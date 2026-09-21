-- Test: 09_public_slot_allocations_regression_test.sql
-- Description: Regression test verifying public.get_public_slot_allocations correctly returns
--              active holds and permanent confirmed bookings (both to anon and authenticated roles),
--              and calling private.confirm_booking_payment correctly clears expires_at on happy path
--              and correctly triggers refund / released_at on late capture.

begin;
select plan(16);

-- 1. Verify function exists and permissions
select has_function(
  'public',
  'get_public_slot_allocations',
  array['uuid', 'timestamp with time zone', 'timestamp with time zone'],
  'public.get_public_slot_allocations(uuid, timestamptz, timestamptz) exists'
);

-- 2. Setup Test Fixture
insert into auth.users (id, email) values
  ('99000000-1111-2222-3333-444444444444'::uuid, 'owner_regress@test.com'),
  ('99000000-5555-6666-7777-888888888888'::uuid, 'player_regress@test.com')
on conflict (id) do nothing;

insert into public.master_owners (id, owner_user_id, business_name, status)
values ('99000000-aaaa-bbbb-cccc-dddddddddddd'::uuid, '99000000-1111-2222-3333-444444444444'::uuid, 'Regress Arena Corp', 'active')
on conflict (id) do nothing;

insert into public.turfs (id, master_owner_id, slug, name, address_text, city, location, approval_status)
values (
  '99000000-eeee-ffff-0000-111111111111'::uuid,
  '99000000-aaaa-bbbb-cccc-dddddddddddd'::uuid,
  'regress-turf',
  'Regression Arena',
  '456 Test Blvd',
  'Bengaluru',
  extensions.st_setsrid(extensions.st_makepoint(77.5946, 12.9716), 4326),
  'approved'
) on conflict (id) do nothing;

insert into public.resources (id, master_owner_id, turf_id, name, booking_increment_minutes)
values (
  '99000000-2222-3333-4444-555555555555'::uuid,
  '99000000-aaaa-bbbb-cccc-dddddddddddd'::uuid,
  '99000000-eeee-ffff-0000-111111111111'::uuid,
  'Regress Pitch 1',
  60
) on conflict (id) do nothing;

-- 3. Test: Initially no allocations exist in the test interval
select is(
  (
    select count(*)::int
    from public.get_public_slot_allocations(
      '99000000-2222-3333-4444-555555555555'::uuid,
      '2026-10-01 10:00:00+05:30'::timestamptz,
      '2026-10-01 11:00:00+05:30'::timestamptz
    )
  ),
  0,
  'Available slot returns 0 allocations'
);

-- Setup Hold 1: 10:00 to 11:00 (active hold)
insert into public.bookings (
  id, reference_code, master_owner_id, turf_id, resource_id, created_by, source, status,
  starts_at, ends_at, hold_expires_at, total_minor, required_online_minor,
  pricing_snapshot, cancellation_snapshot, commission_snapshot
) values (
  '99000000-bbbb-1111-2222-333333333333'::uuid,
  'REG-HAPPY-01',
  '99000000-aaaa-bbbb-cccc-dddddddddddd'::uuid,
  '99000000-eeee-ffff-0000-111111111111'::uuid,
  '99000000-2222-3333-4444-555555555555'::uuid,
  '99000000-1111-2222-3333-444444444444'::uuid,
  'walkin',
  'held',
  '2026-10-01 10:00:00+05:30'::timestamptz,
  '2026-10-01 11:00:00+05:30'::timestamptz,
  now() + interval '7 minutes',
  100000,
  100000,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb
) on conflict (id) do nothing;

insert into public.inventory_allocations (
  id, master_owner_id, turf_id, resource_id, booking_id, kind, starts_at, ends_at, expires_at
) values (
  '99000000-aaaa-1111-2222-333333333333'::uuid,
  '99000000-aaaa-bbbb-cccc-dddddddddddd'::uuid,
  '99000000-eeee-ffff-0000-111111111111'::uuid,
  '99000000-2222-3333-4444-555555555555'::uuid,
  '99000000-bbbb-1111-2222-333333333333'::uuid,
  'hold',
  '2026-10-01 10:00:00+05:30'::timestamptz,
  '2026-10-01 11:00:00+05:30'::timestamptz,
  now() + interval '7 minutes'
);

insert into private.payment_orders (
  id, booking_id, master_owner_id, purpose, provider, provider_order_id, amount_minor, currency, status, idempotency_key
) values (
  '99000000-cccc-1111-2222-333333333333'::uuid,
  '99000000-bbbb-1111-2222-333333333333'::uuid,
  '99000000-aaaa-bbbb-cccc-dddddddddddd'::uuid,
  'initial',
  'razorpay',
  'order_regress_happy_01',
  100000,
  'INR',
  'ready',
  'idem_regress_happy_01'
);

-- 4. Active hold is occupied
select is(
  (
    select count(*)::int
    from public.get_public_slot_allocations(
      '99000000-2222-3333-4444-555555555555'::uuid,
      '2026-10-01 00:00:00+05:30'::timestamptz,
      '2026-10-01 23:59:59+05:30'::timestamptz
    )
  ),
  1,
  'Active hold is returned as occupied in get_public_slot_allocations'
);

-- 5. Expire the hold into the past
update public.inventory_allocations
set expires_at = now() - interval '1 minute'
where id = '99000000-aaaa-1111-2222-333333333333'::uuid;

select is(
  (
    select count(*)::int
    from public.get_public_slot_allocations(
      '99000000-2222-3333-4444-555555555555'::uuid,
      '2026-10-01 00:00:00+05:30'::timestamptz,
      '2026-10-01 23:59:59+05:30'::timestamptz
    )
  ),
  0,
  'Expired hold is excluded from get_public_slot_allocations (slot is available again)'
);

-- Reset hold to active for real confirmation call
update public.inventory_allocations
set expires_at = now() + interval '7 minutes'
where id = '99000000-aaaa-1111-2222-333333333333'::uuid;

update public.bookings
set hold_expires_at = now() + interval '7 minutes'
where id = '99000000-bbbb-1111-2222-333333333333'::uuid;

-- 6. Call real private.confirm_booking_payment (Happy Path)
do $$
begin
  perform private.confirm_booking_payment(
    'razorpay', 'order_regress_happy_01', 'pay_regress_happy_01', 100000
  );
end;
$$;

-- Assertions for Happy Path Confirmation
select is(
  (select status from public.bookings where id = '99000000-bbbb-1111-2222-333333333333'::uuid),
  'confirmed',
  'confirm_booking_payment transitions booking status to confirmed'
);

select is(
  (select expires_at is null from public.inventory_allocations where booking_id = '99000000-bbbb-1111-2222-333333333333'::uuid),
  true,
  'confirm_booking_payment explicitly clears expires_at (expires_at IS NULL)'
);

select is(
  (
    select count(*)::int
    from public.get_public_slot_allocations(
      '99000000-2222-3333-4444-555555555555'::uuid,
      '2026-10-01 00:00:00+05:30'::timestamptz,
      '2026-10-01 23:59:59+05:30'::timestamptz
    )
  ),
  1,
  'Confirmed booking with expires_at NULL is returned as occupied'
);

-- 7. Confirmed booking with past expires_at timestamp is STILL occupied
update public.inventory_allocations
set expires_at = now() - interval '1 hour'
where id = '99000000-aaaa-1111-2222-333333333333'::uuid;

select is(
  (
    select count(*)::int
    from public.get_public_slot_allocations(
      '99000000-2222-3333-4444-555555555555'::uuid,
      '2026-10-01 00:00:00+05:30'::timestamptz,
      '2026-10-01 23:59:59+05:30'::timestamptz
    )
  ),
  1,
  'Confirmed booking (kind=booking) is ALWAYS returned as occupied regardless of expires_at value'
);

-- 8. Cancel the booking (released_at is set)
update public.inventory_allocations
set released_at = now()
where id = '99000000-aaaa-1111-2222-333333333333'::uuid;

select is(
  (
    select count(*)::int
    from public.get_public_slot_allocations(
      '99000000-2222-3333-4444-555555555555'::uuid,
      '2026-10-01 00:00:00+05:30'::timestamptz,
      '2026-10-01 23:59:59+05:30'::timestamptz
    )
  ),
  0,
  'Cancelled/released booking is excluded from get_public_slot_allocations (slot is available again)'
);

-- 9. Anon role permission verification
set role anon;
select is(
  (
    select count(*)::int
    from public.get_public_slot_allocations(
      '99000000-2222-3333-4444-555555555555'::uuid,
      '2026-10-01 00:00:00+05:30'::timestamptz,
      '2026-10-01 23:59:59+05:30'::timestamptz
    )
  ),
  0,
  'Anon role can successfully execute get_public_slot_allocations'
);
reset role;

-- 10. Late-Capture Path Verification:
-- Setup Hold 2: 14:00 to 15:00 with hold_expires_at in the past
insert into public.bookings (
  id, reference_code, master_owner_id, turf_id, resource_id, created_by, source, status,
  starts_at, ends_at, hold_expires_at, total_minor, required_online_minor,
  pricing_snapshot, cancellation_snapshot, commission_snapshot
) values (
  '99000000-bbbb-2222-3333-444444444444'::uuid,
  'REG-LATE-01',
  '99000000-aaaa-bbbb-cccc-dddddddddddd'::uuid,
  '99000000-eeee-ffff-0000-111111111111'::uuid,
  '99000000-2222-3333-4444-555555555555'::uuid,
  '99000000-1111-2222-3333-444444444444'::uuid,
  'walkin',
  'held',
  '2026-10-01 14:00:00+05:30'::timestamptz,
  '2026-10-01 15:00:00+05:30'::timestamptz,
  now() - interval '5 minutes',
  100000,
  100000,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb
);

insert into public.inventory_allocations (
  id, master_owner_id, turf_id, resource_id, booking_id, kind, starts_at, ends_at, expires_at
) values (
  '99000000-aaaa-2222-3333-444444444444'::uuid,
  '99000000-aaaa-bbbb-cccc-dddddddddddd'::uuid,
  '99000000-eeee-ffff-0000-111111111111'::uuid,
  '99000000-2222-3333-4444-555555555555'::uuid,
  '99000000-bbbb-2222-3333-444444444444'::uuid,
  'hold',
  '2026-10-01 14:00:00+05:30'::timestamptz,
  '2026-10-01 15:00:00+05:30'::timestamptz,
  now() - interval '5 minutes'
);

insert into private.payment_orders (
  id, booking_id, master_owner_id, purpose, provider, provider_order_id, amount_minor, currency, status, idempotency_key
) values (
  '99000000-cccc-2222-3333-444444444444'::uuid,
  '99000000-bbbb-2222-3333-444444444444'::uuid,
  '99000000-aaaa-bbbb-cccc-dddddddddddd'::uuid,
  'initial',
  'razorpay',
  'order_regress_late_01',
  100000,
  'INR',
  'ready',
  'idem_regress_late_01'
);

-- Execute confirm_booking_payment on expired hold
select is(
  (
    select (private.confirm_booking_payment(
      'razorpay', 'order_regress_late_01', 'pay_regress_late_01', 100000
    )->>'refund_queued')::boolean
  ),
  true,
  'Late-capture confirm_booking_payment returns refund_queued = true'
);

select is(
  (select status from public.bookings where id = '99000000-bbbb-2222-3333-444444444444'::uuid),
  'payment_exception',
  'Late-capture transitions booking status to payment_exception'
);

select is(
  (select status from private.refunds where idempotency_key = 'refund_pay_regress_late_01'),
  'requested',
  'Late-capture inserts private.refunds row with status = requested'
);

select is(
  (select count(*)::int from private.outbox_events where topic = 'payment.refund_required' and dedupe_key = 'refund_required_pay_regress_late_01'),
  1,
  'Late-capture inserts private.outbox_events row with topic = payment.refund_required'
);

select is(
  (select released_at is not null from public.inventory_allocations where booking_id = '99000000-bbbb-2222-3333-444444444444'::uuid),
  true,
  'Late-capture marks hold allocation released_at IS NOT NULL'
);

select is(
  (
    select count(*)::int
    from public.get_public_slot_allocations(
      '99000000-2222-3333-4444-555555555555'::uuid,
      '2026-10-01 14:00:00+05:30'::timestamptz,
      '2026-10-01 15:00:00+05:30'::timestamptz
    )
  ),
  0,
  'Late-capture releases inventory so slot is immediately available to new players'
);

select * from finish();
rollback;
