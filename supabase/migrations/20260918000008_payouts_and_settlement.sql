-- Migration: 20260918000008_payouts_and_settlement.sql
-- Description: Owner financial accounts, payouts, payout allocations, payment transfers, disputes, concurrent refund capacity checks, and outbox worker lease mechanics.

-- 1. Owner Financial Accounts (Bank accounts & gateway linked vendor accounts)
create table private.owner_financial_accounts (
  id uuid primary key default gen_random_uuid(),
  master_owner_id uuid not null references public.master_owners(id) on delete restrict,
  provider text not null default 'razorpay',
  provider_account_id text not null,
  currency text not null default 'INR',
  verification_status text not null default 'verified'
    check (verification_status in ('pending', 'verified', 'rejected', 'suspended')),
  active boolean not null default false,
  masked_bank_label text,
  created_at timestamptz not null default now(),
  unique (provider, provider_account_id),
  unique (id, master_owner_id, currency)
);

create unique index one_active_owner_financial_account
  on private.owner_financial_accounts(master_owner_id, provider, currency)
  where active;

-- 2. Payouts (Settlement batches and provider payout records)
create table private.payouts (
  id uuid primary key default gen_random_uuid(),
  master_owner_id uuid not null,
  financial_account_id uuid not null,
  currency text not null default 'INR',
  amount_minor bigint not null check (amount_minor > 0),
  status text not null default 'planned'
    check (
      status in (
        'planned', 'submitted', 'processing',
        'settled', 'failed', 'reversed', 'unknown'
      )
    ),
  provider_settlement_id text,
  idempotency_key text not null unique,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  foreign key (financial_account_id, master_owner_id, currency)
    references private.owner_financial_accounts(id, master_owner_id, currency) on delete restrict,
  unique (id, master_owner_id)
);

create index payouts_master_owner_idx
  on private.payouts(master_owner_id, status);

-- 3. Payout Allocations (Traceability between payouts and individual bookings)
create table private.payout_allocations (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null,
  master_owner_id uuid not null,
  booking_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  foreign key (payout_id, master_owner_id)
    references private.payouts(id, master_owner_id) on delete cascade,
  foreign key (booking_id, master_owner_id)
    references public.bookings(id, master_owner_id) on delete restrict,
  unique (payout_id, booking_id)
);

create index payout_allocations_booking_idx
  on private.payout_allocations(booking_id);

-- 4. Payment Transfers (Provider route splits)
create table private.payment_transfers (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references private.payments(id) on delete restrict,
  financial_account_id uuid not null
    references private.owner_financial_accounts(id) on delete restrict,
  payout_allocation_id uuid references private.payout_allocations(id) on delete set null,
  provider_transfer_id text,
  amount_minor bigint not null check (amount_minor > 0),
  status text not null check (status in ('pending', 'transferred', 'failed', 'reversed')),
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

-- 5. Transfer Reversals (Clawbacks on transfers due to refunds)
create table private.transfer_reversals (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references private.payment_transfers(id) on delete restrict,
  refund_id uuid references private.refunds(id) on delete set null,
  provider_reversal_id text,
  amount_minor bigint not null check (amount_minor > 0),
  status text not null check (status in ('pending', 'reversed', 'failed')),
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

-- 6. Disputes (Gateway chargebacks)
create table private.disputes (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references private.payments(id) on delete restrict,
  provider_dispute_id text,
  status text not null check (status in ('opened', 'under_review', 'won', 'lost', 'closed')),
  reason text,
  amount_minor bigint not null check (amount_minor >= 0),
  evidence_due_at timestamptz,
  created_at timestamptz not null default now()
);

-- Revoke write privileges on financial tables from public/anon/authenticated
revoke all on private.owner_financial_accounts from public, anon, authenticated;
revoke all on private.payouts from public, anon, authenticated;
revoke all on private.payout_allocations from public, anon, authenticated;
revoke all on private.payment_transfers from public, anon, authenticated;
revoke all on private.transfer_reversals from public, anon, authenticated;
revoke all on private.disputes from public, anon, authenticated;

grant select on private.owner_financial_accounts to authenticated, service_role;
grant select on private.payouts to authenticated, service_role;
grant select on private.payout_allocations to authenticated, service_role;

-- 7. Stored Procedures & Business Logic

-- 7.1 Register Owner Financial Account
create or replace function private.register_owner_financial_account(
  p_master_owner_id uuid,
  p_provider text,
  p_provider_account_id text,
  p_masked_bank_label text,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_account_id uuid;
begin
  if p_active then
    update private.owner_financial_accounts
    set active = false
    where master_owner_id = p_master_owner_id
      and provider = p_provider
      and currency = 'INR'
      and active = true;
  end if;

  insert into private.owner_financial_accounts (
    master_owner_id, provider, provider_account_id, currency,
    verification_status, active, masked_bank_label
  ) values (
    p_master_owner_id, p_provider, p_provider_account_id, 'INR',
    'verified', p_active, p_masked_bank_label
  )
  on conflict (provider, provider_account_id) do update
  set active = p_active,
      masked_bank_label = coalesce(excluded.masked_bank_label, private.owner_financial_accounts.masked_bank_label),
      verification_status = 'verified'
  returning id into v_account_id;

  return jsonb_build_object(
    'account_id', v_account_id,
    'master_owner_id', p_master_owner_id,
    'provider', p_provider,
    'provider_account_id', p_provider_account_id,
    'active', p_active,
    'status', 'verified'
  );
end;
$$;

revoke all on function private.register_owner_financial_account(uuid, text, text, text, boolean) from public;
grant execute on function private.register_owner_financial_account(uuid, text, text, text, boolean) to authenticated, service_role;

-- 7.2 Plan Owner Payout (Multi-turf consolidation)
create or replace function private.plan_owner_payout(
  p_master_owner_id uuid,
  p_period_start timestamptz default null,
  p_period_end timestamptz default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_acc record;
  v_payout_id uuid;
  v_idemp_key text;
  v_total_minor bigint := 0;
  v_count integer := 0;
  v_rec record;
begin
  -- 1. Check active verified financial account
  select * into v_acc
  from private.owner_financial_accounts
  where master_owner_id = p_master_owner_id
    and active = true
    and verification_status = 'verified'
  limit 1;

  if v_acc.id is null then
    raise exception 'NO_ACTIVE_FINANCIAL_ACCOUNT: Master owner has no active, verified payout account'
      using errcode = 'P0002';
  end if;

  v_idemp_key := coalesce(p_idempotency_key, format('plan_payout_%s_%s', p_master_owner_id, extract(epoch from now())));

  -- Check idempotency
  select id into v_payout_id
  from private.payouts
  where idempotency_key = v_idemp_key;

  if v_payout_id is not null then
    select amount_minor into v_total_minor from private.payouts where id = v_payout_id;
    return jsonb_build_object(
      'payout_id', v_payout_id,
      'status', 'already_planned',
      'amount_minor', v_total_minor
    );
  end if;

  -- 2. Calculate eligible bookings sum & count across ALL turfs of this master_owner_id
  with eligible as (
    select b.id as booking_id,
           (b.total_minor - coalesce((b.commission_snapshot->>'estimated_commission_minor')::bigint, round((b.total_minor * 1000) / 10000.0))) as payable_minor
    from public.bookings b
    where b.master_owner_id = p_master_owner_id
      and b.status = 'confirmed'
      and (p_period_start is null or b.starts_at >= p_period_start)
      and (p_period_end is null or b.starts_at <= p_period_end)
      and not exists (
        select 1 from private.payout_allocations pa
        where pa.booking_id = b.id
      )
  )
  select coalesce(sum(payable_minor), 0), count(*)
  into v_total_minor, v_count
  from eligible
  where payable_minor > 0;

  if v_total_minor <= 0 or v_count = 0 then
    return jsonb_build_object(
      'status', 'no_payable_balance',
      'amount_minor', 0,
      'allocated_bookings', 0
    );
  end if;

  v_payout_id := gen_random_uuid();

  -- 3. Insert payout header FIRST to satisfy foreign key constraints
  insert into private.payouts (
    id, master_owner_id, financial_account_id, currency,
    amount_minor, status, idempotency_key, period_start, period_end
  ) values (
    v_payout_id, p_master_owner_id, v_acc.id, 'INR',
    v_total_minor, 'planned', v_idemp_key, p_period_start, p_period_end
  );

  -- 4. Insert allocation line-items referencing the newly created payout
  insert into private.payout_allocations (
    payout_id, master_owner_id, booking_id, amount_minor
  )
  select v_payout_id,
         p_master_owner_id,
         b.id,
         (b.total_minor - coalesce((b.commission_snapshot->>'estimated_commission_minor')::bigint, round((b.total_minor * 1000) / 10000.0)))
  from public.bookings b
  where b.master_owner_id = p_master_owner_id
    and b.status = 'confirmed'
    and (p_period_start is null or b.starts_at >= p_period_start)
    and (p_period_end is null or b.starts_at <= p_period_end)
    and not exists (
      select 1 from private.payout_allocations pa
      where pa.booking_id = b.id
    )
    and (b.total_minor - coalesce((b.commission_snapshot->>'estimated_commission_minor')::bigint, round((b.total_minor * 1000) / 10000.0))) > 0;

  -- 5. Queue outbox event
  insert into private.outbox_events (
    topic, aggregate_type, aggregate_id, dedupe_key, payload
  ) values (
    'payout.planned', 'payout', v_payout_id,
    format('payout_planned_%s', v_payout_id),
    jsonb_build_object(
      'payout_id', v_payout_id,
      'master_owner_id', p_master_owner_id,
      'amount_minor', v_total_minor,
      'allocated_bookings', v_count,
      'destination_account_id', v_acc.provider_account_id
    )
  );

  return jsonb_build_object(
    'payout_id', v_payout_id,
    'status', 'planned',
    'amount_minor', v_total_minor,
    'allocated_bookings', v_count,
    'financial_account_id', v_acc.id,
    'masked_bank_label', v_acc.masked_bank_label
  );
end;
$$;

revoke all on function private.plan_owner_payout(uuid, timestamptz, timestamptz, text) from public;
grant execute on function private.plan_owner_payout(uuid, timestamptz, timestamptz, text) to authenticated, service_role;

-- 7.3 Settle Owner Payout (Ledger posting & idempotency)
create or replace function private.settle_owner_payout(
  p_payout_id uuid,
  p_provider_settlement_id text,
  p_settled_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_payout record;
  v_acc_clearing uuid;
  v_acc_owner uuid;
  v_journal_key text;
  v_journal_res jsonb;
begin
  -- 1. Lock payout FOR UPDATE
  select * into v_payout
  from private.payouts
  where id = p_payout_id
  for update;

  if v_payout.id is null then
    raise exception 'PAYOUT_NOT_FOUND: Payout with ID % not found', p_payout_id
      using errcode = 'P0002';
  end if;

  -- 2. Idempotency replay
  if v_payout.status = 'settled' then
    return jsonb_build_object(
      'payout_id', v_payout.id,
      'status', 'already_settled',
      'provider_settlement_id', v_payout.provider_settlement_id,
      'settled_at', v_payout.settled_at,
      'amount_minor', v_payout.amount_minor
    );
  end if;

  if v_payout.status not in ('planned', 'submitted', 'processing') then
    raise exception 'INVALID_PAYOUT_STATE: Cannot settle payout in status %', v_payout.status
      using errcode = '22023';
  end if;

  -- 3. Double-entry ledger posting
  -- Debit (+): owner_payable (reducing liability to master owner)
  -- Credit (-): gateway_clearing (reducing asset clearing with gateway/bank)
  select id into v_acc_clearing
  from private.ledger_accounts
  where code = 'gateway_clearing' and currency = v_payout.currency;

  v_acc_owner := private.get_or_create_owner_account(v_payout.master_owner_id, 'owner_payable', v_payout.currency);

  v_journal_key := format('payout_settled_%s', coalesce(p_provider_settlement_id, p_payout_id::text));
  v_journal_res := private.post_journal(
    p_event_key => v_journal_key,
    p_event_type => 'payout_settled',
    p_currency => v_payout.currency,
    p_booking_id => null,
    p_entries => jsonb_build_array(
      jsonb_build_object('account_id', v_acc_owner, 'amount_minor', v_payout.amount_minor),
      jsonb_build_object('account_id', v_acc_clearing, 'amount_minor', -v_payout.amount_minor)
    )
  );

  -- 4. Update payout status
  update private.payouts
  set status = 'settled',
      provider_settlement_id = p_provider_settlement_id,
      settled_at = coalesce(p_settled_at, now())
  where id = p_payout_id;

  -- 5. Queue outbox event
  insert into private.outbox_events (
    topic, aggregate_type, aggregate_id, dedupe_key, payload
  ) values (
    'payout.settled', 'payout', p_payout_id,
    format('payout_settled_%s', p_payout_id),
    jsonb_build_object(
      'payout_id', p_payout_id,
      'master_owner_id', v_payout.master_owner_id,
      'amount_minor', v_payout.amount_minor,
      'provider_settlement_id', p_provider_settlement_id,
      'settled_at', coalesce(p_settled_at, now())
    )
  );

  return jsonb_build_object(
    'payout_id', p_payout_id,
    'status', 'settled',
    'provider_settlement_id', p_provider_settlement_id,
    'amount_minor', v_payout.amount_minor,
    'journal_res', v_journal_res
  );
end;
$$;

revoke all on function private.settle_owner_payout(uuid, text, timestamptz) from public;
grant execute on function private.settle_owner_payout(uuid, text, timestamptz) to authenticated, service_role;

-- 7.4 Request Refund (Capacity enforcement under concurrency)
create or replace function private.request_refund(
  p_payment_id uuid,
  p_amount_minor bigint,
  p_reason text,
  p_requested_by uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_payment record;
  v_already_refunded bigint := 0;
  v_available bigint := 0;
  v_idemp_key text;
  v_existing_refund record;
  v_refund_id uuid;
begin
  if p_amount_minor <= 0 then
    raise exception 'INVALID_AMOUNT: Refund amount must be positive' using errcode = '22023';
  end if;

  v_idemp_key := coalesce(p_idempotency_key, format('ref_%s_%s', p_payment_id, gen_random_uuid()));

  -- Check idempotency first
  if p_idempotency_key is not null then
    select * into v_existing_refund
    from private.refunds
    where idempotency_key = p_idempotency_key;

    if v_existing_refund.id is not null then
      return jsonb_build_object(
        'refund_id', v_existing_refund.id,
        'payment_id', v_existing_refund.payment_id,
        'amount_minor', v_existing_refund.amount_minor,
        'status', v_existing_refund.status,
        'is_existing', true
      );
    end if;
  end if;

  -- 1. Lock payment row FOR UPDATE to serialize concurrent refund requests
  select * into v_payment
  from private.payments
  where id = p_payment_id
  for update;

  if v_payment.id is null then
    raise exception 'PAYMENT_NOT_FOUND: Payment % does not exist', p_payment_id using errcode = 'P0002';
  end if;

  if v_payment.status not in ('captured', 'partially_refunded') then
    raise exception 'INVALID_PAYMENT_STATUS: Payment is not in a refundable state (status: %)', v_payment.status
      using errcode = '22023';
  end if;

  -- 2. Compute in-flight and completed refunds
  select coalesce(sum(amount_minor), 0) into v_already_refunded
  from private.refunds
  where payment_id = p_payment_id
    and status in ('requested', 'approved', 'processing', 'succeeded');

  v_available := v_payment.amount_minor - v_already_refunded;

  -- 3. Capacity check
  if p_amount_minor > v_available then
    raise exception 'REFUND_CAPACITY_EXCEEDED: Requested refund amount % exceeds remaining refundable capacity % for payment %',
      p_amount_minor, v_available, p_payment_id
      using errcode = '23514'; -- check_violation
  end if;

  -- 4. Insert refund record
  v_refund_id := gen_random_uuid();
  insert into private.refunds (
    id, payment_id, amount_minor, reason, requested_by, idempotency_key, status
  ) values (
    v_refund_id, p_payment_id, p_amount_minor, p_reason, p_requested_by, v_idemp_key, 'requested'
  );

  -- 5. Emit outbox event
  insert into private.outbox_events (
    topic, aggregate_type, aggregate_id, dedupe_key, payload
  ) values (
    'payment.refund_required', 'refund', v_refund_id,
    format('refund_required_%s', v_refund_id),
    jsonb_build_object(
      'refund_id', v_refund_id,
      'payment_id', p_payment_id,
      'provider_payment_id', v_payment.provider_payment_id,
      'amount_minor', p_amount_minor,
      'reason', p_reason
    )
  );

  return jsonb_build_object(
    'refund_id', v_refund_id,
    'payment_id', p_payment_id,
    'amount_minor', p_amount_minor,
    'status', 'requested',
    'remaining_capacity_minor', v_available - p_amount_minor,
    'is_existing', false
  );
end;
$$;

revoke all on function private.request_refund(uuid, bigint, text, uuid, text) from public;
grant execute on function private.request_refund(uuid, bigint, text, uuid, text) to authenticated, service_role;

-- 7.5 Outbox Worker Lease and Crash Recovery
drop function if exists private.claim_outbox_batch(text, integer, interval);

create or replace function private.claim_outbox_batch(
  p_worker_id text,
  p_batch_size integer default 10,
  p_lease_duration interval default interval '30 seconds',
  p_topic text default null
)
returns table (
  id uuid,
  topic text,
  aggregate_type text,
  aggregate_id uuid,
  dedupe_key text,
  payload jsonb,
  attempts integer
)
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
begin
  return query
  with claimed as (
    select o.id
    from private.outbox_events o
    where o.completed_at is null
      and o.available_at <= now()
      and (o.lease_until is null or o.lease_until < now())
      and (p_topic is null or o.topic = p_topic)
    order by o.created_at asc
    limit p_batch_size
    for update skip locked
  )
  update private.outbox_events o
  set lease_until = now() + p_lease_duration,
      attempts = o.attempts + 1
  from claimed
  where o.id = claimed.id
  returning o.id, o.topic, o.aggregate_type, o.aggregate_id, o.dedupe_key, o.payload, o.attempts;
end;
$$;

revoke all on function private.claim_outbox_batch(text, integer, interval, text) from public;
grant execute on function private.claim_outbox_batch(text, integer, interval, text) to authenticated, service_role;

create or replace function private.complete_outbox_event(
  p_event_id uuid,
  p_worker_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_rows integer;
begin
  update private.outbox_events
  set completed_at = now(),
      lease_until = null
  where id = p_event_id
    and completed_at is null;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function private.complete_outbox_event(uuid, text) from public;
grant execute on function private.complete_outbox_event(uuid, text) to authenticated, service_role;

create or replace function private.fail_outbox_event(
  p_event_id uuid,
  p_error text,
  p_backoff interval default interval '1 minute'
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
begin
  update private.outbox_events
  set last_error = p_error,
      available_at = now() + p_backoff,
      lease_until = null
  where id = p_event_id
    and completed_at is null;

  return found;
end;
$$;

revoke all on function private.fail_outbox_event(uuid, text, interval) from public;
grant execute on function private.fail_outbox_event(uuid, text, interval) to authenticated, service_role;

create or replace function private.is_platform_admin(p_uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public, extensions, auth, pg_temp
as $$
  select exists (
    select 1 from private.platform_admins
    where user_id = p_uid and active = true
  );
$$;

revoke all on function private.is_platform_admin(uuid) from public;
grant execute on function private.is_platform_admin(uuid) to authenticated, service_role;

-- 7.6 Public Financial Summary (Strict RBAC & Tenancy Enforcement)
create or replace function public.get_owner_financial_summary(
  p_master_owner_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean := false;
  v_active_acc record;
  v_unsettled_minor bigint := 0;
  v_planned_minor bigint := 0;
  v_settled_minor bigint := 0;
  v_booking_count integer := 0;
begin
  -- RBAC & Tenancy Enforcement: Only Master Owner or Platform Admin
  if auth.role() <> 'service_role' then
    select (mo.owner_user_id = v_uid) into v_is_owner
    from public.master_owners mo
    where mo.id = p_master_owner_id;

    if not coalesce(v_is_owner, false) and not private.is_platform_admin(v_uid) then
      raise exception 'PERMISSION_DENIED: User is not authorized to access Master Owner financial statements'
        using errcode = '42501';
    end if;
  end if;

  -- 1. Active financial account
  select id, provider, provider_account_id, masked_bank_label, verification_status into v_active_acc
  from private.owner_financial_accounts
  where master_owner_id = p_master_owner_id
    and active = true
  limit 1;

  -- 2. Unsettled confirmed bookings (not yet allocated to any payout)
  select coalesce(sum(b.total_minor - coalesce((b.commission_snapshot->>'estimated_commission_minor')::bigint, round((b.total_minor * 1000) / 10000.0))), 0),
         count(*)
  into v_unsettled_minor, v_booking_count
  from public.bookings b
  where b.master_owner_id = p_master_owner_id
    and b.status = 'confirmed'
    and not exists (
      select 1 from private.payout_allocations pa
      where pa.booking_id = b.id
    );

  -- 3. Planned payouts
  select coalesce(sum(amount_minor), 0) into v_planned_minor
  from private.payouts
  where master_owner_id = p_master_owner_id
    and status in ('planned', 'submitted', 'processing');

  -- 4. Settled payouts
  select coalesce(sum(amount_minor), 0) into v_settled_minor
  from private.payouts
  where master_owner_id = p_master_owner_id
    and status = 'settled';

  return jsonb_build_object(
    'master_owner_id', p_master_owner_id,
    'active_account', case when v_active_acc.id is not null then
      jsonb_build_object(
        'id', v_active_acc.id,
        'provider', v_active_acc.provider,
        'masked_bank_label', v_active_acc.masked_bank_label,
        'verification_status', v_active_acc.verification_status
      )
      else null end,
    'unsettled_payable_minor', v_unsettled_minor,
    'unsettled_booking_count', v_booking_count,
    'planned_payouts_minor', v_planned_minor,
    'settled_payouts_minor', v_settled_minor,
    'currency', 'INR'
  );
end;
$$;

revoke all on function public.get_owner_financial_summary(uuid) from public;
grant execute on function public.get_owner_financial_summary(uuid) to authenticated, service_role;

-- Public wrappers for RPC access
create or replace function public.register_owner_financial_account(
  p_master_owner_id uuid,
  p_provider text,
  p_provider_account_id text,
  p_masked_bank_label text,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean := false;
begin
  if auth.role() <> 'service_role' then
    select (mo.owner_user_id = v_uid) into v_is_owner
    from public.master_owners mo
    where mo.id = p_master_owner_id;

    if not coalesce(v_is_owner, false) and not private.is_platform_admin(v_uid) then
      raise exception 'PERMISSION_DENIED: Only Master Owner can manage financial accounts'
        using errcode = '42501';
    end if;
  end if;

  return private.register_owner_financial_account(
    p_master_owner_id, p_provider, p_provider_account_id, p_masked_bank_label, p_active
  );
end;
$$;

revoke all on function public.register_owner_financial_account(uuid, text, text, text, boolean) from public;
grant execute on function public.register_owner_financial_account(uuid, text, text, text, boolean) to authenticated, service_role;

create or replace function public.plan_owner_payout(
  p_master_owner_id uuid,
  p_period_start timestamptz default null,
  p_period_end timestamptz default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean := false;
begin
  if auth.role() <> 'service_role' then
    select (mo.owner_user_id = v_uid) into v_is_owner
    from public.master_owners mo
    where mo.id = p_master_owner_id;

    if not coalesce(v_is_owner, false) and not private.is_platform_admin(v_uid) then
      raise exception 'PERMISSION_DENIED: Only Master Owner can plan payouts'
        using errcode = '42501';
    end if;
  end if;

  return private.plan_owner_payout(
    p_master_owner_id, p_period_start, p_period_end, p_idempotency_key
  );
end;
$$;

revoke all on function public.plan_owner_payout(uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.plan_owner_payout(uuid, timestamptz, timestamptz, text) to authenticated, service_role;
