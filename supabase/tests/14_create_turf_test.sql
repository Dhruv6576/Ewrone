-- Test Suite: 14_create_turf_test.sql
-- Description: pgTAP tests for public.create_turf RPC:
--   1. Owner can create turf for their own master owner account.
--   2. Foreign caller is rejected with 42501.
--   3. Unauthenticated caller is rejected with 42501.
--   4. Blank name is rejected with 22023.
--   5. Duplicate name under the same master owner is rejected with 22023.
--   6. Slug de-duplication generates unique slugs (e.g. slug-2).
--   7. New turf starts with approval_status = 'draft'.
--   8. Draft turf is NOT visible to anon under turfs_select RLS.
--   9. Approved turf is visible to anon under turfs_select RLS.
--  10. Audit event logged for turf.create.

begin;
select plan(10);

-- Setup fixtures
do $$
declare
  uid_owner_a   uuid := 'a2400000-0000-0000-0000-000000000001';
  uid_owner_b   uuid := 'a2400000-0000-0000-0000-000000000002';
  mo_a_id       uuid := 'b2400000-0000-0000-0000-000000000001';
  mo_b_id       uuid := 'b2400000-0000-0000-0000-000000000002';
begin
  insert into auth.users (id, email) values
    (uid_owner_a, 'owner_a_14@test.com'),
    (uid_owner_b, 'owner_b_14@test.com')
  on conflict (id) do nothing;

  insert into public.profiles (user_id, display_name) values
    (uid_owner_a, 'Owner A 14'),
    (uid_owner_b, 'Owner B 14')
  on conflict (user_id) do nothing;

  insert into public.master_owners (id, owner_user_id, business_name, status) values
    (mo_a_id, uid_owner_a, 'Master Owner A 14', 'active'),
    (mo_b_id, uid_owner_b, 'Master Owner B 14', 'active')
  on conflict (id) do nothing;
end;
$$;

-- Test 1: Owner A creates turf for Master Owner A
set local role authenticated;
set local "request.jwt.claim.sub" to 'a2400000-0000-0000-0000-000000000001';

select lives_ok(
  $$select public.create_turf(
      'b2400000-0000-0000-0000-000000000001'::uuid,
      'Phoenix Arena',
      'Bengaluru',
      '100ft Road, Indiranagar'
    )$$,
  'Owner A can create turf for own master owner account'
);

-- Test 2: Foreign caller (Owner B calling on Master Owner A) is rejected 42501
set local "request.jwt.claim.sub" to 'a2400000-0000-0000-0000-000000000002';

select throws_ok(
  $$select public.create_turf(
      'b2400000-0000-0000-0000-000000000001'::uuid,
      'Unauthorized Turf',
      'Bengaluru',
      'MG Road'
    )$$,
  '42501',
  null,
  'Foreign caller attempting create_turf is rejected with 42501'
);

-- Test 3: Unauthenticated caller is rejected 42501
set local role anon;
reset "request.jwt.claim.sub";

select throws_ok(
  $$select public.create_turf(
      'b2400000-0000-0000-0000-000000000001'::uuid,
      'Anon Turf',
      'Bengaluru',
      'Brigade Road'
    )$$,
  '42501',
  null,
  'Unauthenticated caller is rejected with 42501'
);

-- Switch back to Owner A
set local role authenticated;
set local "request.jwt.claim.sub" to 'a2400000-0000-0000-0000-000000000001';

-- Test 4: Blank name rejected with 22023
select throws_ok(
  $$select public.create_turf(
      'b2400000-0000-0000-0000-000000000001'::uuid,
      '   ',
      'Bengaluru',
      'Indiranagar'
    )$$,
  '22023',
  null,
  'Blank name is rejected with 22023'
);

-- Test 5: Duplicate name for same master owner rejected with 22023
select throws_ok(
  $$select public.create_turf(
      'b2400000-0000-0000-0000-000000000001'::uuid,
      'Phoenix Arena',
      'Bengaluru',
      'Another Address'
    )$$,
  '22023',
  null,
  'Duplicate venue name under same master owner is rejected with 22023'
);

-- Test 6: Slug de-duplication works
-- Owner B creates "Phoenix Arena" -> same slug 'phoenix-arena' exists, so should become 'phoenix-arena-2'
set local "request.jwt.claim.sub" to 'a2400000-0000-0000-0000-000000000002';

select lives_ok(
  $$select public.create_turf(
      'b2400000-0000-0000-0000-000000000002'::uuid,
      'Phoenix Arena',
      'Bengaluru',
      'Koramangala 80ft Road'
    )$$,
  'Owner B creates Phoenix Arena; slug de-duplication avoids collision'
);

-- Test 7: New turf starts with approval_status = 'draft'
reset role;
select is(
  (select approval_status from public.turfs where slug = 'phoenix-arena'),
  'draft',
  'Newly created turf has approval_status = draft'
);

-- Test 8: Draft turf is NOT visible to anon under turfs_select RLS
set local role anon;
reset "request.jwt.claim.sub";

select is(
  (select count(*)::int from public.turfs where slug in ('phoenix-arena', 'phoenix-arena-2')),
  0,
  'Draft turfs are NOT visible to anon under turfs_select RLS'
);

-- Test 9: Approved turf IS visible to anon under turfs_select RLS
reset role;
update public.turfs set approval_status = 'approved' where slug = 'phoenix-arena';

set local role anon;
reset "request.jwt.claim.sub";

select is(
  (select count(*)::int from public.turfs where slug = 'phoenix-arena'),
  1,
  'Approved turf IS visible to anon under turfs_select RLS'
);

-- Test 10: Audit event logged for turf creation
reset role;
select ok(
  exists(
    select 1 from private.audit_events
    where action = 'turf.create'
      and entity_type = 'turf'
      and turf_id = (select id from public.turfs where slug = 'phoenix-arena')
  ),
  'Audit event logged for turf.create'
);

rollback;
