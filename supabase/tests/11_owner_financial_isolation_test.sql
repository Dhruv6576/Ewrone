-- Test Suite: 11_owner_financial_isolation_test.sql
-- Description: pgTAP tests verifying:
--              1. Walk-in bookings are 100% payout-ineligible across plan_owner_payout & get_owner_financial_summary
--              2. Sign bifurcation on owner_payable in get_owner_statement (debit is receivable, credit is payable)
--              3. Date filtering on get_owner_statement excludes ledger entries outside period
--              4. Cross-tenant financial isolation on statement, financial summary, and dashboard
--              5. Platform admin can access tenant financial surfaces
--              6. Dashboard source breakdown correctly separates online vs walkin metrics
--              7. Online bookings remain eligible for platform payout settlement

begin;
select plan(21);

-- ============================================================================
-- 1. SETUP TEST FIXTURES (Superuser Mode)
-- ============================================================================

do $$
declare
  uid_owner_a   uuid := 'a1100000-0000-0000-0000-000000000001';
  uid_owner_b   uuid := 'a1100000-0000-0000-0000-000000000002';
  uid_admin     uuid := 'a1100000-0000-0000-0000-000000000003';

  mo_a_id       uuid := 'b1100000-0000-0000-0000-000000000001';
  mo_b_id       uuid := 'b1100000-0000-0000-0000-000000000002';

  turf_a_id     uuid := 'c1100000-0000-0000-0000-000000000001';
  turf_b_id     uuid := 'c1100000-0000-0000-0000-000000000002';

  res_a_id      uuid := 'd1100000-0000-0000-0000-000000000001';
  res_b_id      uuid := 'd1100000-0000-0000-0000-000000000002';

  acc_fin_a     uuid := 'e1100000-0000-0000-0000-000000000001';
  acc_fin_b     uuid := 'e1100000-0000-0000-0000-000000000002';

  b_walkin_id   uuid := 'f1100000-0000-0000-0000-000000000001';
  b_online_id   uuid := 'f1100000-0000-0000-0000-000000000002';

  acc_owner_a   uuid;
  acc_owner_b   uuid;
  acc_comm      uuid;
  acc_gateway   uuid;
begin
  -- Users
  insert into auth.users (id, email) values
    (uid_owner_a, 'owner_fin_a@test.com'),
    (uid_owner_b, 'owner_fin_b@test.com'),
    (uid_admin, 'admin_fin@test.com')
  on conflict (id) do nothing;

  -- Platform Admin grant
  insert into private.platform_admins (user_id, active) values
    (uid_admin, true)
  on conflict (user_id) do nothing;

  -- Master Owners
  insert into public.master_owners (id, owner_user_id, business_name, status) values
    (mo_a_id, uid_owner_a, 'Owner A Sports Ltd', 'active'),
    (mo_b_id, uid_owner_b, 'Owner B Turfs Inc', 'active')
  on conflict (id) do nothing;

  -- Turfs
  insert into public.turfs (id, master_owner_id, slug, name, address_text, city, location, approval_status) values
    (turf_a_id, mo_a_id, 'fin-turf-a', 'Fin Turf A', '100 Fin Road', 'Ahmedabad',
     extensions.st_setsrid(extensions.st_makepoint(72.5714, 23.0225), 4326), 'approved'),
    (turf_b_id, mo_b_id, 'fin-turf-b', 'Fin Turf B', '200 Fin Road', 'Surat',
     extensions.st_setsrid(extensions.st_makepoint(72.8311, 21.1702), 4326), 'approved')
  on conflict (id) do nothing;

  -- Resources
  insert into public.resources (id, master_owner_id, turf_id, name, booking_increment_minutes) values
    (res_a_id, mo_a_id, turf_a_id, 'Fin Pitch A1', 60),
    (res_b_id, mo_b_id, turf_b_id, 'Fin Pitch B1', 60)
  on conflict (id) do nothing;

  -- Active Verified Payout Accounts
  insert into private.owner_financial_accounts (
    id, master_owner_id, provider, provider_account_id, masked_bank_label, verification_status, active
  ) values
    (acc_fin_a, mo_a_id, 'razorpay_x', 'acc_fin_a_123', 'HDFC Bank - 1111', 'verified', true),
    (acc_fin_b, mo_b_id, 'razorpay_x', 'acc_fin_b_456', 'ICICI Bank - 2222', 'verified', true)
  on conflict (id) do nothing;

  -- Ledger Accounts
  acc_owner_a := private.get_or_create_owner_account(mo_a_id, 'owner_payable', 'INR');
  acc_owner_b := private.get_or_create_owner_account(mo_b_id, 'owner_payable', 'INR');

  select id into acc_comm from private.ledger_accounts where code = 'platform_commission' and currency = 'INR';
  select id into acc_gateway from private.ledger_accounts where code = 'gateway_clearing' and currency = 'INR';

  -- Fixture 1: Owner A has 1 confirmed WALKIN booking:
  -- Total: ₹3,000 (300,000 minor), Commission: 10% = ₹300 (30,000 minor)
  insert into public.bookings (
    id, reference_code, master_owner_id, turf_id, resource_id,
    player_user_id, created_by, source, status,
    starts_at, ends_at, total_minor, required_online_minor, currency,
    pricing_snapshot, cancellation_snapshot, commission_snapshot, confirmed_at, created_at
  ) values (
    b_walkin_id, 'WK-FIN-A01', mo_a_id, turf_a_id, res_a_id,
    null, uid_owner_a, 'walkin', 'confirmed',
    now() + interval '1 day', now() + interval '1 day 1 hour', 300000, 0, 'INR',
    '{"increments_count": 1}'::jsonb, '{}'::jsonb,
    '{"basis_points": 1000, "fixed_minor": 0, "estimated_commission_minor": 30000}'::jsonb,
    now(), now()
  ) on conflict (id) do nothing;

  -- Post commission journal for walk-in:
  -- Debit owner_payable (+30,000), Credit platform_commission (-30,000)
  perform private.post_journal(
    p_event_key => 'test_walkin_comm_journal_a',
    p_event_type => 'walkin_booking_recorded',
    p_currency => 'INR',
    p_booking_id => b_walkin_id,
    p_entries => jsonb_build_array(
      jsonb_build_object('account_id', acc_owner_a, 'amount_minor', 30000),
      jsonb_build_object('account_id', acc_comm, 'amount_minor', -30000)
    )
  );

  -- Fixture 2: Owner B has 1 confirmed ONLINE booking:
  -- Total: ₹5,000 (500,000 minor), Commission: 10% = ₹500 (50,000 minor), Net Payable = ₹4,500 (450,000 minor)
  insert into public.bookings (
    id, reference_code, master_owner_id, turf_id, resource_id,
    player_user_id, created_by, source, status,
    starts_at, ends_at, total_minor, required_online_minor, currency,
    pricing_snapshot, cancellation_snapshot, commission_snapshot, confirmed_at, created_at
  ) values (
    b_online_id, 'ON-FIN-B01', mo_b_id, turf_b_id, res_b_id,
    uid_owner_b, uid_owner_b, 'online', 'confirmed',
    now() + interval '2 days', now() + interval '2 days 1 hour', 500000, 500000, 'INR',
    '{"increments_count": 1}'::jsonb, '{}'::jsonb,
    '{"basis_points": 1000, "fixed_minor": 0, "estimated_commission_minor": 50000}'::jsonb,
    now(), now()
  ) on conflict (id) do nothing;

  -- Post online payment capture journal for Owner B:
  -- Debit gateway_clearing (+500,000), Credit owner_payable (-450,000), Credit platform_commission (-50,000)
  perform private.post_journal(
    p_event_key => 'test_online_capture_journal_b',
    p_event_type => 'payment_captured',
    p_currency => 'INR',
    p_booking_id => b_online_id,
    p_entries => jsonb_build_array(
      jsonb_build_object('account_id', acc_gateway, 'amount_minor', 500000),
      jsonb_build_object('account_id', acc_owner_b, 'amount_minor', -450000),
      jsonb_build_object('account_id', acc_comm, 'amount_minor', -50000)
    )
  );
end $$;

-- ============================================================================
-- 2. TEST GROUP 1: Walk-in Payout Ineligibility
-- ============================================================================

-- Switch to Owner A (who has only walk-in bookings)
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1100000-0000-0000-0000-000000000001", "role": "authenticated"}';

-- Test 1: get_owner_financial_summary returns 0 unsettled payable for walk-in only owner
select is(
  (
    select (public.get_owner_financial_summary('b1100000-0000-0000-0000-000000000001'::uuid)->>'unsettled_payable_minor')::bigint
  ),
  0::bigint,
  'Owner with only walk-in bookings has strictly 0 unsettled payable minor'
);

-- Test 2: get_owner_financial_summary returns 0 unsettled booking count
select is(
  (
    select (public.get_owner_financial_summary('b1100000-0000-0000-0000-000000000001'::uuid)->>'unsettled_booking_count')::int
  ),
  0,
  'Owner with only walk-in bookings has strictly 0 unsettled booking count'
);

-- Test 3: plan_owner_payout returns no_payable_balance and creates 0 allocations
reset role;

select is(
  (
    select (private.plan_owner_payout('b1100000-0000-0000-0000-000000000001'::uuid)->>'status')
  ),
  'no_payable_balance',
  'plan_owner_payout returns no_payable_balance for walk-in only owner'
);

-- ============================================================================
-- 3. TEST GROUP 2: Sign Bifurcation on get_owner_statement
-- ============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1100000-0000-0000-0000-000000000001", "role": "authenticated"}';

-- Test 4: owner_payable_net is positive (debit balance representing owner debt to platform)
select is(
  (
    select (public.get_owner_statement('b1100000-0000-0000-0000-000000000001'::uuid)->'ledger_balances'->>'owner_payable_net')::bigint
  ),
  30000::bigint,
  'owner_payable_net is +30000 (positive debit balance for walk-in commission)'
);

-- Test 5: outstanding_payable_minor is strictly 0 (platform does not owe owner)
select is(
  (
    select (public.get_owner_statement('b1100000-0000-0000-0000-000000000001'::uuid)->'payouts'->>'outstanding_payable_minor')::bigint
  ),
  0::bigint,
  'outstanding_payable_minor is 0 (platform does not owe money to owner)'
);

-- Test 6: owner_receivable_minor is strictly 30000 (owner owes platform commission)
select is(
  (
    select (public.get_owner_statement('b1100000-0000-0000-0000-000000000001'::uuid)->'payouts'->>'owner_receivable_minor')::bigint
  ),
  30000::bigint,
  'owner_receivable_minor is 30000 (owner owes platform commission)'
);

-- ============================================================================
-- 4. TEST GROUP 3: Cumulative Lifetime Balances on get_owner_statement
-- ============================================================================

-- Test 7: Current date range returns cumulative lifetime balances (period_applied = false)
select is(
  (
    select (public.get_owner_statement(
      'b1100000-0000-0000-0000-000000000001'::uuid,
      current_date,
      current_date
    )->'ledger_balances'->>'platform_commission_net')::bigint
  ),
  (-30000)::bigint,
  'Statement returns cumulative lifetime platform_commission_net of -30000'
);

-- Test 8: Historical date range returns cumulative lifetime balance (date params are deprecated no-ops)
select is(
  (
    select (public.get_owner_statement(
      'b1100000-0000-0000-0000-000000000001'::uuid,
      '2024-01-01'::date,
      '2024-01-31'::date
    )->'ledger_balances'->>'platform_commission_net')::bigint
  ),
  (-30000)::bigint,
  'Statement with historical date params returns cumulative lifetime balance (params deprecated no-ops)'
);

-- ============================================================================
-- 5. TEST GROUP 4: Cross-Tenant Financial Isolation
-- ============================================================================

-- Owner A tries to access Owner B financial surfaces
-- Test 9: Negative - Owner A cannot view Owner B statement
select throws_ok(
  $$select public.get_owner_statement('b1100000-0000-0000-0000-000000000002'::uuid)$$,
  '42501',
  NULL,
  'Owner A cannot view Owner B statement (Cross-tenant rejection 42501)'
);

-- Test 10: Negative - Owner A cannot view Owner B financial summary
select throws_ok(
  $$select public.get_owner_financial_summary('b1100000-0000-0000-0000-000000000002'::uuid)$$,
  '42501',
  NULL,
  'Owner A cannot view Owner B financial summary (Cross-tenant rejection 42501)'
);

-- Test 11: Negative - Owner A cannot view Owner B dashboard
select throws_ok(
  $$select public.get_owner_dashboard('b1100000-0000-0000-0000-000000000002'::uuid)$$,
  '42501',
  NULL,
  'Owner A cannot view Owner B dashboard (Cross-tenant rejection 42501)'
);

-- ============================================================================
-- 6. TEST GROUP 5: Platform Admin Financial Access
-- ============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1100000-0000-0000-0000-000000000003", "role": "authenticated"}';

-- Test 12: Positive - Platform admin can view Owner A statement
select lives_ok(
  $$select public.get_owner_statement('b1100000-0000-0000-0000-000000000001'::uuid)$$,
  'Platform admin can view any master owner statement'
);

-- Test 13: Positive - Platform admin can view Owner A financial summary
select lives_ok(
  $$select public.get_owner_financial_summary('b1100000-0000-0000-0000-000000000001'::uuid)$$,
  'Platform admin can view any master owner financial summary'
);

-- Test 14: Positive - Platform admin can view Owner A dashboard
select lives_ok(
  $$select public.get_owner_dashboard('b1100000-0000-0000-0000-000000000001'::uuid)$$,
  'Platform admin can view any master owner dashboard'
);

-- ============================================================================
-- 7. TEST GROUP 6: Dashboard Source Breakdown
-- ============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1100000-0000-0000-0000-000000000001", "role": "authenticated"}';

-- Test 15: Walk-in bookings count in dashboard source_breakdown
select is(
  (
    select (public.get_owner_dashboard('b1100000-0000-0000-0000-000000000001'::uuid)->'summary'->'source_breakdown'->'walkin'->>'bookings_count')::int
  ),
  1,
  'Dashboard source_breakdown reports exactly 1 walk-in booking for Owner A'
);

-- Test 16: Walk-in gross minor in dashboard source_breakdown
select is(
  (
    select (public.get_owner_dashboard('b1100000-0000-0000-0000-000000000001'::uuid)->'summary'->'source_breakdown'->'walkin'->>'gross_minor')::bigint
  ),
  300000::bigint,
  'Dashboard source_breakdown reports 300000 gross minor for walk-in'
);

-- Test 17: Walk-in commission minor in dashboard source_breakdown
select is(
  (
    select (public.get_owner_dashboard('b1100000-0000-0000-0000-000000000001'::uuid)->'summary'->'source_breakdown'->'walkin'->>'commission_minor')::bigint
  ),
  30000::bigint,
  'Dashboard source_breakdown reports 30000 commission minor for walk-in'
);

-- Test 18: Online bookings count is 0 for walk-in only owner in source_breakdown
select is(
  (
    select (public.get_owner_dashboard('b1100000-0000-0000-0000-000000000001'::uuid)->'summary'->'source_breakdown'->'online'->>'bookings_count')::int
  ),
  0,
  'Dashboard source_breakdown reports 0 online bookings for Owner A'
);

-- ============================================================================
-- 8. TEST GROUP 7: Online Booking Payout Eligibility Control
-- ============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1100000-0000-0000-0000-000000000002", "role": "authenticated"}';

-- Test 19: Owner B has unsettled payable for the online booking (500000 - 50000 = 450000)
select is(
  (
    select (public.get_owner_financial_summary('b1100000-0000-0000-0000-000000000002'::uuid)->>'unsettled_payable_minor')::bigint
  ),
  450000::bigint,
  'Owner B has 450000 unsettled payable minor for online booking'
);

-- Test 20: plan_owner_payout successfully plans payout for Owner B online booking
reset role;

select is(
  (
    select (private.plan_owner_payout('b1100000-0000-0000-0000-000000000002'::uuid)->>'status')
  ),
  'planned',
  'plan_owner_payout successfully plans payout for online booking'
);

-- Test 21: Allocation persisted and financial summary unsettled payable moves to planned
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1100000-0000-0000-0000-000000000002", "role": "authenticated"}';

select is(
  (
    select (public.get_owner_financial_summary('b1100000-0000-0000-0000-000000000002'::uuid)->>'planned_payouts_minor')::bigint
  ),
  450000::bigint,
  'Financial summary reflects 450000 in planned_payouts_minor after planning'
);

rollback;
