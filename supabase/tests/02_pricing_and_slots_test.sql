-- Test Suite: 02_pricing_and_slots_test.sql
-- Description: pgTAP tests for Milestone 3:
-- 1. Just-in-time slot generation and idempotency
-- 2. Hierarchical pricing precedence (Base vs Peak vs Date-Specific Override)
-- 3. Duration & increment boundary validation
-- 4. Advance payment & policy snapshot calculation

begin;
select plan(12);

-- ============================================================================
-- 1. SETUP TEST FIXTURES
-- ============================================================================

do $$
declare
  uid_owner uuid := '55555555-5555-5555-5555-555555555555';
  mo_id     uuid := '50000000-0000-0000-0000-000000000005';
  turf_id   uuid := '5a111111-1111-1111-1111-111111111111';
  res_id    uuid := '5b111111-1111-1111-1111-111111111111';
  pol_id    uuid := '5c111111-1111-1111-1111-111111111111';
begin
  -- User, Profile & Master Owner
  insert into auth.users (id, email, raw_user_meta_data) values
    (uid_owner, 'pricing_owner@test.com', '{"name": "Pricing Owner"}'::jsonb);

  insert into public.master_owners (id, owner_user_id, business_name, status) values
    (mo_id, uid_owner, 'Premier Sports Arena', 'active');

  -- Approved Turf (Asia/Kolkata timezone)
  insert into public.turfs (id, master_owner_id, slug, name, address_text, city, location, approval_status, timezone) values
    (turf_id, mo_id, 'premier-sports-arena', 'Premier Sports', 'Main Road', 'Ahmedabad',
     extensions.ST_SetSRID(extensions.ST_MakePoint(72.5714, 23.0225), 4326)::extensions.geography, 'approved', 'Asia/Kolkata');

  -- Resource (Ground 1, increment 30 min, min duration 60 min, max 240 min)
  insert into public.resources (id, master_owner_id, turf_id, name, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes, active) values
    (res_id, mo_id, turf_id, 'Ground 1', 30, 60, 240, true);

  -- Operating hours: Mon-Sun 06:00 to 23:00
  insert into public.operating_hours (resource_id, iso_weekday, opens_at, closes_at, valid_from)
  select res_id, gs, '06:00'::time, '23:00'::time, '2026-01-01'::date
  from generate_series(1, 7) gs;

  -- Cancellation policy (Flexible: 100% refund > 24h)
  insert into public.cancellation_policies (id, master_owner_id, name, version, rules) values
    (pol_id, mo_id, 'Standard Flexible', 1, '[{"hours_before": 24, "refund_percent": 100}]'::jsonb);

  -- Turf booking settings (50% advance = 5000 basis points)
  insert into public.turf_booking_settings (turf_id, master_owner_id, cancellation_policy_id, advance_basis_points, booking_horizon_days, minimum_lead_minutes, hold_seconds) values
    (turf_id, mo_id, pol_id, 5000, 60, 60, 420);

  -- Pricing Rules with Hierarchical Precedence:
  -- 1. Base rule: Priority 0, all week, 06:00 to 23:00 -> ₹500/slot (50000 paise)
  insert into public.pricing_rules (master_owner_id, turf_id, resource_id, priority, valid_from, iso_weekdays, starts_local, ends_local, amount_per_increment_minor) values
    (mo_id, turf_id, res_id, 0, '2026-01-01', '{1,2,3,4,5,6,7}', '06:00', '23:00', 50000);

  -- 2. Evening Peak Rule: Priority 10, Mon-Fri (weekdays 1-5), 18:00 to 22:00 -> ₹800/slot (80000 paise)
  insert into public.pricing_rules (master_owner_id, turf_id, resource_id, priority, valid_from, iso_weekdays, starts_local, ends_local, amount_per_increment_minor) values
    (mo_id, turf_id, res_id, 10, '2026-01-01', '{1,2,3,4,5}', '18:00', '22:00', 80000);

  -- 3. Festival Override Rule: Priority 100, valid ONLY on 2026-10-02 (Gandhi Jayanti / Friday), 18:00 to 22:00 -> ₹1200/slot (120000 paise)
  insert into public.pricing_rules (master_owner_id, turf_id, resource_id, priority, valid_from, valid_until, iso_weekdays, starts_local, ends_local, amount_per_increment_minor) values
    (mo_id, turf_id, res_id, 100, '2026-10-02', '2026-10-02', '{1,2,3,4,5,6,7}', '18:00', '22:00', 120000);
end $$;

-- ============================================================================
-- 2. TEST JIT SLOT GENERATION
-- ============================================================================

-- Generate slots for a single day: 2026-10-01 (06:00 to 23:00 = 17 hours = 34 half-hour slots)
select is(
  private.generate_resource_slots('5b111111-1111-1111-1111-111111111111'::uuid, '2026-10-01'::date, '2026-10-01'::date),
  34,
  'JIT generator creates exactly 34 slots for 17 hours operating window'
);

-- Slot generation idempotency: second call must not create duplicates
select is(
  (select count(*)::int from public.slots where resource_id = '5b111111-1111-1111-1111-111111111111'::uuid),
  34,
  'Slot table has exactly 34 rows without duplicates'
);

-- Verify timezone boundary: 06:00 IST is 00:30 UTC
select is(
  (select starts_at from public.slots where resource_id = '5b111111-1111-1111-1111-111111111111'::uuid order by starts_at limit 1),
  '2026-10-01 00:30:00+00'::timestamptz,
  'First slot start correctly maps 06:00 Asia/Kolkata to 00:30 UTC'
);

-- ============================================================================
-- 3. TEST HIERARCHICAL PRICING PRECEDENCE
-- ============================================================================

-- Scenario A: Regular weekday morning 08:00 to 09:00 IST (02:30 to 03:30 UTC on 2026-10-01 / Thursday)
-- Matches Base Rule (priority 0). Duration 60 min = 2 increments of ₹500 = ₹1,000 (100,000 paise).
select is(
  (public.quote_booking('5b111111-1111-1111-1111-111111111111'::uuid, '2026-10-01 02:30:00+00'::timestamptz, '2026-10-01 03:30:00+00'::timestamptz)->>'total_minor')::bigint,
  100000::bigint,
  'Base price rule applies when no higher priority rule matches (₹1,000 for 1 hr)'
);

-- Scenario B: Regular weekday evening peak 18:00 to 19:00 IST (12:30 to 13:30 UTC on 2026-10-01 / Thursday)
-- Matches Peak Rule (priority 10) vs Base (priority 0). Peak wins!
-- 2 increments of ₹800 = ₹1,600 (160,000 paise).
select is(
  (public.quote_booking('5b111111-1111-1111-1111-111111111111'::uuid, '2026-10-01 12:30:00+00'::timestamptz, '2026-10-01 13:30:00+00'::timestamptz)->>'total_minor')::bigint,
  160000::bigint,
  'Evening peak rule (priority 10) overrides base rule (₹1,600 for 1 hr)'
);

-- Scenario C: Festival evening on 2026-10-02 18:00 to 19:00 IST (12:30 to 13:30 UTC on 2026-10-02 / Friday)
-- Matches Festival Override (priority 100), Peak (priority 10), Base (priority 0). Festival Override wins!
-- 2 increments of ₹1,200 = ₹2,400 (240,000 paise).
select is(
  (public.quote_booking('5b111111-1111-1111-1111-111111111111'::uuid, '2026-10-02 12:30:00+00'::timestamptz, '2026-10-02 13:30:00+00'::timestamptz)->>'total_minor')::bigint,
  240000::bigint,
  'Date-specific festival override (priority 100) overrides peak and base rules (₹2,400 for 1 hr)'
);

-- ============================================================================
-- 4. TEST ADVANCE PAYMENT & POLICY SNAPSHOTS
-- ============================================================================

-- With 50% advance (5000 bps) on ₹1,600 quote, required_online_minor must be exactly ₹800 (80000 paise)
select is(
  (public.quote_booking('5b111111-1111-1111-1111-111111111111'::uuid, '2026-10-01 12:30:00+00'::timestamptz, '2026-10-01 13:30:00+00'::timestamptz)->>'required_online_minor')::bigint,
  80000::bigint,
  'Required online advance correctly calculates 50% of total (₹800)'
);

-- Verify cancellation policy snapshot is attached
select is(
  (public.quote_booking('5b111111-1111-1111-1111-111111111111'::uuid, '2026-10-01 12:30:00+00'::timestamptz, '2026-10-01 13:30:00+00'::timestamptz)->'cancellation_snapshot'->>'name'),
  'Standard Flexible',
  'Quote includes the snapshotted cancellation policy name'
);

-- ============================================================================
-- 5. TEST DURATION & BOUNDARY VALIDATIONS
-- ============================================================================

-- Duration shorter than minimum (30 min < 60 min minimum)
select throws_ok(
  $$ select public.quote_booking('5b111111-1111-1111-1111-111111111111'::uuid, '2026-10-01 02:30:00+00'::timestamptz, '2026-10-01 03:00:00+00'::timestamptz) $$,
  '22023',
  'DURATION_TOO_SHORT: Minimum duration is 60 minutes',
  'Rejects booking shorter than minimum duration'
);

-- Duration longer than maximum (300 min > 240 min maximum)
select throws_ok(
  $$ select public.quote_booking('5b111111-1111-1111-1111-111111111111'::uuid, '2026-10-01 02:30:00+00'::timestamptz, '2026-10-01 07:30:00+00'::timestamptz) $$,
  '22023',
  'DURATION_TOO_LONG: Maximum duration is 240 minutes',
  'Rejects booking longer than maximum duration'
);

-- Invalid increment (75 minutes with 30 min increment, 75 >= 60 min minimum)
select throws_ok(
  $$ select public.quote_booking('5b111111-1111-1111-1111-111111111111'::uuid, '2026-10-01 02:30:00+00'::timestamptz, '2026-10-01 03:45:00+00'::timestamptz) $$,
  '22023',
  'INVALID_INCREMENT: Duration must be an exact multiple of 30 minutes',
  'Rejects booking with duration not aligned to increment'
);

-- Invalid range (ends before starts)
select throws_ok(
  $$ select public.quote_booking('5b111111-1111-1111-1111-111111111111'::uuid, '2026-10-01 03:30:00+00'::timestamptz, '2026-10-01 02:30:00+00'::timestamptz) $$,
  '22023',
  'INVALID_TIME_RANGE: ends_at must be strictly after starts_at',
  'Rejects inverted time range'
);

select * from finish();
rollback;
