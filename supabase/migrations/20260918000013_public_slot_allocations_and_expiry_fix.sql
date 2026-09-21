-- Migration 13: Public Slot Allocations RPC, Expiry Fix, and Pricing Read Permissions
-- Author: Antigravity IDE
-- Date: 2026-09-19

-- 1. get_public_slot_allocations RPC
create or replace function public.get_public_slot_allocations(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns table (
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  select a.starts_at, a.ends_at
  from public.inventory_allocations a
  where a.resource_id = p_resource_id
    and a.released_at is null
    and (a.kind = 'booking' or a.expires_at > now())
    and a.ends_at > p_starts_at
    and a.starts_at < p_ends_at;
$$;

revoke all on function public.get_public_slot_allocations(uuid, timestamptz, timestamptz) from public;
grant execute on function public.get_public_slot_allocations(uuid, timestamptz, timestamptz) to anon, authenticated, service_role;

-- 2. Backfill existing confirmed bookings: clear expires_at so they never expire in slot queries
update public.inventory_allocations
set expires_at = null
where kind = 'booking' and expires_at is not null;

-- 3. Update confirm_booking_payment to clear expires_at on confirmation
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
set search_path = public, private, extensions, auth, pg_temp
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
  v_owner_user_id uuid;
  v_player_notif_id uuid;
  v_owner_notif_id uuid;
begin
  -- 1. Match payment order by provider order ID
  select * into v_order
  from private.payment_orders
  where provider = p_provider
    and provider_order_id = p_provider_order_id
  for update;

  if not found then
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
    if v_payment.status = 'captured' and p_event_type = 'payment.authorized' then
      null;
    elsif p_event_type = 'payment.captured' and v_payment.status <> 'captured' then
      update private.payments
      set status = 'captured',
          captured_at = coalesce(p_captured_at, v_now)
      where id = v_payment_id;
    end if;
  end if;

  -- 4. Authorization event handling
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
  if v_booking.status = 'held' and v_booking.hold_expires_at > v_now then
    -- Confirm booking
    update public.bookings
    set status = 'confirmed',
        confirmed_at = v_now,
        payment_exception_reason = null
    where id = v_booking.id;

    -- Confirm inventory allocation and CLEAR expires_at so it remains permanently locked
    update public.inventory_allocations
    set kind = 'booking',
        expires_at = null
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

    -- Booking event log
    insert into public.booking_events (
      booking_id, event_type, public_summary
    ) values (
      v_booking.id, 'payment_confirmed', format('Payment captured: %s', p_provider_payment_id)
    );

    -- Outbox event for booking confirmation
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

    -- Integration Fix: Dispatch Multi-channel Notifications to Player & Master Owner
    select owner_user_id into v_owner_user_id
    from public.master_owners
    where id = v_booking.master_owner_id;

    if v_booking.player_user_id is not null then
      v_player_notif_id := private.queue_notification(
        v_booking.player_user_id,
        'booking.confirmed',
        'Booking Confirmed!',
        format('Your booking (Ref: %s) is confirmed for ₹%s.', v_booking.reference_code, (p_amount_minor/100)::text),
        format('/bookings/%s', v_booking.id),
        array['push', 'sms', 'email']
      );
    end if;

    if v_owner_user_id is not null then
      v_owner_notif_id := private.queue_notification(
        v_owner_user_id,
        'booking.new_confirmed',
        'New Confirmed Booking',
        format('New booking received (Ref: %s) for ₹%s.', v_booking.reference_code, (p_amount_minor/100)::text),
        format('/owner/bookings/%s', v_booking.id),
        array['push', 'email']
      );
    end if;

    -- Integration Fix: Business Audit Event Logging
    perform private.log_audit_event(
      v_booking.master_owner_id,
      v_booking.turf_id,
      coalesce(v_booking.player_user_id, auth.uid()),
      'gateway',
      'booking.confirm',
      'booking',
      v_booking.id,
      jsonb_build_object('status', 'held'),
      jsonb_build_object('status', 'confirmed', 'payment_id', v_payment_id, 'amount_minor', p_amount_minor),
      format('Payment captured by %s (%s)', p_provider, p_provider_payment_id)
    );

    return jsonb_build_object(
      'status', 'confirmed',
      'booking_id', v_booking.id,
      'payment_id', v_payment_id,
      'journal_status', v_journal_res->>'status',
      'player_notif_id', v_player_notif_id,
      'owner_notif_id', v_owner_notif_id
    );

  -- Scenario B: §7.5 Capture-After-Hold-Expiry Race
  else
    update public.bookings
    set status = 'payment_exception',
        payment_exception_reason = 'Payment captured after hold expiry window'
    where id = v_booking.id;

    -- Post journal for gateway clearing -> exception holding liability
    select id into v_acc_clearing
    from private.ledger_accounts
    where code = 'gateway_clearing' and currency = v_booking.currency;

    select id into v_acc_commission
    from private.ledger_accounts
    where code = 'unearned_revenue' and currency = v_booking.currency;

    v_journal_key := format('pay_exc_%s', p_provider_payment_id);
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

    -- Log exception booking event
    insert into public.booking_events (
      booking_id, event_type, public_summary
    ) values (
      v_booking.id, 'payment_exception', format('Late payment received (%s). Manual refund or slot swap required.', p_provider_payment_id)
    );

    return jsonb_build_object(
      'status', 'payment_exception',
      'booking_id', v_booking.id,
      'payment_id', v_payment_id,
      'reason', 'HOLD_EXPIRED'
    );
  end if;
end;
$$;

revoke all on function private.confirm_booking_payment(text, text, text, bigint, text, text, timestamptz) from public;
grant execute on function private.confirm_booking_payment(text, text, text, bigint, text, text, timestamptz) to authenticated, service_role;

-- 4. Pricing Rules Select Permissions for Catalog "Starting From" Calculation
grant select on public.pricing_rules to anon, authenticated;
drop policy if exists pricing_rules_anon_select on public.pricing_rules;
create policy pricing_rules_anon_select
  on public.pricing_rules for select to anon, authenticated
  using (active = true);
