-- Test Suite: 16_advance_payment_and_multi_slot_test.sql
-- Description: Regression tests for Round 33 multi-slot booking, advance payment policies,
--              balance reconciliation, and offline venue collection invariants.

BEGIN;
SELECT plan(9);

-- ============================================================================
-- 1. SETUP TEST FIXTURES
-- ============================================================================

DO $$
DECLARE
  uid_owner uuid := '66666666-6666-6666-6666-666666666666';
  uid_player uuid := '66666666-6666-6666-6666-666666666667';
  uid_staff uuid := '66666666-6666-6666-6666-666666666668';
  mo_id     uuid := '60000000-0000-0000-0000-000000000006';
  turf_id   uuid := '6a111111-1111-1111-1111-111111111111';
  res_id    uuid := '6b111111-1111-1111-1111-111111111111';
  pol_id    uuid := '6c111111-1111-1111-1111-111111111111';
  emp_id    uuid := '6d111111-1111-1111-1111-111111111111';
  asgn_id   uuid := '6e111111-1111-1111-1111-111111111111';
BEGIN
  -- 1. Users & Profiles
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (uid_owner, 'owner16@test.com', '{"name": "Owner Sixteen"}'::jsonb),
    (uid_player, 'player16@test.com', '{"name": "Player Sixteen"}'::jsonb),
    (uid_staff, 'staff16@test.com', '{"name": "Staff Sixteen"}'::jsonb);

  INSERT INTO public.players (user_id) VALUES (uid_player)
  ON CONFLICT DO NOTHING;

  -- 2. Master Owner & Turf
  INSERT INTO public.master_owners (id, owner_user_id, business_name, status) VALUES
    (mo_id, uid_owner, 'Sixteen Arena Group', 'active');

  INSERT INTO public.turfs (id, master_owner_id, slug, name, address_text, city, location, approval_status, timezone) VALUES
    (turf_id, mo_id, 'sixteen-arena', 'Sixteen Arena', '16 Test Road', 'Bengaluru',
     extensions.ST_SetSRID(extensions.ST_MakePoint(77.5946, 12.9716), 4326)::extensions.geography, 'approved', 'Asia/Kolkata');

  -- 3. Resource (30 min increment, min duration 60 min, max 240 min)
  INSERT INTO public.resources (id, master_owner_id, turf_id, name, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes, active) VALUES
    (res_id, mo_id, turf_id, 'Pitch 16', 30, 60, 240, true);

  -- 4. Operating hours: Mon-Sun 06:00 to 23:00 IST
  INSERT INTO public.operating_hours (resource_id, iso_weekday, opens_at, closes_at, valid_from)
  SELECT res_id, gs, '06:00'::time, '23:00'::time, '2026-01-01'::date
  FROM generate_series(1, 7) gs;

  -- 5. Cancellation Policy
  INSERT INTO public.cancellation_policies (id, master_owner_id, name, version, rules) VALUES
    (pol_id, mo_id, 'Flexible 16', 1, '[{"hours_before": 24, "refund_percent": 100}]'::jsonb);

  -- 6. Booking Settings: 50% advance (5000 bps)
  INSERT INTO public.turf_booking_settings (turf_id, master_owner_id, cancellation_policy_id, advance_basis_points, booking_horizon_days, minimum_lead_minutes, hold_seconds) VALUES
    (turf_id, mo_id, pol_id, 5000, 60, 60, 420);

  -- 7. Pricing Rule: ₹800 per 30m increment (160000 paise per 1 hour = 2 slots)
  INSERT INTO public.pricing_rules (master_owner_id, turf_id, resource_id, priority, valid_from, iso_weekdays, starts_local, ends_local, amount_per_increment_minor) VALUES
    (mo_id, turf_id, res_id, 0, '2026-01-01', '{1,2,3,4,5,6,7}', '06:00', '23:00', 80000);

  -- 8. Staff Employee & Grants with payments.record_offline
  INSERT INTO public.employees (id, master_owner_id, user_id, status) VALUES
    (emp_id, mo_id, uid_staff, 'active');

  INSERT INTO public.employee_turf_assignments (id, master_owner_id, employee_id, turf_id) VALUES
    (asgn_id, mo_id, emp_id, turf_id);

  INSERT INTO private.assignment_grants (assignment_id, capability, scope) VALUES
    (asgn_id, 'bookings.read', 'turf'),
    (asgn_id, 'bookings.create_walkin', 'turf'),
    (asgn_id, 'payments.record_offline', 'turf');
END $$;

-- ============================================================================
-- TEST 1: quote_booking 3-arg default returns owner's advance policy (80000 on 160000 quote)
-- ============================================================================
SELECT is(
  (public.quote_booking(
    '6b111111-1111-1111-1111-111111111111'::uuid,
    '2026-10-15 04:30:00+00'::timestamptz,
    '2026-10-15 05:30:00+00'::timestamptz
  )->>'required_online_minor')::bigint,
  80000::bigint,
  'Test 1: quote_booking 3-arg default returns owner advance (5000 bps = 80000 on 160000)'
);

-- ============================================================================
-- TEST 2: quote_booking with explicit 'full' returns required_online_minor = total_minor
-- ============================================================================
SELECT is(
  (public.quote_booking(
    '6b111111-1111-1111-1111-111111111111'::uuid,
    '2026-10-15 04:30:00+00'::timestamptz,
    '2026-10-15 05:30:00+00'::timestamptz,
    'full'
  )->>'required_online_minor')::bigint,
  160000::bigint,
  'Test 2: quote_booking with payment_mode full requires 100% online (160000)'
);

-- ============================================================================
-- TEST 3: fixed_per_slot wins over basis_points when both are configured
-- ============================================================================
-- Set advance_fixed_per_slot_minor = ₹300 (30000 paise per 30m slot)
UPDATE public.turf_booking_settings
SET advance_fixed_per_slot_minor = 30000
WHERE turf_id = '6a111111-1111-1111-1111-111111111111';

SELECT is(
  (public.quote_booking(
    '6b111111-1111-1111-1111-111111111111'::uuid,
    '2026-10-15 04:30:00+00'::timestamptz,
    '2026-10-15 05:30:00+00'::timestamptz
  )->>'required_online_minor')::bigint,
  60000::bigint,
  'Test 3: fixed_per_slot (2 slots * 30000 = 60000) overrides basis_points (80000)'
);

-- ============================================================================
-- TEST 4: required_online_minor + balance_due_minor = total_minor on create_booking_hold
-- ============================================================================
SELECT set_config('request.jwt.claims', '{"sub": "66666666-6666-6666-6666-666666666667", "role": "authenticated"}', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_hold jsonb;
  v_b public.bookings%rowtype;
BEGIN
  v_hold := public.create_booking_hold(
    '6b111111-1111-1111-1111-111111111111'::uuid,
    '2026-10-15 04:30:00+00'::timestamptz,
    '2026-10-15 05:30:00+00'::timestamptz,
    'idemp-pgtap-hold-16',
    'Player Sixteen',
    '+919999999962',
    'player16@test.com'
  );

  SELECT * INTO v_b FROM public.bookings WHERE id = (v_hold->>'booking_id')::uuid;

  IF (v_b.required_online_minor + v_b.balance_due_minor) <> v_b.total_minor THEN
    RAISE EXCEPTION 'SUM_CHECK_FAILED: required_online (%) + balance_due (%) <> total (%)',
      v_b.required_online_minor, v_b.balance_due_minor, v_b.total_minor;
  END IF;
END $$;

RESET ROLE;
SELECT pass('Test 4: required_online_minor + balance_due_minor equals total_minor on held booking');

-- ============================================================================
-- TEST 5: create_or_get_payment_order with purpose 'balance' raises BALANCE_VENUE_ONLY
-- ============================================================================
SELECT throws_ok(
  format(
    'SELECT private.create_or_get_payment_order(''%s''::uuid, ''idemp-ord-bal-16'', ''balance'')',
    (SELECT id FROM public.bookings WHERE reference_code LIKE 'BK-%' ORDER BY created_at DESC LIMIT 1)
  ),
  '22023',
  'BALANCE_VENUE_ONLY: Outstanding balance must be collected at the venue',
  'Test 5: create_or_get_payment_order with purpose balance raises BALANCE_VENUE_ONLY'
);

-- ============================================================================
-- TEST 6: owner_record_balance_collection twice: second call raises NO_BALANCE_DUE
-- ============================================================================
DO $$
DECLARE
  v_bid uuid;
BEGIN
  SELECT id INTO v_bid FROM public.bookings WHERE reference_code LIKE 'BK-%' ORDER BY created_at DESC LIMIT 1;

  -- Confirm booking to enable balance collection
  UPDATE public.bookings
  SET status = 'confirmed', confirmed_at = now()
  WHERE id = v_bid;

  -- Set auth context to staff
  PERFORM set_config('request.jwt.claims', '{"sub": "66666666-6666-6666-6666-666666666668", "role": "authenticated"}', true);
END $$;

SET LOCAL ROLE authenticated;

-- First collection succeeds: collects remaining balance
SELECT lives_ok(
  format(
    'SELECT public.owner_record_balance_collection(''%s''::uuid, (SELECT balance_due_minor FROM public.bookings WHERE id = ''%s''::uuid), ''cash'', ''idemp-col-1'')',
    (SELECT id FROM public.bookings WHERE reference_code LIKE 'BK-%' ORDER BY created_at DESC LIMIT 1),
    (SELECT id FROM public.bookings WHERE reference_code LIKE 'BK-%' ORDER BY created_at DESC LIMIT 1)
  ),
  'Test 6a: First balance collection succeeds and zeroes balance_due_minor'
);

-- Second collection raises NO_BALANCE_DUE
SELECT throws_ok(
  format(
    'SELECT public.owner_record_balance_collection(''%s''::uuid, 1000, ''cash'', ''idemp-col-2'')',
    (SELECT id FROM public.bookings WHERE reference_code LIKE 'BK-%' ORDER BY created_at DESC LIMIT 1)
  ),
  '22023',
  NULL,
  'Test 6b: Second balance collection on zero balance raises NO_BALANCE_DUE'
);

RESET ROLE;

-- ============================================================================
-- TEST 7: balance_due_minor survives an UPDATE setting status = 'confirmed' (No BEFORE UPDATE Trigger)
-- ============================================================================
DO $$
DECLARE
  v_test_bid uuid;
  v_hold jsonb;
  v_bal_after bigint;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub": "66666666-6666-6666-6666-666666666667", "role": "authenticated"}', true);

  v_hold := public.create_booking_hold(
    '6b111111-1111-1111-1111-111111111111'::uuid,
    '2026-10-15 06:00:00+00'::timestamptz,
    '2026-10-15 07:00:00+00'::timestamptz,
    'idemp-pgtap-hold-7',
    'Player Sixteen',
    '+919999999962',
    'player16@test.com'
  );
  v_test_bid := (v_hold->>'booking_id')::uuid;

  -- Decrement balance due as if partial cash collected
  UPDATE public.bookings
  SET balance_due_minor = 40000
  WHERE id = v_test_bid;

  -- Now simulate status update to confirmed
  UPDATE public.bookings
  SET status = 'confirmed'
  WHERE id = v_test_bid;

  SELECT balance_due_minor INTO v_bal_after
  FROM public.bookings
  WHERE id = v_test_bid;

  IF v_bal_after <> 40000 THEN
    RAISE EXCEPTION 'TRIGGER_CLOBBER_DETECTED: balance_due_minor was reset to % (expected 40000)', v_bal_after;
  END IF;
END $$;

SELECT pass('Test 7: balance_due_minor survived UPDATE status=confirmed without trigger clobbering');

-- ============================================================================
-- TEST 8: Zero-advance configuration is rejected by advance_fixed_per_slot_minor > 0 CHECK
-- ============================================================================
SELECT throws_ok(
  'UPDATE public.turf_booking_settings SET advance_fixed_per_slot_minor = 0 WHERE turf_id = ''6a111111-1111-1111-1111-111111111111''',
  '23514',
  NULL,
  'Test 8: Zero-advance configuration rejected by check constraint'
);

SELECT * FROM finish();
ROLLBACK;
