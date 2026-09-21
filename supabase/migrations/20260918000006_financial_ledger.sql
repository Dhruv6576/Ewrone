-- Migration: 20260918000006_financial_ledger.sql
-- Description: Immutable double-entry financial ledger, deferred constraint balance trigger, posting and reversal routines.

-- 1. Ledger Accounts (Chart of Accounts)
create table private.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  master_owner_id uuid references public.master_owners(id) on delete restrict,
  code text not null,
  currency text not null default 'INR',
  description text,
  created_at timestamptz not null default now(),
  unique (id, currency)
);

create unique index ledger_owner_account_unique
  on private.ledger_accounts(master_owner_id, code, currency)
  where master_owner_id is not null;

create unique index ledger_platform_account_unique
  on private.ledger_accounts(code, currency)
  where master_owner_id is null;

-- Seed Platform Accounts
insert into private.ledger_accounts (master_owner_id, code, currency, description) values
  (null, 'gateway_clearing', 'INR', 'Asset: Funds captured and clearing through payment gateway'),
  (null, 'platform_commission', 'INR', 'Revenue: Platform commission earnings'),
  (null, 'platform_receivable', 'INR', 'Asset: Platform receivables from owners/gateways');

-- 2. Ledger Journals (Header records with event idempotency)
create table private.ledger_journals (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  currency text not null default 'INR',
  booking_id uuid references public.bookings(id) on delete set null,
  reversal_of uuid references private.ledger_journals(id) on delete restrict,
  posted_at timestamptz not null default now(),
  unique (id, currency)
);

-- 3. Ledger Entries (Debit/Credit line items: positive = debit, negative = credit)
create table private.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null,
  account_id uuid not null,
  currency text not null default 'INR',
  amount_minor bigint not null check (amount_minor <> 0),
  created_at timestamptz not null default now(),
  foreign key (journal_id, currency)
    references private.ledger_journals(id, currency) on delete restrict,
  foreign key (account_id, currency)
    references private.ledger_accounts(id, currency) on delete restrict
);

create index ledger_entries_account_idx
  on private.ledger_entries(account_id, journal_id);

-- 4. True Database-Level Immutability Enforcement (Triggers + Privileges)
create or replace function private.prevent_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'LEDGER_IMMUTABLE: Financial ledger records are strictly append-only and cannot be updated or deleted. Use private.reverse_journal for corrections.'
    using errcode = '55000'; -- object_not_in_prerequisite_state
end;
$$;

create trigger trg_immutable_ledger_journals
  before update or delete on private.ledger_journals
  for each row execute function private.prevent_ledger_mutation();

create trigger trg_immutable_ledger_entries
  before update or delete on private.ledger_entries
  for each row execute function private.prevent_ledger_mutation();

-- Revoke write privileges from public, anon, and authenticated
revoke all on private.ledger_accounts from public, anon, authenticated;
revoke all on private.ledger_journals from public, anon, authenticated;
revoke all on private.ledger_entries from public, anon, authenticated;

-- 5. Deferred Constraint Balance Trigger Functions
-- Function checking a specific journal balance
create or replace function private.check_journal_balance_record(p_journal_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_count integer;
  v_sum bigint;
begin
  select count(*), coalesce(sum(amount_minor), 0)
  into v_count, v_sum
  from private.ledger_entries
  where journal_id = p_journal_id;

  if v_count < 2 then
    raise exception 'LEDGER_UNBALANCED: Journal % must have at least 2 entries (found %)',
      p_journal_id, v_count using errcode = '23514'; -- check_violation
  end if;

  if v_sum <> 0 then
    raise exception 'LEDGER_UNBALANCED: Journal % entries do not balance to zero (net sum = %)',
      p_journal_id, v_sum using errcode = '23514'; -- check_violation
  end if;
end;
$$;

-- Deferred constraint trigger function for ledger_journals
create or replace function private.trg_check_ledger_journal_balance()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
begin
  perform private.check_journal_balance_record(new.id);
  return new;
end;
$$;

-- Deferred constraint trigger function for ledger_entries
create or replace function private.trg_check_ledger_entry_balance()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_jid uuid;
begin
  if tg_op = 'DELETE' then
    v_jid := old.journal_id;
  else
    v_jid := new.journal_id;
  end if;

  perform private.check_journal_balance_record(v_jid);

  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$;

-- Attach Deferred Constraint Triggers
create constraint trigger trg_enforce_journal_balance
  after insert on private.ledger_journals
  deferrable initially deferred
  for each row execute function private.trg_check_ledger_journal_balance();

create constraint trigger trg_enforce_entry_balance
  after insert on private.ledger_entries
  deferrable initially deferred
  for each row execute function private.trg_check_ledger_entry_balance();

-- 6. Helper: Get or Create Owner Account
create or replace function private.get_or_create_owner_account(
  p_master_owner_id uuid,
  p_code text,
  p_currency text default 'INR'
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_acc_id uuid;
begin
  select id into v_acc_id
  from private.ledger_accounts
  where master_owner_id = p_master_owner_id
    and code = p_code
    and currency = p_currency;

  if not found then
    insert into private.ledger_accounts (master_owner_id, code, currency, description)
    values (p_master_owner_id, p_code, p_currency, 'Owner account for ' || p_code)
    returning id into v_acc_id;
  end if;

  return v_acc_id;
end;
$$;

revoke all on function private.get_or_create_owner_account(uuid, text, text) from public;
grant execute on function private.get_or_create_owner_account(uuid, text, text) to authenticated, service_role;

-- 7. Authoritative post_journal RPC
create or replace function private.post_journal(
  p_event_key text,
  p_event_type text,
  p_currency text,
  p_booking_id uuid,
  p_entries jsonb,
  p_reversal_of uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_existing record;
  v_journal_id uuid;
  v_entry record;
  v_count integer := 0;
begin
  if p_event_key is null or trim(p_event_key) = '' then
    raise exception 'EVENT_KEY_REQUIRED: Event key is required for ledger idempotency' using errcode = '22023';
  end if;

  -- 1. Check existing event_key
  select id, event_key, event_type, currency, posted_at into v_existing
  from private.ledger_journals
  where event_key = p_event_key;

  if found then
    return jsonb_build_object(
      'journal_id', v_existing.id,
      'event_key', v_existing.event_key,
      'status', 'already_posted',
      'posted_at', v_existing.posted_at
    );
  end if;

  -- 2. Insert Journal header
  v_journal_id := gen_random_uuid();
  begin
    insert into private.ledger_journals (
      id, event_key, event_type, currency, booking_id, reversal_of
    ) values (
      v_journal_id, p_event_key, p_event_type, coalesce(p_currency, 'INR'), p_booking_id, p_reversal_of
    );
  exception
    when unique_violation then
      -- Concurrent insertion race: return the already posted journal
      select id, event_key, event_type, currency, posted_at into v_existing
      from private.ledger_journals
      where event_key = p_event_key;

      return jsonb_build_object(
        'journal_id', v_existing.id,
        'event_key', v_existing.event_key,
        'status', 'already_posted',
        'posted_at', v_existing.posted_at
      );
  end;

  -- 3. Insert entries
  for v_entry in select * from jsonb_to_recordset(p_entries) as (account_id uuid, amount_minor bigint) loop
    if v_entry.amount_minor = 0 then
      raise exception 'ZERO_AMOUNT_ENTRY: Ledger entries must be non-zero' using errcode = '22023';
    end if;

    insert into private.ledger_entries (
      journal_id, account_id, currency, amount_minor
    ) values (
      v_journal_id, v_entry.account_id, coalesce(p_currency, 'INR'), v_entry.amount_minor
    );

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'journal_id', v_journal_id,
    'event_key', p_event_key,
    'status', 'posted',
    'entry_count', v_count,
    'posted_at', now()
  );
end;
$$;

revoke all on function private.post_journal(text, text, text, uuid, jsonb, uuid) from public;
grant execute on function private.post_journal(text, text, text, uuid, jsonb, uuid) to authenticated, service_role;

-- 8. Reversal Journal Routine
create or replace function private.reverse_journal(
  p_journal_id uuid,
  p_reversal_event_key text,
  p_reason text default 'Correction Reversal'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_orig record;
  v_reversal_entries jsonb := '[]'::jsonb;
  v_entry record;
  v_result jsonb;
begin
  select * into v_orig
  from private.ledger_journals
  where id = p_journal_id;

  if not found then
    raise exception 'JOURNAL_NOT_FOUND: Journal % not found', p_journal_id using errcode = 'P0002';
  end if;

  -- Invert signs: positive -> negative, negative -> positive
  for v_entry in
    select account_id, amount_minor
    from private.ledger_entries
    where journal_id = p_journal_id
  loop
    v_reversal_entries := v_reversal_entries || jsonb_build_object(
      'account_id', v_entry.account_id,
      'amount_minor', -v_entry.amount_minor
    );
  end loop;

  v_result := private.post_journal(
    p_event_key => p_reversal_event_key,
    p_event_type => 'reversal',
    p_currency => v_orig.currency,
    p_booking_id => v_orig.booking_id,
    p_entries => v_reversal_entries,
    p_reversal_of => p_journal_id
  );

  return v_result;
end;
$$;

revoke all on function private.reverse_journal(uuid, text, text) from public;
grant execute on function private.reverse_journal(uuid, text, text) to authenticated, service_role;

-- 9. Row Level Security
alter table private.ledger_accounts enable row level security;
alter table private.ledger_journals enable row level security;
alter table private.ledger_entries enable row level security;
