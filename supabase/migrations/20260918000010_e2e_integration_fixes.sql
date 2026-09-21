-- Migration: 20260918000010_e2e_integration_fixes.sql
-- Description: Milestone 10 Integration Fixes: Cross-milestone wiring for booking cancellation, payment confirmation notifications & audit, and payout planning on retained revenue.

-- 1. Update private.confirm_booking_payment to queue notifications to player & owner, and log to private.audit_events
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

-- 2. Core Booking Cancellation RPC (public.cancel_booking)
create or replace function public.cancel_booking(
  p_booking_id uuid,
  p_reason text default 'Player requested cancellation'
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, auth, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_booking record;
  v_payment record;
  v_hours_before numeric;
  v_refund_percent integer := 0;
  v_tier record;
  v_rules jsonb;
  v_refund_minor bigint := 0;
  v_retained_minor bigint := 0;
  v_owner_user_id uuid;
  v_refund_id uuid;
  v_acc_clearing uuid;
  v_acc_owner uuid;
  v_journal_res jsonb;
  v_notif_player_id uuid;
  v_notif_owner_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: Authentication required' using errcode = '42501';
  end if;

  -- 1. Lock the booking
  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if v_booking.id is null then
    raise exception 'BOOKING_NOT_FOUND: Booking % does not exist', p_booking_id using errcode = 'P0002';
  end if;

  -- Authorization check: caller must be player or have bookings.cancel capability
  if v_booking.player_user_id <> v_uid then
    if not private.can_turf(v_uid, v_booking.turf_id, 'bookings.cancel') and not private.is_platform_admin(v_uid) then
      raise exception 'PERMISSION_DENIED: Caller cannot cancel this booking' using errcode = '42501';
    end if;
  end if;

  if v_booking.status <> 'confirmed' then
    raise exception 'INVALID_BOOKING_STATUS: Only confirmed bookings can be cancelled (current: %)', v_booking.status
      using errcode = '22023';
  end if;

  -- 2. Evaluate cancellation policy rules
  v_hours_before := extract(epoch from (v_booking.starts_at - now())) / 3600.0;
  v_rules := v_booking.cancellation_snapshot->'rules';

  -- Default to 0% if no matching tier found
  v_refund_percent := 0;

  if v_rules is not null and jsonb_array_length(v_rules) > 0 then
    for v_tier in
      select (elem->>'hours_before')::numeric as hours_before,
             (elem->>'refund_percent')::integer as refund_percent
      from jsonb_array_elements(v_rules) as elem
      order by (elem->>'hours_before')::numeric desc
    loop
      if v_hours_before >= v_tier.hours_before then
        v_refund_percent := v_tier.refund_percent;
        exit; -- Take the highest applicable tier
      end if;
    end loop;
  end if;

  v_refund_minor := round((v_booking.total_minor * v_refund_percent) / 100.0);
  v_retained_minor := v_booking.total_minor - v_refund_minor;

  -- 3. Transition booking status
  update public.bookings
  set status = 'cancelled',
      cancelled_at = now()
  where id = v_booking.id;

  -- Release inventory allocation
  update public.inventory_allocations
  set released_at = now()
  where booking_id = v_booking.id;

  -- 4. Process Refund if applicable
  if v_refund_minor > 0 then
    select p.* into v_payment
    from private.payments p
    join private.payment_orders po on po.id = p.payment_order_id
    where po.booking_id = v_booking.id
      and p.status = 'captured'
    order by p.captured_at desc
    limit 1;

    if v_payment.id is not null then
      -- Call request_refund
      v_refund_id := gen_random_uuid();
      insert into private.refunds (
        id, payment_id, amount_minor, reason, requested_by, idempotency_key, status, completed_at
      ) values (
        v_refund_id, v_payment.id, v_refund_minor, p_reason, v_uid,
        format('cancel_ref_%s', v_booking.id), 'succeeded', now()
      );

      -- Update payment status if partial or full
      if v_refund_minor >= v_payment.amount_minor then
        update private.payments set status = 'refunded' where id = v_payment.id;
      else
        update private.payments set status = 'partially_refunded' where id = v_payment.id;
      end if;

      -- Post ledger refund journal:
      -- Debit (+): owner_payable (reducing liability to owner for refunded amount)
      -- Credit (-): gateway_clearing (reducing gateway asset clearing)
      select id into v_acc_clearing
      from private.ledger_accounts
      where code = 'gateway_clearing' and currency = v_booking.currency;

      v_acc_owner := private.get_or_create_owner_account(v_booking.master_owner_id, 'owner_payable', v_booking.currency);

      v_journal_res := private.post_journal(
        p_event_key => format('cancel_refund_%s', v_refund_id),
        p_event_type => 'refund_processed',
        p_currency => v_booking.currency,
        p_booking_id => v_booking.id,
        p_entries => jsonb_build_array(
          jsonb_build_object('account_id', v_acc_owner, 'amount_minor', v_refund_minor),
          jsonb_build_object('account_id', v_acc_clearing, 'amount_minor', -v_refund_minor)
        )
      );
    end if;
  end if;

  -- 5. Notifications to Player & Owner
  select owner_user_id into v_owner_user_id
  from public.master_owners
  where id = v_booking.master_owner_id;

  if v_booking.player_user_id is not null then
    v_notif_player_id := private.queue_notification(
      v_booking.player_user_id,
      'booking.cancelled',
      'Booking Cancelled',
      format('Your booking %s has been cancelled. Refund amount: ₹%s (%s%%).',
        v_booking.reference_code, (v_refund_minor / 100)::text, v_refund_percent::text),
      format('/bookings/%s', v_booking.id),
      array['push', 'sms', 'email']
    );
  end if;

  if v_owner_user_id is not null then
    v_notif_owner_id := private.queue_notification(
      v_owner_user_id,
      'booking.cancelled',
      'Booking Cancelled by Player',
      format('Booking %s was cancelled. Retained revenue: ₹%s.',
        v_booking.reference_code, (v_retained_minor / 100)::text),
      format('/owner/bookings/%s', v_booking.id),
      array['push', 'email']
    );
  end if;

  -- 6. Log Audit Event
  perform private.log_audit_event(
    v_booking.master_owner_id,
    v_booking.turf_id,
    v_uid,
    'user',
    'booking.cancel',
    'booking',
    v_booking.id,
    jsonb_build_object('status', 'confirmed'),
    jsonb_build_object(
      'status', 'cancelled',
      'refund_minor', v_refund_minor,
      'refund_percent', v_refund_percent,
      'retained_minor', v_retained_minor
    ),
    p_reason
  );

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'status', 'cancelled',
    'refund_percent', v_refund_percent,
    'refund_amount_minor', v_refund_minor,
    'retained_revenue_minor', v_retained_minor,
    'player_notif_id', v_notif_player_id,
    'owner_notif_id', v_notif_owner_id
  );
end;
$$;

revoke all on function public.cancel_booking from public;
grant execute on function public.cancel_booking to authenticated, service_role;

-- 3. Update private.plan_owner_payout to include cancelled bookings with retained net revenue
create or replace function private.plan_owner_payout(
  p_master_owner_id uuid,
  p_period_start timestamptz default null,
  p_period_end timestamptz default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, auth, pg_temp
as $$
declare
  v_acc record;
  v_payout_id uuid;
  v_idemp_key text;
  v_total_minor bigint := 0;
  v_count integer := 0;
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

  -- 2. Calculate eligible bookings sum across confirmed and cancelled bookings with net retained revenue
  with eligible as (
    select b.id as booking_id,
           (
             b.total_minor 
             - coalesce((b.commission_snapshot->>'estimated_commission_minor')::bigint, round((b.total_minor * 1000) / 10000.0))
             - coalesce((
                 select sum(r.amount_minor)
                 from private.refunds r
                 join private.payments p on p.id = r.payment_id
                 join private.payment_orders po on po.id = p.payment_order_id
                 where po.booking_id = b.id and r.status in ('requested', 'approved', 'processing', 'succeeded')
               ), 0)
           ) as payable_minor
    from public.bookings b
    where b.master_owner_id = p_master_owner_id
      and b.status in ('confirmed', 'cancelled')
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

  -- 3. Insert payout header
  insert into private.payouts (
    id, master_owner_id, financial_account_id, currency,
    amount_minor, status, idempotency_key, period_start, period_end
  ) values (
    v_payout_id, p_master_owner_id, v_acc.id, 'INR',
    v_total_minor, 'planned', v_idemp_key, p_period_start, p_period_end
  );

  -- 4. Insert allocation line-items
  insert into private.payout_allocations (
    payout_id, master_owner_id, booking_id, amount_minor
  )
  select v_payout_id,
         p_master_owner_id,
         b.id,
         (
           b.total_minor 
           - coalesce((b.commission_snapshot->>'estimated_commission_minor')::bigint, round((b.total_minor * 1000) / 10000.0))
           - coalesce((
               select sum(r.amount_minor)
               from private.refunds r
               join private.payments p on p.id = r.payment_id
               join private.payment_orders po on po.id = p.payment_order_id
               where po.booking_id = b.id and r.status in ('requested', 'approved', 'processing', 'succeeded')
             ), 0)
         )
  from public.bookings b
  where b.master_owner_id = p_master_owner_id
    and b.status in ('confirmed', 'cancelled')
    and (p_period_start is null or b.starts_at >= p_period_start)
    and (p_period_end is null or b.starts_at <= p_period_end)
    and not exists (
      select 1 from private.payout_allocations pa
      where pa.booking_id = b.id
    )
    and (
      b.total_minor 
      - coalesce((b.commission_snapshot->>'estimated_commission_minor')::bigint, round((b.total_minor * 1000) / 10000.0))
      - coalesce((
          select sum(r.amount_minor)
          from private.refunds r
          join private.payments p on p.id = r.payment_id
          join private.payment_orders po on po.id = p.payment_order_id
          where po.booking_id = b.id and r.status in ('requested', 'approved', 'processing', 'succeeded')
        ), 0)
    ) > 0;

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
      'allocated_count', v_count
    )
  );

  -- 6. Log Audit Event
  perform private.log_audit_event(
    p_master_owner_id,
    null,
    auth.uid(),
    'user',
    'payout.plan',
    'payout',
    v_payout_id,
    null,
    jsonb_build_object('amount_minor', v_total_minor, 'status', 'planned', 'allocated_count', v_count),
    'Payout batch planned'
  );

  return jsonb_build_object(
    'payout_id', v_payout_id,
    'status', 'planned',
    'amount_minor', v_total_minor,
    'allocated_bookings', v_count
  );
end;
$$;

-- 4. Update private.settle_owner_payout to log audit events
create or replace function private.settle_owner_payout(
  p_payout_id uuid,
  p_provider_settlement_id text,
  p_settled_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, auth, pg_temp
as $$
declare
  v_payout record;
  v_acc_clearing uuid;
  v_acc_owner uuid;
  v_journal_key text;
  v_journal_res jsonb;
begin
  -- 1. Lock payout row
  select * into v_payout
  from private.payouts
  where id = p_payout_id
  for update;

  if v_payout.id is null then
    raise exception 'PAYOUT_NOT_FOUND: Payout % does not exist', p_payout_id using errcode = 'P0002';
  end if;

  if v_payout.status = 'settled' then
    return jsonb_build_object(
      'payout_id', p_payout_id,
      'status', 'already_settled',
      'provider_settlement_id', v_payout.provider_settlement_id,
      'amount_minor', v_payout.amount_minor
    );
  end if;

  if v_payout.status not in ('planned', 'submitted', 'processing') then
    raise exception 'INVALID_PAYOUT_STATUS: Payout is in invalid state % for settlement', v_payout.status
      using errcode = '22023';
  end if;

  -- 2. Double-entry ledger posting
  -- Debit (+): owner_payable
  -- Credit (-): gateway_clearing
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

  -- 3. Update payout status
  update private.payouts
  set status = 'settled',
      provider_settlement_id = p_provider_settlement_id,
      settled_at = coalesce(p_settled_at, now())
  where id = p_payout_id;

  -- 4. Queue outbox event
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

  -- 5. Audit event logging
  perform private.log_audit_event(
    v_payout.master_owner_id,
    null,
    auth.uid(),
    'system',
    'payout.settle',
    'payout',
    p_payout_id,
    jsonb_build_object('status', 'planned'),
    jsonb_build_object('status', 'settled', 'provider_settlement_id', p_provider_settlement_id, 'amount_minor', v_payout.amount_minor),
    'Payout settlement completed'
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

-- 5. Update public.get_owner_financial_summary to match
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
  if auth.role() <> 'service_role' then
    select (mo.owner_user_id = v_uid) into v_is_owner
    from public.master_owners mo
    where mo.id = p_master_owner_id;

    if not coalesce(v_is_owner, false) and not private.is_platform_admin(v_uid) then
      raise exception 'PERMISSION_DENIED: User is not authorized to access Master Owner financial statements'
        using errcode = '42501';
    end if;
  end if;

  select id, provider, provider_account_id, masked_bank_label, verification_status into v_active_acc
  from private.owner_financial_accounts
  where master_owner_id = p_master_owner_id
    and active = true
  limit 1;

  select coalesce(sum(
    b.total_minor 
    - coalesce((b.commission_snapshot->>'estimated_commission_minor')::bigint, round((b.total_minor * 1000) / 10000.0))
    - coalesce((
        select sum(r.amount_minor)
        from private.refunds r
        join private.payments p on p.id = r.payment_id
        join private.payment_orders po on po.id = p.payment_order_id
        where po.booking_id = b.id and r.status in ('requested', 'approved', 'processing', 'succeeded')
      ), 0)
  ), 0),
  count(*)
  into v_unsettled_minor, v_booking_count
  from public.bookings b
  where b.master_owner_id = p_master_owner_id
    and b.status in ('confirmed', 'cancelled')
    and not exists (
      select 1 from private.payout_allocations pa
      where pa.booking_id = b.id
    )
    and (
      b.total_minor 
      - coalesce((b.commission_snapshot->>'estimated_commission_minor')::bigint, round((b.total_minor * 1000) / 10000.0))
      - coalesce((
          select sum(r.amount_minor)
          from private.refunds r
          join private.payments p on p.id = r.payment_id
          join private.payment_orders po on po.id = p.payment_order_id
          where po.booking_id = b.id and r.status in ('requested', 'approved', 'processing', 'succeeded')
        ), 0)
    ) > 0;

  select coalesce(sum(amount_minor), 0) into v_planned_minor
  from private.payouts
  where master_owner_id = p_master_owner_id
    and status in ('planned', 'submitted', 'processing');

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

-- 6. Update public.get_owner_dashboard to report net retained revenue from cancelled bookings
create or replace function public.get_owner_dashboard(
  p_master_owner_id uuid,
  p_start_date date default null,
  p_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_is_admin boolean;
  v_start date := coalesce(p_start_date, (current_date - interval '30 days')::date);
  v_end date := coalesce(p_end_date, current_date);
  v_summary jsonb;
  v_turfs jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: Authentication required' using errcode = '42501';
  end if;

  v_is_admin := private.is_platform_admin(v_uid);
  select exists (
    select 1 from public.master_owners where id = p_master_owner_id and owner_user_id = v_uid
  ) into v_is_owner;

  if not v_is_admin and not v_is_owner then
    raise exception 'PERMISSION_DENIED: Caller is not authorized to view dashboard for owner %', p_master_owner_id
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total_bookings', coalesce(count(b.id), 0),
    'confirmed_bookings', coalesce(count(b.id) filter (where b.status = 'confirmed'), 0),
    'cancelled_bookings', coalesce(count(b.id) filter (where b.status = 'cancelled'), 0),
    'gross_booking_minor', coalesce(sum(b.total_minor) filter (where b.status in ('confirmed', 'cancelled')), 0),
    'commission_minor', coalesce(sum(coalesce((b.commission_snapshot->>'estimated_commission_minor')::bigint, 0)) filter (where b.status in ('confirmed', 'cancelled')), 0),
    'net_owner_minor', coalesce(sum(
      b.total_minor 
      - coalesce((b.commission_snapshot->>'estimated_commission_minor')::bigint, 0)
      - coalesce((
          select sum(r.amount_minor)
          from private.refunds r
          join private.payments p on p.id = r.payment_id
          join private.payment_orders po on po.id = p.payment_order_id
          where po.booking_id = b.id and r.status in ('requested', 'approved', 'processing', 'succeeded')
        ), 0)
    ) filter (where b.status in ('confirmed', 'cancelled')), 0)
  ) into v_summary
  from public.bookings b
  where b.master_owner_id = p_master_owner_id
    and b.created_at::date between v_start and v_end;

  select coalesce(jsonb_agg(turf_data), '[]'::jsonb) into v_turfs
  from (
    select jsonb_build_object(
      'turf_id', t.id,
      'turf_name', t.name,
      'approval_status', t.approval_status,
      'bookings_count', count(b.id) filter (where b.status in ('confirmed', 'cancelled')),
      'gross_minor', coalesce(sum(b.total_minor) filter (where b.status in ('confirmed', 'cancelled')), 0),
      'net_minor', coalesce(sum(
        b.total_minor 
        - coalesce((b.commission_snapshot->>'estimated_commission_minor')::bigint, 0)
        - coalesce((
            select sum(r.amount_minor)
            from private.refunds r
            join private.payments p on p.id = r.payment_id
            join private.payment_orders po on po.id = p.payment_order_id
            where po.booking_id = b.id and r.status in ('requested', 'approved', 'processing', 'succeeded')
          ), 0)
      ) filter (where b.status in ('confirmed', 'cancelled')), 0)
    ) as turf_data
    from public.turfs t
    left join public.bookings b on b.turf_id = t.id and b.created_at::date between v_start and v_end
    where t.master_owner_id = p_master_owner_id
    group by t.id, t.name, t.approval_status
    order by t.name
  ) s;

  return jsonb_build_object(
    'master_owner_id', p_master_owner_id,
    'start_date', v_start,
    'end_date', v_end,
    'summary', v_summary,
    'turfs', v_turfs
  );
end;
$$;

-- 7. Update public.get_owner_statement to scope ledger balances strictly to the tenant's journals
create or replace function public.get_owner_statement(
  p_master_owner_id uuid,
  p_start_date date default null,
  p_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_is_admin boolean;
  v_start date := coalesce(p_start_date, (current_date - interval '30 days')::date);
  v_end date := coalesce(p_end_date, current_date);
  v_gateway_balance bigint;
  v_payable_balance bigint;
  v_commission_balance bigint;
  v_settled_minor bigint;
  v_planned_minor bigint;
  v_outstanding_minor bigint;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: Authentication required' using errcode = '42501';
  end if;

  v_is_admin := private.is_platform_admin(v_uid);
  select exists (
    select 1 from public.master_owners where id = p_master_owner_id and owner_user_id = v_uid
  ) into v_is_owner;

  -- Cross-Tenant Isolation:
  if not v_is_admin and not v_is_owner then
    raise exception 'PERMISSION_DENIED: Caller is not authorized to view statement for owner %', p_master_owner_id
      using errcode = '42501';
  end if;

  -- Fetch double-entry ledger balances strictly scoped to this tenant's financial transactions:
  -- Every journal impacting a master owner contains an entry in that owner's owner_payable account
  with tenant_journals as (
    select distinct e.journal_id
    from private.ledger_entries e
    join private.ledger_accounts a on a.id = e.account_id
    where a.master_owner_id = p_master_owner_id
  )
  select
    coalesce(sum(case when a.code = 'gateway_clearing' then e.amount_minor else 0 end), 0),
    coalesce(sum(case when a.code = 'owner_payable' and a.master_owner_id = p_master_owner_id then e.amount_minor else 0 end), 0),
    coalesce(sum(case when a.code = 'platform_commission' then e.amount_minor else 0 end), 0)
  into v_gateway_balance, v_payable_balance, v_commission_balance
  from private.ledger_entries e
  join private.ledger_accounts a on a.id = e.account_id
  join tenant_journals tj on tj.journal_id = e.journal_id;

  -- Payouts
  select coalesce(sum(amount_minor), 0) into v_settled_minor
  from private.payouts
  where master_owner_id = p_master_owner_id and status = 'settled';

  select coalesce(sum(amount_minor), 0) into v_planned_minor
  from private.payouts
  where master_owner_id = p_master_owner_id and status in ('planned', 'submitted', 'processing');

  -- Outstanding payable is the credit balance on owner_payable
  v_outstanding_minor := abs(v_payable_balance);

  return jsonb_build_object(
    'master_owner_id', p_master_owner_id,
    'start_date', v_start,
    'end_date', v_end,
    'ledger_balances', jsonb_build_object(
      'owner_payable_net', v_payable_balance,
      'gateway_clearing_net', v_gateway_balance,
      'platform_commission_net', v_commission_balance
    ),
    'payouts', jsonb_build_object(
      'settled_minor', v_settled_minor,
      'planned_in_flight_minor', v_planned_minor,
      'outstanding_payable_minor', v_outstanding_minor
    )
  );
end;
$$;

revoke all on function public.get_owner_statement from public;
grant execute on function public.get_owner_statement to authenticated, service_role;

