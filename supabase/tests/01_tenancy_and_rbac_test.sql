-- Test Suite: 01_tenancy_and_rbac_test.sql
-- Description: pgTAP tests for Milestone 1 acceptance criteria:
-- 1. Cross-tenant isolation
-- 2. Employee boundary enforcement
-- 3. Privilege revocation
-- 4. Metadata spoofing defense

begin;
select plan(17);

-- ============================================================================
-- 1. SETUP TEST FIXTURES (Superuser Mode)
-- ============================================================================

do $$
declare
  uid_owner_a uuid := '11111111-1111-1111-1111-111111111111';
  uid_owner_b uuid := '22222222-2222-2222-2222-222222222222';
  uid_employee uuid := '33333333-3333-3333-3333-333333333333';
  uid_player   uuid := '44444444-4444-4444-4444-444444444444';

  mo_a_id uuid := 'a0000000-0000-0000-0000-000000000001';
  mo_b_id uuid := 'b0000000-0000-0000-0000-000000000002';

  turf_a1_id uuid := 'a1111111-1111-1111-1111-111111111111';
  turf_a2_id uuid := 'a2222222-2222-2222-2222-222222222222';
  turf_b1_id uuid := 'b1111111-1111-1111-1111-111111111111';

  emp_id uuid := 'e0000000-0000-0000-0000-000000000001';
  assign_a1_id uuid := 'aa111111-1111-1111-1111-111111111111';
begin
  -- Insert Auth users
  insert into auth.users (id, email, raw_user_meta_data) values
    (uid_owner_a, 'owner_a@test.com', '{"name": "Owner A"}'::jsonb),
    (uid_owner_b, 'owner_b@test.com', '{"name": "Owner B"}'::jsonb),
    (uid_employee, 'emp@test.com', '{"name": "Employee"}'::jsonb),
    (uid_player, 'player@test.com', '{"name": "Malicious Player", "role": "master_owner", "is_admin": true}'::jsonb);

  -- Insert Master Owner business accounts
  insert into public.master_owners (id, owner_user_id, business_name, status) values
    (mo_a_id, uid_owner_a, 'Arena Alpha Sports', 'active'),
    (mo_b_id, uid_owner_b, 'Beta Turf Zone', 'active');

  -- Insert draft turfs
  insert into public.turfs (id, master_owner_id, slug, name, address_text, city, location, approval_status) values
    (turf_a1_id, mo_a_id, 'arena-alpha-ground-1', 'Arena Alpha 1', 'Street 1', 'Ahmedabad', extensions.ST_SetSRID(extensions.ST_MakePoint(72.5714, 23.0225), 4326)::extensions.geography, 'draft'),
    (turf_a2_id, mo_a_id, 'arena-alpha-ground-2', 'Arena Alpha 2', 'Street 1', 'Ahmedabad', extensions.ST_SetSRID(extensions.ST_MakePoint(72.5714, 23.0225), 4326)::extensions.geography, 'draft'),
    (turf_b1_id, mo_b_id, 'beta-turf-main', 'Beta Turf 1', 'Street 2', 'Surat', extensions.ST_SetSRID(extensions.ST_MakePoint(72.8311, 21.1702), 4326)::extensions.geography, 'draft');

  -- Insert Employee membership for Tenant A
  insert into public.employees (id, master_owner_id, user_id, status) values
    (emp_id, mo_a_id, uid_employee, 'active');

  -- Assign Employee to Turf A1 ONLY with calendar.read capability
  insert into public.employee_turf_assignments (id, master_owner_id, employee_id, turf_id, active) values
    (assign_a1_id, mo_a_id, emp_id, turf_a1_id, true);

  insert into private.assignment_grants (assignment_id, capability, scope) values
    (assign_a1_id, 'calendar.read', 'turf');
end $$;

-- ============================================================================
-- 2. ACCEPTANCE TEST 1: CROSS-TENANT ISOLATION
-- ============================================================================

-- Switch session to Owner A
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';

select is(
  private.can_turf('a1111111-1111-1111-1111-111111111111'::uuid, 'turf.read'),
  true,
  'Owner A has turf.read access to their own Turf A1'
);

select is(
  private.can_turf('b1111111-1111-1111-1111-111111111111'::uuid, 'turf.read'),
  false,
  'Owner A CANNOT access Tenant B Turf B1 via can_turf (Cross-tenant isolation)'
);

select is(
  (select count(*)::int from public.turfs where master_owner_id = 'b0000000-0000-0000-0000-000000000002'::uuid),
  0,
  'Owner A sees 0 draft turfs belonging to Tenant B through RLS'
);

-- Switch session to Owner B
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';

select is(
  private.can_turf('a1111111-1111-1111-1111-111111111111'::uuid, 'turf.read'),
  false,
  'Owner B CANNOT access Tenant A Turf A1 via can_turf'
);

select is(
  (select count(*)::int from public.turfs where approval_status = 'draft'),
  1,
  'Owner B sees exactly 1 draft turf (their own Turf B1)'
);

-- ============================================================================
-- 3. ACCEPTANCE TEST 2: EMPLOYEE BOUNDARY ENFORCEMENT
-- ============================================================================

-- Switch session to Employee (assigned to Turf A1 with calendar.read)
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';

select is(
  private.can_turf('a1111111-1111-1111-1111-111111111111'::uuid, 'calendar.read'),
  true,
  'Employee can access calendar.read on assigned Turf A1'
);

select is(
  private.can_turf('a2222222-2222-2222-2222-222222222222'::uuid, 'calendar.read'),
  false,
  'Employee CANNOT access calendar.read on unassigned Turf A2 of same business'
);

select is(
  private.can_turf('a1111111-1111-1111-1111-111111111111'::uuid, 'pricing.edit'),
  false,
  'Employee CANNOT edit pricing on Turf A1 without explicit grant'
);

select is(
  private.can_turf('b1111111-1111-1111-1111-111111111111'::uuid, 'calendar.read'),
  false,
  'Employee CANNOT access other tenant Turf B1'
);

-- ============================================================================
-- 4. ACCEPTANCE TEST 3: PRIVILEGE REVOCATION
-- ============================================================================

-- Switch to Owner A to revoke employee
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';

-- Owner A disables the employee
select lives_ok(
  $$ select public.disable_employee('e0000000-0000-0000-0000-000000000001'::uuid) $$,
  'Owner A successfully invokes disable_employee'
);

-- Switch back to Employee: should instantly lose all capabilities
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';

select is(
  private.can_turf('a1111111-1111-1111-1111-111111111111'::uuid, 'calendar.read'),
  false,
  'Revoked employee INSTANTLY loses calendar.read access via can_turf'
);

-- ============================================================================
-- 5. ACCEPTANCE TEST 4: METADATA SPOOFING DEFENSE
-- ============================================================================

-- Switch to Player who spoofed metadata: {"role": "master_owner", "is_admin": true}
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated", "user_metadata": {"role": "master_owner", "is_admin": true}}';

select is(
  private.can_turf('a1111111-1111-1111-1111-111111111111'::uuid, 'turf.read'),
  false,
  'User spoofing user_metadata role cannot bypass can_turf check'
);

select is(
  (select count(*)::int from public.turfs where approval_status = 'draft'),
  0,
  'User spoofing user_metadata role sees 0 draft turfs through RLS'
);

-- ============================================================================
-- 6. ACCEPTANCE TEST 5: ARCHIVED TURF ACCESS CONTROLS
-- ============================================================================

-- Reset to superuser to archive Turf A2 and assign employee to Turf A2
set local role postgres;
update public.turfs
set archived_at = now()
where id = 'a2222222-2222-2222-2222-222222222222'::uuid;

-- Re-enable employee and grant calendar.read on Turf A2 as well
update public.employees
set status = 'active'
where id = 'e0000000-0000-0000-0000-000000000001'::uuid;

insert into public.employee_turf_assignments (id, master_owner_id, employee_id, turf_id, active) values
  ('aa222222-2222-2222-2222-222222222222'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid, 'a2222222-2222-2222-2222-222222222222'::uuid, true);

insert into private.assignment_grants (assignment_id, capability, scope) values
  ('aa222222-2222-2222-2222-222222222222'::uuid, 'calendar.read', 'turf');

-- As Employee: Turf A2 is archived, so calendar.read must be blocked
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';

select is(
  private.can_turf('a2222222-2222-2222-2222-222222222222'::uuid, 'calendar.read'),
  false,
  'Employee CANNOT access operational capability on archived turf'
);

-- As Owner A: listing.edit on archived turf is blocked, but turf.read for historical audit is allowed
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';

select is(
  private.can_turf('a2222222-2222-2222-2222-222222222222'::uuid, 'listing.edit'),
  false,
  'Owner CANNOT edit listing of an archived turf'
);

select is(
  private.can_turf('a2222222-2222-2222-2222-222222222222'::uuid, 'turf.read'),
  true,
  'Owner CAN read historical records of an archived turf'
);

-- ============================================================================
-- 7. ACCEPTANCE TEST 6: SUSPENDED MASTER OWNER BUSINESS
-- ============================================================================

-- Suspend Business A
set local role postgres;
update public.master_owners
set status = 'suspended'
where id = 'a0000000-0000-0000-0000-000000000001'::uuid;

-- As Owner A: suspended business blocks turf operations
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';

select is(
  private.can_turf('a1111111-1111-1111-1111-111111111111'::uuid, 'turf.read'),
  false,
  'Suspended Master Owner CANNOT access turf operations via can_turf'
);

select * from finish();
rollback;
