-- Test Suite: 04_financial_ledger_test.sql
-- Description: pgTAP tests for Milestone 5:
-- 1. Chart of accounts (platform vs owner accounts)
-- 2. Balanced journal posting (+2000, -1800, -200)
-- 3. Unbalanced journal rejection (deferred constraint trigger)
-- 4. Fewer than 2 entries rejection
-- 5. Zero amount entry rejection
-- 6. Idempotency key replay protection
-- 7. Reversal journal creation & net balance cancellation
-- 8. Immutability enforcement (UPDATE and DELETE blocked via trigger)

begin;
select plan(13);

-- ============================================================================
-- 1. SETUP TEST FIXTURES
-- ============================================================================

do $$
declare
  uid_owner uuid := 'a1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  mo_id     uuid := 'a2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  acc_clearing uuid;
  acc_commission uuid;
  acc_payable uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (uid_owner, 'ledger_owner@test.com', '{"name": "Ledger Owner"}'::jsonb);

  insert into public.master_owners (id, owner_user_id, business_name, status) values
    (mo_id, uid_owner, 'Ledger Test Arena', 'active');

  -- Get platform accounts
  select id into acc_clearing from private.ledger_accounts where code = 'gateway_clearing';
  select id into acc_commission from private.ledger_accounts where code = 'platform_commission';

  -- Create owner payable account
  perform private.get_or_create_owner_account(mo_id, 'owner_payable', 'INR');
end $$;

-- Test 1: Platform accounts exist
select is(
  (select count(*)::int from private.ledger_accounts where master_owner_id is null and code in ('gateway_clearing', 'platform_commission')),
  2,
  'Platform chart of accounts seeded'
);

-- Test 2: Owner account created
select is(
  (select count(*)::int from private.ledger_accounts where master_owner_id = 'a2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid and code = 'owner_payable'),
  1,
  'Owner payable account created'
);

-- ============================================================================
-- 2. POST BALANCED JOURNAL (+2000, -1800, -200)
-- ============================================================================

select is(
  (
    select private.post_journal(
      p_event_key => 'evt-pay-001',
      p_event_type => 'payment_captured',
      p_currency => 'INR',
      p_booking_id => null,
      p_entries => jsonb_build_array(
        jsonb_build_object('account_id', (select id from private.ledger_accounts where code = 'gateway_clearing'), 'amount_minor', 200000),
        jsonb_build_object('account_id', (select id from private.ledger_accounts where master_owner_id = 'a2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid and code = 'owner_payable'), 'amount_minor', -180000),
        jsonb_build_object('account_id', (select id from private.ledger_accounts where code = 'platform_commission'), 'amount_minor', -20000)
      )
    )->>'status'
  ),
  'posted',
  'post_journal successfully posts balanced 3-legged journal'
);

-- Entries net sum is exactly zero
select is(
  (
    select sum(e.amount_minor)::bigint
    from private.ledger_entries e
    join private.ledger_journals j on j.id = e.journal_id
    where j.event_key = 'evt-pay-001'
  ),
  0::bigint,
  'Posted journal entries sum to zero'
);

-- ============================================================================
-- 3. IDEMPOTENCY REPLAY
-- ============================================================================

select is(
  (
    select private.post_journal(
      p_event_key => 'evt-pay-001',
      p_event_type => 'payment_captured',
      p_currency => 'INR',
      p_booking_id => null,
      p_entries => jsonb_build_array(
        jsonb_build_object('account_id', (select id from private.ledger_accounts where code = 'gateway_clearing'), 'amount_minor', 200000),
        jsonb_build_object('account_id', (select id from private.ledger_accounts where master_owner_id = 'a2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid and code = 'owner_payable'), 'amount_minor', -180000),
        jsonb_build_object('account_id', (select id from private.ledger_accounts where code = 'platform_commission'), 'amount_minor', -20000)
      )
    )->>'status'
  ),
  'already_posted',
  'Idempotent call with identical event_key returns already_posted status'
);

select is(
  (select count(*)::int from private.ledger_journals where event_key = 'evt-pay-001'),
  1,
  'No duplicate journal created on idempotent replay'
);

-- ============================================================================
-- 4. UNBALANCED JOURNAL REJECTION
-- ============================================================================

-- Net sum is +50,000 paise (not zero) -> must fail with check_violation 23514
select throws_ok(
  $$
    select private.post_journal(
      p_event_key => 'evt-unbalanced-001',
      p_event_type => 'test_unbalanced',
      p_currency => 'INR',
      p_booking_id => null,
      p_entries => jsonb_build_array(
        jsonb_build_object('account_id', (select id from private.ledger_accounts where code = 'gateway_clearing'), 'amount_minor', 200000),
        jsonb_build_object('account_id', (select id from private.ledger_accounts where code = 'platform_commission'), 'amount_minor', -150000)
      )
    );
    set constraints all immediate;
  $$,
  '23514',
  null,
  'Deferred constraint trigger rejects unbalanced journal on constraint check'
);

-- Fewer than 2 entries (1 entry) -> must fail with 23514
select throws_ok(
  $$
    select private.post_journal(
      p_event_key => 'evt-single-001',
      p_event_type => 'test_single',
      p_currency => 'INR',
      p_booking_id => null,
      p_entries => jsonb_build_array(
        jsonb_build_object('account_id', (select id from private.ledger_accounts where code = 'gateway_clearing'), 'amount_minor', 100000)
      )
    );
    set constraints all immediate;
  $$,
  '23514',
  null,
  'Deferred constraint trigger rejects journal with fewer than 2 entries on constraint check'
);

-- Zero amount entry -> rejected
select throws_ok(
  $$
    select private.post_journal(
      p_event_key => 'evt-zero-001',
      p_event_type => 'test_zero',
      p_currency => 'INR',
      p_booking_id => null,
      p_entries => jsonb_build_array(
        jsonb_build_object('account_id', (select id from private.ledger_accounts where code = 'gateway_clearing'), 'amount_minor', 0),
        jsonb_build_object('account_id', (select id from private.ledger_accounts where code = 'platform_commission'), 'amount_minor', 0)
      )
    )
  $$,
  '22023',
  'ZERO_AMOUNT_ENTRY: Ledger entries must be non-zero',
  'Rejects zero-amount ledger entries'
);

-- ============================================================================
-- 5. REVERSAL JOURNAL CREATION
-- ============================================================================

select is(
  (
    select private.reverse_journal(
      p_journal_id => (select id from private.ledger_journals where event_key = 'evt-pay-001'),
      p_reversal_event_key => 'evt-rev-001'
    )->>'status'
  ),
  'posted',
  'reverse_journal successfully creates balancing reversal journal'
);

-- Sum across original and reversal journals is zero for every account
select is(
  (
    select sum(amount_minor)::bigint
    from private.ledger_entries
    where journal_id in (
      select id from private.ledger_journals where event_key in ('evt-pay-001', 'evt-rev-001')
    )
  ),
  0::bigint,
  'Combined original and reversal entries cancel to exactly zero'
);

-- ============================================================================
-- 6. IMMUTABILITY ENFORCEMENT
-- ============================================================================

-- Attempt to UPDATE existing journal header
select throws_ok(
  $$
    update private.ledger_journals
    set event_type = 'tampered'
    where event_key = 'evt-pay-001'
  $$,
  '55000',
  'LEDGER_IMMUTABLE: Financial ledger records are strictly append-only and cannot be updated or deleted. Use private.reverse_journal for corrections.',
  'Blocking trigger rejects UPDATE on ledger_journals'
);

-- Attempt to DELETE existing ledger entry
select throws_ok(
  $$
    delete from private.ledger_entries
    where journal_id = (select id from private.ledger_journals where event_key = 'evt-pay-001')
  $$,
  '55000',
  'LEDGER_IMMUTABLE: Financial ledger records are strictly append-only and cannot be updated or deleted. Use private.reverse_journal for corrections.',
  'Blocking trigger rejects DELETE on ledger_entries'
);

select * from finish();
rollback;
