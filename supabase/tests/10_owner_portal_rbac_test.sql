-- Test Suite: 10_owner_portal_rbac_test.sql
-- Description: Positive and negative test cases for Phase 2 owner portal RPCs:
--              1. create_walkin_booking (auth guards, capabilities, full NOT NULL columns, exclusion locking)
--              2. upsert_pricing_rule (auth, venue active/archived, overlap validation, optimistic locking)
--              3. invite_employee, get_pending_employee_invites, accept_employee_invite

begin;
select plan(26);

-- ============================================================================
-- 1. SETUP TEST FIXTURES (Superuser Mode)
-- ============================================================================

do $$
declare
  uid_owner      uuid := 'a1000000-0000-0000-0000-000000000001';
  uid_unauth     uuid := 'a1000000-0000-0000-0000-000000000002';
  uid_emp_walkin uuid := 'a1000000-0000-0000-0000-000000000003';
  uid_emp_nocash uuid := 'a1000000-0000-0000-0000-000000000004';
  uid_invitee    uuid := 'a1000000-0000-0000-0000-000000000005';

  mo_id          uuid := 'b1000000-0000-0000-0000-000000000001';
  turf_active    uuid := 'c1000000-0000-0000-0000-000000000001';
  turf_archived  uuid := 'c1000000-0000-0000-0000-000000000002';
  res_active     uuid := 'd1000000-0000-0000-0000-000000000001';
  res_archived   uuid := 'd1000000-0000-0000-0000-000000000002';

  emp_rec_1      uuid := 'f1000000-0000-0000-0000-000000000001';
  emp_rec_2      uuid := 'f1000000-0000-0000-0000-000000000002';
  assign_1       uuid := 'e1000000-0000-0000-0000-000000000001';
  assign_2       uuid := 'e1000000-0000-0000-0000-000000000002';
begin
  -- Auth users
  insert into auth.users (id, email) values
    (uid_owner, 'owner_10@test.com'),
    (uid_unauth, 'unauth_10@test.com'),
    (uid_emp_walkin, 'emp_walkin_10@test.com'),
    (uid_emp_nocash, 'emp_nocash_10@test.com'),
    (uid_invitee, 'invitee_10@test.com')
  on conflict (id) do nothing;

  -- Master owner
  insert into public.master_owners (id, owner_user_id, business_name, status) values
    (mo_id, uid_owner, 'RBAC Test Sports Corp', 'active')
  on conflict (id) do nothing;

  -- Active and archived turfs
  insert into public.turfs (id, master_owner_id, slug, name, address_text, city, location, approval_status, archived_at) values
    (turf_active, mo_id, 'rbac-active-turf', 'RBAC Active Arena', '123 Play St', 'Bengaluru',
     extensions.st_setsrid(extensions.st_makepoint(77.5946, 12.9716), 4326), 'approved', null),
    (turf_archived, mo_id, 'rbac-archived-turf', 'RBAC Archived Arena', '456 Closed St', 'Bengaluru',
     extensions.st_setsrid(extensions.st_makepoint(77.5946, 12.9716), 4326), 'approved', now())
  on conflict (id) do nothing;

  -- Resources
  insert into public.resources (id, master_owner_id, turf_id, name, booking_increment_minutes) values
    (res_active, mo_id, turf_active, 'RBAC Pitch 1', 60),
    (res_archived, mo_id, turf_archived, 'RBAC Pitch Archived', 60)
  on conflict (id) do nothing;

  -- Base pricing rule for active resource
  insert into public.pricing_rules (
    id, master_owner_id, turf_id, resource_id, valid_from, valid_until,
    iso_weekdays, starts_local, ends_local, amount_per_increment_minor, priority, active, version
  ) values (
    '81000000-0000-0000-0000-000000000001'::uuid, mo_id, turf_active, res_active,
    '2026-01-01', '2026-12-31', array[1,2,3,4,5,6,7]::smallint[],
    '06:00'::time, '23:00'::time, 50000, 0, true, 1
  ) on conflict (id) do nothing;

  -- Operating hours for active resource (matching pricing window 06:00-23:00)
  insert into public.operating_hours (resource_id, iso_weekday, opens_at, closes_at, valid_from)
  select res_active, gs, '06:00:00'::time, '23:00:00'::time, '2026-01-01'::date
  from generate_series(1, 7) gs
  on conflict do nothing;

  -- Employee 1: has bookings.create_walkin AND payments.record_offline
  insert into public.employees (id, master_owner_id, user_id, status)
  values (emp_rec_1, mo_id, uid_emp_walkin, 'active')
  on conflict (master_owner_id, user_id) do nothing;

  insert into public.employee_turf_assignments (id, employee_id, master_owner_id, turf_id, active)
  values (assign_1, emp_rec_1, mo_id, turf_active, true)
  on conflict (employee_id, turf_id) do nothing;

  insert into private.assignment_grants (assignment_id, capability, scope) values
    (assign_1, 'bookings.create_walkin', 'turf'),
    (assign_1, 'payments.record_offline', 'turf'),
    (assign_1, 'bookings.read', 'turf')
  on conflict do nothing;

  -- Employee 2: has ONLY bookings.create_walkin (missing payments.record_offline)
  insert into public.employees (id, master_owner_id, user_id, status)
  values (emp_rec_2, mo_id, uid_emp_nocash, 'active')
  on conflict (master_owner_id, user_id) do nothing;

  insert into public.employee_turf_assignments (id, employee_id, master_owner_id, turf_id, active)
  values (assign_2, emp_rec_2, mo_id, turf_active, true)
  on conflict (employee_id, turf_id) do nothing;

  insert into private.assignment_grants (assignment_id, capability, scope) values
    (assign_2, 'bookings.create_walkin', 'turf')
  on conflict do nothing;
end $$;

-- ============================================================================
-- 2. RPC TESTS: create_walkin_booking
-- ============================================================================

-- Test 1: Negative - Anon cannot call create_walkin_booking (AUTH_REQUIRED)
set local role anon;
select throws_ok(
  $$select public.create_walkin_booking(
    'd1000000-0000-0000-0000-000000000001'::uuid,
    '2026-10-15 10:00:00+05:30'::timestamptz,
    '2026-10-15 11:00:00+05:30'::timestamptz,
    'Anon Walkin',
    '+919876543210'
  )$$,
  '42501',
  NULL,
  'Anon caller rejected from create_walkin_booking with 42501'
);

-- Test 2: Negative - Unaffiliated authenticated user rejected (PERMISSION_DENIED)
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000000-0000-0000-0000-000000000002"}';
select throws_ok(
  $$select public.create_walkin_booking(
    'd1000000-0000-0000-0000-000000000001'::uuid,
    '2026-10-15 10:00:00+05:30'::timestamptz,
    '2026-10-15 11:00:00+05:30'::timestamptz,
    'Unauthorized Walkin',
    '+919876543210'
  )$$,
  '42501',
  NULL,
  'Unaffiliated authenticated user rejected with 42501'
);

-- Test 3: Negative - Employee missing payments.record_offline rejected
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000000-0000-0000-0000-000000000004"}';
select throws_ok(
  $$select public.create_walkin_booking(
    'd1000000-0000-0000-0000-000000000001'::uuid,
    '2026-10-15 10:00:00+05:30'::timestamptz,
    '2026-10-15 11:00:00+05:30'::timestamptz,
    'No Cash Staff',
    '+919876543210'
  )$$,
  '42501',
  NULL,
  'Employee missing payments.record_offline rejected with 42501'
);

-- Test 4: Positive - Authorized Employee with both capabilities succeeds
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000000-0000-0000-0000-000000000003"}';
select lives_ok(
  $$select public.create_walkin_booking(
    'd1000000-0000-0000-0000-000000000001'::uuid,
    '2026-10-15 10:00:00+05:30'::timestamptz,
    '2026-10-15 11:00:00+05:30'::timestamptz,
    'Walk-in Player 1',
    '+919876543210',
    'player1@test.com',
    'cash'
  )$$,
  'Authorized employee creates walk-in booking successfully'
);

-- Test 5: Verify created walk-in booking record shape and NOT NULL columns
select is(
  (
    select count(*)::int from public.bookings
    where resource_id = 'd1000000-0000-0000-0000-000000000001'::uuid
      and source = 'walkin'
      and status = 'confirmed'
      and required_online_minor = 0
      and total_minor = 50000
      and cancellation_snapshot is not null
      and created_by = 'a1000000-0000-0000-0000-000000000003'::uuid
  ),
  1,
  'Walk-in booking persisted with source=walkin, status=confirmed, required_online_minor=0, and valid created_by'
);

-- Test 6: Negative - Collision with existing booking raises SLOT_UNAVAILABLE (23P01)
select throws_ok(
  $$select public.create_walkin_booking(
    'd1000000-0000-0000-0000-000000000001'::uuid,
    '2026-10-15 10:00:00+05:30'::timestamptz,
    '2026-10-15 11:00:00+05:30'::timestamptz,
    'Colliding Player',
    '+919876543211'
  )$$,
  '23P01',
  NULL,
  'Concurrent walk-in collision on identical interval throws SLOT_UNAVAILABLE (23P01)'
);

-- Test 7: Positive - Master Owner can create walk-in booking
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000000-0000-0000-0000-000000000001"}';
select lives_ok(
  $$select public.create_walkin_booking(
    'd1000000-0000-0000-0000-000000000001'::uuid,
    '2026-10-15 11:00:00+05:30'::timestamptz,
    '2026-10-15 12:00:00+05:30'::timestamptz,
    'Owner Walk-in Player',
    '+919876543212',
    null,
    'pos_card'
  )$$,
  'Master Owner can create walk-in booking'
);

-- ============================================================================
-- 3. RPC TESTS: upsert_pricing_rule
-- ============================================================================

-- Test 8: Negative - Unaffiliated user rejected from upsert_pricing_rule (PERMISSION_DENIED)
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000000-0000-0000-0000-000000000002"}';
select throws_ok(
  $$select public.upsert_pricing_rule(
    null,
    'd1000000-0000-0000-0000-000000000001'::uuid,
    '2026-10-01'::date,
    '2026-10-31'::date,
    array[1,2,3,4,5]::smallint[],
    '18:00'::time,
    '22:00'::time,
    80000,
    1,
    true
  )$$,
  '42501',
  NULL,
  'Unaffiliated caller rejected from upsert_pricing_rule with 42501'
);

-- Test 9: Negative - Cannot create pricing rule on archived turf (PERMISSION_DENIED)
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000000-0000-0000-0000-000000000001"}';
select throws_ok(
  $$select public.upsert_pricing_rule(
    null,
    'd1000000-0000-0000-0000-000000000002'::uuid,
    '2026-10-01'::date,
    '2026-10-31'::date,
    array[1,2,3,4,5]::smallint[],
    '18:00'::time,
    '22:00'::time,
    80000,
    1,
    true
  )$$,
  '42501',
  'PERMISSION_DENIED: Caller lacks pricing.edit capability on turf c1000000-0000-0000-0000-000000000002',
  'Cannot create pricing rule on archived turf (PERMISSION_DENIED)'
);

-- Test 10: Negative - Overlapping rule with same priority rejected (PRICING_RULE_OVERLAP)
select throws_ok(
  $$select public.upsert_pricing_rule(
    null,
    'd1000000-0000-0000-0000-000000000001'::uuid,
    '2026-06-01'::date,
    '2026-07-01'::date,
    array[1,2,3]::smallint[],
    '08:00'::time,
    '12:00'::time,
    60000,
    0,
    true
  )$$,
  '22023',
  NULL,
  'Active overlapping rule with identical priority rejected with PRICING_RULE_OVERLAP'
);

-- Test 11: Positive - Master Owner inserts new pricing rule with higher priority
select lives_ok(
  $$select public.upsert_pricing_rule(
    null,
    'd1000000-0000-0000-0000-000000000001'::uuid,
    '2026-10-01'::date,
    '2026-10-31'::date,
    array[6,7]::smallint[],
    '18:00'::time,
    '22:00'::time,
    90000,
    5,
    true
  )$$,
  'Master Owner inserts weekend peak pricing rule with priority 5'
);

-- Test 12: Negative - Optimistic locking conflict (stale expected_version)
select throws_ok(
  $$select public.upsert_pricing_rule(
    '81000000-0000-0000-0000-000000000001'::uuid,
    'd1000000-0000-0000-0000-000000000001'::uuid,
    '2026-01-01'::date,
    '2026-12-31'::date,
    array[1,2,3,4,5,6,7]::smallint[],
    '06:00'::time,
    '23:00'::time,
    55000,
    0,
    true,
    99 -- wrong version
  )$$,
  '40900',
  NULL,
  'Mismatched expected_version throws VERSION_CONFLICT (40900)'
);

-- Test 13: Positive - Update pricing rule with correct version succeeds and increments version
select is(
  (
    select (public.upsert_pricing_rule(
      '81000000-0000-0000-0000-000000000001'::uuid,
      'd1000000-0000-0000-0000-000000000001'::uuid,
      '2026-01-01'::date,
      '2026-12-31'::date,
      array[1,2,3,4,5,6,7]::smallint[],
      '06:00'::time,
      '23:00'::time,
      55000,
      0,
      true,
      1 -- correct initial version
    )->>'amount_per_increment_minor')::bigint
  ),
  55000::bigint,
  'Updating rule with matching version succeeds'
);

-- ============================================================================
-- 4. RPC TESTS: Employee Invites Lifecycle
-- ============================================================================

-- Test 14: Negative - Non-owner cannot invite employees (PERMISSION_DENIED)
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000000-0000-0000-0000-000000000002"}';
select throws_ok(
  $$select public.invite_employee(
    'b1000000-0000-0000-0000-000000000001'::uuid,
    'hacker@test.com',
    array['c1000000-0000-0000-0000-000000000001'::uuid],
    array['bookings.create_walkin']
  )$$,
  '42501',
  NULL,
  'Non-owner cannot invite employees'
);

-- Test 15: Negative - Invalid capability not in registry fails (INVALID_CAPABILITY)
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000000-0000-0000-0000-000000000001"}';
select throws_ok(
  $$select public.invite_employee(
    'b1000000-0000-0000-0000-000000000001'::uuid,
    'invitee_10@test.com',
    array['c1000000-0000-0000-0000-000000000001'::uuid],
    array['fake_nonexistent_capability']
  )$$,
  '22023',
  NULL,
  'Invalid capability rejected with INVALID_CAPABILITY'
);

-- Test 16: Positive - Master Owner invites employee with valid turf and capabilities
select is(
  (
    select (public.invite_employee(
      'b1000000-0000-0000-0000-000000000001'::uuid,
      'invitee_10@test.com',
      array['c1000000-0000-0000-0000-000000000001'::uuid],
      array['bookings.create_walkin', 'payments.record_offline']
    )->>'email')
  ),
  'invitee_10@test.com',
  'Master Owner successfully creates employee invite'
);

-- Test 17: Positive - get_pending_employee_invites lists the created invite
select is(
  (
    select count(*)::int
    from jsonb_array_elements(public.get_pending_employee_invites('b1000000-0000-0000-0000-000000000001'::uuid))
    where value->>'email' = 'invitee_10@test.com'
  ),
  1,
  'Pending employee invite is visible to master owner'
);

-- Test 18: Positive - Invitee accepts invitation via token
do $$
declare
  v_invite jsonb;
begin
  -- Master Owner generates invite with token
  v_invite := public.invite_employee(
    'b1000000-0000-0000-0000-000000000001'::uuid,
    'known_token@test.com',
    array['c1000000-0000-0000-0000-000000000001'::uuid],
    array['bookings.create_walkin', 'payments.record_offline']
  );
  create temp table _test_invite_token on commit drop as select v_invite->>'token' as token;
end $$;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000000-0000-0000-0000-000000000005"}';

select is(
  (
    select public.accept_employee_invite((select token from _test_invite_token))->>'status'
  ),
  'active',
  'Invitee accepts invite and becomes an active employee'
);

-- Test 19: Negative - Re-accepting already accepted token fails
select throws_ok(
  $$select public.accept_employee_invite((select token from _test_invite_token))$$,
  '22023',
  NULL,
  'Re-accepting already accepted token rejected with INVALID_INVITE_TOKEN'
);

-- Test 20: Verify assignment grants created with scope = 'turf'
reset role;

select is(
  (
    select count(*)::int
    from private.assignment_grants g
    join public.employee_turf_assignments a on a.id = g.assignment_id
    join public.employees e on e.id = a.employee_id
    where e.user_id = 'a1000000-0000-0000-0000-000000000005'::uuid
      and g.scope = 'turf'
  ),
  2,
  'Employee turf assignment grants are created with scope = turf'
);

-- Test 21 to 24: Authenticated owner reads master_owners and employees without 42P17 recursion
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000000-0000-0000-0000-000000000001"}';

select lives_ok(
  $$select * from public.master_owners$$,
  'Owner can query public.master_owners without RLS recursion'
);

select is(
  (select count(*)::int from public.master_owners),
  1,
  'Owner sees exactly their own master_owner row'
);

select lives_ok(
  $$select * from public.employees$$,
  'Owner can query public.employees without RLS recursion'
);

select is(
  (select count(*)::int from public.employees),
  3,
  'Owner sees all employee rows under their master_owner'
);

-- Test 25 & 26: Authenticated player reads zero rows from both tables
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000000-0000-0000-0000-000000000002"}';

select is(
  (select count(*)::int from public.master_owners),
  0,
  'Player sees zero master_owner rows'
);

select is(
  (select count(*)::int from public.employees),
  0,
  'Player sees zero employee rows'
);

rollback;

