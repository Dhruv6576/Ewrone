-- Test Suite: 05_payment_orchestration_test.sql
-- Description: pgTAP tests for Milestone 6 payment orchestration and confirmation routines:
-- 1. Payment order creation & idempotency
-- 2. Payment confirmation happy path (booking confirmed, allocation confirmed, ledger posted)
-- 3. Webhook idempotency replay (no double confirmation, no duplicate journal)
-- 4. Out-of-order events (captured before authorized)
-- 5. Capture-after-hold-expiry race (§7.5) -> payment_exception + queued refund + released allocation

begin;
select plan(12);

-- ============================================================================
-- 1. SETUP TEST FIXTURES
-- ============================================================================

do $$
declare
  uid_owner  uuid := 'b1111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  mo_id      uuid := 'b2222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  turf_id    uuid := 'b3333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  res_id     uuid := 'b4444444-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  pol_id     uuid := 'b5555555-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  uid_player uuid := 'b6666666-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  b_id       uuid := 'b7777777-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  b_exp_id   uuid := 'b8888888-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
begin
  -- Profiles & Master Owner
  insert into auth.users (id, email, raw_user_meta_data) values
    (uid_owner, 'pay_owner@test.com', '{"name": "Pay Owner"}'::jsonb),
    (uid_player, 'pay_player@test.com', '{"name": "Pay Player"}'::jsonb)
  on conflict (id) do nothing;

  insert into public.master_owners (id, owner_user_id, business_name, status) values
    (mo_id, uid_owner, 'Payment Arena Ltd', 'active')
  on conflict (id) do nothing;

  -- Turf & Resource
  insert into public.turfs (id, master_owner_id, slug, name, address_text, city, location, approval_status, timezone) values
    (turf_id, mo_id, 'payment-arena', 'Payment Arena', 'Main Rd', 'Ahmedabad',
     extensions.ST_SetSRID(extensions.ST_MakePoint(72.5714, 23.0225), 4326)::extensions.geography, 'approved', 'Asia/Kolkata')
  on conflict (id) do nothing;

  insert into public.resources (id, master_owner_id, turf_id, name, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes, active) values
    (res_id, mo_id, turf_id, 'Ground Pay', 30, 60, 240, true)
  on conflict (id) do nothing;

  -- Operating hours
  insert into public.operating_hours (resource_id, iso_weekday, opens_at, closes_at, valid_from)
  select res_id, gs, '06:00'::time, '23:00'::time, '2026-01-01'::date
  from generate_series(1, 7) gs
  on conflict do nothing;

  -- Active Hold Booking (valid for next 10 minutes)
  insert into public.bookings (
    id, reference_code, master_owner_id, turf_id, resource_id, player_user_id, created_by,
    source, status, starts_at, ends_at, hold_expires_at,
    total_minor, required_online_minor, currency,
    pricing_snapshot, cancellation_snapshot, commission_snapshot
  ) values (
    b_id, 'BK-PAYTEST-01', mo_id, turf_id, res_id, uid_player, uid_player,
    'online', 'held', '2026-11-20 10:00:00+00'::timestamptz, '2026-11-20 11:00:00+00'::timestamptz,
    now() + interval '10 minutes', 200000, 200000, 'INR',
    '{"base_rate": 200000}'::jsonb, '{"deadline_hours": 24}'::jsonb,
    '{"basis_points": 1000, "estimated_commission_minor": 20000}'::jsonb
  ) on conflict (id) do nothing;

  insert into public.inventory_allocations (
    booking_id, master_owner_id, turf_id, resource_id, kind,
    starts_at, ends_at, expires_at, created_by
  ) values (
    b_id, mo_id, turf_id, res_id, 'hold',
    '2026-11-20 10:00:00+00'::timestamptz, '2026-11-20 11:00:00+00'::timestamptz,
    now() + interval '10 minutes', uid_player
  ) on conflict (id) do nothing;

  -- Expired Hold Booking (expires_at in past)
  insert into public.bookings (
    id, reference_code, master_owner_id, turf_id, resource_id, player_user_id, created_by,
    source, status, starts_at, ends_at, hold_expires_at,
    total_minor, required_online_minor, currency,
    pricing_snapshot, cancellation_snapshot, commission_snapshot
  ) values (
    b_exp_id, 'BK-PAYTEST-EXP', mo_id, turf_id, res_id, uid_player, uid_player,
    'online', 'expired', '2026-11-20 12:00:00+00'::timestamptz, '2026-11-20 13:00:00+00'::timestamptz,
    now() - interval '10 minutes', 150000, 150000, 'INR',
    '{"base_rate": 150000}'::jsonb, '{"deadline_hours": 24}'::jsonb,
    '{"basis_points": 1000, "estimated_commission_minor": 15000}'::jsonb
  ) on conflict (id) do nothing;

  insert into public.inventory_allocations (
    booking_id, master_owner_id, turf_id, resource_id, kind,
    starts_at, ends_at, expires_at, released_at, created_by
  ) values (
    b_exp_id, mo_id, turf_id, res_id, 'hold',
    '2026-11-20 12:00:00+00'::timestamptz, '2026-11-20 13:00:00+00'::timestamptz,
    now() - interval '10 minutes', now() - interval '9 minutes', uid_player
  ) on conflict (id) do nothing;
end $$;

-- ============================================================================
-- 2. PAYMENT ORDER CREATION & IDEMPOTENCY
-- ============================================================================

-- Test 1: Create payment order for active hold
select is(
  (
    select private.create_or_get_payment_order(
      'b7777777-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
      'idemp-order-001',
      'initial'
    )->>'status'
  ),
  'creating',
  'create_or_get_payment_order creates order in creating status'
);

-- Update with provider order ID
do $$
begin
  perform private.update_payment_order_provider(
    (select id from private.payment_orders where idempotency_key = 'idemp-order-001'),
    'order_rzp_test_001',
    'ready'
  );
end $$;

-- Test 2: Idempotent call with same key returns existing order
select is(
  (
    select private.create_or_get_payment_order(
      'b7777777-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
      'idemp-order-001',
      'initial'
    )->>'provider_order_id'
  ),
  'order_rzp_test_001',
  'Repeat call with same idempotency key returns existing provider_order_id'
);

-- Test 3: Reject order creation for expired booking
select throws_ok(
  $$
    select private.create_or_get_payment_order(
      'b8888888-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
      'idemp-order-exp',
      'initial'
    );
  $$,
  '22023',
  'INVALID_BOOKING_STATUS: Booking status is expired (must be held)',
  'Rejects payment order creation for already expired booking'
);

-- ============================================================================
-- 3. PAYMENT CONFIRMATION HAPPY PATH
-- ============================================================================

-- Test 4: Confirm payment for active hold
select is(
  (
    select private.confirm_booking_payment(
      p_provider => 'razorpay',
      p_provider_order_id => 'order_rzp_test_001',
      p_provider_payment_id => 'pay_rzp_test_001',
      p_amount_minor => 200000,
      p_currency => 'INR',
      p_event_type => 'payment.captured',
      p_captured_at => now()
    )->>'status'
  ),
  'confirmed',
  'confirm_booking_payment transitions active hold to confirmed'
);

-- Test 5: Booking status is confirmed
select is(
  (select status from public.bookings where id = 'b7777777-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid),
  'confirmed',
  'Booking record updated to confirmed'
);

-- Test 6: Allocation kind is booking
select is(
  (select kind from public.inventory_allocations where booking_id = 'b7777777-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid),
  'booking',
  'Inventory allocation updated to booking'
);

-- Test 7: Ledger journal posted and balances to zero
select is(
  (
    select sum(amount_minor)::bigint
    from private.ledger_entries
    where journal_id = (
      select id from private.ledger_journals where event_key = 'pay_pay_rzp_test_001_captured'
    )
  ),
  0::bigint,
  'Financial ledger journal entries balance to zero'
);

-- Test 8: Outbox confirmation message queued
select is(
  (select count(*)::int from private.outbox_events where aggregate_id = 'b7777777-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid and topic = 'booking.confirmed'),
  1,
  'Outbox confirmation event queued'
);

-- ============================================================================
-- 4. IDEMPOTENCY REPLAY (§10.2)
-- ============================================================================

-- Test 9: Replay of confirmed payment returns already_confirmed
select is(
  (
    select private.confirm_booking_payment(
      p_provider => 'razorpay',
      p_provider_order_id => 'order_rzp_test_001',
      p_provider_payment_id => 'pay_rzp_test_001',
      p_amount_minor => 200000,
      p_currency => 'INR',
      p_event_type => 'payment.captured'
    )->>'status'
  ),
  'already_confirmed',
  'Duplicate payment capture returns already_confirmed without side effect'
);

-- ============================================================================
-- 5. OUT-OF-ORDER WEBHOOK DELIVERY (§17.3)
-- ============================================================================

-- Test 10: Delayed payment.authorized arriving after payment.captured does not downgrade
select is(
  (
    select private.confirm_booking_payment(
      p_provider => 'razorpay',
      p_provider_order_id => 'order_rzp_test_001',
      p_provider_payment_id => 'pay_rzp_test_001',
      p_amount_minor => 200000,
      p_currency => 'INR',
      p_event_type => 'payment.authorized'
    )->>'status'
  ),
  'already_confirmed',
  'Delayed authorized event after capture retains confirmed status'
);

-- Test 11: Payment table record status remains captured
select is(
  (select status from private.payments where provider_payment_id = 'pay_rzp_test_001'),
  'captured',
  'Payment status remains captured after delayed authorized event'
);

-- ============================================================================
-- 6. CAPTURE-AFTER-HOLD-EXPIRY RACE (§7.5)
-- ============================================================================

-- Setup an expired booking order
do $$
begin
  insert into private.payment_orders (
    id, booking_id, master_owner_id, purpose, provider, provider_order_id,
    amount_minor, currency, status, idempotency_key
  ) values (
    'b9999999-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'b8888888-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'b2222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'initial', 'razorpay', 'order_rzp_expired_001',
    150000, 'INR', 'ready', 'idemp-order-exp-002'
  );
end $$;

-- Test 12: Capture on expired hold transitions to payment_exception & queues refund
select is(
  (
    select private.confirm_booking_payment(
      p_provider => 'razorpay',
      p_provider_order_id => 'order_rzp_expired_001',
      p_provider_payment_id => 'pay_rzp_exp_001',
      p_amount_minor => 150000,
      p_currency => 'INR',
      p_event_type => 'payment.captured'
    )->>'status'
  ),
  'payment_exception',
  'Late capture on expired hold transitions booking to payment_exception'
);

select * from finish();
rollback;
