-- Migration: 20260918000007_payment_orchestration.sql
-- Description: Payment orchestration, gateway order lifecycle, webhook inbox, outbox, refunds, and booking confirmation routines.

-- Add payment_exception_reason column to bookings
alter table public.bookings
  add column if not exists payment_exception_reason text;

-- 1. Payment Orders (Durable payment intents)
create table private.payment_orders (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  master_owner_id uuid not null,
  purpose text not null
    check (purpose in ('initial', 'balance', 'reschedule')),
  provider text not null default 'razorpay',
  provider_order_id text,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'INR',
  status text not null default 'creating'
    check (
      status in (
        'creating', 'ready', 'paid', 'expired',
        'failed', 'creation_unknown'
      )
    ),
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  foreign key (booking_id, master_owner_id)
    references public.bookings(id, master_owner_id) on delete restrict,
  unique (provider, provider_order_id)
);

create index payment_orders_booking_idx
  on private.payment_orders(booking_id, master_owner_id);

-- 2. Payments (Individual gateway transaction records)
create table private.payments (
  id uuid primary key default gen_random_uuid(),
  payment_order_id uuid not null references private.payment_orders(id) on delete restrict,
  provider text not null default 'razorpay',
  provider_payment_id text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'INR',
  status text not null
    check (
      status in (
        'pending', 'authorized', 'captured',
        'failed', 'partially_refunded', 'refunded'
      )
    ),
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_payment_id)
);

create index payments_order_idx
  on private.payments(payment_order_id);

-- 3. Refunds (Automated and manual refunds)
create table private.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references private.payments(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  reason text not null,
  requested_by uuid references public.profiles(user_id),
  approved_by uuid references public.profiles(user_id),
  provider_refund_id text,
  status text not null default 'requested'
    check (
      status in (
        'requested', 'approved', 'processing',
        'succeeded', 'failed', 'unknown', 'rejected'
      )
    ),
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index refunds_payment_idx
  on private.refunds(payment_id);

-- 4. Webhook Events (Durable gateway webhook inbox)
create table private.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'razorpay',
  provider_account_scope text not null default 'standard',
  provider_event_id text not null,
  event_type text not null,
  raw_body text not null,
  body_hash text not null,
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'retryable', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_account_scope, provider_event_id)
);

create index webhook_events_pending_idx
  on private.webhook_events(next_attempt_at)
  where status in ('received', 'retryable');

-- 5. Outbox Events (Durable asynchronous messaging outbox)
create table private.outbox_events (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  dedupe_key text not null unique,
  payload jsonb not null,
  available_at timestamptz not null default now(),
  attempts integer not null default 0,
  lease_until timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index outbox_pending_idx
  on private.outbox_events(available_at)
  where completed_at is null;

-- Revoke write privileges on financial/inbox tables from non-service roles
revoke all on private.payment_orders from public, anon, authenticated;
revoke all on private.payments from public, anon, authenticated;
revoke all on private.refunds from public, anon, authenticated;
revoke all on private.webhook_events from public, anon, authenticated;
revoke all on private.outbox_events from public, anon, authenticated;

grant select on private.payment_orders to authenticated, service_role;
grant select on private.payments to authenticated, service_role;

-- 6. Stored Procedures & State Machines

-- 6.1 Create or Get Payment Order
create or replace function private.create_or_get_payment_order(
  p_booking_id uuid,
  p_idempotency_key text,
  p_purpose text default 'initial'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_booking record;
  v_existing record;
  v_order_id uuid;
  v_amount bigint;
  v_caller uuid := auth.uid();
begin
  if p_idempotency_key is null or trim(p_idempotency_key) = '' then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED: Idempotency key must not be empty' using errcode = '22023';
  end if;

  -- 1. Check existing order by idempotency key
  select * into v_existing
  from private.payment_orders
  where idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'order_id', v_existing.id,
      'provider_order_id', v_existing.provider_order_id,
      'booking_id', v_existing.booking_id,
      'amount_minor', v_existing.amount_minor,
      'currency', v_existing.currency,
      'status', v_existing.status,
      'is_existing', true
    );
  end if;

  -- 2. Validate booking existence and hold status
  select * into v_booking
  from public.bookings
  where id = p_booking_id;

  if not found then
    raise exception 'BOOKING_NOT_FOUND: Booking % does not exist', p_booking_id using errcode = 'P0002';
  end if;

  -- Verify caller ownership (unless service_role/internal)
  if v_caller is not null and v_caller <> v_booking.player_user_id then
    raise exception 'UNAUTHORIZED: Cannot create payment order for another player hold' using errcode = '42501';
  end if;

  if v_booking.status <> 'held' then
    raise exception 'INVALID_BOOKING_STATUS: Booking status is % (must be held)', v_booking.status using errcode = '22023';
  end if;

  if v_booking.hold_expires_at <= now() then
    -- Opportunistically mark expired
    perform private.expire_booking_holds();
    raise exception 'BOOKING_HOLD_EXPIRED: Hold deadline has passed' using errcode = '22023';
  end if;

  -- 3. Check if active order already exists for this booking
  select * into v_existing
  from private.payment_orders
  where booking_id = p_booking_id
    and status in ('creating', 'ready');

  if found then
    return jsonb_build_object(
      'order_id', v_existing.id,
      'provider_order_id', v_existing.provider_order_id,
      'booking_id', v_existing.booking_id,
      'amount_minor', v_existing.amount_minor,
      'currency', v_existing.currency,
      'status', v_existing.status,
      'is_existing', true
    );
  end if;

  -- 4. Compute required payment amount
  if p_purpose = 'initial' then
    v_amount := coalesce(v_booking.required_online_minor, v_booking.total_minor);
  else
    v_amount := v_booking.total_minor - coalesce(v_booking.required_online_minor, 0);
  end if;

  if v_amount <= 0 then
    v_amount := v_booking.total_minor;
  end if;

  -- 5. Insert new payment order in 'creating' state
  v_order_id := gen_random_uuid();
  insert into private.payment_orders (
    id, booking_id, master_owner_id, purpose, provider,
    amount_minor, currency, status, idempotency_key
  ) values (
    v_order_id, v_booking.id, v_booking.master_owner_id, p_purpose, 'razorpay',
    v_amount, v_booking.currency, 'creating', p_idempotency_key
  );

  return jsonb_build_object(
    'order_id', v_order_id,
    'provider_order_id', null,
    'booking_id', v_booking.id,
    'amount_minor', v_amount,
    'currency', v_booking.currency,
    'status', 'creating',
    'is_existing', false
  );
end;
$$;

revoke all on function private.create_or_get_payment_order(uuid, text, text) from public;
grant execute on function private.create_or_get_payment_order(uuid, text, text) to authenticated, service_role;

-- 6.2 Update Payment Order Provider Details
create or replace function private.update_payment_order_provider(
  p_order_id uuid,
  p_provider_order_id text,
  p_status text default 'ready'
)
returns void
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
begin
  update private.payment_orders
  set provider_order_id = p_provider_order_id,
      status = p_status
  where id = p_order_id;
end;
$$;

revoke all on function private.update_payment_order_provider(uuid, text, text) from public;
grant execute on function private.update_payment_order_provider(uuid, text, text) to authenticated, service_role;

-- 6.3 Core Booking Payment Confirmation Routine
create or replace function private.confirm_booking_payment(
  p_provider text,
  p_provider_order_id text,
  p_provider_payment_id text,
  p_amount_minor bigint,
  p_currency text default 'INR',
  p_event_type text default 'payment.captured',
  p_captured_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_order record;
  v_booking record;
  v_payment record;
  v_payment_id uuid;
  v_acc_clearing uuid;
  v_acc_commission uuid;
  v_acc_owner uuid;
  v_commission_minor bigint;
  v_owner_minor bigint;
  v_journal_key text;
  v_journal_res jsonb;
  v_now timestamptz := now();
begin
  -- 1. Match payment order by provider order ID
  select * into v_order
  from private.payment_orders
  where provider = p_provider
    and provider_order_id = p_provider_order_id
  for update;

  if not found then
    -- §2.5 Webhook arrives before order persistence: raise P0002 for retryable handling
    raise exception 'ORDER_NOT_FOUND: Payment order with provider_order_id % not found', p_provider_order_id
      using errcode = 'P0002';
  end if;

  -- 2. Lock the booking record
  select * into v_booking
  from public.bookings
  where id = v_order.booking_id
  for update;

  -- 3. Record or update private.payments record
  select * into v_payment
  from private.payments
  where provider = p_provider
    and provider_payment_id = p_provider_payment_id
  for update;

  if not found then
    v_payment_id := gen_random_uuid();
    insert into private.payments (
      id, payment_order_id, provider, provider_payment_id,
      amount_minor, currency, status, captured_at
    ) values (
      v_payment_id, v_order.id, p_provider, p_provider_payment_id,
      p_amount_minor, coalesce(p_currency, 'INR'),
      case when p_event_type = 'payment.authorized' then 'authorized' else 'captured' end,
      case when p_event_type = 'payment.authorized' then null else coalesce(p_captured_at, v_now) end
    );
  else
    v_payment_id := v_payment.id;
    -- §17.3 Out-of-order handling: if already captured, ignore delayed authorized event
    if v_payment.status = 'captured' and p_event_type = 'payment.authorized' then
      -- Retain captured status, do not downgrade
      null;
    elsif p_event_type = 'payment.captured' and v_payment.status <> 'captured' then
      update private.payments
      set status = 'captured',
          captured_at = coalesce(p_captured_at, v_now)
      where id = v_payment_id;
    end if;
  end if;

  -- 4. If this is an authorization event, stop here (await capture event)
  if p_event_type = 'payment.authorized' and v_booking.status = 'held' then
    return jsonb_build_object(
      'status', 'authorized',
      'booking_id', v_booking.id,
      'payment_id', v_payment_id
    );
  end if;

  -- 5. Check Idempotency: already confirmed?
  if v_booking.status = 'confirmed' and v_order.status = 'paid' then
    return jsonb_build_object(
      'status', 'already_confirmed',
      'booking_id', v_booking.id,
      'payment_id', v_payment_id
    );
  end if;

  -- 6. Evaluate Hold Expiry / Availability Invariants
  -- Scenario A: Booking hold is valid and active (Happy Path)
  if v_booking.status = 'held' and v_booking.hold_expires_at > v_now then
    -- Confirm booking
    update public.bookings
    set status = 'confirmed',
        confirmed_at = v_now,
        payment_exception_reason = null
    where id = v_booking.id;

    -- Confirm inventory allocation
    update public.inventory_allocations
    set kind = 'booking'
    where booking_id = v_booking.id;

    -- Mark payment order paid
    update private.payment_orders
    set status = 'paid'
    where id = v_order.id;

    -- Double-entry ledger journal posting
    select id into v_acc_clearing
    from private.ledger_accounts
    where code = 'gateway_clearing' and currency = v_booking.currency;

    select id into v_acc_commission
    from private.ledger_accounts
    where code = 'platform_commission' and currency = v_booking.currency;

    v_acc_owner := private.get_or_create_owner_account(v_booking.master_owner_id, 'owner_payable', v_booking.currency);

    v_commission_minor := coalesce((v_booking.commission_snapshot->>'estimated_commission_minor')::bigint, round((p_amount_minor * 1000) / 10000.0));
    v_owner_minor := p_amount_minor - v_commission_minor;

    v_journal_key := format('pay_%s_captured', p_provider_payment_id);
    v_journal_res := private.post_journal(
      p_event_key => v_journal_key,
      p_event_type => 'payment_captured',
      p_currency => v_booking.currency,
      p_booking_id => v_booking.id,
      p_entries => jsonb_build_array(
        jsonb_build_object('account_id', v_acc_clearing, 'amount_minor', p_amount_minor),
        jsonb_build_object('account_id', v_acc_owner, 'amount_minor', -v_owner_minor),
        jsonb_build_object('account_id', v_acc_commission, 'amount_minor', -v_commission_minor)
      )
    );

    -- Audit & Outbox events
    insert into public.booking_events (
      booking_id, event_type, public_summary
    ) values (
      v_booking.id, 'payment_confirmed', format('Payment captured: %s', p_provider_payment_id)
    );

    insert into private.outbox_events (
      topic, aggregate_type, aggregate_id, dedupe_key, payload
    ) values (
      'booking.confirmed', 'booking', v_booking.id,
      format('booking_confirmed_%s', v_booking.id),
      jsonb_build_object(
        'booking_id', v_booking.id,
        'master_owner_id', v_booking.master_owner_id,
        'turf_id', v_booking.turf_id,
        'payment_id', v_payment_id,
        'amount_minor', p_amount_minor
      )
    );

    return jsonb_build_object(
      'status', 'confirmed',
      'booking_id', v_booking.id,
      'payment_id', v_payment_id,
      'journal_status', v_journal_res->>'status'
    );

  -- Scenario B: §7.5 Capture-After-Hold-Expiry Race
  -- Hold expired, or already released, or booking not held
  elsif v_booking.status in ('expired', 'held') and (v_booking.hold_expires_at <= v_now or v_booking.status = 'expired') then
    -- Transition booking to payment_exception (NEVER confirm, NEVER displace new customers)
    update public.bookings
    set status = 'payment_exception',
        payment_exception_reason = 'Payment captured after hold expiry (§7.5)'
    where id = v_booking.id;

    -- Ensure allocation is marked released
    update public.inventory_allocations
    set released_at = coalesce(released_at, v_now)
    where booking_id = v_booking.id
      and kind = 'hold'
      and released_at is null;

    -- Post suspense ledger journal (funds entered gateway clearing, credit platform_receivable)
    select id into v_acc_clearing
    from private.ledger_accounts
    where code = 'gateway_clearing' and currency = v_booking.currency;

    select id into v_acc_commission
    from private.ledger_accounts
    where code = 'platform_receivable' and currency = v_booking.currency;

    v_journal_key := format('pay_%s_exception', p_provider_payment_id);
    v_journal_res := private.post_journal(
      p_event_key => v_journal_key,
      p_event_type => 'payment_exception',
      p_currency => v_booking.currency,
      p_booking_id => v_booking.id,
      p_entries => jsonb_build_array(
        jsonb_build_object('account_id', v_acc_clearing, 'amount_minor', p_amount_minor),
        jsonb_build_object('account_id', v_acc_commission, 'amount_minor', -p_amount_minor)
      )
    );

    -- Queue automatic refund in private.refunds
    insert into private.refunds (
      payment_id, amount_minor, reason, status, idempotency_key
    ) values (
      v_payment_id, p_amount_minor, 'Hold expired before payment capture (§7.5)',
      'requested', format('refund_%s', p_provider_payment_id)
    )
    on conflict (idempotency_key) do nothing;

    -- Insert Outbox event for refund processing worker
    insert into private.outbox_events (
      topic, aggregate_type, aggregate_id, dedupe_key, payload
    ) values (
      'payment.refund_required', 'payment', v_payment_id,
      format('refund_required_%s', p_provider_payment_id),
      jsonb_build_object(
        'payment_id', v_payment_id,
        'booking_id', v_booking.id,
        'amount_minor', p_amount_minor,
        'reason', 'Hold expired before payment capture (§7.5)'
      )
    )
    on conflict (dedupe_key) do nothing;

    -- Audit log
    insert into public.booking_events (
      booking_id, event_type, public_summary
    ) values (
      v_booking.id, 'payment_expired_exception',
      format('Late capture received for expired hold: %s. Refund queued.', p_provider_payment_id)
    );

    return jsonb_build_object(
      'status', 'payment_exception',
      'booking_id', v_booking.id,
      'payment_id', v_payment_id,
      'refund_queued', true
    );
  else
    -- Other states (e.g. cancelled)
    update public.bookings
    set status = 'payment_exception',
        payment_exception_reason = format('Payment captured on booking in %s state', v_booking.status)
    where id = v_booking.id;

    return jsonb_build_object(
      'status', 'payment_exception',
      'booking_id', v_booking.id,
      'payment_id', v_payment_id
    );
  end if;
end;
$$;

revoke all on function private.confirm_booking_payment(text, text, text, bigint, text, text, timestamptz) from public;
grant execute on function private.confirm_booking_payment(text, text, text, bigint, text, text, timestamptz) to authenticated, service_role;

-- 6.4 Process Webhook Inbox Event
create or replace function private.process_webhook_event(p_webhook_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_event record;
  v_payload jsonb;
  v_event_type text;
  v_payment_entity jsonb;
  v_provider_order_id text;
  v_provider_payment_id text;
  v_amount bigint;
  v_currency text;
  v_captured_at timestamptz;
  v_confirm_res jsonb;
begin
  select * into v_event
  from private.webhook_events
  where id = p_webhook_event_id
  for update;

  if not found then
    raise exception 'WEBHOOK_EVENT_NOT_FOUND: % not found', p_webhook_event_id using errcode = 'P0002';
  end if;

  if v_event.status = 'processed' then
    return jsonb_build_object('status', 'already_processed', 'id', v_event.id);
  end if;

  update private.webhook_events
  set status = 'processing',
      attempts = attempts + 1
  where id = v_event.id;

  v_payload := v_event.raw_body::jsonb;
  v_event_type := coalesce(v_payload->>'event', v_event.event_type);
  v_payment_entity := v_payload->'payload'->'payment'->'entity';

  if v_payment_entity is null then
    -- Might be order.paid event
    v_provider_order_id := v_payload->'payload'->'order'->'entity'->>'id';
  else
    v_provider_order_id := v_payment_entity->>'order_id';
    v_provider_payment_id := v_payment_entity->>'id';
    v_amount := (v_payment_entity->>'amount')::bigint;
    v_currency := coalesce(v_payment_entity->>'currency', 'INR');
    if v_payment_entity->>'captured_at' is not null then
      v_captured_at := to_timestamp((v_payment_entity->>'captured_at')::bigint);
    end if;
  end if;

  -- Attempt confirmation
  begin
    v_confirm_res := private.confirm_booking_payment(
      p_provider => v_event.provider,
      p_provider_order_id => v_provider_order_id,
      p_provider_payment_id => v_provider_payment_id,
      p_amount_minor => v_amount,
      p_currency => v_currency,
      p_event_type => v_event_type,
      p_captured_at => v_captured_at
    );

    update private.webhook_events
    set status = 'processed',
        processed_at = now(),
        last_error = null
    where id = v_event.id;

    return jsonb_build_object(
      'status', 'processed',
      'result', v_confirm_res
    );

  exception
    when sqlstate 'P0002' then
      -- §2.5 Order not yet persisted: mark retryable with 5-second backoff
      update private.webhook_events
      set status = 'retryable',
          next_attempt_at = now() + interval '5 seconds',
          last_error = SQLERRM
      where id = v_event.id;

      return jsonb_build_object(
        'status', 'retryable',
        'error', SQLERRM
      );

    when others then
      update private.webhook_events
      set status = 'failed',
          last_error = format('%s: %s', SQLSTATE, SQLERRM)
      where id = v_event.id;

      return jsonb_build_object(
        'status', 'failed',
        'error', format('%s: %s', SQLSTATE, SQLERRM)
      );
  end;
end;
$$;

revoke all on function private.process_webhook_event(uuid) from public;
grant execute on function private.process_webhook_event(uuid) to authenticated, service_role;

-- 6.5 Retry Worker for Unprocessed / Retryable Webhooks
create or replace function private.retry_unprocessed_webhooks()
returns integer
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_rec record;
  v_count integer := 0;
begin
  for v_rec in
    select id
    from private.webhook_events
    where status in ('received', 'retryable')
      and next_attempt_at <= now()
    order by received_at asc
    limit 50
  loop
    perform private.process_webhook_event(v_rec.id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function private.retry_unprocessed_webhooks() from public;
grant execute on function private.retry_unprocessed_webhooks() to authenticated, service_role;

-- 6.6 Helper: Persist Webhook Event Inbox Record
create or replace function private.persist_webhook_event(
  p_provider text,
  p_scope text,
  p_event_id text,
  p_event_type text,
  p_raw_body text,
  p_body_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_rec record;
  v_is_new boolean := false;
begin
  select id, status into v_rec
  from private.webhook_events
  where provider = p_provider
    and provider_account_scope = p_scope
    and provider_event_id = p_event_id;

  if not found then
    insert into private.webhook_events (
      provider, provider_account_scope, provider_event_id,
      event_type, raw_body, body_hash, status
    ) values (
      p_provider, p_scope, p_event_id,
      p_event_type, p_raw_body, p_body_hash, 'received'
    ) returning id, status into v_rec;
    v_is_new := true;
  end if;

  return jsonb_build_object(
    'id', v_rec.id,
    'status', v_rec.status,
    'is_new', v_is_new
  );
end;
$$;

revoke all on function private.persist_webhook_event(text, text, text, text, text, text) from public;
grant execute on function private.persist_webhook_event(text, text, text, text, text, text) to authenticated, service_role;

-- 7. Public API Wrappers for PostgREST & Edge Functions (Strictly Authorized)
create or replace function public.create_or_get_payment_order(
  p_booking_id uuid,
  p_idempotency_key text,
  p_purpose text default 'initial'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
begin
  return private.create_or_get_payment_order(p_booking_id, p_idempotency_key, p_purpose);
end;
$$;

revoke all on function public.create_or_get_payment_order(uuid, text, text) from public, anon;
grant execute on function public.create_or_get_payment_order(uuid, text, text) to authenticated, service_role;

create or replace function public.update_payment_order_provider(
  p_order_id uuid,
  p_provider_order_id text,
  p_status text default 'ready'
)
returns void
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
begin
  perform private.update_payment_order_provider(p_order_id, p_provider_order_id, p_status);
end;
$$;

revoke all on function public.update_payment_order_provider(uuid, text, text) from public, anon, authenticated;
grant execute on function public.update_payment_order_provider(uuid, text, text) to service_role;

create or replace function public.persist_webhook_event(
  p_provider text,
  p_scope text,
  p_event_id text,
  p_event_type text,
  p_raw_body text,
  p_body_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
begin
  return private.persist_webhook_event(p_provider, p_scope, p_event_id, p_event_type, p_raw_body, p_body_hash);
end;
$$;

revoke all on function public.persist_webhook_event(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.persist_webhook_event(text, text, text, text, text, text) to service_role;

create or replace function public.process_webhook_event(p_webhook_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
begin
  return private.process_webhook_event(p_webhook_event_id);
end;
$$;

revoke all on function public.process_webhook_event(uuid) from public, anon, authenticated;
grant execute on function public.process_webhook_event(uuid) to service_role;


