-- Test Suite: 03_inventory_and_holds_test.sql
-- Description: pgTAP tests for Milestone 4 deterministic/sequential scenarios:
-- 1. create_booking_hold success & allocation insertion
-- 2. Idempotency key replay protection
-- 3. Overlapping interval exclusion rejection (SQLSTATE 23P01)
-- 4. Adjacent interval success
-- 5. Maintenance block conflict rejection
-- 6. Opportunistic & batch hold expiry cleanup
-- 7. Contact PII isolation

begin;
select plan(12);

-- ============================================================================
-- 1. SETUP TEST FIXTURES
-- ============================================================================

do $$
declare
  uid_owner  uuid := '66666666-6666-6666-6666-666666666666';
  uid_player uuid := '77777777-7777-7777-7777-777777777777';
  uid_other  uuid := '88888888-8888-8888-8888-888888888888';

  mo_id   uuid := '60000000-0000-0000-0000-000000000006';
  turf_id uuid := '6a111111-1111-1111-1111-111111111111';
  res_id  uuid := '6b111111-1111-1111-1111-111111111111';
  pol_id  uuid := '6c111111-1111-1111-1111-111111111111';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (uid_owner, 'hold_owner@test.com', '{"name": "Hold Owner"}'::jsonb),
    (uid_player, 'hold_player@test.com', '{"name": "Hold Player"}'::jsonb),
    (uid_other, 'other_player@test.com', '{"name": "Other Player"}'::jsonb);

  insert into public.master_owners (id, owner_user_id, business_name, status) values
    (mo_id, uid_owner, 'Hold Test Arena', 'active');

  insert into public.turfs (id, master_owner_id, slug, name, address_text, city, location, approval_status, timezone) values
    (turf_id, mo_id, 'hold-test-arena', 'Hold Test Arena', 'Road 5', 'Ahmedabad',
     extensions.ST_SetSRID(extensions.ST_MakePoint(72.5714, 23.0225), 4326)::extensions.geography, 'approved', 'Asia/Kolkata');

  insert into public.resources (id, master_owner_id, turf_id, name, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes, active) values
    (res_id, mo_id, turf_id, 'Main Turf Ground', 30, 60, 240, true);

  -- Operating hours: 06:00 to 23:00 daily
  insert into public.operating_hours (resource_id, iso_weekday, opens_at, closes_at, valid_from)
  select res_id, gs, '06:00'::time, '23:00'::time, '2026-01-01'::date
  from generate_series(1, 7) gs;

  -- Cancellation policy
  insert into public.cancellation_policies (id, master_owner_id, name, version, rules) values
    (pol_id, mo_id, 'Flexible Hold Policy', 1, '[{"hours_before": 24, "refund_percent": 100}]'::jsonb);

  -- Booking settings (hold_seconds = 300)
  insert into public.turf_booking_settings (turf_id, master_owner_id, cancellation_policy_id, advance_basis_points, booking_horizon_days, minimum_lead_minutes, hold_seconds) values
    (turf_id, mo_id, pol_id, 10000, 60, 0, 300);

  -- Base pricing rule: ₹500/slot
  insert into public.pricing_rules (master_owner_id, turf_id, resource_id, priority, valid_from, iso_weekdays, starts_local, ends_local, amount_per_increment_minor) values
    (mo_id, turf_id, res_id, 0, '2026-01-01', '{1,2,3,4,5,6,7}', '06:00', '23:00', 50000);
end $$;

-- ============================================================================
-- 2. TEST 1: CREATE BOOKING HOLD
-- ============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "77777777-7777-7777-7777-777777777777"}';

-- Create hold: 18:00 to 19:00 IST on 2026-10-10 (12:30 to 13:30 UTC)
select is(
  (public.create_booking_hold(
    '6b111111-1111-1111-1111-111111111111'::uuid,
    '2026-10-10 12:30:00+00'::timestamptz,
    '2026-10-10 13:30:00+00'::timestamptz,
    'key-hold-001',
    'Hold Player',
    '9999999999',
    'hold_player@test.com'
  )->>'status'),
  'held',
  'create_booking_hold successfully reserves inventory and returns status held'
);

-- Exactly 1 active allocation exists for this resource (checked as superuser)
set local role postgres;
select is(
  (select count(*)::int from public.inventory_allocations where resource_id = '6b111111-1111-1111-1111-111111111111'::uuid and released_at is null),
  1,
  'Exactly 1 active allocation created for resource'
);
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "77777777-7777-7777-7777-777777777777"}';

-- Two constituent slots mapped into booking_slots
select is(
  (select count(*)::int from public.booking_slots),
  2,
  'Two constituent 30-min slots mapped to booking'
);

-- ============================================================================
-- 3. TEST 2: IDEMPOTENCY REPLAY
-- ============================================================================

-- Re-executing with the exact same idempotency key returns identical booking without duplicate allocation
select is(
  (public.create_booking_hold(
    '6b111111-1111-1111-1111-111111111111'::uuid,
    '2026-10-10 12:30:00+00'::timestamptz,
    '2026-10-10 13:30:00+00'::timestamptz,
    'key-hold-001'
  )->>'reference_code'),
  (select reference_code from public.bookings limit 1),
  'Idempotent call returns identical cached booking reference'
);

select is(
  (select count(*)::int from public.bookings),
  1,
  'No duplicate booking created on idempotent replay'
);

-- ============================================================================
-- 4. TEST 3: OVERLAPPING INTERVAL CONFLICT REJECTION
-- ============================================================================

-- Another user tries to hold overlapping time: 18:30 to 19:30 IST (13:00 to 14:00 UTC)
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888888888"}';

select throws_ok(
  $$ select public.create_booking_hold(
    '6b111111-1111-1111-1111-111111111111'::uuid,
    '2026-10-10 13:00:00+00'::timestamptz,
    '2026-10-10 14:00:00+00'::timestamptz,
    'key-hold-002'
  ) $$,
  '23P01',
  'SLOT_UNAVAILABLE: This time interval is no longer available',
  'Rejects overlapping reservation with SLOT_UNAVAILABLE / SQLSTATE 23P01'
);

-- ============================================================================
-- 5. TEST 4: ADJACENT INTERVAL SUCCESS
-- ============================================================================

-- Immediately adjacent time: 19:00 to 20:00 IST (13:30 to 14:30 UTC) must succeed!
select is(
  (public.create_booking_hold(
    '6b111111-1111-1111-1111-111111111111'::uuid,
    '2026-10-10 13:30:00+00'::timestamptz,
    '2026-10-10 14:30:00+00'::timestamptz,
    'key-hold-003'
  )->>'status'),
  'held',
  'Adjacent interval reservation succeeds without conflict'
);

set local role postgres;
select is(
  (select count(*)::int from public.inventory_allocations where resource_id = '6b111111-1111-1111-1111-111111111111'::uuid and released_at is null),
  2,
  'Two non-overlapping active allocations exist side-by-side'
);
set local role authenticated;

-- ============================================================================
-- 6. TEST 5: MAINTENANCE BLOCK CONFLICT
-- ============================================================================

-- Owner tries to block 18:30 to 19:30 (overlaps with existing hold)
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666666666"}';

select throws_ok(
  $$ select public.block_resource_time(
    '6b111111-1111-1111-1111-111111111111'::uuid,
    '2026-10-10 13:00:00+00'::timestamptz,
    '2026-10-10 14:00:00+00'::timestamptz,
    'Turf Maintenance'
  ) $$,
  '23P01',
  'SLOT_UNAVAILABLE: Time range overlaps with existing reservation',
  'Maintenance block cannot overlap with active booking hold'
);

-- ============================================================================
-- 7. TEST 6: HOLD EXPIRY SWEEPER
-- ============================================================================

-- Simulate time passing: set first hold expires_at in the past
set local role postgres;
select private.expire_booking_holds();
update public.inventory_allocations
set expires_at = now() - interval '10 seconds'
where starts_at = '2026-10-10 12:30:00+00'::timestamptz;

-- Run expiry cleaner
select is(
  private.expire_booking_holds(),
  1,
  'expire_booking_holds cleans up exactly 1 expired hold'
);

-- The released interval can now be held again!
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888888888"}';

select is(
  (public.create_booking_hold(
    '6b111111-1111-1111-1111-111111111111'::uuid,
    '2026-10-10 12:30:00+00'::timestamptz,
    '2026-10-10 13:30:00+00'::timestamptz,
    'key-hold-004'
  )->>'status'),
  'held',
  'Expired interval is successfully reclaimed by new hold'
);

-- ============================================================================
-- 8. TEST 7: CONTACT PII ACCESS CONTROL
-- ============================================================================

-- Other player cannot read player 1's booking contact
set local role postgres;
select set_config('test.target_booking_id', (select id::text from public.bookings where player_user_id = '77777777-7777-7777-7777-777777777777'::uuid limit 1), true);

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888888888"}';

select throws_ok(
  format('select public.get_booking_contact(%L::uuid)', current_setting('test.target_booking_id')),
  '42501',
  'PERM_DENIED: Unauthorized to read booking contact information',
  'Unrelated user cannot read booking contact PII'
);

select * from finish();
rollback;
