-- Migration: 20260918000015_payout_source_and_walkin_ledger.sql
-- Description: Scope payout eligibility strictly to online bookings (b.source = 'online'),
--              bifurcate owner_payable net sign in get_owner_statement, apply date filtering
--              to ledger journals, add source_breakdown to get_owner_dashboard, and implement
--              Phase 2 owner RPCs: create_walkin_booking, upsert_pricing_rule, invite_employee,
--              get_pending_employee_invites, accept_employee_invite, and update_employee_assignments.
-- NOTE: Migration 08 definitions are dead code superseded by migration 10;
--       this migration strictly patches current live definitions.

-- 1. Redefine private.plan_owner_payout (b.source = 'online' in CTE & allocations insert)
CREATE OR REPLACE FUNCTION private.plan_owner_payout(p_master_owner_id uuid, p_period_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_period_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions', 'auth', 'pg_temp'
AS $function$
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
      and b.source = 'online'
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
    and b.source = 'online'
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
$function$;

revoke all on function private.plan_owner_payout from public;
grant execute on function private.plan_owner_payout to authenticated, service_role;

-- 2. Redefine public.get_owner_financial_summary (b.source = 'online')
CREATE OR REPLACE FUNCTION public.get_owner_financial_summary(p_master_owner_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'auth', 'pg_temp'
AS $function$
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
    and b.source = 'online'
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
$function$;

revoke all on function public.get_owner_financial_summary from public;
grant execute on function public.get_owner_financial_summary to authenticated, service_role;

-- 3. Redefine public.get_owner_statement (date filtering on ledger journals and sign bifurcation)
CREATE OR REPLACE FUNCTION public.get_owner_statement(p_master_owner_id uuid, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
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
  v_outstanding_payable_minor bigint;
  v_owner_receivable_minor bigint;
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
    join private.ledger_journals j on j.id = e.journal_id
    where a.master_owner_id = p_master_owner_id
      and j.posted_at::date between v_start and v_end
  )
  select
    coalesce(sum(case when a.code = 'gateway_clearing' then e.amount_minor else 0 end), 0),
    coalesce(sum(case when a.code = 'owner_payable' and a.master_owner_id = p_master_owner_id then e.amount_minor else 0 end), 0),
    coalesce(sum(case when a.code = 'platform_commission' then e.amount_minor else 0 end), 0)
  into v_gateway_balance, v_payable_balance, v_commission_balance
  from private.ledger_entries e
  join private.ledger_accounts a on a.id = e.account_id
  join tenant_journals tj on tj.journal_id = e.journal_id;

  -- Payouts (filtered by date range)
  select coalesce(sum(amount_minor), 0) into v_settled_minor
  from private.payouts
  where master_owner_id = p_master_owner_id and status = 'settled'
    and created_at::date between v_start and v_end;

  select coalesce(sum(amount_minor), 0) into v_planned_minor
  from private.payouts
  where master_owner_id = p_master_owner_id and status in ('planned', 'submitted', 'processing')
    and created_at::date between v_start and v_end;

  -- Sign bifurcation: credit balance (< 0) on owner_payable is platform liability (payable to owner);
  -- debit balance (> 0) on owner_payable is owner debt (receivable from owner).
  v_outstanding_payable_minor := greatest(-v_payable_balance, 0);
  v_owner_receivable_minor := greatest(v_payable_balance, 0);

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
      'outstanding_payable_minor', v_outstanding_payable_minor,
      'owner_receivable_minor', v_owner_receivable_minor
    )
  );
end;
$function$;

revoke all on function public.get_owner_statement from public;
grant execute on function public.get_owner_statement to authenticated, service_role;

-- 4. Redefine public.get_owner_dashboard (adds source_breakdown)
CREATE OR REPLACE FUNCTION public.get_owner_dashboard(p_master_owner_id uuid, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
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
    ) filter (where b.status in ('confirmed', 'cancelled')), 0),
    'source_breakdown', jsonb_build_object(
      'online', jsonb_build_object(
        'bookings_count', coalesce(count(b.id) filter (where b.status in ('confirmed', 'cancelled') and b.source = 'online'), 0),
        'gross_minor', coalesce(sum(b.total_minor) filter (where b.status in ('confirmed', 'cancelled') and b.source = 'online'), 0),
        'commission_minor', coalesce(sum(coalesce((b.commission_snapshot->>'estimated_commission_minor')::bigint, 0)) filter (where b.status in ('confirmed', 'cancelled') and b.source = 'online'), 0),
        'net_payout_eligible_minor', coalesce(sum(
          b.total_minor 
          - coalesce((b.commission_snapshot->>'estimated_commission_minor')::bigint, 0)
          - coalesce((
              select sum(r.amount_minor)
              from private.refunds r
              join private.payments p on p.id = r.payment_id
              join private.payment_orders po on po.id = p.payment_order_id
              where po.booking_id = b.id and r.status in ('requested', 'approved', 'processing', 'succeeded')
            ), 0)
        ) filter (where b.status in ('confirmed', 'cancelled') and b.source = 'online'), 0)
      ),
      'walkin', jsonb_build_object(
        'bookings_count', coalesce(count(b.id) filter (where b.status in ('confirmed', 'cancelled') and b.source = 'walkin'), 0),
        'gross_minor', coalesce(sum(b.total_minor) filter (where b.status in ('confirmed', 'cancelled') and b.source = 'walkin'), 0),
        'commission_minor', coalesce(sum(coalesce((b.commission_snapshot->>'estimated_commission_minor')::bigint, 0)) filter (where b.status in ('confirmed', 'cancelled') and b.source = 'walkin'), 0),
        'net_retained_minor', coalesce(sum(
          b.total_minor 
          - coalesce((b.commission_snapshot->>'estimated_commission_minor')::bigint, 0)
        ) filter (where b.status in ('confirmed', 'cancelled') and b.source = 'walkin'), 0)
      )
    )
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
$function$;

revoke all on function public.get_owner_dashboard from public;
grant execute on function public.get_owner_dashboard to authenticated, service_role;


-- ============================================================================
-- Phase 2 RPCs: Walk-ins, Pricing Rules, Employee Management
-- ============================================================================

-- RPC: public.create_walkin_booking
CREATE OR REPLACE FUNCTION public.create_walkin_booking(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_contact_name text,
  p_contact_phone text,
  p_contact_email text default null,
  p_payment_method text default 'cash',
  p_notes text default null,
  p_idempotency_key text default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'auth', 'pg_temp'
AS $function$
declare
  v_uid uuid;
  v_cached_response jsonb;
  v_res record;
  v_quote jsonb;
  v_comm_rule record;
  v_comm_snapshot jsonb;
  v_commission_minor bigint;
  v_total_minor bigint;
  v_booking_id uuid;
  v_ref_code text;
  v_acc_owner uuid;
  v_acc_commission uuid;
  v_journal_key text;
  v_journal_res jsonb;
  v_inc_interval interval;
  v_inc_start timestamptz;
  v_inc_end timestamptz;
  v_slot_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: Authentication required to create walk-in booking' using errcode = '42501';
  end if;

  if p_contact_name is null or trim(p_contact_name) = '' then
    raise exception 'CONTACT_NAME_REQUIRED: Customer contact name is required' using errcode = '22023';
  end if;

  if p_payment_method not in ('cash', 'upi_counter', 'pos_card') then
    raise exception 'INVALID_PAYMENT_METHOD: Unsupported payment method %', p_payment_method using errcode = '22023';
  end if;

  -- Check Idempotency Table if key supplied
  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    select response_json into v_cached_response
    from private.api_idempotency
    where actor_user_id = v_uid
      and operation = 'create_walkin_booking'
      and idempotency_key = p_idempotency_key;

    if v_cached_response is not null then
      return v_cached_response;
    end if;
  end if;

  -- Serialize on resource row
  select
    r.id, r.turf_id, r.master_owner_id, r.name, r.active,
    r.booking_increment_minutes, r.minimum_duration_minutes, r.maximum_duration_minutes,
    t.timezone, t.approval_status, t.archived_at, mo.status as owner_status
  into v_res
  from public.resources r
  join public.turfs t on t.id = r.turf_id
  join public.master_owners mo on mo.id = r.master_owner_id
  where r.id = p_resource_id
  for update;

  if not found then
    raise exception 'RESOURCE_NOT_FOUND: Resource % not found', p_resource_id using errcode = 'P0002';
  end if;

  if not v_res.active or v_res.archived_at is not null or v_res.approval_status <> 'approved' or v_res.owner_status <> 'active' then
    raise exception 'RESOURCE_UNAVAILABLE: Venue is not active, archived, or not approved' using errcode = '22023';
  end if;

  -- Authorization check: Master Owner or staff with bookings.create_walkin AND payments.record_offline (or bookings.manage)
  if not (
    (private.can_turf(v_uid, v_res.turf_id, 'bookings.create_walkin') and private.can_turf(v_uid, v_res.turf_id, 'payments.record_offline'))
    or private.can_turf(v_uid, v_res.turf_id, 'bookings.manage')
  ) then
    raise exception 'PERMISSION_DENIED: Caller lacks walk-in creation or offline payment recording authority on turf %', v_res.turf_id
      using errcode = '42501';
  end if;

  -- Opportunistic release of expired holds
  update public.inventory_allocations
  set released_at = now()
  where resource_id = p_resource_id
    and kind = 'hold'
    and released_at is null
    and expires_at < now();

  -- JIT Slot Materialization
  perform private.generate_resource_slots(
    p_resource_id,
    (p_starts_at at time zone v_res.timezone)::date,
    (p_ends_at at time zone v_res.timezone)::date
  );

  -- Authoritative Pricing Quote Calculation
  v_quote := public.quote_booking(p_resource_id, p_starts_at, p_ends_at);
  v_total_minor := (v_quote->>'total_minor')::bigint;

  -- Commission Snapshot
  select basis_points, fixed_minor into v_comm_rule
  from private.commission_rules
  where (master_owner_id = v_res.master_owner_id or master_owner_id is null)
    and effective_from <= now()
    and (effective_until is null or effective_until > now())
  order by master_owner_id nulls last, version desc
  limit 1;

  v_commission_minor := round((v_total_minor * coalesce(v_comm_rule.basis_points, 1000)) / 10000.0) + coalesce(v_comm_rule.fixed_minor, 0);

  v_comm_snapshot := jsonb_build_object(
    'basis_points', coalesce(v_comm_rule.basis_points, 1000),
    'fixed_minor', coalesce(v_comm_rule.fixed_minor, 0),
    'estimated_commission_minor', v_commission_minor
  );

  v_ref_code := 'WK-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
  v_booking_id := gen_random_uuid();

  -- Step 1: Insert Booking record:
  --   source = 'walkin', status = 'confirmed', required_online_minor = 0,
  --   cancellation_snapshot = v_quote->'cancellation_snapshot', created_by = v_uid
  insert into public.bookings (
    id, reference_code, master_owner_id, turf_id, resource_id,
    player_user_id, created_by, source, status,
    starts_at, ends_at, hold_expires_at,
    total_minor, required_online_minor, currency,
    pricing_snapshot, cancellation_snapshot, commission_snapshot,
    confirmed_at
  ) values (
    v_booking_id, v_ref_code, v_res.master_owner_id, v_res.turf_id, p_resource_id,
    null, v_uid, 'walkin', 'confirmed',
    p_starts_at, p_ends_at, null,
    v_total_minor, 0, 'INR',
    v_quote->'pricing_snapshot', v_quote->'cancellation_snapshot', v_comm_snapshot,
    now()
  );

  -- Step 2: Insert Inventory Allocation (Exclusion constraint protects against concurrent holds/bookings)
  begin
    insert into public.inventory_allocations (
      master_owner_id, turf_id, resource_id, booking_id,
      kind, starts_at, ends_at, expires_at, created_by
    ) values (
      v_res.master_owner_id, v_res.turf_id, p_resource_id, v_booking_id,
      'booking', p_starts_at, p_ends_at, null, v_uid
    );
  exception
    when exclusion_violation then
      raise exception 'SLOT_UNAVAILABLE: Time range overlaps with an existing reservation or hold' using errcode = '23P01';
  end;

  -- Step 3: Map constituent booking_slots
  v_inc_interval := (v_res.booking_increment_minutes || ' minutes')::interval;
  v_inc_start := p_starts_at;
  while v_inc_start < p_ends_at loop
    v_inc_end := v_inc_start + v_inc_interval;

    select id into v_slot_id
    from public.slots
    where resource_id = p_resource_id
      and starts_at = v_inc_start;

    if v_slot_id is not null then
      insert into public.booking_slots (
        booking_id, slot_id, resource_id, turf_id, master_owner_id, quoted_amount_minor
      ) values (
        v_booking_id, v_slot_id, p_resource_id, v_res.turf_id, v_res.master_owner_id,
        round(v_total_minor::numeric / greatest((v_quote->'pricing_snapshot'->>'increments_count')::int, 1))
      ) on conflict do nothing;
    end if;

    v_inc_start := v_inc_end;
  end loop;

  -- Step 4: Insert Booking Contact with 180-day retention horizon
  insert into private.booking_contacts (
    booking_id, contact_name, contact_phone, contact_email, retention_until
  ) values (
    v_booking_id, p_contact_name, p_contact_phone, p_contact_email, p_ends_at + interval '180 days'
  );

  -- Step 5: Insert Booking Event
  insert into public.booking_events (
    booking_id, event_type, public_summary
  ) values (
    v_booking_id, 'walkin_confirmed', format('Walk-in booking confirmed via %s by counter staff', p_payment_method)
  );

  -- Step 6: Double-entry ledger journal for walk-in commission deduction against owner_payable
  if v_commission_minor > 0 then
    v_acc_owner := private.get_or_create_owner_account(v_res.master_owner_id, 'owner_payable', 'INR');

    select id into v_acc_commission
    from private.ledger_accounts
    where code = 'platform_commission' and currency = 'INR';

    v_journal_key := format('walkin_%s_commission', v_booking_id);
    v_journal_res := private.post_journal(
      p_event_key => v_journal_key,
      p_event_type => 'walkin_booking_recorded',
      p_currency => 'INR',
      p_booking_id => v_booking_id,
      p_entries => jsonb_build_array(
        jsonb_build_object('account_id', v_acc_owner, 'amount_minor', v_commission_minor),
        jsonb_build_object('account_id', v_acc_commission, 'amount_minor', -v_commission_minor)
      )
    );
  end if;

  -- Step 7: Cache response if idempotency key was provided
  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    insert into private.api_idempotency (
      actor_user_id, operation, idempotency_key, request_hash, response_json, expires_at
    ) values (
      v_uid, 'create_walkin_booking', p_idempotency_key,
      md5(p_resource_id::text || ':' || p_starts_at::text || ':' || p_ends_at::text),
      jsonb_build_object(
        'booking_id', v_booking_id,
        'reference_code', v_ref_code,
        'status', 'confirmed',
        'total_minor', v_total_minor,
        'commission_minor', v_commission_minor,
        'starts_at', p_starts_at,
        'ends_at', p_ends_at,
        'source', 'walkin',
        'payment_method', p_payment_method
      ),
      now() + interval '24 hours'
    );
  end if;

  return jsonb_build_object(
    'booking_id', v_booking_id,
    'reference_code', v_ref_code,
    'status', 'confirmed',
    'total_minor', v_total_minor,
    'commission_minor', v_commission_minor,
    'starts_at', p_starts_at,
    'ends_at', p_ends_at,
    'source', 'walkin',
    'payment_method', p_payment_method
  );
end;
$function$;

revoke all on function public.create_walkin_booking from public;
grant execute on function public.create_walkin_booking to authenticated, service_role;


-- RPC: public.upsert_pricing_rule
CREATE OR REPLACE FUNCTION public.upsert_pricing_rule(
  p_rule_id uuid,
  p_resource_id uuid,
  p_valid_from date,
  p_valid_until date,
  p_iso_weekdays smallint[],
  p_starts_local time,
  p_ends_local time,
  p_amount_per_increment_minor bigint,
  p_priority integer default 0,
  p_active boolean default true,
  p_expected_version bigint default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'auth', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_res record;
  v_existing record;
  v_target_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: Authentication required' using errcode = '42501';
  end if;

  if p_ends_local <= p_starts_local then
    raise exception 'INVALID_TIME_RANGE: ends_local must be strictly after starts_local' using errcode = '22023';
  end if;

  if p_valid_until is not null and p_valid_until < p_valid_from then
    raise exception 'INVALID_DATE_RANGE: valid_until must be on or after valid_from' using errcode = '22023';
  end if;

  if p_amount_per_increment_minor < 0 then
    raise exception 'INVALID_AMOUNT: amount_per_increment_minor cannot be negative' using errcode = '22023';
  end if;

  if p_iso_weekdays is null or array_length(p_iso_weekdays, 1) is null then
    raise exception 'ISO_WEEKDAYS_REQUIRED: At least one ISO weekday must be specified' using errcode = '22023';
  end if;

  select r.id, r.turf_id, r.master_owner_id, t.archived_at
  into v_res
  from public.resources r
  join public.turfs t on t.id = r.turf_id
  where r.id = p_resource_id;

  if not found then
    raise exception 'RESOURCE_NOT_FOUND: Resource % does not exist', p_resource_id using errcode = 'P0002';
  end if;

  if v_res.archived_at is not null then
    raise exception 'VENUE_ARCHIVED: Cannot configure pricing on archived turf %', v_res.turf_id using errcode = '42501';
  end if;

  if not private.can_turf(v_uid, v_res.turf_id, 'pricing.edit') then
    raise exception 'PERMISSION_DENIED: Caller lacks pricing.edit capability on turf %', v_res.turf_id using errcode = '42501';
  end if;

  -- Overlap validation: reject if another active rule covers the exact same time window with the exact same priority
  if p_active = true and exists (
    select 1 from public.pricing_rules pr
    where pr.resource_id = p_resource_id
      and pr.active = true
      and (p_rule_id is null or pr.id <> p_rule_id)
      and pr.priority = p_priority
      and pr.valid_from <= coalesce(p_valid_until, '9999-12-31'::date)
      and coalesce(pr.valid_until, '9999-12-31'::date) >= p_valid_from
      and pr.iso_weekdays && p_iso_weekdays
      and pr.starts_local < p_ends_local
      and pr.ends_local > p_starts_local
  ) then
    raise exception 'PRICING_RULE_OVERLAP: An active rule with priority % already covers this time window. Adjust priority or time range.', p_priority
      using errcode = '22023';
  end if;

  if p_rule_id is not null then
    select * into v_existing from public.pricing_rules where id = p_rule_id;
    if not found then
      raise exception 'RULE_NOT_FOUND: Pricing rule % does not exist', p_rule_id using errcode = 'P0002';
    end if;

    if p_expected_version is not null and v_existing.version <> p_expected_version then
      raise exception 'VERSION_CONFLICT: Expected version % but found %', p_expected_version, v_existing.version
        using errcode = '40900';
    end if;

    update public.pricing_rules
    set valid_from = p_valid_from,
        valid_until = p_valid_until,
        iso_weekdays = p_iso_weekdays,
        starts_local = p_starts_local,
        ends_local = p_ends_local,
        amount_per_increment_minor = p_amount_per_increment_minor,
        priority = p_priority,
        active = p_active,
        version = version + 1,
        updated_at = now()
    where id = p_rule_id
    returning id into v_target_id;
  else
    insert into public.pricing_rules (
      master_owner_id, turf_id, resource_id,
      valid_from, valid_until, iso_weekdays,
      starts_local, ends_local,
      amount_per_increment_minor, priority, active
    ) values (
      v_res.master_owner_id, v_res.turf_id, p_resource_id,
      p_valid_from, p_valid_until, p_iso_weekdays,
      p_starts_local, p_ends_local,
      p_amount_per_increment_minor, p_priority, p_active
    ) returning id into v_target_id;
  end if;

  return jsonb_build_object(
    'rule_id', v_target_id,
    'resource_id', p_resource_id,
    'priority', p_priority,
    'active', p_active,
    'amount_per_increment_minor', p_amount_per_increment_minor
  );
end;
$function$;

revoke all on function public.upsert_pricing_rule from public;
grant execute on function public.upsert_pricing_rule to authenticated, service_role;


-- RPC: public.invite_employee
CREATE OR REPLACE FUNCTION public.invite_employee(
  p_master_owner_id uuid,
  p_email text,
  p_turf_ids uuid[],
  p_capabilities text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'auth', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_is_admin boolean;
  v_raw_token text;
  v_token_hash text;
  v_invite_id uuid;
  v_turf_id uuid;
  v_cap text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: Authentication required' using errcode = '42501';
  end if;

  v_is_admin := private.is_platform_admin(v_uid);
  select exists (
    select 1 from public.master_owners where id = p_master_owner_id and owner_user_id = v_uid
  ) into v_is_owner;

  if not v_is_admin and not v_is_owner then
    raise exception 'PERMISSION_DENIED: Only the Master Owner can invite employees' using errcode = '42501';
  end if;

  if p_email is null or trim(p_email) = '' or p_email not like '%@%.%' then
    raise exception 'INVALID_EMAIL: A valid email address is required' using errcode = '22023';
  end if;

  if p_turf_ids is null or array_length(p_turf_ids, 1) is null then
    raise exception 'TURFS_REQUIRED: At least one turf assignment must be specified' using errcode = '22023';
  end if;

  -- Validate turfs belong to this master owner and are unarchived
  foreach v_turf_id in array p_turf_ids loop
    if not exists (
      select 1 from public.turfs where id = v_turf_id and master_owner_id = p_master_owner_id and archived_at is null
    ) then
      raise exception 'INVALID_TURF: Turf % does not belong to owner % or is archived', v_turf_id, p_master_owner_id
        using errcode = '22023';
    end if;
  end loop;

  -- Validate capabilities exist in registry with scope = 'turf'
  if p_capabilities is not null then
    foreach v_cap in array p_capabilities loop
      if not exists (
        select 1 from private.capabilities where code = v_cap and scope = 'turf'
      ) then
        raise exception 'INVALID_CAPABILITY: Capability % does not exist in registry with scope turf', v_cap
          using errcode = '22023';
      end if;
    end loop;
  end if;

  -- Generate 32-byte secure random token and SHA-256 hash
  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_raw_token, 'sha256'), 'hex');
  v_invite_id := gen_random_uuid();

  insert into private.employee_invites (
    id, master_owner_id, normalized_email, token_hash,
    proposed_assignments, invited_by, expires_at
  ) values (
    v_invite_id, p_master_owner_id, lower(trim(p_email)), v_token_hash,
    jsonb_build_object('turf_ids', p_turf_ids, 'capabilities', coalesce(p_capabilities, array[]::text[])),
    v_uid, now() + interval '7 days'
  );

  return jsonb_build_object(
    'invite_id', v_invite_id,
    'token', v_raw_token,
    'email', lower(trim(p_email)),
    'expires_at', now() + interval '7 days'
  );
end;
$function$;

revoke all on function public.invite_employee from public;
grant execute on function public.invite_employee to authenticated, service_role;


-- RPC: public.get_pending_employee_invites
CREATE OR REPLACE FUNCTION public.get_pending_employee_invites(p_master_owner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'auth', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_is_admin boolean;
  v_res jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: Authentication required' using errcode = '42501';
  end if;

  v_is_admin := private.is_platform_admin(v_uid);
  select exists (
    select 1 from public.master_owners where id = p_master_owner_id and owner_user_id = v_uid
  ) into v_is_owner;

  if not v_is_admin and not v_is_owner then
    raise exception 'PERMISSION_DENIED: Caller is not authorized' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'invite_id', id,
        'email', normalized_email,
        'proposed_assignments', proposed_assignments,
        'created_at', created_at,
        'expires_at', expires_at
      )
      order by created_at desc
    ),
    '[]'::jsonb
  ) into v_res
  from private.employee_invites
  where master_owner_id = p_master_owner_id
    and accepted_at is null
    and revoked_at is null
    and expires_at > now();

  return v_res;
end;
$function$;

revoke all on function public.get_pending_employee_invites from public;
grant execute on function public.get_pending_employee_invites to authenticated, service_role;


-- RPC: public.accept_employee_invite
CREATE OR REPLACE FUNCTION public.accept_employee_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'auth', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_token_hash text;
  v_invite record;
  v_emp_id uuid;
  v_turf_id text;
  v_cap text;
  v_assign_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: Authentication required to accept invitation' using errcode = '42501';
  end if;

  v_token_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_invite
  from private.employee_invites
  where token_hash = v_token_hash
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception 'INVALID_INVITE_TOKEN: Invitation token is invalid, expired, or already accepted'
      using errcode = '22023';
  end if;

  -- 1. Create or re-activate Employee record
  insert into public.employees (
    master_owner_id, user_id, status
  ) values (
    v_invite.master_owner_id, v_uid, 'active'
  )
  on conflict (master_owner_id, user_id)
  do update set status = 'active', permission_version = public.employees.permission_version + 1
  returning id into v_emp_id;

  -- 2. Create Turf Assignments and Assignment Grants with scope = 'turf'
  for v_turf_id in select jsonb_array_elements_text(v_invite.proposed_assignments->'turf_ids') loop
    insert into public.employee_turf_assignments (
      employee_id, master_owner_id, turf_id, active
    ) values (
      v_emp_id, v_invite.master_owner_id, v_turf_id::uuid, true
    )
    on conflict (employee_id, turf_id)
    do update set active = true
    returning id into v_assign_id;

    for v_cap in select jsonb_array_elements_text(v_invite.proposed_assignments->'capabilities') loop
      insert into private.assignment_grants (
        assignment_id, capability, scope
      ) values (
        v_assign_id, v_cap, 'turf'
      )
      on conflict (assignment_id, capability) do nothing;
    end loop;
  end loop;

  -- 3. Mark Invite as Accepted
  update private.employee_invites
  set accepted_at = now()
  where id = v_invite.id;

  return jsonb_build_object(
    'employee_id', v_emp_id,
    'master_owner_id', v_invite.master_owner_id,
    'status', 'active',
    'accepted_at', now()
  );
end;
$function$;

revoke all on function public.accept_employee_invite from public;
grant execute on function public.accept_employee_invite to authenticated, service_role;


-- RPC: public.update_employee_assignments
CREATE OR REPLACE FUNCTION public.update_employee_assignments(
  p_employee_id uuid,
  p_turf_id uuid,
  p_capabilities text[],
  p_active boolean default true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'auth', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_emp record;
  v_is_owner boolean;
  v_is_admin boolean;
  v_assign_id uuid;
  v_cap text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: Authentication required' using errcode = '42501';
  end if;

  select * into v_emp from public.employees where id = p_employee_id;
  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND: Employee % not found', p_employee_id using errcode = 'P0002';
  end if;

  v_is_admin := private.is_platform_admin(v_uid);
  select exists (
    select 1 from public.master_owners where id = v_emp.master_owner_id and owner_user_id = v_uid
  ) into v_is_owner;

  if not v_is_admin and not v_is_owner then
    raise exception 'PERMISSION_DENIED: Only Master Owner can manage assignments' using errcode = '42501';
  end if;

  insert into public.employee_turf_assignments (
    employee_id, master_owner_id, turf_id, active
  ) values (
    p_employee_id, v_emp.master_owner_id, p_turf_id, p_active
  )
  on conflict (employee_id, turf_id)
  do update set active = p_active
  returning id into v_assign_id;

  delete from private.assignment_grants where assignment_id = v_assign_id;

  if p_active = true and p_capabilities is not null then
    foreach v_cap in array p_capabilities loop
      insert into private.assignment_grants (
        assignment_id, capability, scope
      ) values (
        v_assign_id, v_cap, 'turf'
      );
    end loop;
  end if;

  update public.employees
  set permission_version = permission_version + 1
  where id = p_employee_id;

  return jsonb_build_object(
    'employee_id', p_employee_id,
    'turf_id', p_turf_id,
    'active', p_active
  );
end;
$function$;

revoke all on function public.update_employee_assignments from public;
grant execute on function public.update_employee_assignments to authenticated, service_role;

