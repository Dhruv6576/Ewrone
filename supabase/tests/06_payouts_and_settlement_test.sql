-- Test Suite 06: Payouts, Settlement Reconciliation, Concurrent Refunds & Outbox Worker Leases
begin;
select plan(20);

-- 1. Table Existence
select has_table('private', 'owner_financial_accounts', 'private.owner_financial_accounts exists');
select has_table('private', 'payouts', 'private.payouts exists');
select has_table('private', 'payout_allocations', 'private.payout_allocations exists');
select has_table('private', 'payment_transfers', 'private.payment_transfers exists');
select has_table('private', 'transfer_reversals', 'private.transfer_reversals exists');

-- 2. Setup Fixtures
create temp table test_payout_fixtures as
select
  gen_random_uuid() as uid_owner,
  gen_random_uuid() as mo_id,
  gen_random_uuid() as turf_1,
  gen_random_uuid() as turf_2,
  gen_random_uuid() as res_1,
  gen_random_uuid() as res_2,
  gen_random_uuid() as uid_player;

-- Insert user profiles
insert into auth.users (id, email)
select uid_owner, 'payout_owner@test.com' from test_payout_fixtures
union all
select uid_player, 'payout_player@test.com' from test_payout_fixtures;

-- Insert master owner
insert into public.master_owners (id, owner_user_id, business_name, status)
select mo_id, uid_owner, 'Consolidated Arena Ltd', 'active' from test_payout_fixtures;

-- Insert 2 turfs for the same master owner (Multi-turf consolidation)
insert into public.turfs (id, master_owner_id, slug, name, address_text, city, location, approval_status, timezone)
select turf_1, mo_id, 'arena-north', 'Arena North', 'North Road', 'Ahmedabad',
       extensions.ST_SetSRID(extensions.ST_MakePoint(72.57, 23.02), 4326)::extensions.geography, 'approved', 'Asia/Kolkata'
from test_payout_fixtures
union all
select turf_2, mo_id, 'arena-south', 'Arena South', 'South Road', 'Ahmedabad',
       extensions.ST_SetSRID(extensions.ST_MakePoint(72.58, 23.03), 4326)::extensions.geography, 'approved', 'Asia/Kolkata'
from test_payout_fixtures;

-- Insert 2 resources (one per turf)
insert into public.resources (id, master_owner_id, turf_id, name, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes, active)
select res_1, mo_id, turf_1, 'Pitch 1', 30, 60, 240, true from test_payout_fixtures
union all
select res_2, mo_id, turf_2, 'Court 1', 30, 60, 240, true from test_payout_fixtures;

-- 3. Register Financial Account
select lives_ok(
  format(
    $$select private.register_owner_financial_account('%s', 'razorpay', 'acc_route_test_1', 'HDFC Bank •••• 9999', true)$$,
    (select mo_id from test_payout_fixtures)
  ),
  'Successfully registered verified owner financial account'
);

-- Register second account as active -> should atomically deactivate first account
select lives_ok(
  format(
    $$select private.register_owner_financial_account('%s', 'razorpay', 'acc_route_test_2', 'ICICI Bank •••• 1111', true)$$,
    (select mo_id from test_payout_fixtures)
  ),
  'Successfully registered second account and switched active status'
);

-- Assert only one active account exists
select is(
  (select count(*)::int from private.owner_financial_accounts where master_owner_id = (select mo_id from test_payout_fixtures) and active = true),
  1,
  'Enforced exactly one active financial account via partial unique index'
);

-- 4. Multi-Turf Bookings & Payout Planning
-- Insert confirmed booking on Turf 1 (₹2,500 total, ₹250 commission -> ₹2,250 payable)
insert into public.bookings (
  id, reference_code, master_owner_id, turf_id, resource_id, player_user_id, created_by,
  source, status, starts_at, ends_at, hold_expires_at,
  total_minor, required_online_minor, currency,
  pricing_snapshot, cancellation_snapshot, commission_snapshot
) select
  'b1111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'BK-TURF1', mo_id, turf_1, res_1, uid_player, uid_player,
  'online', 'confirmed', now() + interval '1 day', now() + interval '1 day 1 hour', now() + interval '10 minutes',
  250000, 250000, 'INR', '{}'::jsonb, '{}'::jsonb, '{"basis_points": 1000, "estimated_commission_minor": 25000}'::jsonb
from test_payout_fixtures;

-- Post payment_captured journal for Turf 1 booking:
-- gateway_clearing (+250,000), owner_payable (-225,000), platform_commission (-25,000)
select private.post_journal(
  'pay_test_turf1_captured', 'payment_captured', 'INR',
  'b1111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from private.ledger_accounts where code = 'gateway_clearing' and currency = 'INR'), 'amount_minor', 250000),
    jsonb_build_object('account_id', private.get_or_create_owner_account((select mo_id from test_payout_fixtures), 'owner_payable', 'INR'), 'amount_minor', -225000),
    jsonb_build_object('account_id', (select id from private.ledger_accounts where code = 'platform_commission' and currency = 'INR'), 'amount_minor', -25000)
  )
);

-- Insert confirmed booking on Turf 2 (₹1,500 total, ₹150 commission -> ₹1,350 payable)
insert into public.bookings (
  id, reference_code, master_owner_id, turf_id, resource_id, player_user_id, created_by,
  source, status, starts_at, ends_at, hold_expires_at,
  total_minor, required_online_minor, currency,
  pricing_snapshot, cancellation_snapshot, commission_snapshot
) select
  'b2222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'BK-TURF2', mo_id, turf_2, res_2, uid_player, uid_player,
  'online', 'confirmed', now() + interval '1 day 2 hours', now() + interval '1 day 3 hours', now() + interval '10 minutes',
  150000, 150000, 'INR', '{}'::jsonb, '{}'::jsonb, '{"basis_points": 1000, "estimated_commission_minor": 15000}'::jsonb
from test_payout_fixtures;

-- Post payment_captured journal for Turf 2 booking:
-- gateway_clearing (+150,000), owner_payable (-135,000), platform_commission (-15,000)
select private.post_journal(
  'pay_test_turf2_captured', 'payment_captured', 'INR',
  'b2222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from private.ledger_accounts where code = 'gateway_clearing' and currency = 'INR'), 'amount_minor', 150000),
    jsonb_build_object('account_id', private.get_or_create_owner_account((select mo_id from test_payout_fixtures), 'owner_payable', 'INR'), 'amount_minor', -135000),
    jsonb_build_object('account_id', (select id from private.ledger_accounts where code = 'platform_commission' and currency = 'INR'), 'amount_minor', -15000)
  )
);

-- Plan Payout across both turfs: Expected total = 225,000 + 135,000 = 360,000 paise (₹3,600)
create temp table planned_payout_result as
select private.plan_owner_payout((select mo_id from test_payout_fixtures)) as res;

select is(
  ((select res->>'amount_minor' from planned_payout_result)::bigint),
  360000::bigint,
  'Multi-turf consolidation aggregated bookings across Turf 1 and Turf 2 into exactly ₹3,600 payable'
);

select is(
  (select count(*)::int from private.payout_allocations where payout_id = ((select res->>'payout_id' from planned_payout_result)::uuid)),
  2,
  'Payout allocations correctly mapped both bookings across different turfs to the single payout'
);

-- 5. Settle Payout & Double-Entry Ledger Verification
select lives_ok(
  format(
    $$select private.settle_owner_payout('%s', 'setl_test_99999')$$,
    (select res->>'payout_id' from planned_payout_result)
  ),
  'Successfully settled owner payout'
);

-- Assert payout status is 'settled'
select is(
  (select status from private.payouts where id = ((select res->>'payout_id' from planned_payout_result)::uuid)),
  'settled',
  'Payout record transitioned to settled'
);

-- 6. Concurrent Partial Refund Capacity Check (Sequential baseline test)
-- Create a test payment of ₹2,000 (200,000 paise)
insert into private.payment_orders (
  id, booking_id, master_owner_id, purpose, provider, provider_order_id,
  amount_minor, currency, status, idempotency_key
) select
  '99999999-9999-9999-9999-999999999991', 'b1111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', mo_id, 'initial', 'razorpay', 'order_ref_test_99',
  200000, 'INR', 'paid', 'idemp_ref_order_99'
from test_payout_fixtures;

insert into private.payments (
  id, payment_order_id, provider, provider_payment_id,
  amount_minor, currency, status, captured_at
) values (
  '99999999-9999-9999-9999-999999999992', '99999999-9999-9999-9999-999999999991', 'razorpay', 'pay_ref_test_99',
  200000, 'INR', 'captured', now()
);

-- Request refund of ₹1,500 (150,000 paise) -> Should succeed
select lives_ok(
  $$select private.request_refund('99999999-9999-9999-9999-999999999992', 150000, 'Player request', null, 'idemp_refund_1')$$,
  'First partial refund of ₹1,500 succeeds'
);

-- Request refund of ₹600 (60,000 paise) -> Should FAIL (150k + 60k = 210k > 200k)
select throws_ok(
  $$select private.request_refund('99999999-9999-9999-9999-999999999992', 60000, 'Exceeding capacity', null, 'idemp_refund_2')$$,
  '23514',
  NULL,
  'Second partial refund exceeding remaining refundable capacity rejected with 23514'
);

-- 7. Outbox Worker Leasing & Crash Recovery
-- Insert dedicated test outbox event
insert into private.outbox_events (
  id, topic, aggregate_type, aggregate_id, dedupe_key, payload, attempts
) values (
  '88888888-8888-8888-8888-888888888888', 'test.pgtap.lease', 'test', gen_random_uuid(), 'dedupe_pgtap_lease', '{"test": true}', 0
);

-- 7.1 Worker A claims batch with 10-second lease
select is(
  (select count(*)::int from private.claim_outbox_batch('worker_node_a'::text, 10, interval '10 seconds', 'test.pgtap.lease')),
  1,
  'Worker A successfully claimed pending outbox event with active lease'
);

-- 7.2 Worker B attempts to claim while Worker A lease is active -> 0 claimed
select is(
  (select count(*)::int from private.claim_outbox_batch('worker_node_b'::text, 10, interval '10 seconds', 'test.pgtap.lease')),
  0,
  'Worker B blocked from claiming event while Worker A lease is active'
);

-- 7.3 Simulate Worker A crash / lease expiry
update private.outbox_events
set lease_until = now() - interval '1 second'
where id = '88888888-8888-8888-8888-888888888888';

-- 7.4 Worker B reclaims the job after lease expiry
select is(
  (select count(*)::int from private.claim_outbox_batch('worker_node_b'::text, 10, interval '10 seconds', 'test.pgtap.lease')),
  1,
  'Worker B successfully reclaimed outbox event after Worker A lease expired'
);

-- 7.5 Attempts incremented on retry
select is(
  (select attempts from private.outbox_events where id = '88888888-8888-8888-8888-888888888888'),
  2,
  'Outbox event attempts correctly incremented to 2 on reclaim'
);

-- 7.6 Worker B completes the job
select is(
  (select private.complete_outbox_event('88888888-8888-8888-8888-888888888888', 'worker_node_b')),
  true,
  'Worker B successfully completed outbox event'
);

-- 7.7 Worker C attempts to claim completed job -> 0 claimed
select is(
  (select count(*)::int from private.claim_outbox_batch('worker_node_c'::text, 10, interval '10 seconds', 'test.pgtap.lease')),
  0,
  'Worker C cannot claim completed outbox event'
);

select * from finish();
rollback;

