-- Test Suite: 12_turf_onboarding_test.sql
-- Description: Positive and negative test cases for Phase 1 Owner Portal:
--              1. Direct cross-tenant UPDATE returns rowCount = 0 under RLS USING clause.
--              2. RPC public.update_turf_onboarding cross-tenant write strictly raises SQLSTATE 42501.
--              3. Owner updates onboarding fields (description, address, normalized turf_amenities, turf_photos, resource_sports).
--              4. Optimistic concurrency (VERSION_MISMATCH raises 40001).
--              5. Anon visibility: anon can read published photos of approved turfs, but not unpublished or draft photos.
--              6. Capability resolution: public.get_my_capabilities returns full implicit capabilities for owners (exactly 19, no platform codes),
--                 staff capabilities resolved from assignment grants, and strictly raises 42501 when caller queries a foreign master_owner_id.
--              7. Photo diffing and domain error checks (duplicate path and cross-tenant collision raise PHOTO_PATH_CONFLICT 23505).
--              8. Conditional version bump (no-change save does not increment version).

begin;
select plan(27);

-- ============================================================================
-- 1. SETUP TEST FIXTURES
-- ============================================================================

do $$
declare
  uid_owner_a   uuid := 'a2000000-0000-0000-0000-000000000001';
  uid_owner_b   uuid := 'a2000000-0000-0000-0000-000000000002';
  uid_unauth    uuid := 'a2000000-0000-0000-0000-000000000003';
  uid_staff     uuid := 'a2000000-0000-0000-0000-000000000005';

  mo_a_id       uuid := 'b2000000-0000-0000-0000-000000000001';
  mo_b_id       uuid := 'b2000000-0000-0000-0000-000000000002';

  turf_a_active   uuid := 'c2000000-0000-0000-0000-000000000001';
  turf_a_archived uuid := 'c2000000-0000-0000-0000-000000000002';
  turf_a_draft    uuid := 'c2000000-0000-0000-0000-000000000003';
  turf_b_active   uuid := 'c2000000-0000-0000-0000-000000000004';

  res_a_1         uuid := 'd2000000-0000-0000-0000-000000000001';
  emp_id          uuid := 'e2000000-0000-0000-0000-000000000001';
  asgn_id         uuid := 'f2000000-0000-0000-0000-000000000001';
begin
  -- Auth users
  insert into auth.users (id, email) values
    (uid_owner_a, 'owner_a_12@test.com'),
    (uid_owner_b, 'owner_b_12@test.com'),
    (uid_unauth,  'unauth_12@test.com'),
    (uid_staff,   'staff_12@test.com')
  on conflict (id) do nothing;

  -- Profiles (if not auto-created by auth trigger)
  insert into public.profiles (user_id, display_name) values
    (uid_owner_a, 'Owner A'),
    (uid_owner_b, 'Owner B'),
    (uid_unauth,  'Unauth User'),
    (uid_staff,   'Staff Member')
  on conflict (user_id) do nothing;

  -- Master owners
  insert into public.master_owners (id, owner_user_id, business_name, status) values
    (mo_a_id, uid_owner_a, 'Onboarding Corp A', 'active'),
    (mo_b_id, uid_owner_b, 'Onboarding Corp B', 'active')
  on conflict (id) do nothing;

  -- Turfs
  insert into public.turfs (id, master_owner_id, slug, name, address_text, city, location, approval_status, archived_at, version) values
    (turf_a_active,   mo_a_id, 'turf-a-active',   'Turf A Active',   '100 Street A', 'Ahmedabad',
     extensions.st_setsrid(extensions.st_makepoint(72.5714, 23.0225), 4326), 'approved', null, 1),
    (turf_a_archived, mo_a_id, 'turf-a-archived', 'Turf A Archived', '101 Street A', 'Ahmedabad',
     extensions.st_setsrid(extensions.st_makepoint(72.5714, 23.0225), 4326), 'approved', now(), 1),
    (turf_a_draft,    mo_a_id, 'turf-a-draft',    'Turf A Draft',    '102 Street A', 'Ahmedabad',
     extensions.st_setsrid(extensions.st_makepoint(72.5714, 23.0225), 4326), 'draft',    null, 1),
    (turf_b_active,   mo_b_id, 'turf-b-active',   'Turf B Active',   '200 Street B', 'Ahmedabad',
     extensions.st_setsrid(extensions.st_makepoint(72.5714, 23.0225), 4326), 'approved', null, 1)
  on conflict (id) do nothing;

  -- Resources
  insert into public.resources (id, master_owner_id, turf_id, name, booking_increment_minutes) values
    (res_a_1, mo_a_id, turf_a_active, 'Main Court A', 60)
  on conflict (id) do nothing;

  -- Seed a photo for Turf B to test cross-tenant collision
  insert into public.turf_photos (turf_id, storage_path, sort_order, published) values
    (turf_b_active, 'turfs/b1/hero.webp', 0, true)
  on conflict do nothing;

  -- Staff employee, turf assignment, and grants
  insert into public.employees (id, master_owner_id, user_id, status) values
    (emp_id, mo_a_id, uid_staff, 'active')
  on conflict (id) do nothing;

  insert into public.employee_turf_assignments (id, master_owner_id, employee_id, turf_id, active) values
    (asgn_id, mo_a_id, emp_id, turf_a_active, true)
  on conflict (id) do nothing;

  insert into private.assignment_grants (assignment_id, capability, scope) values
    (asgn_id, 'bookings.read', 'turf'),
    (asgn_id, 'calendar.read', 'turf')
  on conflict (assignment_id, capability) do nothing;
end $$;

-- ============================================================================
-- 2. DIRECT CROSS-TENANT UPDATE (RLS USING CLAUSE DENIAL)
-- ============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2000000-0000-0000-0000-000000000002"}'; -- Owner B caller

-- Test 1: Direct UPDATE on Owner A's turf returns 0 rows updated (no error, filtered by USING)
with updated as (
  update public.turfs
  set description = 'malicious description overwrite'
  where id = 'c2000000-0000-0000-0000-000000000001'
  returning id
)
select is(
  count(*)::int,
  0,
  'Direct cross-tenant UPDATE returns 0 rows under RLS USING clause'
)
from updated;

-- ============================================================================
-- 3. CROSS-TENANT WRITE ON update_turf_onboarding (42501 REJECTION)
-- ============================================================================

-- Test 2: Foreign caller (Owner B) calling update_turf_onboarding on Owner A's turf raises 42501
select throws_ok(
  $$select public.update_turf_onboarding('c2000000-0000-0000-0000-000000000001'::uuid, 1, 'new desc')$$,
  '42501',
  'PERMISSION_DENIED: Caller lacks listing.edit capability on turf c2000000-0000-0000-0000-000000000001',
  'Cross-tenant call to update_turf_onboarding strictly raises 42501'
);

-- Test 3: Unauthenticated caller calling update_turf_onboarding raises 42501
set local role anon;
set local "request.jwt.claims" = '';
select throws_ok(
  $$select public.update_turf_onboarding('c2000000-0000-0000-0000-000000000001'::uuid, 1, 'new desc')$$,
  '42501',
  NULL,
  'Unauthenticated caller to update_turf_onboarding strictly raises 42501'
);

-- ============================================================================
-- 4. ARCHIVED TURF WRITE DENIAL (42501 REJECTION)
-- ============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2000000-0000-0000-0000-000000000001"}'; -- Owner A caller

-- Test 4: Owner A cannot update archived turf (private.can_turf denies listing.edit on archived turfs)
select throws_ok(
  $$select public.update_turf_onboarding('c2000000-0000-0000-0000-000000000002'::uuid, 1, 'update archived')$$,
  '42501',
  'PERMISSION_DENIED: Caller lacks listing.edit capability on turf c2000000-0000-0000-0000-000000000002',
  'Cannot update onboarding on archived turf (raises 42501)'
);

-- ============================================================================
-- 5. SUCCESSFUL ONBOARDING UPDATE & NORMALIZED RECONCILIATION
-- ============================================================================

-- Test 5: Owner A successfully updates onboarding fields
select lives_ok(
  $$select public.update_turf_onboarding(
      'c2000000-0000-0000-0000-000000000001'::uuid,
      1,
      'Premier floodlit box cricket arena with professional turf',
      '100 Stadium Road, Sector 5',
      array['parking', 'washroom', 'floodlights'],
      '[{"storage_path": "turfs/a1/pitch.webp", "sort_order": 0, "published": true}, {"storage_path": "turfs/a1/draft.webp", "sort_order": 1, "published": false}]'::jsonb,
      '[{"resource_id": "d2000000-0000-0000-0000-000000000001", "sport_codes": ["cricket", "football"]}]'::jsonb
    )$$,
  'Owner A successfully updates turf onboarding'
);

-- Test 6: Verify turf core fields updated and version incremented
select results_eq(
  $$select description, address_text, version from public.turfs where id = 'c2000000-0000-0000-0000-000000000001'$$,
  $$values ('Premier floodlit box cricket arena with professional turf'::text, '100 Stadium Road, Sector 5'::text, 2::bigint)$$,
  'Turf description, address_text, and version incremented'
);

-- Test 7: Verify normalized public.turf_amenities reconciled
select results_eq(
  $$select amenity_code from public.turf_amenities where turf_id = 'c2000000-0000-0000-0000-000000000001' order by amenity_code$$,
  $$values ('floodlights'::text), ('parking'::text), ('washroom'::text)$$,
  'Normalized turf_amenities reconciled with valid codes'
);

-- Test 8: Verify normalized public.turf_photos reconciled
select results_eq(
  $$select storage_path, sort_order, published from public.turf_photos where turf_id = 'c2000000-0000-0000-0000-000000000001' order by sort_order$$,
  $$values ('turfs/a1/pitch.webp'::text, 0::integer, true::boolean), ('turfs/a1/draft.webp'::text, 1::integer, false::boolean)$$,
  'Normalized turf_photos reconciled with published flags'
);

-- Test 9: Verify normalized public.resource_sports reconciled
select results_eq(
  $$select sport_code from public.resource_sports where resource_id = 'd2000000-0000-0000-0000-000000000001' order by sport_code$$,
  $$values ('cricket'::text), ('football'::text)$$,
  'Normalized resource_sports reconciled for resource'
);

-- ============================================================================
-- 6. OPTIMISTIC CONCURRENCY CONTROL (40001 REJECTION)
-- ============================================================================

-- Test 10: Calling with stale expected_version 1 raises 40001
select throws_ok(
  $$select public.update_turf_onboarding('c2000000-0000-0000-0000-000000000001'::uuid, 1, 'stale edit')$$,
  '40001',
  'VERSION_MISMATCH: Expected version 1 does not match current version 2',
  'Stale expected_version rejected with 40001'
);

-- ============================================================================
-- 7. ANON VISIBILITY: PUBLISHED PHOTOS ONLY ON APPROVED TURFS
-- ============================================================================

set local role anon;
set local "request.jwt.claims" = '';

-- Test 11: Anon can see published photo of approved turf
select results_eq(
  $$select storage_path from public.turf_photos where turf_id = 'c2000000-0000-0000-0000-000000000001'$$,
  $$values ('turfs/a1/pitch.webp'::text)$$,
  'Anon sees only published photos of approved turf (unpublished draft photo is hidden)'
);

-- Test 12: Anon cannot see photos of draft turf
select is_empty(
  $$select * from public.turf_photos where turf_id = 'c2000000-0000-0000-0000-000000000003'$$,
  'Anon cannot see photos of draft/unapproved turf'
);

-- ============================================================================
-- 8. CAPABILITY RESOLUTION (public.get_my_capabilities)
-- ============================================================================

-- Test 13: Foreign tenant capability query raises 42501 (prevents leaking business_name)
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2000000-0000-0000-0000-000000000002"}'; -- Owner B
select throws_ok(
  $$select public.get_my_capabilities('b2000000-0000-0000-0000-000000000001'::uuid)$$,
  '42501',
  'PERMISSION_DENIED: Caller is not a member of master owner b2000000-0000-0000-0000-000000000001',
  'Querying capabilities for non-member master_owner_id strictly raises 42501'
);

-- Test 14: Owner A receives implicit full capabilities
set local "request.jwt.claims" = '{"sub": "a2000000-0000-0000-0000-000000000001"}'; -- Owner A
select is(
  (select (public.get_my_capabilities()->>'is_owner')::boolean),
  true,
  'Owner A has is_owner = true'
);

-- Test 15: Owner A has exactly 19 capabilities (turf and owner scope only)
select is(
  (select jsonb_array_length(public.get_my_capabilities()->'capabilities')),
  19,
  'Owner A has exactly 19 capabilities scoped to turf and owner'
);

-- Test 16: Owner A capabilities do NOT contain any platform-scoped codes
select is(
  (
    select count(*)::int
    from jsonb_array_elements_text(public.get_my_capabilities()->'capabilities') cap
    where cap in ('platform.admin', 'turfs.approve', 'turfs.manage', 'commissions.manage', 'payouts.release', 'audit.read_all')
  ),
  0,
  'Owner A capabilities do NOT contain platform-scoped codes'
);

-- ============================================================================
-- 9. STAFF CAPABILITY RESOLUTION
-- ============================================================================

set local "request.jwt.claims" = '{"sub": "a2000000-0000-0000-0000-000000000005"}'; -- Staff Member

-- Test 17: Staff caller has is_staff = true
select is(
  (select (public.get_my_capabilities()->>'is_staff')::boolean),
  true,
  'Staff caller has is_staff = true'
);

-- Test 18: Staff caller has is_owner = false
select is(
  (select (public.get_my_capabilities()->>'is_owner')::boolean),
  false,
  'Staff caller has is_owner = false'
);

-- Test 19: Staff caller resolves business_name
select is(
  (select public.get_my_capabilities()->>'business_name'),
  'Onboarding Corp A',
  'Staff caller resolves business_name = Onboarding Corp A'
);

-- Test 20: Staff caller capabilities match granted set exactly (bookings.read, calendar.read)
select results_eq(
  $$select jsonb_array_elements_text(public.get_my_capabilities()->'capabilities') order by 1$$,
  $$values ('bookings.read'::text), ('calendar.read'::text)$$,
  'Staff caller receives only explicit granted capabilities'
);

-- ============================================================================
-- 10. PHOTO CONFLICT & DIFF RECONCILIATION
-- ============================================================================

set local "request.jwt.claims" = '{"sub": "a2000000-0000-0000-0000-000000000001"}'; -- Owner A

-- Test 21: Duplicate storage_path in payload raises 23505 (PHOTO_PATH_CONFLICT)
select throws_ok(
  $$select public.update_turf_onboarding(
      'c2000000-0000-0000-0000-000000000001'::uuid,
      2,
      null,
      null,
      null,
      '[{"storage_path": "turfs/a1/dup.webp", "sort_order": 0}, {"storage_path": "turfs/a1/dup.webp", "sort_order": 1}]'::jsonb
    )$$,
  '23505',
  'PHOTO_PATH_CONFLICT: Duplicate storage_path found in photos payload',
  'Duplicate storage_path in payload raises PHOTO_PATH_CONFLICT (23505)'
);

-- Test 22: Cross-tenant storage_path collision raises 23505 (PHOTO_PATH_CONFLICT)
select throws_ok(
  $$select public.update_turf_onboarding(
      'c2000000-0000-0000-0000-000000000001'::uuid,
      2,
      null,
      null,
      null,
      '[{"storage_path": "turfs/b1/hero.webp", "sort_order": 0}]'::jsonb
    )$$,
  '23505',
  'PHOTO_PATH_CONFLICT: Storage path is already in use by another venue',
  'Cross-tenant storage_path collision raises PHOTO_PATH_CONFLICT (23505)'
);

-- Test 23: No-change onboarding save does NOT bump version
select lives_ok(
  $$select public.update_turf_onboarding(
      'c2000000-0000-0000-0000-000000000001'::uuid,
      2,
      'Premier floodlit box cricket arena with professional turf',
      '100 Stadium Road, Sector 5'
    )$$,
  'Calling onboarding update with unchanged core fields succeeds'
);

select is(
  (select version from public.turfs where id = 'c2000000-0000-0000-0000-000000000001'),
  2::bigint,
  'Version remains 2 because core listing fields were unchanged'
);

-- Test 24: Photo diffing preserves existing photo ID and created_at
select lives_ok(
  $$
  do $block$
  declare
    v_old_id uuid;
    v_new_id uuid;
  begin
    select id into v_old_id from public.turf_photos where storage_path = 'turfs/a1/pitch.webp';

    perform public.update_turf_onboarding(
      'c2000000-0000-0000-0000-000000000001'::uuid,
      2,
      null,
      null,
      null,
      '[{"storage_path": "turfs/a1/pitch.webp", "sort_order": 5, "published": true}]'::jsonb
    );

    select id into v_new_id from public.turf_photos where storage_path = 'turfs/a1/pitch.webp';
    if v_old_id != v_new_id then
      raise exception 'Photo ID changed across diff save: % vs %', v_old_id, v_new_id;
    end if;
  end $block$;
  $$,
  'Photo diffing preserves existing photo id across saves'
);

-- Test 25: Re-sending photo without 'published' retains existing published=true state
select lives_ok(
  $$select public.update_turf_onboarding(
      'c2000000-0000-0000-0000-000000000001'::uuid,
      2,
      null,
      null,
      null,
      '[{"storage_path": "turfs/a1/pitch.webp", "sort_order": 7}]'::jsonb
    )$$,
  'Re-sending photo without published flag succeeds'
);

select is(
  (select published from public.turf_photos where storage_path = 'turfs/a1/pitch.webp'),
  true,
  'Photo remains published when published flag is omitted in update payload'
);

rollback;
