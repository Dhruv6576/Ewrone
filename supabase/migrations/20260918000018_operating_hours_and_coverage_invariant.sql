-- Migration: 20260918000018_operating_hours_and_coverage_invariant.sql
-- Description: Enforce operating hours coverage invariant at booking layer, add structural slot backstop,
--              implement schedule_version bumping, exception-first slot retirement, and set_resource_operating_hours RPC.

-- 1. Add schedule_version to public.resources
ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS schedule_version bigint NOT NULL DEFAULT 1;

-- 2. Add UNIQUE constraint to public.operating_hours (one window per weekday per validity period)
ALTER TABLE public.operating_hours
  DROP CONSTRAINT IF EXISTS operating_hours_resource_weekday_validity_key;

ALTER TABLE public.operating_hours
  ADD CONSTRAINT operating_hours_resource_weekday_validity_key
  UNIQUE (resource_id, iso_weekday, valid_from);

-- 3. Coverage Invariant Helper Function
CREATE OR REPLACE FUNCTION private.assert_within_operating_hours(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_res record;
  v_start_date date;
  v_end_date date;
  v_curr_date date;
  v_dow int;
  v_ex record;
  v_oh record;
  v_period record;
  v_w_start timestamptz;
  v_w_end timestamptz;
  v_ranges tstzrange[] := ARRAY[]::tstzrange[];
  v_combined_range tstzmultirange;
  v_booking_range tstzrange;
BEGIN
  SELECT r.id, r.turf_id, t.timezone INTO v_res
  FROM public.resources r
  JOIN public.turfs t ON t.id = r.turf_id
  WHERE r.id = p_resource_id;

  IF v_res.id IS NULL THEN
    RAISE EXCEPTION 'RESOURCE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  v_start_date := (p_starts_at AT TIME ZONE v_res.timezone)::date;
  v_end_date := (p_ends_at AT TIME ZONE v_res.timezone)::date;
  v_booking_range := tstzrange(p_starts_at, p_ends_at, '[)');

  -- Evaluate each date in the window (starting from previous day for overnight spillover)
  v_curr_date := v_start_date - 1;
  WHILE v_curr_date <= v_end_date LOOP
    v_dow := extract(isodow from v_curr_date)::int;

    -- Check operating exception for this local date
    SELECT * INTO v_ex
    FROM public.operating_exceptions
    WHERE resource_id = p_resource_id AND local_date = v_curr_date;

    IF v_ex.id IS NOT NULL AND v_ex.closed THEN
      -- Closed on this exception date: yields no operational windows
      NULL;
    ELSIF v_ex.id IS NOT NULL AND v_ex.override_periods IS NOT NULL THEN
      -- Exception override periods
      FOR v_period IN SELECT * FROM jsonb_to_recordset(v_ex.override_periods) AS (opens_at time, closes_at time, closes_next_day boolean) LOOP
        v_w_start := (v_curr_date + v_period.opens_at) AT TIME ZONE v_res.timezone;
        v_w_end := ((v_curr_date + CASE WHEN coalesce(v_period.closes_next_day, false) THEN 1 ELSE 0 END) + v_period.closes_at) AT TIME ZONE v_res.timezone;
        v_ranges := array_append(v_ranges, tstzrange(v_w_start, v_w_end, '[)'));
      END LOOP;
    ELSE
      -- Standard operating hours for this weekday
      FOR v_oh IN
        SELECT * FROM public.operating_hours
        WHERE resource_id = p_resource_id
          AND iso_weekday = v_dow
          AND valid_from <= v_curr_date
          AND (valid_until IS NULL OR valid_until >= v_curr_date)
      LOOP
        v_w_start := (v_curr_date + v_oh.opens_at) AT TIME ZONE v_res.timezone;
        v_w_end := ((v_curr_date + CASE WHEN v_oh.closes_next_day THEN 1 ELSE 0 END) + v_oh.closes_at) AT TIME ZONE v_res.timezone;
        v_ranges := array_append(v_ranges, tstzrange(v_w_start, v_w_end, '[)'));
      END LOOP;
    END IF;

    v_curr_date := v_curr_date + 1;
  END LOOP;

  IF array_length(v_ranges, 1) IS NULL THEN
    RAISE EXCEPTION 'OUTSIDE_OPERATING_HOURS: Requested interval is not fully covered by resource operating hours'
      USING ERRCODE = '22023';
  END IF;

  SELECT range_agg(r) INTO v_combined_range FROM unnest(v_ranges) r;

  -- Fail-closed coverage check
  IF v_combined_range IS NULL OR NOT (v_combined_range @> v_booking_range) THEN
    RAISE EXCEPTION 'OUTSIDE_OPERATING_HOURS: Requested interval is not fully covered by resource operating hours'
      USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_within_operating_hours(uuid, timestamptz, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION private.assert_within_operating_hours(uuid, timestamptz, timestamptz) TO authenticated, service_role;

-- 4. Update private.generate_resource_slots to stamp resources.schedule_version
CREATE OR REPLACE FUNCTION private.generate_resource_slots(
  p_resource_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'auth', 'pg_temp'
AS $$
DECLARE
  v_res record;
  v_curr_date date;
  v_dow integer;
  v_oh record;
  v_ex record;
  v_period record;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_inc_interval interval;
  v_generated_count integer := 0;
BEGIN
  SELECT r.id, r.turf_id, r.master_owner_id, r.booking_increment_minutes, r.active, r.schedule_version, t.timezone
  INTO v_res
  FROM public.resources r
  JOIN public.turfs t ON t.id = r.turf_id
  WHERE r.id = p_resource_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESOURCE_NOT_FOUND: Resource % not found', p_resource_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_res.active THEN
    RETURN 0;
  END IF;

  v_inc_interval := (v_res.booking_increment_minutes || ' minutes')::interval;
  v_curr_date := p_start_date;

  WHILE v_curr_date <= p_end_date LOOP
    v_dow := extract(isodow from v_curr_date)::integer;

    -- Check for exceptions on this local date
    SELECT * INTO v_ex
    FROM public.operating_exceptions
    WHERE resource_id = p_resource_id AND local_date = v_curr_date;

    IF v_ex.id IS NOT NULL AND v_ex.closed THEN
      -- Closed on this exception date
      v_curr_date := v_curr_date + 1;
      CONTINUE;
    END IF;

    IF v_ex.id IS NOT NULL AND v_ex.override_periods IS NOT NULL THEN
      -- Operating override periods
      FOR v_period IN SELECT * FROM jsonb_to_recordset(v_ex.override_periods) AS (opens_at time, closes_at time, closes_next_day boolean) LOOP
        v_window_start := (v_curr_date + v_period.opens_at) AT TIME ZONE v_res.timezone;
        IF coalesce(v_period.closes_next_day, false) THEN
          v_window_end := ((v_curr_date + 1) + v_period.closes_at) AT TIME ZONE v_res.timezone;
        ELSE
          v_window_end := (v_curr_date + v_period.closes_at) AT TIME ZONE v_res.timezone;
        END IF;

        v_slot_start := v_window_start;
        WHILE v_slot_start + v_inc_interval <= v_window_end LOOP
          v_slot_end := v_slot_start + v_inc_interval;
          INSERT INTO public.slots (master_owner_id, turf_id, resource_id, starts_at, ends_at, schedule_version)
          VALUES (v_res.master_owner_id, v_res.turf_id, p_resource_id, v_slot_start, v_slot_end, coalesce(v_res.schedule_version, 1))
          ON CONFLICT (resource_id, starts_at) DO NOTHING;
          v_generated_count := v_generated_count + 1;
          v_slot_start := v_slot_end;
        END LOOP;
      END LOOP;
    ELSE
      -- Standard operating hours for this weekday
      FOR v_oh IN
        SELECT * FROM public.operating_hours
        WHERE resource_id = p_resource_id
          AND iso_weekday = v_dow
          AND valid_from <= v_curr_date
          AND (valid_until IS NULL OR valid_until >= v_curr_date)
      LOOP
        v_window_start := (v_curr_date + v_oh.opens_at) AT TIME ZONE v_res.timezone;
        IF v_oh.closes_next_day THEN
          v_window_end := ((v_curr_date + 1) + v_oh.closes_at) AT TIME ZONE v_res.timezone;
        ELSE
          v_window_end := (v_curr_date + v_oh.closes_at) AT TIME ZONE v_res.timezone;
        END IF;

        v_slot_start := v_window_start;
        WHILE v_slot_start + v_inc_interval <= v_window_end LOOP
          v_slot_end := v_slot_start + v_inc_interval;
          INSERT INTO public.slots (master_owner_id, turf_id, resource_id, starts_at, ends_at, schedule_version)
          VALUES (v_res.master_owner_id, v_res.turf_id, p_resource_id, v_slot_start, v_slot_end, coalesce(v_res.schedule_version, 1))
          ON CONFLICT (resource_id, starts_at) DO NOTHING;
          v_generated_count := v_generated_count + 1;
          v_slot_start := v_slot_end;
        END LOOP;
      END LOOP;
    END IF;

    v_curr_date := v_curr_date + 1;
  END LOOP;

  RETURN v_generated_count;
END;
$$;

REVOKE ALL ON FUNCTION private.generate_resource_slots(uuid, date, date) FROM public;
GRANT EXECUTE ON FUNCTION private.generate_resource_slots(uuid, date, date) TO authenticated, service_role;

-- 5. Redefine public.create_booking_hold with Coverage Invariant and Slot Backstop
CREATE OR REPLACE FUNCTION public.create_booking_hold(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_idempotency_key text,
  p_contact_name text DEFAULT NULL,
  p_contact_phone text DEFAULT NULL,
  p_contact_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'auth', 'pg_temp'
AS $$
DECLARE
  v_uid uuid;
  v_profile record;
  v_cached_response jsonb;
  v_req_hash text;
  v_res record;
  v_settings record;
  v_quote jsonb;
  v_hold_seconds integer;
  v_hold_expires_at timestamptz;
  v_booking_id uuid;
  v_ref_code text;
  v_alloc_id uuid;
  v_comm_rule record;
  v_comm_snapshot jsonb;
  v_slot record;
  v_inc_start timestamptz;
  v_inc_end timestamptz;
  v_inc_interval interval;
  v_result jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Authentication required to create booking hold' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND: User profile does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED: An idempotency key is required' USING ERRCODE = '22023';
  END IF;

  v_req_hash := md5(p_resource_id::text || ':' || p_starts_at::text || ':' || p_ends_at::text);

  -- Step 2: Check Idempotency Table
  SELECT response_json INTO v_cached_response
  FROM private.api_idempotency
  WHERE actor_user_id = v_uid
    AND operation = 'create_booking_hold'
    AND idempotency_key = p_idempotency_key;

  IF v_cached_response IS NOT NULL THEN
    RETURN v_cached_response;
  END IF;

  -- Step 3: SERIALIZE ON THE RESOURCE ROW
  SELECT
    r.id, r.turf_id, r.master_owner_id, r.name, r.active,
    r.booking_increment_minutes, r.minimum_duration_minutes, r.maximum_duration_minutes,
    t.timezone, t.approval_status, t.archived_at, mo.status AS owner_status
  INTO v_res
  FROM public.resources r
  JOIN public.turfs t ON t.id = r.turf_id
  JOIN public.master_owners mo ON mo.id = r.master_owner_id
  WHERE r.id = p_resource_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESOURCE_NOT_FOUND: Resource % not found', p_resource_id USING ERRCODE = 'P0002';
  END IF;

  -- Step 4: Verification of active venue & business
  IF NOT v_res.active OR v_res.archived_at IS NOT NULL OR v_res.approval_status <> 'approved' OR v_res.owner_status <> 'active' THEN
    RAISE EXCEPTION 'RESOURCE_UNAVAILABLE: Venue is not active, not approved, or suspended' USING ERRCODE = '22023';
  END IF;

  -- Coverage Invariant Check
  PERFORM private.assert_within_operating_hours(p_resource_id, p_starts_at, p_ends_at);

  -- Step 5: Opportunistic Expiry of stale holds on this resource
  UPDATE public.inventory_allocations
  SET released_at = now()
  WHERE resource_id = p_resource_id
    AND kind = 'hold'
    AND released_at IS NULL
    AND expires_at < now();

  -- Step 6: JIT Slot Materialization
  PERFORM private.generate_resource_slots(
    p_resource_id,
    (p_starts_at AT TIME ZONE v_res.timezone)::date,
    (p_ends_at AT TIME ZONE v_res.timezone)::date
  );

  -- Step 7: Authoritative Pricing Quote Calculation
  v_quote := public.quote_booking(p_resource_id, p_starts_at, p_ends_at);

  -- Fetch booking settings for hold TTL
  SELECT * INTO v_settings FROM public.turf_booking_settings WHERE turf_id = v_res.turf_id;
  v_hold_seconds := coalesce(v_settings.hold_seconds, 420);
  v_hold_expires_at := now() + (v_hold_seconds || ' seconds')::interval;

  -- Commission Snapshot
  SELECT basis_points, fixed_minor INTO v_comm_rule
  FROM private.commission_rules
  WHERE (master_owner_id = v_res.master_owner_id OR master_owner_id IS NULL)
    AND effective_from <= now()
    AND (effective_until IS NULL OR effective_until > now())
  ORDER BY master_owner_id NULLS LAST, version DESC
  LIMIT 1;

  v_comm_snapshot := jsonb_build_object(
    'basis_points', coalesce(v_comm_rule.basis_points, 1000),
    'fixed_minor', coalesce(v_comm_rule.fixed_minor, 0),
    'estimated_commission_minor', round(((v_quote->>'total_minor')::bigint * coalesce(v_comm_rule.basis_points, 1000)) / 10000.0) + coalesce(v_comm_rule.fixed_minor, 0)
  );

  -- Unique booking reference code
  v_ref_code := 'BK-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
  v_booking_id := gen_random_uuid();

  -- Step 10: Insert Booking record (status = 'held')
  INSERT INTO public.bookings (
    id, reference_code, master_owner_id, turf_id, resource_id,
    player_user_id, created_by, source, status,
    starts_at, ends_at, hold_expires_at,
    total_minor, required_online_minor, currency,
    pricing_snapshot, cancellation_snapshot, commission_snapshot
  ) VALUES (
    v_booking_id, v_ref_code, v_res.master_owner_id, v_res.turf_id, p_resource_id,
    v_uid, v_uid, 'online', 'held',
    p_starts_at, p_ends_at, v_hold_expires_at,
    (v_quote->>'total_minor')::bigint, (v_quote->>'required_online_minor')::bigint, 'INR',
    v_quote->'pricing_snapshot', v_quote->'cancellation_snapshot', v_comm_snapshot
  );

  -- Step 11: Insert Inventory Allocation (Exclusion constraint protects here)
  BEGIN
    INSERT INTO public.inventory_allocations (
      master_owner_id, turf_id, resource_id, booking_id,
      kind, starts_at, ends_at, expires_at, created_by
    ) VALUES (
      v_res.master_owner_id, v_res.turf_id, p_resource_id, v_booking_id,
      'hold', p_starts_at, p_ends_at, v_hold_expires_at, v_uid
    ) RETURNING id INTO v_alloc_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'SLOT_UNAVAILABLE: This time interval is no longer available' USING ERRCODE = '23P01';
  END;

  -- Step 12: Map constituent booking_slots with per-increment backstop
  v_inc_interval := (v_res.booking_increment_minutes || ' minutes')::interval;
  v_inc_start := p_starts_at;
  WHILE v_inc_start < p_ends_at LOOP
    v_inc_end := v_inc_start + v_inc_interval;

    SELECT id INTO v_slot
    FROM public.slots
    WHERE resource_id = p_resource_id
      AND starts_at = v_inc_start;

    IF v_slot.id IS NULL THEN
      RAISE EXCEPTION 'SLOT_NOT_FOUND: Required slot starting at % was not materialized (unaligned or out of schedule)', v_inc_start
        USING ERRCODE = 'P0003';
    END IF;

    INSERT INTO public.booking_slots (
      booking_id, slot_id, resource_id, turf_id, master_owner_id, quoted_amount_minor
    ) VALUES (
      v_booking_id, v_slot.id, p_resource_id, v_res.turf_id, v_res.master_owner_id,
      round((v_quote->>'total_minor')::bigint / ((v_quote->'pricing_snapshot'->>'increments_count')::int))
    ) ON CONFLICT DO NOTHING;

    v_inc_start := v_inc_end;
  END LOOP;

  -- Step 13: Booking Contact
  INSERT INTO private.booking_contacts (
    booking_id, contact_name, contact_phone, contact_email
  ) VALUES (
    v_booking_id,
    coalesce(p_contact_name, v_profile.display_name),
    p_contact_phone,
    p_contact_email
  );

  -- Step 14: Booking Event
  INSERT INTO public.booking_events (booking_id, event_type, public_summary)
  VALUES (v_booking_id, 'hold_created', 'Booking hold created. Awaiting checkout payment.');

  -- Construct Response
  v_result := jsonb_build_object(
    'booking_id', v_booking_id,
    'reference_code', v_ref_code,
    'status', 'held',
    'resource_id', p_resource_id,
    'turf_id', v_res.turf_id,
    'starts_at', p_starts_at,
    'ends_at', p_ends_at,
    'hold_expires_at', v_hold_expires_at,
    'hold_seconds', v_hold_seconds,
    'total_minor', (v_quote->>'total_minor')::bigint,
    'required_online_minor', (v_quote->>'required_online_minor')::bigint,
    'currency', 'INR'
  );

  -- Step 15: Cache in Idempotency table (with expires_at)
  INSERT INTO private.api_idempotency (
    actor_user_id, operation, idempotency_key, request_hash, response_json, expires_at
  ) VALUES (
    v_uid, 'create_booking_hold', p_idempotency_key, v_req_hash, v_result, now() + interval '24 hours'
  ) ON CONFLICT (actor_user_id, operation, idempotency_key) DO NOTHING;

  RETURN v_result;
END;
$$;

-- 6. Redefine public.create_walkin_booking with 9 args, Coverage Invariant, and Slot Backstop
CREATE OR REPLACE FUNCTION public.create_walkin_booking(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_contact_name text,
  p_contact_phone text,
  p_contact_email text DEFAULT NULL,
  p_payment_method text DEFAULT 'cash',
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'auth', 'pg_temp'
AS $$
DECLARE
  v_uid uuid;
  v_res record;
  v_quote jsonb;
  v_total_minor bigint;
  v_comm_rule record;
  v_comm_snapshot jsonb;
  v_commission_minor bigint;
  v_ref_code text;
  v_booking_id uuid;
  v_slot_id uuid;
  v_inc_start timestamptz;
  v_inc_end timestamptz;
  v_inc_interval interval;
  v_cached_response jsonb;
  v_req_hash text;
  v_result jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    SELECT response_json INTO v_cached_response
    FROM private.api_idempotency
    WHERE actor_user_id = v_uid
      AND operation = 'create_walkin_booking'
      AND idempotency_key = p_idempotency_key;

    IF v_cached_response IS NOT NULL THEN
      RETURN v_cached_response;
    END IF;
  END IF;

  -- Verify Resource and serialize
  SELECT
    r.id, r.turf_id, r.master_owner_id, r.name, r.active,
    r.booking_increment_minutes, r.minimum_duration_minutes, r.maximum_duration_minutes,
    t.timezone, t.approval_status, t.archived_at, mo.status AS owner_status
  INTO v_res
  FROM public.resources r
  JOIN public.turfs t ON t.id = r.turf_id
  JOIN public.master_owners mo ON mo.id = r.master_owner_id
  WHERE r.id = p_resource_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESOURCE_NOT_FOUND: Resource % not found', p_resource_id USING ERRCODE = 'P0002';
  END IF;

  -- Authorization check FIRST: Master Owner or staff with bookings.create_walkin AND payments.record_offline (or bookings.manage)
  -- Note: private.can_turf strictly enforces that archived turfs deny all write capabilities, raising 42501.
  IF NOT (
    (private.can_turf(v_uid, v_res.turf_id, 'bookings.create_walkin') AND private.can_turf(v_uid, v_res.turf_id, 'payments.record_offline'))
    OR private.can_turf(v_uid, v_res.turf_id, 'bookings.manage')
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Caller lacks walk-in creation or offline payment recording authority on turf %', v_res.turf_id
      USING ERRCODE = '42501';
  END IF;

  -- Verification of active venue & business
  IF NOT v_res.active OR v_res.archived_at IS NOT NULL OR v_res.approval_status <> 'approved' OR v_res.owner_status <> 'active' THEN
    RAISE EXCEPTION 'RESOURCE_UNAVAILABLE: Venue is not active, not approved, or suspended' USING ERRCODE = '22023';
  END IF;

  -- Coverage Invariant Check
  PERFORM private.assert_within_operating_hours(p_resource_id, p_starts_at, p_ends_at);

  -- Opportunistic expiry of stale holds
  UPDATE public.inventory_allocations
  SET released_at = now()
  WHERE resource_id = p_resource_id
    AND kind = 'hold'
    AND released_at IS NULL
    AND expires_at < now();

  -- JIT Slot Materialization
  PERFORM private.generate_resource_slots(
    p_resource_id,
    (p_starts_at AT TIME ZONE v_res.timezone)::date,
    (p_ends_at AT TIME ZONE v_res.timezone)::date
  );

  -- Authoritative Pricing Quote Calculation
  v_quote := public.quote_booking(p_resource_id, p_starts_at, p_ends_at);
  v_total_minor := (v_quote->>'total_minor')::bigint;

  -- Commission Snapshot
  SELECT basis_points, fixed_minor INTO v_comm_rule
  FROM private.commission_rules
  WHERE (master_owner_id = v_res.master_owner_id OR master_owner_id IS NULL)
    AND effective_from <= now()
    AND (effective_until IS NULL OR effective_until > now())
  ORDER BY master_owner_id NULLS LAST, version DESC
  LIMIT 1;

  v_commission_minor := round((v_total_minor * coalesce(v_comm_rule.basis_points, 1000)) / 10000.0) + coalesce(v_comm_rule.fixed_minor, 0);

  v_comm_snapshot := jsonb_build_object(
    'basis_points', coalesce(v_comm_rule.basis_points, 1000),
    'fixed_minor', coalesce(v_comm_rule.fixed_minor, 0),
    'estimated_commission_minor', v_commission_minor
  );

  v_ref_code := 'WK-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
  v_booking_id := gen_random_uuid();

  -- Step 1: Insert Booking record
  INSERT INTO public.bookings (
    id, reference_code, master_owner_id, turf_id, resource_id,
    player_user_id, created_by, source, status,
    starts_at, ends_at, hold_expires_at,
    total_minor, required_online_minor, currency,
    pricing_snapshot, cancellation_snapshot, commission_snapshot,
    confirmed_at
  ) VALUES (
    v_booking_id, v_ref_code, v_res.master_owner_id, v_res.turf_id, p_resource_id,
    NULL, v_uid, 'walkin', 'confirmed',
    p_starts_at, p_ends_at, NULL,
    v_total_minor, 0, 'INR',
    v_quote->'pricing_snapshot', v_quote->'cancellation_snapshot', v_comm_snapshot,
    now()
  );

  -- Step 2: Insert Inventory Allocation
  BEGIN
    INSERT INTO public.inventory_allocations (
      master_owner_id, turf_id, resource_id, booking_id,
      kind, starts_at, ends_at, expires_at, created_by
    ) VALUES (
      v_res.master_owner_id, v_res.turf_id, p_resource_id, v_booking_id,
      'booking', p_starts_at, p_ends_at, NULL, v_uid
    );
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'SLOT_UNAVAILABLE: Time range overlaps with an existing reservation or hold' USING ERRCODE = '23P01';
  END;

  -- Step 3: Map constituent booking_slots with per-increment backstop
  v_inc_interval := (v_res.booking_increment_minutes || ' minutes')::interval;
  v_inc_start := p_starts_at;
  WHILE v_inc_start < p_ends_at LOOP
    v_inc_end := v_inc_start + v_inc_interval;

    SELECT id INTO v_slot_id
    FROM public.slots
    WHERE resource_id = p_resource_id
      AND starts_at = v_inc_start;

    IF v_slot_id IS NULL THEN
      RAISE EXCEPTION 'SLOT_NOT_FOUND: Required slot starting at % was not materialized (unaligned or out of schedule)', v_inc_start
        USING ERRCODE = 'P0003';
    END IF;

    INSERT INTO public.booking_slots (
      booking_id, slot_id, resource_id, turf_id, master_owner_id, quoted_amount_minor
    ) VALUES (
      v_booking_id, v_slot_id, p_resource_id, v_res.turf_id, v_res.master_owner_id,
      round(v_total_minor::numeric / greatest((v_quote->'pricing_snapshot'->>'increments_count')::int, 1))
    ) ON CONFLICT DO NOTHING;

    v_inc_start := v_inc_end;
  END LOOP;

  -- Step 4: Insert Booking Contact with 180-day retention horizon
  INSERT INTO private.booking_contacts (
    booking_id, contact_name, contact_phone, contact_email, retention_until
  ) VALUES (
    v_booking_id, p_contact_name, p_contact_phone, p_contact_email, p_ends_at + interval '180 days'
  );

  -- Step 5: Insert Booking Event
  INSERT INTO public.booking_events (
    booking_id, event_type, public_summary
  ) VALUES (
    v_booking_id, 'walkin_confirmed', format('Walk-in booking confirmed via %s by counter staff', p_payment_method)
  );

  v_result := jsonb_build_object(
    'booking_id', v_booking_id,
    'reference_code', v_ref_code,
    'status', 'confirmed',
    'total_minor', v_total_minor,
    'starts_at', p_starts_at,
    'ends_at', p_ends_at
  );

  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    v_req_hash := md5(p_resource_id::text || ':' || p_starts_at::text || ':' || p_ends_at::text);
    INSERT INTO private.api_idempotency (
      actor_user_id, operation, idempotency_key, request_hash, response_json, expires_at
    ) VALUES (
      v_uid, 'create_walkin_booking', p_idempotency_key, v_req_hash, v_result, now() + interval '24 hours'
    ) ON CONFLICT (actor_user_id, operation, idempotency_key) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

-- 7. Implement public.set_resource_operating_hours
CREATE OR REPLACE FUNCTION public.set_resource_operating_hours(
  p_resource_id uuid,
  p_hours jsonb,
  p_valid_from date DEFAULT NULL,
  p_valid_until date DEFAULT NULL
)
RETURNS SETOF public.operating_hours
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_res record;
  v_tz text;
  v_valid_from date;
  v_elem record;
  v_new_version bigint;
  v_conflict_count integer;
  v_conflicted_booking_ids jsonb;
BEGIN
  -- Verify resource and permissions
  SELECT r.id, r.turf_id, t.timezone INTO v_res
  FROM public.resources r
  JOIN public.turfs t ON t.id = r.turf_id
  WHERE r.id = p_resource_id;

  IF v_res.id IS NULL THEN
    RAISE EXCEPTION 'RESOURCE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF NOT private.can_turf(v_res.turf_id, 'listing.edit') THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Caller lacks listing.edit on turf %', v_res.turf_id
      USING ERRCODE = '42501';
  END IF;

  v_tz := v_res.timezone;
  v_valid_from := coalesce(p_valid_from, (now() AT TIME ZONE v_tz)::date);

  IF p_valid_until IS NOT NULL AND p_valid_until < v_valid_from THEN
    RAISE EXCEPTION 'INVALID_VALIDITY_WINDOW: valid_until must be >= valid_from'
      USING ERRCODE = '22023';
  END IF;

  -- Validate payload: single window per weekday, valid hours, no internal overlaps
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_hours) AS a(iso_weekday int, opens_at time, closes_at time, closes_next_day boolean),
         jsonb_to_recordset(p_hours) AS b(iso_weekday int, opens_at time, closes_at time, closes_next_day boolean)
    WHERE a.iso_weekday = b.iso_weekday
      AND (a.opens_at, a.closes_at) != (b.opens_at, b.closes_at)
      AND (extract(epoch from a.opens_at)) < (extract(epoch from b.closes_at) + CASE WHEN coalesce(b.closes_next_day, false) THEN 86400 ELSE 0 END)
      AND (extract(epoch from b.opens_at)) < (extract(epoch from a.closes_at) + CASE WHEN coalesce(a.closes_next_day, false) THEN 86400 ELSE 0 END)
  ) THEN
    RAISE EXCEPTION 'OVERLAPPING_OPERATING_HOURS: Operating hours for weekday overlap'
      USING ERRCODE = '22023';
  END IF;

  -- Check for duplicate weekdays in payload (enforcing one window per weekday)
  IF EXISTS (
    SELECT (h->>'iso_weekday')::int
    FROM jsonb_array_elements(p_hours) h
    GROUP BY (h->>'iso_weekday')::int
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_OPERATING_HOURS: Only one window per weekday is supported'
      USING ERRCODE = '22023';
  END IF;

  -- Windowing: Cap open-ended predecessors and replace overlapping validity windows
  FOR v_elem IN SELECT * FROM jsonb_to_recordset(p_hours) AS (iso_weekday int, opens_at time, closes_at time, closes_next_day boolean)
  LOOP
    IF v_elem.iso_weekday < 1 OR v_elem.iso_weekday > 7 THEN
      RAISE EXCEPTION 'INVALID_ISO_WEEKDAY: must be 1..7' USING ERRCODE = '22023';
    END IF;

    -- Cap open-ended predecessors
    UPDATE public.operating_hours
    SET valid_until = v_valid_from - 1
    WHERE resource_id = p_resource_id
      AND iso_weekday = v_elem.iso_weekday
      AND valid_from < v_valid_from
      AND (valid_until IS NULL OR valid_until >= v_valid_from);

    -- Delete existing rows completely covered by the new window
    DELETE FROM public.operating_hours
    WHERE resource_id = p_resource_id
      AND iso_weekday = v_elem.iso_weekday
      AND valid_from >= v_valid_from
      AND (p_valid_until IS NULL OR valid_from <= p_valid_until);

    -- Insert new operating hours row
    INSERT INTO public.operating_hours (
      resource_id, iso_weekday, opens_at, closes_at, closes_next_day, valid_from, valid_until
    ) VALUES (
      p_resource_id, v_elem.iso_weekday, v_elem.opens_at, v_elem.closes_at,
      coalesce(v_elem.closes_next_day, false), v_valid_from, p_valid_until
    );
  END LOOP;

  -- Bump schedule_version on resources
  UPDATE public.resources
  SET schedule_version = schedule_version + 1
  WHERE id = p_resource_id
  RETURNING schedule_version INTO v_new_version;

  -- Re-stamp surviving in-schedule future slots to v_new_version
  UPDATE public.slots s
  SET schedule_version = v_new_version
  WHERE s.resource_id = p_resource_id
    AND s.starts_at >= now()
    AND (
      -- Check slot covered by exception on its date or previous date (overnight spillover)
      EXISTS (
        SELECT 1
        FROM public.operating_exceptions ex,
             jsonb_to_recordset(ex.override_periods) AS p(opens_at time, closes_at time, closes_next_day boolean)
        WHERE ex.resource_id = s.resource_id
          AND ex.local_date = (s.starts_at AT TIME ZONE v_tz)::date
          AND NOT ex.closed
          AND ex.override_periods IS NOT NULL
          AND s.starts_at >= (ex.local_date + p.opens_at) AT TIME ZONE v_tz
          AND s.ends_at <= ((ex.local_date + CASE WHEN coalesce(p.closes_next_day, false) THEN 1 ELSE 0 END) + p.closes_at) AT TIME ZONE v_tz
      )
      OR EXISTS (
        SELECT 1
        FROM public.operating_exceptions ex,
             jsonb_to_recordset(ex.override_periods) AS p(opens_at time, closes_at time, closes_next_day boolean)
        WHERE ex.resource_id = s.resource_id
          AND ex.local_date = ((s.starts_at AT TIME ZONE v_tz)::date - 1)
          AND NOT ex.closed
          AND ex.override_periods IS NOT NULL
          AND coalesce(p.closes_next_day, false)
          AND s.starts_at >= (ex.local_date + p.opens_at) AT TIME ZONE v_tz
          AND s.ends_at <= ((ex.local_date + 1) + p.closes_at) AT TIME ZONE v_tz
      )
      -- Or standard hours on its date
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.operating_exceptions ex
          WHERE ex.resource_id = s.resource_id
            AND ex.local_date = (s.starts_at AT TIME ZONE v_tz)::date
            AND (ex.closed OR ex.override_periods IS NOT NULL)
        )
        AND EXISTS (
          SELECT 1 FROM public.operating_hours oh
          WHERE oh.resource_id = s.resource_id
            AND oh.iso_weekday = extract(isodow from (s.starts_at AT TIME ZONE v_tz))::int
            AND oh.valid_from <= (s.starts_at AT TIME ZONE v_tz)::date
            AND (oh.valid_until IS NULL OR oh.valid_until >= (s.starts_at AT TIME ZONE v_tz)::date)
            AND s.starts_at >= ((s.starts_at AT TIME ZONE v_tz)::date + oh.opens_at) AT TIME ZONE v_tz
            AND s.ends_at <= (((s.starts_at AT TIME ZONE v_tz)::date + CASE WHEN oh.closes_next_day THEN 1 ELSE 0 END) + oh.closes_at) AT TIME ZONE v_tz
        )
      )
      -- Or standard hours from previous date (overnight spillover)
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.operating_exceptions ex
          WHERE ex.resource_id = s.resource_id
            AND ex.local_date = ((s.starts_at AT TIME ZONE v_tz)::date - 1)
            AND (ex.closed OR ex.override_periods IS NOT NULL)
        )
        AND EXISTS (
          SELECT 1 FROM public.operating_hours oh
          WHERE oh.resource_id = s.resource_id
            AND oh.iso_weekday = extract(isodow from ((s.starts_at AT TIME ZONE v_tz)::date - 1))::int
            AND oh.valid_from <= ((s.starts_at AT TIME ZONE v_tz)::date - 1)
            AND (oh.valid_until IS NULL OR oh.valid_until >= ((s.starts_at AT TIME ZONE v_tz)::date - 1))
            AND oh.closes_next_day
            AND s.starts_at >= (((s.starts_at AT TIME ZONE v_tz)::date - 1) + oh.opens_at) AT TIME ZONE v_tz
            AND s.ends_at <= (((s.starts_at AT TIME ZONE v_tz)::date) + oh.closes_at) AT TIME ZONE v_tz
        )
      )
    );

  -- Delete unallocated future slots outside schedule
  DELETE FROM public.slots s
  WHERE s.resource_id = p_resource_id
    AND s.starts_at >= now()
    AND NOT EXISTS (SELECT 1 FROM public.booking_slots bs WHERE bs.slot_id = s.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.inventory_allocations ia
      WHERE ia.resource_id = s.resource_id
        AND ia.released_at IS NULL
        AND (ia.expires_at IS NULL OR ia.expires_at > now())
        AND ia.occupied_period && tstzrange(s.starts_at, s.ends_at, '[)')
    )
    AND NOT (
      EXISTS (
        SELECT 1
        FROM public.operating_exceptions ex,
             jsonb_to_recordset(ex.override_periods) AS p(opens_at time, closes_at time, closes_next_day boolean)
        WHERE ex.resource_id = s.resource_id
          AND ex.local_date = (s.starts_at AT TIME ZONE v_tz)::date
          AND NOT ex.closed
          AND ex.override_periods IS NOT NULL
          AND s.starts_at >= (ex.local_date + p.opens_at) AT TIME ZONE v_tz
          AND s.ends_at <= ((ex.local_date + CASE WHEN coalesce(p.closes_next_day, false) THEN 1 ELSE 0 END) + p.closes_at) AT TIME ZONE v_tz
      )
      OR EXISTS (
        SELECT 1
        FROM public.operating_exceptions ex,
             jsonb_to_recordset(ex.override_periods) AS p(opens_at time, closes_at time, closes_next_day boolean)
        WHERE ex.resource_id = s.resource_id
          AND ex.local_date = ((s.starts_at AT TIME ZONE v_tz)::date - 1)
          AND NOT ex.closed
          AND ex.override_periods IS NOT NULL
          AND coalesce(p.closes_next_day, false)
          AND s.starts_at >= (ex.local_date + p.opens_at) AT TIME ZONE v_tz
          AND s.ends_at <= ((ex.local_date + 1) + p.closes_at) AT TIME ZONE v_tz
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.operating_exceptions ex
          WHERE ex.resource_id = s.resource_id
            AND ex.local_date = (s.starts_at AT TIME ZONE v_tz)::date
            AND (ex.closed OR ex.override_periods IS NOT NULL)
        )
        AND EXISTS (
          SELECT 1 FROM public.operating_hours oh
          WHERE oh.resource_id = s.resource_id
            AND oh.iso_weekday = extract(isodow from (s.starts_at AT TIME ZONE v_tz))::int
            AND oh.valid_from <= (s.starts_at AT TIME ZONE v_tz)::date
            AND (oh.valid_until IS NULL OR oh.valid_until >= (s.starts_at AT TIME ZONE v_tz)::date)
            AND s.starts_at >= ((s.starts_at AT TIME ZONE v_tz)::date + oh.opens_at) AT TIME ZONE v_tz
            AND s.ends_at <= (((s.starts_at AT TIME ZONE v_tz)::date + CASE WHEN oh.closes_next_day THEN 1 ELSE 0 END) + oh.closes_at) AT TIME ZONE v_tz
        )
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.operating_exceptions ex
          WHERE ex.resource_id = s.resource_id
            AND ex.local_date = ((s.starts_at AT TIME ZONE v_tz)::date - 1)
            AND (ex.closed OR ex.override_periods IS NOT NULL)
        )
        AND EXISTS (
          SELECT 1 FROM public.operating_hours oh
          WHERE oh.resource_id = s.resource_id
            AND oh.iso_weekday = extract(isodow from ((s.starts_at AT TIME ZONE v_tz)::date - 1))::int
            AND oh.valid_from <= ((s.starts_at AT TIME ZONE v_tz)::date - 1)
            AND (oh.valid_until IS NULL OR oh.valid_until >= ((s.starts_at AT TIME ZONE v_tz)::date - 1))
            AND oh.closes_next_day
            AND s.starts_at >= (((s.starts_at AT TIME ZONE v_tz)::date - 1) + oh.opens_at) AT TIME ZONE v_tz
            AND s.ends_at <= (((s.starts_at AT TIME ZONE v_tz)::date) + oh.closes_at) AT TIME ZONE v_tz
        )
      )
    );

  -- Check for conflicting booked slots that are now out-of-schedule
  SELECT count(*), coalesce(jsonb_agg(DISTINCT bs.booking_id), '[]'::jsonb)
  INTO v_conflict_count, v_conflicted_booking_ids
  FROM public.slots s
  JOIN public.booking_slots bs ON bs.slot_id = s.id
  WHERE s.resource_id = p_resource_id
    AND s.starts_at >= now()
    AND NOT (
      EXISTS (
        SELECT 1
        FROM public.operating_exceptions ex,
             jsonb_to_recordset(ex.override_periods) AS p(opens_at time, closes_at time, closes_next_day boolean)
        WHERE ex.resource_id = s.resource_id
          AND ex.local_date = (s.starts_at AT TIME ZONE v_tz)::date
          AND NOT ex.closed
          AND ex.override_periods IS NOT NULL
          AND s.starts_at >= (ex.local_date + p.opens_at) AT TIME ZONE v_tz
          AND s.ends_at <= ((ex.local_date + CASE WHEN coalesce(p.closes_next_day, false) THEN 1 ELSE 0 END) + p.closes_at) AT TIME ZONE v_tz
      )
      OR EXISTS (
        SELECT 1
        FROM public.operating_exceptions ex,
             jsonb_to_recordset(ex.override_periods) AS p(opens_at time, closes_at time, closes_next_day boolean)
        WHERE ex.resource_id = s.resource_id
          AND ex.local_date = ((s.starts_at AT TIME ZONE v_tz)::date - 1)
          AND NOT ex.closed
          AND ex.override_periods IS NOT NULL
          AND coalesce(p.closes_next_day, false)
          AND s.starts_at >= (ex.local_date + p.opens_at) AT TIME ZONE v_tz
          AND s.ends_at <= ((ex.local_date + 1) + p.closes_at) AT TIME ZONE v_tz
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.operating_exceptions ex
          WHERE ex.resource_id = s.resource_id
            AND ex.local_date = (s.starts_at AT TIME ZONE v_tz)::date
            AND (ex.closed OR ex.override_periods IS NOT NULL)
        )
        AND EXISTS (
          SELECT 1 FROM public.operating_hours oh
          WHERE oh.resource_id = s.resource_id
            AND oh.iso_weekday = extract(isodow from (s.starts_at AT TIME ZONE v_tz))::int
            AND oh.valid_from <= (s.starts_at AT TIME ZONE v_tz)::date
            AND (oh.valid_until IS NULL OR oh.valid_until >= (s.starts_at AT TIME ZONE v_tz)::date)
            AND s.starts_at >= ((s.starts_at AT TIME ZONE v_tz)::date + oh.opens_at) AT TIME ZONE v_tz
            AND s.ends_at <= (((s.starts_at AT TIME ZONE v_tz)::date + CASE WHEN oh.closes_next_day THEN 1 ELSE 0 END) + oh.closes_at) AT TIME ZONE v_tz
        )
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.operating_exceptions ex
          WHERE ex.resource_id = s.resource_id
            AND ex.local_date = ((s.starts_at AT TIME ZONE v_tz)::date - 1)
            AND (ex.closed OR ex.override_periods IS NOT NULL)
        )
        AND EXISTS (
          SELECT 1 FROM public.operating_hours oh
          WHERE oh.resource_id = s.resource_id
            AND oh.iso_weekday = extract(isodow from ((s.starts_at AT TIME ZONE v_tz)::date - 1))::int
            AND oh.valid_from <= ((s.starts_at AT TIME ZONE v_tz)::date - 1)
            AND (oh.valid_until IS NULL OR oh.valid_until >= ((s.starts_at AT TIME ZONE v_tz)::date - 1))
            AND oh.closes_next_day
            AND s.starts_at >= (((s.starts_at AT TIME ZONE v_tz)::date - 1) + oh.opens_at) AT TIME ZONE v_tz
            AND s.ends_at <= (((s.starts_at AT TIME ZONE v_tz)::date) + oh.closes_at) AT TIME ZONE v_tz
        )
      )
    );

  IF v_conflict_count > 0 THEN
    INSERT INTO private.operational_alerts (
      alert_type,
      severity,
      entity_type,
      entity_id,
      title,
      details,
      status
    ) VALUES (
      'schedule_conflict',
      'warning',
      'resource',
      p_resource_id::text,
      'Booking schedule conflict after operating hours change',
      jsonb_build_object(
        'resource_id', p_resource_id,
        'conflict_count', v_conflict_count,
        'conflicted_booking_ids', v_conflicted_booking_ids
      ),
      'active'
    )
    ON CONFLICT (alert_type, entity_id) WHERE status = 'active'
    DO UPDATE SET
      details = EXCLUDED.details;
  END IF;

  RETURN QUERY
  SELECT * FROM public.operating_hours
  WHERE resource_id = p_resource_id
  ORDER BY iso_weekday, opens_at;
END;
$$;

REVOKE ALL ON FUNCTION public.set_resource_operating_hours(uuid, jsonb, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.set_resource_operating_hours(uuid, jsonb, date, date) TO authenticated, service_role;
