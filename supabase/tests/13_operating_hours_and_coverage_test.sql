begin;
select plan(16);

-- ============================================================================
-- Operating Hours Coverage Invariant & Milestone 2 Acceptance Tests
-- ============================================================================

-- Fixtures: Arena Pitch 1 (88888888-2222-2222-2222-222222222222)
-- Seed Master Owner: a7204914-04e3-4c2c-a8d5-e7531db0f48f
-- Timezone: Asia/Kolkata (IST = UTC+05:30)
-- Operating Hours: 06:00:00 to 23:00:00 IST every day
-- Increment: 60 minutes

-- Authenticate as Seed Master Owner (has profile and listing.edit on Turf 3)
set local "request.jwt.claims" = '{"sub": "a7204914-04e3-4c2c-a8d5-e7531db0f48f"}';

-- ----------------------------------------------------------------------------
-- Test 1: Positive Control: In-hours hold (13:00-14:00 IST) succeeds with 7 arguments
-- 13:00 IST = 07:30 UTC, 14:00 IST = 08:30 UTC
-- ----------------------------------------------------------------------------
select lives_ok(
  $$select public.create_booking_hold(
      '88888888-2222-2222-2222-222222222222'::uuid,
      '2026-09-21 07:30:00+00'::timestamptz,
      '2026-09-21 08:30:00+00'::timestamptz,
      'test-idemp-pos-control',
      'Test Player',
      '+919876543210',
      'player@test.com'
    )$$,
  'Positive control: in-hours hold (13:00-14:00 IST) succeeds with 7 arguments'
);

-- ----------------------------------------------------------------------------
-- Test 2: Negative Control: Out-of-hours hold (22:30-23:30 IST) rejected with 22023
-- 22:30 IST = 17:00 UTC, 23:30 IST = 18:00 UTC (Hours end at 23:00 IST = 17:30 UTC)
-- ----------------------------------------------------------------------------
select throws_ok(
  $$select public.create_booking_hold(
      '88888888-2222-2222-2222-222222222222'::uuid,
      '2026-09-21 17:00:00+00'::timestamptz,
      '2026-09-21 18:00:00+00'::timestamptz,
      'test-idemp-ooh-end',
      'Test Player',
      '+919876543210',
      'player@test.com'
    )$$,
  '22023',
  'OUTSIDE_OPERATING_HOURS: Requested interval is not fully covered by resource operating hours',
  'Hold extending past closing time (22:30-23:30 IST) rejected with OUTSIDE_OPERATING_HOURS (22023)'
);

-- ----------------------------------------------------------------------------
-- Test 3: Negative Control: Hold starting before open (05:30-06:30 IST) rejected with 22023
-- 05:30 IST = 00:00 UTC, 06:30 IST = 01:00 UTC (Hours start at 06:00 IST = 00:30 UTC)
-- ----------------------------------------------------------------------------
select throws_ok(
  $$select public.create_booking_hold(
      '88888888-2222-2222-2222-222222222222'::uuid,
      '2026-09-21 00:00:00+00'::timestamptz,
      '2026-09-21 01:00:00+00'::timestamptz,
      'test-idemp-ooh-start',
      'Test Player',
      '+919876543210',
      'player@test.com'
    )$$,
  '22023',
  'OUTSIDE_OPERATING_HOURS: Requested interval is not fully covered by resource operating hours',
  'Hold starting before open (05:30-06:30 IST) rejected for operating hours reason (22023)'
);

-- ----------------------------------------------------------------------------
-- Test 4: Unaligned start time (06:15 with 60-min increments) raises SLOT_NOT_FOUND (P0003)
-- ----------------------------------------------------------------------------
select throws_ok(
  $$select public.create_booking_hold(
      '88888888-2222-2222-2222-222222222222'::uuid,
      '2026-09-21 00:45:00+00'::timestamptz, -- 06:15 IST
      '2026-09-21 01:45:00+00'::timestamptz, -- 07:15 IST
      'test-idemp-unaligned',
      'Test Player',
      '+919876543210',
      'player@test.com'
    )$$,
  'P0003',
  'SLOT_NOT_FOUND: Required slot starting at 2026-09-21 00:45:00+00 was not materialized (unaligned or out of schedule)',
  'Unaligned start time (06:15 IST) hard-fails with SLOT_NOT_FOUND (P0003)'
);

-- ----------------------------------------------------------------------------
-- Test 5: Exception Precedence: non-closed exception with NULL override_periods
-- falls back to standard hours (in-hours hold still succeeds)
-- ----------------------------------------------------------------------------
insert into public.operating_exceptions (
  resource_id, local_date, closed, override_periods, reason
) values (
  '88888888-2222-2222-2222-222222222222'::uuid,
  '2026-09-22',
  false,
  null,
  'Routine inspection notice'
);

select lives_ok(
  $$select public.create_booking_hold(
      '88888888-2222-2222-2222-222222222222'::uuid,
      '2026-09-22 07:30:00+00'::timestamptz, -- 13:00 IST
      '2026-09-22 08:30:00+00'::timestamptz, -- 14:00 IST
      'test-idemp-exception-null-override',
      'Test Player',
      '+919876543210',
      'player@test.com'
    )$$,
  'Non-closed exception with NULL override_periods preserves standard operating hours'
);

-- ----------------------------------------------------------------------------
-- Test 6: Closed exception rejects booking during normal hours (Fail-closed)
-- ----------------------------------------------------------------------------
insert into public.operating_exceptions (
  resource_id, local_date, closed, override_periods, reason
) values (
  '88888888-2222-2222-2222-222222222222'::uuid,
  '2026-09-23',
  true,
  null,
  'Pitch maintenance closure'
);

select throws_ok(
  $$select public.create_booking_hold(
      '88888888-2222-2222-2222-222222222222'::uuid,
      '2026-09-23 07:30:00+00'::timestamptz, -- 13:00 IST
      '2026-09-23 08:30:00+00'::timestamptz, -- 14:00 IST
      'test-idemp-closed-exception',
      'Test Player',
      '+919876543210',
      'player@test.com'
    )$$,
  '22023',
  'OUTSIDE_OPERATING_HOURS: Requested interval is not fully covered by resource operating hours',
  'Closed exception date rejects in-hours booking with OUTSIDE_OPERATING_HOURS (22023)'
);

-- ----------------------------------------------------------------------------
-- Test 7: Duplicate weekday in set_resource_operating_hours payload rejected
-- ----------------------------------------------------------------------------
select throws_ok(
  $$select * from public.set_resource_operating_hours(
      '88888888-2222-2222-2222-222222222222'::uuid,
      '[
        {"iso_weekday": 1, "opens_at": "06:00:00", "closes_at": "12:00:00"},
        {"iso_weekday": 1, "opens_at": "16:00:00", "closes_at": "22:00:00"}
      ]'::jsonb
    )$$,
  '22023',
  'DUPLICATE_OPERATING_HOURS: Only one window per weekday is supported',
  'Payload with duplicate iso_weekday is rejected (22023)'
);

-- ----------------------------------------------------------------------------
-- Test 8: Overlapping hours in set_resource_operating_hours payload rejected
-- ----------------------------------------------------------------------------
select throws_ok(
  $$select * from public.set_resource_operating_hours(
      '88888888-2222-2222-2222-222222222222'::uuid,
      '[
        {"iso_weekday": 2, "opens_at": "06:00:00", "closes_at": "14:00:00"},
        {"iso_weekday": 2, "opens_at": "12:00:00", "closes_at": "20:00:00"}
      ]'::jsonb
    )$$,
  '22023',
  'OVERLAPPING_OPERATING_HOURS: Operating hours for weekday overlap',
  'Payload with overlapping time windows on same weekday is rejected (22023)'
);

-- ----------------------------------------------------------------------------
-- Test 9: Windowing rule: set baseline schedule, then later valid_from window
-- Predecessor is capped at valid_until = p_valid_from - 1
-- ----------------------------------------------------------------------------
select lives_ok(
  $$select * from public.set_resource_operating_hours(
      '88888888-2222-2222-2222-222222222222'::uuid,
      '[{"iso_weekday": 1, "opens_at": "08:00:00", "closes_at": "20:00:00"}]'::jsonb,
      '2026-10-01'::date,
      null
    )$$,
  'Setting future operating hours window succeeds'
);

-- Assert predecessor row has valid_until capped at 2026-09-30
select is(
  (select valid_until from public.operating_hours
   where resource_id = '88888888-2222-2222-2222-222222222222'
     and iso_weekday = 1
     and valid_from < '2026-10-01'),
  '2026-09-30'::date,
  'Baseline schedule valid_until is capped at p_valid_from - 1 (2026-09-30)'
);

-- ----------------------------------------------------------------------------
-- Test 10: Slot generation after valid_from produces ONLY new window, not a union
-- On 2026-10-05 (Monday), hours are 08:00 to 20:00 IST (12 hours = 12 60-min slots)
-- (not the union with 06:00-23:00 which would be 17 slots)
-- ----------------------------------------------------------------------------
select is(
  (select private.generate_resource_slots(
      '88888888-2222-2222-2222-222222222222'::uuid,
      '2026-10-05'::date,
      '2026-10-05'::date
    )),
  12,
  'Generator outputs exactly 12 slots (08:00-20:00 IST), proving no union with capped baseline'
);

-- ----------------------------------------------------------------------------
-- Test 11: schedule_version bumped on resources and stamped on slots
-- ----------------------------------------------------------------------------
select is(
  (select schedule_version from public.resources where id = '88888888-2222-2222-2222-222222222222'),
  2::bigint,
  'resources.schedule_version bumped to 2 following set_resource_operating_hours'
);

-- ----------------------------------------------------------------------------
-- Test 12: operational_alerts UPSERT preserves created_at on conflict
-- ----------------------------------------------------------------------------
select lives_ok(
  $$
  do $block$
  declare
    v_t1 timestamptz;
    v_t2 timestamptz;
  begin
    insert into private.operational_alerts (
      alert_type, severity, entity_type, entity_id, title, details, status
    ) values (
      'schedule_conflict', 'warning', 'resource', '88888888-2222-2222-2222-222222222222',
      'Schedule Conflict', '{"count": 1}'::jsonb, 'active'
    );

    select created_at into v_t1 from private.operational_alerts
    where alert_type = 'schedule_conflict' and entity_id = '88888888-2222-2222-2222-222222222222';

    -- Simulate conflict update
    insert into private.operational_alerts (
      alert_type, severity, entity_type, entity_id, title, details, status
    ) values (
      'schedule_conflict', 'warning', 'resource', '88888888-2222-2222-2222-222222222222',
      'Schedule Conflict', '{"count": 2}'::jsonb, 'active'
    )
    on conflict (alert_type, entity_id) where status = 'active'
    do update set details = excluded.details;

    select created_at into v_t2 from private.operational_alerts
    where alert_type = 'schedule_conflict' and entity_id = '88888888-2222-2222-2222-222222222222';

    if v_t1 != v_t2 then
      raise exception 'created_at was modified on alert conflict: % vs %', v_t1, v_t2;
    end if;
  end $block$;
  $$,
  'operational_alerts UPSERT preserves created_at on conflict'
);

-- ----------------------------------------------------------------------------
-- Test 13: Unconfigured resource (zero operating_hours rows) fails-closed on booking
-- ----------------------------------------------------------------------------
insert into public.resources (
  id, master_owner_id, turf_id, name, booking_increment_minutes, active
) values (
  '99999999-2222-2222-2222-222222222222'::uuid,
  'a7204914-04e3-4c2c-a8d5-e7531db0f48f'::uuid,
  '88888888-1111-1111-1111-111111111111'::uuid,
  'Unconfigured Court X',
  60,
  true
);

-- Pricing rule for the new resource
insert into public.pricing_rules (
  master_owner_id, turf_id, resource_id, priority, valid_from, iso_weekdays,
  starts_local, ends_local, amount_per_increment_minor, currency, active
) values (
  'a7204914-04e3-4c2c-a8d5-e7531db0f48f'::uuid,
  '88888888-1111-1111-1111-111111111111'::uuid,
  '99999999-2222-2222-2222-222222222222'::uuid,
  0, current_date - 1, array[1,2,3,4,5,6,7], '06:00:00', '23:59:59',
  150000, 'INR', true
);

-- Hold attempt fails-closed with 22023 OUTSIDE_OPERATING_HOURS
select throws_ok(
  $$select public.create_booking_hold(
      '99999999-2222-2222-2222-222222222222'::uuid,
      '2026-09-21 07:30:00+00'::timestamptz,
      '2026-09-21 08:30:00+00'::timestamptz,
      'test-idemp-unconfig-resource',
      'Test Player',
      '+919876543210',
      'player@test.com'
    )$$,
  '22023',
  'OUTSIDE_OPERATING_HOURS: Requested interval is not fully covered by resource operating hours',
  'Booking hold on unconfigured resource (zero operating hours) fails-closed with 22023'
);

-- ----------------------------------------------------------------------------
-- Test 14: Onboarding flow configures operating hours via set_resource_operating_hours,
-- making resource immediately bookable
-- ----------------------------------------------------------------------------
select lives_ok(
  $$select * from public.set_resource_operating_hours(
      '99999999-2222-2222-2222-222222222222'::uuid,
      '[{"iso_weekday": 1, "opens_at": "06:00:00", "closes_at": "23:00:00"}]'::jsonb,
      '2026-09-01'::date,
      null
    )$$,
  'Onboarding flow configures operating hours via set_resource_operating_hours'
);

-- Now booking hold succeeds
select lives_ok(
  $$select public.create_booking_hold(
      '99999999-2222-2222-2222-222222222222'::uuid,
      '2026-09-21 07:30:00+00'::timestamptz,
      '2026-09-21 08:30:00+00'::timestamptz,
      'test-idemp-configured-resource',
      'Test Player',
      '+919876543210',
      'player@test.com'
    )$$,
  'Booking hold succeeds once operating hours are configured during onboarding'
);

rollback;
