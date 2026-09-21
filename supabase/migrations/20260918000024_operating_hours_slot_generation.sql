-- Migration: 20260918000024_operating_hours_slot_generation.sql
-- Description: Update public.set_resource_operating_hours to automatically materialize
-- slots via private.generate_resource_slots upon saving operating hours.

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

  -- Automatically materialize slots for the next 14 days under the new schedule
  PERFORM private.generate_resource_slots(
    p_resource_id,
    v_valid_from,
    coalesce(p_valid_until, (v_valid_from + interval '14 days')::date)
  );

  RETURN QUERY
  SELECT * FROM public.operating_hours
  WHERE resource_id = p_resource_id
  ORDER BY iso_weekday, opens_at;
END;
$$;

REVOKE ALL ON FUNCTION public.set_resource_operating_hours(uuid, jsonb, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.set_resource_operating_hours(uuid, jsonb, date, date) TO authenticated, service_role;
