-- Test: 08_full_system_lifecycle_test.sql
-- Description: pgTAP tests for Milestone 10: booking cancellation, notification & audit integration, and payout on retained revenue.

begin;
select plan(15);

-- 1. Verify cancel_booking function exists
select has_function('public', 'cancel_booking', array['uuid', 'text'], 'public.cancel_booking(uuid, text) exists');

-- 2. Setup fixtures
insert into auth.users (id, email, raw_user_meta_data) values
  ('10101010-1010-1010-1010-101010101010'::uuid, 'owner_m10@example.com', '{"name": "Owner M10"}'::jsonb),
  ('20202020-2020-2020-2020-202020202020'::uuid, 'player_m10@example.com', '{"name": "Player M10"}'::jsonb),
  ('30303030-3030-3030-3030-303030303030'::uuid, 'admin_m10@example.com', '{"name": "Admin M10"}'::jsonb)
on conflict (id) do nothing;

insert into private.platform_admins (user_id, active)
values ('30303030-3030-3030-3030-303030303030'::uuid, true)
on conflict do nothing;

insert into private.admin_grants (user_id, capability)
values ('30303030-3030-3030-3030-303030303030'::uuid, 'turfs.approve')
on conflict do nothing;

-- 3. Onboard master owner
insert into public.master_owners (id, owner_user_id, business_name, status)
values ('aaaaaaaa-1010-1010-1010-aaaaaaaaaaaa'::uuid, '10101010-1010-1010-1010-101010101010'::uuid, 'M10 Arena Corp', 'onboarding')
on conflict do nothing;

select is(
  (select status from public.master_owners where id = 'aaaaaaaa-1010-1010-1010-aaaaaaaaaaaa'::uuid),
  'onboarding',
  'Master Owner starts in onboarding status'
);

-- 4. Create turf in draft
insert into public.turfs (id, master_owner_id, slug, name, address_text, city, location, approval_status)
values (
  'bbbbbbbb-1010-1010-1010-bbbbbbbbbbbb'::uuid,
  'aaaaaaaa-1010-1010-1010-aaaaaaaaaaaa'::uuid,
  'm10-arena-pgtap',
  'M10 Arena Ground',
  '123 Sports Way',
  'Bengaluru',
  extensions.st_setsrid(extensions.st_makepoint(77.5946, 12.9716), 4326),
  'draft'
) on conflict do nothing;

insert into public.resources (id, master_owner_id, turf_id, name)
values (
  'cccccccc-1010-1010-1010-cccccccccccc'::uuid,
  'aaaaaaaa-1010-1010-1010-aaaaaaaaaaaa'::uuid,
  'bbbbbbbb-1010-1010-1010-bbbbbbbbbbbb'::uuid,
  'Court 1'
) on conflict do nothing;

select is(
  (select approval_status from public.turfs where id = 'bbbbbbbb-1010-1010-1010-bbbbbbbbbbbb'::uuid),
  'draft',
  'Turf created in draft status'
);

-- 5. Submit and approve turf
select set_config('request.jwt.claims', '{"sub":"10101010-1010-1010-1010-101010101010","role":"authenticated"}', true);
select public.submit_turf_for_approval('bbbbbbbb-1010-1010-1010-bbbbbbbbbbbb'::uuid);

select set_config('request.jwt.claims', '{"sub":"30303030-3030-3030-3030-303030303030","role":"authenticated"}', true);
select public.admin_review_turf('bbbbbbbb-1010-1010-1010-bbbbbbbbbbbb'::uuid, 'approved', 'Test approved');

select is(
  (select approval_status from public.turfs where id = 'bbbbbbbb-1010-1010-1010-bbbbbbbbbbbb'::uuid),
  'approved',
  'Turf approved by platform admin'
);

-- 6. Setup policies and settings
update public.master_owners set status = 'active' where id = 'aaaaaaaa-1010-1010-1010-aaaaaaaaaaaa'::uuid;

insert into public.cancellation_policies (id, master_owner_id, name, version, rules)
values (
  'dddddddd-1010-1010-1010-dddddddddddd'::uuid,
  'aaaaaaaa-1010-1010-1010-aaaaaaaaaaaa'::uuid,
  'M10 50% Policy',
  1,
  '[{"hours_before": 12, "refund_percent": 50}]'::jsonb
) on conflict do nothing;

insert into public.turf_booking_settings (turf_id, master_owner_id, cancellation_policy_id, advance_basis_points, booking_horizon_days, minimum_lead_minutes, hold_seconds)
values (
  'bbbbbbbb-1010-1010-1010-bbbbbbbbbbbb'::uuid,
  'aaaaaaaa-1010-1010-1010-aaaaaaaaaaaa'::uuid,
  'dddddddd-1010-1010-1010-dddddddddddd'::uuid,
  10000, 60, 60, 420
) on conflict do nothing;

insert into public.operating_hours (resource_id, iso_weekday, opens_at, closes_at, valid_from)
select 'cccccccc-1010-1010-1010-cccccccccccc'::uuid, gs, '06:00'::time, '23:00'::time, '2026-01-01'::date
from generate_series(1, 7) gs
on conflict do nothing;

insert into public.pricing_rules (master_owner_id, turf_id, resource_id, priority, valid_from, iso_weekdays, starts_local, ends_local, amount_per_increment_minor)
values (
  'aaaaaaaa-1010-1010-1010-aaaaaaaaaaaa'::uuid,
  'bbbbbbbb-1010-1010-1010-bbbbbbbbbbbb'::uuid,
  'cccccccc-1010-1010-1010-cccccccccccc'::uuid,
  0, '2026-01-01', '{1,2,3,4,5,6,7}', '06:00', '23:00', 100000
) on conflict do nothing;

-- 7. Register owner financial account
select private.register_owner_financial_account(
  'aaaaaaaa-1010-1010-1010-aaaaaaaaaaaa'::uuid,
  'razorpay',
  'acc_rzp_m10_test',
  'HDFC Bank ****1234',
  true
);

-- 8. Create booking hold
select set_config('request.jwt.claims', '{"sub":"20202020-2020-2020-2020-202020202020","role":"authenticated"}', true);
select public.create_booking_hold(
  'cccccccc-1010-1010-1010-cccccccccccc'::uuid,
  '2026-10-15 18:00:00+05:30'::timestamptz,
  '2026-10-15 19:00:00+05:30'::timestamptz,
  'idemp_hold_m10_test',
  'M10 Player',
  '+919876543210',
  'player_m10@example.com'
);

select is(
  (select count(*) from public.slots where resource_id = 'cccccccc-1010-1010-1010-cccccccccccc'::uuid)::integer > 0,
  true,
  'JIT slot generation created slots during booking hold'
);

-- 9. Complete payment confirmation
select set_config('request.jwt.claims', '', true);
select private.create_or_get_payment_order(
  (select id from public.bookings where resource_id = 'cccccccc-1010-1010-1010-cccccccccccc'::uuid limit 1),
  'idemp_pay_m10_test',
  'initial'
);

select private.update_payment_order_provider(
  (select id from private.payment_orders where idempotency_key = 'idemp_pay_m10_test'),
  'order_rzp_m10_test',
  'ready'
);

select private.confirm_booking_payment(
  'razorpay',
  'order_rzp_m10_test',
  'pay_rzp_m10_test',
  200000,
  'INR',
  'payment.captured'
);

select is(
  (select status from public.bookings where resource_id = 'cccccccc-1010-1010-1010-cccccccccccc'::uuid limit 1),
  'confirmed',
  'Booking confirmed upon payment capture'
);

-- 10. Verify notification and audit records for booking confirmation
select is(
  (select count(*) from public.notifications where kind in ('booking.confirmed', 'booking.new_confirmed'))::integer >= 2,
  true,
  'Notifications generated for both player and owner'
);

select is(
  (select count(*) from private.audit_events where action = 'booking.confirm')::integer >= 1,
  true,
  'Audit record logged for booking.confirm'
);

-- 11. Cancel booking as player
select set_config('request.jwt.claims', '{"sub":"20202020-2020-2020-2020-202020202020","role":"authenticated"}', true);
select public.cancel_booking(
  (select id from public.bookings where resource_id = 'cccccccc-1010-1010-1010-cccccccccccc'::uuid limit 1),
  'Need to cancel'
);

select is(
  (select status from public.bookings where resource_id = 'cccccccc-1010-1010-1010-cccccccccccc'::uuid limit 1),
  'cancelled',
  'Booking transitioned to cancelled'
);

select is(
  (select status from private.refunds where payment_id = (select id from private.payments where provider_payment_id = 'pay_rzp_m10_test')),
  'succeeded',
  'Refund succeeded and recorded in private.refunds'
);

-- 12. Payout planning on net retained revenue
select set_config('request.jwt.claims', '{"sub":"10101010-1010-1010-1010-101010101010","role":"authenticated"}', true);
select public.plan_owner_payout('aaaaaaaa-1010-1010-1010-aaaaaaaaaaaa'::uuid);

select is(
  (select amount_minor from private.payouts where master_owner_id = 'aaaaaaaa-1010-1010-1010-aaaaaaaaaaaa'::uuid limit 1),
  80000::bigint,
  'Payout planned for exact net retained revenue (₹800 = 80000 paise)'
);

-- 13. Settle payout and verify ledger zero-sum
select set_config('request.jwt.claims', '', true);
select private.settle_owner_payout(
  (select id from private.payouts where master_owner_id = 'aaaaaaaa-1010-1010-1010-aaaaaaaaaaaa'::uuid limit 1),
  'setl_m10_test'
);

select is(
  (select coalesce(sum(amount_minor), 0) from private.ledger_entries)::bigint,
  0::bigint,
  'System-wide ledger zero-sum balance strictly preserved after full lifecycle'
);

-- 14. Master owner statement reconciliation
select set_config('request.jwt.claims', '{"sub":"10101010-1010-1010-1010-101010101010","role":"authenticated"}', true);
select is(
  (select (public.get_owner_statement('aaaaaaaa-1010-1010-1010-aaaaaaaaaaaa'::uuid)->'ledger_balances'->>'gateway_clearing_net')::bigint),
  20000::bigint,
  'Owner statement gateway_clearing_net is strictly tenant-scoped to ₹200 (20000 paise)'
);

select is(
  (select (public.get_owner_statement('aaaaaaaa-1010-1010-1010-aaaaaaaaaaaa'::uuid)->'ledger_balances'->>'platform_commission_net')::bigint),
  -20000::bigint,
  'Owner statement platform_commission_net is strictly tenant-scoped to -₹200 (-20000 paise)'
);

select is(
  (select (public.get_owner_statement('aaaaaaaa-1010-1010-1010-aaaaaaaaaaaa'::uuid)->'ledger_balances'->>'owner_payable_net')::bigint),
  0::bigint,
  'Owner statement owner_payable_net is ₹0 after settlement'
);

rollback;
