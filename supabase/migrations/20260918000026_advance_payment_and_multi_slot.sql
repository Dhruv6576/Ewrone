-- Migration: 20260918000026_advance_payment_and_multi_slot.sql
-- Description: Multi-slot booking support, owner-configurable advance modes (fixed per slot & basis points),
--              balance tracking on bookings, venue balance collection RPC, and strict online payment order controls.

-- ============================================================================
-- 1. EXTEND public.turf_booking_settings WITH FIXED ADVANCE PER SLOT
-- ============================================================================

ALTER TABLE public.turf_booking_settings
  ADD COLUMN IF NOT EXISTS advance_fixed_per_slot_minor bigint
    CHECK (advance_fixed_per_slot_minor IS NULL OR advance_fixed_per_slot_minor > 0);

COMMENT ON COLUMN public.turf_booking_settings.advance_fixed_per_slot_minor IS
  'When non-null, the required online advance is advance_fixed_per_slot_minor * (number of slots). When null, falls back to advance_basis_points.';

-- ============================================================================
-- 2. EXTEND public.bookings WITH BALANCE TRACKING
-- ============================================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS balance_due_minor bigint NOT NULL DEFAULT 0 CHECK (balance_due_minor >= 0),
  ADD COLUMN IF NOT EXISTS balance_collected_at timestamptz,
  ADD COLUMN IF NOT EXISTS balance_collected_by uuid REFERENCES public.profiles(user_id),
  ADD COLUMN IF NOT EXISTS balance_collection_method text CHECK (balance_collection_method IN ('cash','upi','card','other')),
  ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'full' CHECK (payment_mode IN ('full','advance'));

-- Backfill existing rows
UPDATE public.bookings
SET balance_due_minor = total_minor - required_online_minor,
    payment_mode = CASE WHEN required_online_minor = total_minor THEN 'full' ELSE 'advance' END;

-- Invariant: required_online_minor + balance_due_minor = total_minor for held bookings, and balance_due_minor <= total_minor - required_online_minor at all times
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_payment_balance_sum_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_payment_balance_sum_check
  CHECK (
    (status = 'held' AND required_online_minor + balance_due_minor = total_minor)
    OR
    (balance_due_minor <= total_minor - required_online_minor)
  );

-- Safety trigger: BEFORE INSERT ONLY (never on UPDATE) to default omitted balance_due_minor and payment_mode
CREATE OR REPLACE FUNCTION public.trg_bookings_default_balance_mode()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.balance_due_minor IS NULL OR (NEW.balance_due_minor = 0 AND COALESCE(NEW.required_online_minor, 0) < NEW.total_minor AND NEW.status = 'held') THEN
    NEW.balance_due_minor := NEW.total_minor - COALESCE(NEW.required_online_minor, 0);
  END IF;
  IF NEW.payment_mode IS NULL THEN
    NEW.payment_mode := CASE WHEN COALESCE(NEW.required_online_minor, 0) = NEW.total_minor THEN 'full' ELSE 'advance' END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_before_insert_balance ON public.bookings;
CREATE TRIGGER trg_bookings_before_insert_balance
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.trg_bookings_default_balance_mode();

-- ============================================================================
-- 3. UPDATE private.payment_orders CONSTRAINTS
-- ============================================================================

ALTER TABLE private.payment_orders
  DROP CONSTRAINT IF EXISTS payment_orders_purpose_check;

ALTER TABLE private.payment_orders
  ADD CONSTRAINT payment_orders_purpose_check
  CHECK (purpose IN ('initial', 'advance', 'full', 'balance', 'reschedule'));

-- ============================================================================
-- 4. DROP OLD OVERLOADS BEFORE REDEFINITIONS (AVOID OVERLOAD TRAP)
-- ============================================================================

DROP FUNCTION IF EXISTS public.quote_booking(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.create_booking_hold(uuid, timestamptz, timestamptz, text, text, text, text);

-- ============================================================================
-- 5. REDEFINE public.quote_booking WITH ADVANCE MODES
-- ============================================================================

CREATE OR REPLACE FUNCTION public.quote_booking(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_payment_mode text DEFAULT 'auto'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'auth', 'pg_temp'
AS $$
DECLARE
  v_res record;
  v_total_minutes integer;
  v_inc_minutes integer;
  v_inc_count integer;
  v_curr_start timestamptz;
  v_curr_end timestamptz;
  v_rule record;
  v_local_ts timestamp;
  v_local_date date;
  v_local_time time;
  v_dow smallint;
  v_total_minor bigint := 0;
  v_increments jsonb := '[]'::jsonb;
  v_settings record;
  v_policy record;
  v_required_online_minor bigint;
  v_balance_due_minor bigint;
  v_cancellation_snapshot jsonb;
  v_pricing_snapshot jsonb;
  v_advance_mode text := 'full';
  v_effective_mode text;
BEGIN
  IF p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'INVALID_TIME_RANGE: ends_at must be strictly after starts_at' USING ERRCODE = '22023';
  END IF;

  IF p_payment_mode NOT IN ('auto', 'advance', 'full') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_MODE: Payment mode must be auto, advance, or full' USING ERRCODE = '22023';
  END IF;

  SELECT
    r.id, r.turf_id, r.master_owner_id, r.name, r.active,
    r.booking_increment_minutes, r.minimum_duration_minutes, r.maximum_duration_minutes,
    t.timezone, t.approval_status, t.archived_at
  INTO v_res
  FROM public.resources r
  JOIN public.turfs t ON t.id = r.turf_id
  WHERE r.id = p_resource_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESOURCE_NOT_FOUND: Resource % not found', p_resource_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_res.active OR v_res.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'RESOURCE_UNAVAILABLE: Resource is inactive or archived' USING ERRCODE = '22023';
  END IF;

  IF v_res.approval_status <> 'approved' AND NOT private.can_turf(auth.uid(), v_res.turf_id, 'pricing.read') THEN
    RAISE EXCEPTION 'PERM_DENIED: Turf is not approved' USING ERRCODE = '42501';
  END IF;

  v_total_minutes := extract(epoch FROM (p_ends_at - p_starts_at)) / 60;
  v_inc_minutes := v_res.booking_increment_minutes;

  IF v_total_minutes < v_res.minimum_duration_minutes THEN
    RAISE EXCEPTION 'DURATION_TOO_SHORT: Minimum duration is % minutes', v_res.minimum_duration_minutes USING ERRCODE = '22023';
  END IF;

  IF v_total_minutes > v_res.maximum_duration_minutes THEN
    RAISE EXCEPTION 'DURATION_TOO_LONG: Maximum duration is % minutes', v_res.maximum_duration_minutes USING ERRCODE = '22023';
  END IF;

  IF (v_total_minutes % v_inc_minutes) <> 0 THEN
    RAISE EXCEPTION 'INVALID_INCREMENT: Duration must be an exact multiple of % minutes', v_inc_minutes USING ERRCODE = '22023';
  END IF;

  v_inc_count := v_total_minutes / v_inc_minutes;
  v_curr_start := p_starts_at;

  WHILE v_curr_start < p_ends_at LOOP
    v_curr_end := v_curr_start + (v_inc_minutes || ' minutes')::interval;
    v_local_ts := v_curr_start AT TIME ZONE v_res.timezone;
    v_local_date := v_local_ts::date;
    v_local_time := v_local_ts::time;
    v_dow := extract(isodow FROM v_local_ts)::smallint;

    SELECT
      id, amount_per_increment_minor, currency, priority
    INTO v_rule
    FROM public.pricing_rules
    WHERE resource_id = p_resource_id
      AND active = true
      AND valid_from <= v_local_date
      AND (valid_until IS NULL OR valid_until >= v_local_date)
      AND v_dow = ANY(iso_weekdays)
      AND starts_local <= v_local_time
      AND ends_local > v_local_time
    ORDER BY priority DESC, created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRICING_NOT_CONFIGURED: No active pricing rule covers slot starting at % (local % %)',
        v_curr_start, v_local_date, v_local_time USING ERRCODE = 'P0002';
    END IF;

    v_total_minor := v_total_minor + v_rule.amount_per_increment_minor;

    v_increments := v_increments || jsonb_build_object(
      'starts_at', v_curr_start,
      'ends_at', v_curr_end,
      'amount_minor', v_rule.amount_per_increment_minor,
      'rule_id', v_rule.id,
      'priority', v_rule.priority
    );

    v_curr_start := v_curr_end;
  END LOOP;

  SELECT * INTO v_settings
  FROM public.turf_booking_settings
  WHERE turf_id = v_res.turf_id;

  IF FOUND THEN
    SELECT * INTO v_policy
    FROM public.cancellation_policies
    WHERE id = v_settings.cancellation_policy_id;

    v_cancellation_snapshot := jsonb_build_object(
      'policy_id', v_policy.id,
      'name', v_policy.name,
      'version', v_policy.version,
      'rules', v_policy.rules
    );

    IF p_payment_mode = 'full' THEN
      v_required_online_minor := v_total_minor;
      v_advance_mode := 'full';
    ELSE
      -- 'auto' or 'advance'
      IF v_settings.advance_fixed_per_slot_minor IS NOT NULL THEN
        v_required_online_minor := v_settings.advance_fixed_per_slot_minor * v_inc_count;
        v_advance_mode := 'fixed_per_slot';
      ELSIF v_settings.advance_basis_points IS NOT NULL THEN
        v_required_online_minor := round((v_total_minor * v_settings.advance_basis_points) / 10000.0);
        v_advance_mode := 'percentage';
      ELSE
        v_required_online_minor := v_total_minor;
        v_advance_mode := 'full';
      END IF;
    END IF;
  ELSE
    v_cancellation_snapshot := jsonb_build_object(
      'policy_id', null,
      'name', 'Default Non-Refundable',
      'version', 1,
      'rules', '[]'::jsonb
    );
    v_required_online_minor := v_total_minor;
    v_advance_mode := 'full';
  END IF;

  -- Clamp required online advance to [0, total_minor]
  v_required_online_minor := greatest(0, least(v_required_online_minor, v_total_minor));
  v_balance_due_minor := v_total_minor - v_required_online_minor;

  v_effective_mode := CASE
    WHEN p_payment_mode = 'full' OR v_required_online_minor = v_total_minor THEN 'full'
    ELSE 'advance'
  END;

  v_pricing_snapshot := jsonb_build_object(
    'resource_id', p_resource_id,
    'increment_minutes', v_inc_minutes,
    'increments_count', v_inc_count,
    'increments', v_increments,
    'slot_count', v_inc_count,
    'advance_mode', v_advance_mode
  );

  RETURN jsonb_build_object(
    'resource_id', p_resource_id,
    'starts_at', p_starts_at,
    'ends_at', p_ends_at,
    'total_minor', v_total_minor,
    'required_online_minor', v_required_online_minor,
    'balance_due_minor', v_balance_due_minor,
    'payment_mode', v_effective_mode,
    'advance_mode', v_advance_mode,
    'slot_count', v_inc_count,
    'currency', 'INR',
    'pricing_snapshot', v_pricing_snapshot,
    'cancellation_snapshot', v_cancellation_snapshot
  );
END;
$$;

REVOKE ALL ON FUNCTION public.quote_booking(uuid, timestamptz, timestamptz, text) FROM public;
GRANT EXECUTE ON FUNCTION public.quote_booking(uuid, timestamptz, timestamptz, text) TO anon, authenticated, service_role;

-- ============================================================================
-- 6. REDEFINE public.create_booking_hold WITH ADVANCE SUPPORT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_booking_hold(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_idempotency_key text,
  p_contact_name text DEFAULT NULL,
  p_contact_phone text DEFAULT NULL,
  p_contact_email text DEFAULT NULL,
  p_payment_mode text DEFAULT 'auto'
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
  v_alloc_id uuid;
  v_ref_code text;
  v_booking_id uuid;
  v_comm_rule record;
  v_comm_snapshot jsonb;
  v_slot record;
  v_inc_start timestamptz;
  v_inc_end timestamptz;
  v_inc_interval interval;
  v_result jsonb;
  v_chosen_mode text;
  v_balance_due_minor bigint;
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

  v_req_hash := md5(p_resource_id::text || ':' || p_starts_at::text || ':' || p_ends_at::text || ':' || coalesce(p_payment_mode, 'auto'));

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
  v_quote := public.quote_booking(p_resource_id, p_starts_at, p_ends_at, p_payment_mode);

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

  v_chosen_mode := (v_quote->>'payment_mode')::text;
  v_balance_due_minor := (v_quote->>'balance_due_minor')::bigint;

  -- Unique booking reference code
  v_ref_code := 'BK-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
  v_booking_id := gen_random_uuid();

  -- Step 10: Insert Booking record (status = 'held')
  INSERT INTO public.bookings (
    id, reference_code, master_owner_id, turf_id, resource_id,
    player_user_id, created_by, source, status,
    starts_at, ends_at, hold_expires_at,
    total_minor, required_online_minor, balance_due_minor, payment_mode, currency,
    pricing_snapshot, cancellation_snapshot, commission_snapshot
  ) VALUES (
    v_booking_id, v_ref_code, v_res.master_owner_id, v_res.turf_id, p_resource_id,
    v_uid, v_uid, 'online', 'held',
    p_starts_at, p_ends_at, v_hold_expires_at,
    (v_quote->>'total_minor')::bigint, (v_quote->>'required_online_minor')::bigint, v_balance_due_minor, v_chosen_mode, 'INR',
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
    'balance_due_minor', v_balance_due_minor,
    'payment_mode', v_chosen_mode,
    'slot_count', (v_quote->>'slot_count')::int,
    'advance_mode', v_quote->>'advance_mode',
    'currency', 'INR'
  );

  -- Step 15: Cache in Idempotency table
  INSERT INTO private.api_idempotency (
    actor_user_id, operation, idempotency_key, request_hash, response_json, expires_at
  ) VALUES (
    v_uid, 'create_booking_hold', p_idempotency_key, v_req_hash, v_result, v_hold_expires_at
  ) ON CONFLICT (actor_user_id, operation, idempotency_key) DO NOTHING;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_booking_hold(uuid, timestamptz, timestamptz, text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_booking_hold(uuid, timestamptz, timestamptz, text, text, text, text, text) TO authenticated, service_role;

-- ============================================================================
-- 7. REDEFINE public.create_walkin_booking TO EXPLICITLY SET BALANCE & MODE
-- ============================================================================

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

  IF NOT (
    (private.can_turf(v_uid, v_res.turf_id, 'bookings.create_walkin') AND private.can_turf(v_uid, v_res.turf_id, 'payments.record_offline'))
    OR private.can_turf(v_uid, v_res.turf_id, 'bookings.manage')
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Caller lacks walk-in creation or offline payment recording authority on turf %', v_res.turf_id
      USING ERRCODE = '42501';
  END IF;

  IF NOT v_res.active OR v_res.archived_at IS NOT NULL OR v_res.approval_status <> 'approved' OR v_res.owner_status <> 'active' THEN
    RAISE EXCEPTION 'RESOURCE_UNAVAILABLE: Venue is not active, not approved, or suspended' USING ERRCODE = '22023';
  END IF;

  PERFORM private.assert_within_operating_hours(p_resource_id, p_starts_at, p_ends_at);

  UPDATE public.inventory_allocations
  SET released_at = now()
  WHERE resource_id = p_resource_id
    AND kind = 'hold'
    AND released_at IS NULL
    AND expires_at < now();

  PERFORM private.generate_resource_slots(
    p_resource_id,
    (p_starts_at AT TIME ZONE v_res.timezone)::date,
    (p_ends_at AT TIME ZONE v_res.timezone)::date
  );

  v_quote := public.quote_booking(p_resource_id, p_starts_at, p_ends_at);
  v_total_minor := (v_quote->>'total_minor')::bigint;

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

  -- Step 1: Insert Booking record (walkin balance_due_minor = v_total_minor, payment_mode = 'advance')
  INSERT INTO public.bookings (
    id, reference_code, master_owner_id, turf_id, resource_id,
    player_user_id, created_by, source, status,
    starts_at, ends_at, hold_expires_at,
    total_minor, required_online_minor, balance_due_minor, payment_mode, currency,
    pricing_snapshot, cancellation_snapshot, commission_snapshot,
    confirmed_at
  ) VALUES (
    v_booking_id, v_ref_code, v_res.master_owner_id, v_res.turf_id, p_resource_id,
    NULL, v_uid, 'walkin', 'confirmed',
    p_starts_at, p_ends_at, NULL,
    v_total_minor, 0, v_total_minor, 'advance', 'INR',
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

REVOKE ALL ON FUNCTION public.create_walkin_booking FROM public;
GRANT EXECUTE ON FUNCTION public.create_walkin_booking TO authenticated, service_role;

-- ============================================================================
-- 8. REDEFINE private.create_or_get_payment_order WITH GUARDS
-- ============================================================================

CREATE OR REPLACE FUNCTION private.create_or_get_payment_order(
  p_booking_id uuid,
  p_idempotency_key text,
  p_purpose text DEFAULT 'initial'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'auth', 'pg_temp'
AS $$
DECLARE
  v_booking record;
  v_existing record;
  v_order_id uuid;
  v_amount bigint;
  v_caller uuid := auth.uid();
BEGIN
  -- 0. Validate idempotency key
  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED: Idempotency key must not be empty' USING ERRCODE = '22023';
  END IF;

  -- 1. Disallow online balance collection orders (must be collected at venue)
  IF p_purpose = 'balance' THEN
    RAISE EXCEPTION 'BALANCE_VENUE_ONLY: Outstanding balance must be collected at the venue' USING ERRCODE = '22023';
  END IF;

  -- 2. Check existing order by idempotency key
  SELECT * INTO v_existing
  FROM private.payment_orders
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'order_id', v_existing.id,
      'provider_order_id', v_existing.provider_order_id,
      'booking_id', v_existing.booking_id,
      'amount_minor', v_existing.amount_minor,
      'currency', v_existing.currency,
      'status', v_existing.status,
      'is_existing', true
    );
  END IF;

  -- 3. Validate booking existence and hold status
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND: Booking % does not exist', p_booking_id USING ERRCODE = 'P0002';
  END IF;

  -- Verify caller ownership (unless service_role/internal)
  IF v_caller IS NOT NULL AND v_caller <> v_booking.player_user_id THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Cannot create payment order for another player hold' USING ERRCODE = '42501';
  END IF;

  IF v_booking.status <> 'held' THEN
    RAISE EXCEPTION 'INVALID_BOOKING_STATUS: Booking status is % (must be held)', v_booking.status USING ERRCODE = '22023';
  END IF;

  IF v_booking.hold_expires_at <= now() THEN
    PERFORM private.expire_booking_holds();
    RAISE EXCEPTION 'BOOKING_HOLD_EXPIRED: Hold deadline has passed' USING ERRCODE = '22023';
  END IF;

  -- 4. Check if active order already exists for this booking
  SELECT * INTO v_existing
  FROM private.payment_orders
  WHERE booking_id = p_booking_id
    AND status IN ('creating', 'ready');

  IF FOUND THEN
    RETURN jsonb_build_object(
      'order_id', v_existing.id,
      'provider_order_id', v_existing.provider_order_id,
      'booking_id', v_existing.booking_id,
      'amount_minor', v_existing.amount_minor,
      'currency', v_existing.currency,
      'status', v_existing.status,
      'is_existing', true
    );
  END IF;

  -- 5. Compute required payment amount based on purpose
  IF p_purpose IN ('initial', 'advance') THEN
    v_amount := coalesce(v_booking.required_online_minor, v_booking.total_minor);
  ELSIF p_purpose = 'full' THEN
    v_amount := v_booking.total_minor;
  ELSE
    -- Reschedule or other future purpose
    v_amount := v_booking.total_minor - coalesce(v_booking.required_online_minor, 0);
  END IF;

  -- No balance due / zero-balance guard (replaces the dangerous silent full-price fallback)
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'NO_BALANCE_DUE: Payment order amount must be positive (computed: %)', v_amount USING ERRCODE = '22023';
  END IF;

  -- 6. Insert new payment order in 'creating' state
  v_order_id := gen_random_uuid();
  INSERT INTO private.payment_orders (
    id, booking_id, master_owner_id, purpose, provider,
    amount_minor, currency, status, idempotency_key
  ) VALUES (
    v_order_id, v_booking.id, v_booking.master_owner_id, p_purpose, 'razorpay',
    v_amount, v_booking.currency, 'creating', p_idempotency_key
  );

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'provider_order_id', null,
    'booking_id', v_booking.id,
    'master_owner_id', v_booking.master_owner_id,
    'amount_minor', v_amount,
    'currency', v_booking.currency,
    'purpose', p_purpose,
    'status', 'creating',
    'is_existing', false
  );
END;
$$;

-- ============================================================================
-- 9. BACKFILL payments.record_offline GRANT TO EXISTING COUNTER STAFF ASSIGNMENTS
-- ============================================================================

INSERT INTO private.assignment_grants (assignment_id, capability, scope)
SELECT DISTINCT assignment_id, 'payments.record_offline', 'turf'
FROM private.assignment_grants
WHERE capability = 'bookings.create_walkin'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 10. CREATE public.owner_upsert_booking_settings
-- ============================================================================

CREATE OR REPLACE FUNCTION public.owner_upsert_booking_settings(
  p_turf_id uuid,
  p_advance_basis_points integer,
  p_advance_fixed_per_slot_minor bigint,
  p_booking_horizon_days integer DEFAULT NULL,
  p_minimum_lead_minutes integer DEFAULT NULL,
  p_hold_seconds integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'auth', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_turf record;
  v_min_slot_price bigint;
  v_policy_id uuid;
  v_result record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT id, master_owner_id, archived_at
  INTO v_turf
  FROM public.turfs
  WHERE id = p_turf_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TURF_NOT_FOUND: Turf % does not exist', p_turf_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT private.can_turf(v_uid, p_turf_id, 'pricing.edit') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Caller lacks pricing.edit capability on turf %', p_turf_id USING ERRCODE = '42501';
  END IF;

  IF v_turf.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'VENUE_ARCHIVED: Cannot configure booking settings on archived turf %', p_turf_id USING ERRCODE = '42501';
  END IF;

  -- Validate advance values
  IF p_advance_basis_points IS NOT NULL AND (p_advance_basis_points < 1 OR p_advance_basis_points > 10000) THEN
    RAISE EXCEPTION 'INVALID_ADVANCE_BASIS_POINTS: Advance basis points must be between 1 and 10000' USING ERRCODE = '22023';
  END IF;

  IF p_advance_fixed_per_slot_minor IS NOT NULL AND p_advance_fixed_per_slot_minor <= 0 THEN
    RAISE EXCEPTION 'INVALID_FIXED_ADVANCE: Fixed advance per slot must be strictly positive' USING ERRCODE = '22023';
  END IF;

  -- Look up lowest active slot price on this turf's active resources
  IF p_advance_fixed_per_slot_minor IS NOT NULL THEN
    SELECT min(pr.amount_per_increment_minor) INTO v_min_slot_price
    FROM public.pricing_rules pr
    JOIN public.resources r ON r.id = pr.resource_id
    WHERE r.turf_id = p_turf_id
      AND pr.active = true
      AND r.active = true;

    IF v_min_slot_price IS NOT NULL AND p_advance_fixed_per_slot_minor > v_min_slot_price THEN
      RAISE EXCEPTION 'ADVANCE_EXCEEDS_SLOT_PRICE: Fixed advance per slot (% minor) cannot exceed lowest slot price (% minor)',
        p_advance_fixed_per_slot_minor, v_min_slot_price USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Validate horizon, lead, hold
  IF p_booking_horizon_days IS NOT NULL AND (p_booking_horizon_days < 1 OR p_booking_horizon_days > 365) THEN
    RAISE EXCEPTION 'INVALID_HORIZON: Horizon must be between 1 and 365 days' USING ERRCODE = '22023';
  END IF;

  IF p_minimum_lead_minutes IS NOT NULL AND p_minimum_lead_minutes < 0 THEN
    RAISE EXCEPTION 'INVALID_LEAD_MINUTES: Minimum lead minutes cannot be negative' USING ERRCODE = '22023';
  END IF;

  IF p_hold_seconds IS NOT NULL AND (p_hold_seconds < 60 OR p_hold_seconds > 1200) THEN
    RAISE EXCEPTION 'INVALID_HOLD_SECONDS: Hold seconds must be between 60 and 1200' USING ERRCODE = '22023';
  END IF;

  -- Ensure cancellation policy exists
  SELECT id INTO v_policy_id
  FROM public.cancellation_policies
  WHERE master_owner_id = v_turf.master_owner_id
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_policy_id IS NULL THEN
    SELECT cancellation_policy_id INTO v_policy_id
    FROM public.turf_booking_settings
    WHERE turf_id = p_turf_id;
  END IF;

  IF v_policy_id IS NULL THEN
    RAISE EXCEPTION 'POLICY_NOT_FOUND: No cancellation policy found for master owner %', v_turf.master_owner_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.turf_booking_settings (
    turf_id, master_owner_id, cancellation_policy_id,
    advance_basis_points, advance_fixed_per_slot_minor,
    booking_horizon_days, minimum_lead_minutes, hold_seconds
  ) VALUES (
    p_turf_id, v_turf.master_owner_id, v_policy_id,
    coalesce(p_advance_basis_points, 10000),
    p_advance_fixed_per_slot_minor,
    coalesce(p_booking_horizon_days, 60),
    coalesce(p_minimum_lead_minutes, 60),
    coalesce(p_hold_seconds, 420)
  )
  ON CONFLICT (turf_id) DO UPDATE SET
    advance_basis_points = coalesce(excluded.advance_basis_points, turf_booking_settings.advance_basis_points),
    advance_fixed_per_slot_minor = excluded.advance_fixed_per_slot_minor,
    booking_horizon_days = coalesce(p_booking_horizon_days, turf_booking_settings.booking_horizon_days),
    minimum_lead_minutes = coalesce(p_minimum_lead_minutes, turf_booking_settings.minimum_lead_minutes),
    hold_seconds = coalesce(p_hold_seconds, turf_booking_settings.hold_seconds)
  RETURNING * INTO v_result;

  RETURN jsonb_build_object(
    'turf_id', v_result.turf_id,
    'master_owner_id', v_result.master_owner_id,
    'cancellation_policy_id', v_result.cancellation_policy_id,
    'advance_basis_points', v_result.advance_basis_points,
    'advance_fixed_per_slot_minor', v_result.advance_fixed_per_slot_minor,
    'booking_horizon_days', v_result.booking_horizon_days,
    'minimum_lead_minutes', v_result.minimum_lead_minutes,
    'hold_seconds', v_result.hold_seconds
  );
END;
$$;

REVOKE ALL ON FUNCTION public.owner_upsert_booking_settings(uuid, integer, bigint, integer, integer, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_upsert_booking_settings(uuid, integer, bigint, integer, integer, integer) TO authenticated, service_role;

-- ============================================================================
-- 11. CREATE public.owner_record_balance_collection
-- ============================================================================

CREATE OR REPLACE FUNCTION public.owner_record_balance_collection(
  p_booking_id uuid,
  p_amount_minor bigint,
  p_method text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'auth', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_booking record;
  v_cached_response jsonb;
  v_new_balance bigint;
  v_order_id uuid;
  v_payment_id uuid;
  v_prov_pay_id text;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_method NOT IN ('cash', 'upi', 'card', 'other') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_METHOD: Method must be cash, upi, card, or other' USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED: Idempotency key required' USING ERRCODE = '22023';
  END IF;

  -- Idempotency Check
  SELECT response_json INTO v_cached_response
  FROM private.api_idempotency
  WHERE actor_user_id = v_uid
    AND operation = 'owner_record_balance_collection'
    AND idempotency_key = p_idempotency_key;

  IF v_cached_response IS NOT NULL THEN
    RETURN v_cached_response;
  END IF;

  -- Serialize on Booking
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND: Booking % not found', p_booking_id USING ERRCODE = 'P0002';
  END IF;

  -- Authorization Check: Caller must have payments.record_offline on the turf
  IF NOT private.can_turf(v_uid, v_booking.turf_id, 'payments.record_offline') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Caller lacks payments.record_offline capability on turf %', v_booking.turf_id USING ERRCODE = '42501';
  END IF;

  -- Invariant: Booking must be in confirmed status
  IF v_booking.status <> 'confirmed' THEN
    RAISE EXCEPTION 'INVALID_BOOKING_STATUS: Can only collect balance for confirmed bookings (current status: %)', v_booking.status USING ERRCODE = '22023';
  END IF;

  -- Invariant: Amount must be strictly positive
  IF p_amount_minor <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Collection amount must be positive' USING ERRCODE = '22023';
  END IF;

  -- Invariant: Balance due must be positive and amount must not exceed balance due
  IF v_booking.balance_due_minor <= 0 THEN
    RAISE EXCEPTION 'NO_BALANCE_DUE: Booking % has no outstanding balance due', p_booking_id USING ERRCODE = '22023';
  END IF;

  IF p_amount_minor > v_booking.balance_due_minor THEN
    RAISE EXCEPTION 'AMOUNT_EXCEEDS_BALANCE: Amount (% minor) exceeds outstanding balance due (% minor)', p_amount_minor, v_booking.balance_due_minor USING ERRCODE = '22023';
  END IF;

  -- Create private.payment_orders row for offline balance
  v_order_id := gen_random_uuid();
  INSERT INTO private.payment_orders (
    id, booking_id, master_owner_id, purpose, provider,
    amount_minor, currency, status, idempotency_key
  ) VALUES (
    v_order_id, v_booking.id, v_booking.master_owner_id, 'balance', 'offline',
    p_amount_minor, v_booking.currency, 'paid', 'off_order_' || p_idempotency_key
  ) ON CONFLICT (idempotency_key) DO UPDATE SET status = 'paid'
  RETURNING id INTO v_order_id;

  -- Create private.payments row for offline balance
  v_payment_id := gen_random_uuid();
  v_prov_pay_id := 'offline_' || replace(v_payment_id::text, '-', '');

  INSERT INTO private.payments (
    id, payment_order_id, provider, provider_payment_id,
    amount_minor, currency, status, captured_at
  ) VALUES (
    v_payment_id, v_order_id, 'offline', v_prov_pay_id,
    p_amount_minor, v_booking.currency, 'captured', now()
  );

  -- Note on Financial Accounting:
  -- The online advance capture already recognized the entire booking commission from commission_snapshot
  -- and settled owner_payable liability to -(advance - total_commission).
  -- Since the balance amount is collected directly in cash/offline by the venue, NO funds touch the gateway
  -- and no platform liability is created; hence NO double-entry ledger journal is posted here.

  -- Decrement balance_due_minor on public.bookings
  v_new_balance := v_booking.balance_due_minor - p_amount_minor;

  UPDATE public.bookings
  SET balance_due_minor = v_new_balance,
      balance_collected_at = CASE WHEN v_new_balance = 0 THEN now() ELSE balance_collected_at END,
      balance_collected_by = CASE WHEN v_new_balance = 0 THEN v_uid ELSE balance_collected_by END,
      balance_collection_method = CASE WHEN v_new_balance = 0 THEN p_method ELSE balance_collection_method END
  WHERE id = v_booking.id;

  -- Record Booking Event
  INSERT INTO public.booking_events (booking_id, event_type, public_summary)
  VALUES (v_booking.id, 'balance_collected', format('Balance of ₹%s collected at venue via %s', (p_amount_minor/100)::text, p_method));

  -- Record Business Audit Event
  PERFORM private.log_audit_event(
    v_booking.master_owner_id,
    v_booking.turf_id,
    v_uid,
    'user',
    'booking.balance_collected',
    'booking',
    v_booking.id,
    jsonb_build_object('balance_due_minor', v_booking.balance_due_minor),
    jsonb_build_object('balance_due_minor', v_new_balance, 'collected_minor', p_amount_minor, 'method', p_method),
    format('Balance collected at venue: ₹%s via %s', (p_amount_minor/100)::text, p_method)
  );

  v_result := jsonb_build_object(
    'booking_id', v_booking.id,
    'payment_id', v_payment_id,
    'payment_order_id', v_order_id,
    'amount_collected_minor', p_amount_minor,
    'balance_due_minor', v_new_balance,
    'payment_method', p_method,
    'status', 'success'
  );

  -- Cache in Idempotency table
  INSERT INTO private.api_idempotency (
    actor_user_id, operation, idempotency_key, request_hash, response_json, expires_at
  ) VALUES (
    v_uid, 'owner_record_balance_collection', p_idempotency_key,
    md5(p_booking_id::text || ':' || p_amount_minor::text), v_result, now() + interval '24 hours'
  ) ON CONFLICT (actor_user_id, operation, idempotency_key) DO NOTHING;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_record_balance_collection(uuid, bigint, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_record_balance_collection(uuid, bigint, text, text) TO authenticated, service_role;

-- ============================================================================
-- 12. CREATE public.get_booking_payment_summary
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_booking_payment_summary(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'auth', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_booking record;
  v_paid_minor bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND: Booking % not found', p_booking_id USING ERRCODE = 'P0002';
  END IF;

  IF v_booking.player_user_id <> v_uid 
     AND NOT private.can_turf(v_uid, v_booking.turf_id, 'bookings.read')
     AND NOT private.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Caller not authorized to view booking payment summary' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(sum(p.amount_minor), 0) INTO v_paid_minor
  FROM private.payments p
  JOIN private.payment_orders po ON po.id = p.payment_order_id
  WHERE po.booking_id = p_booking_id
    AND p.status = 'captured';

  RETURN jsonb_build_object(
    'booking_id', v_booking.id,
    'reference_code', v_booking.reference_code,
    'status', v_booking.status,
    'currency', v_booking.currency,
    'total_minor', v_booking.total_minor,
    'required_online_minor', v_booking.required_online_minor,
    'paid_minor', v_paid_minor,
    'balance_due_minor', v_booking.balance_due_minor,
    'payment_mode', v_booking.payment_mode,
    'balance_collected_at', v_booking.balance_collected_at,
    'balance_collected_by', v_booking.balance_collected_by,
    'balance_collection_method', v_booking.balance_collection_method
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_booking_payment_summary(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_booking_payment_summary(uuid) TO authenticated, service_role;
