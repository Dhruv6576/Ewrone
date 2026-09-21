-- Migration: 20260918000016_harden_owner_rpcs_and_waterfall_payouts.sql
-- Description:
-- 1. Hardens public.upsert_pricing_rule:
--    - Checks can_turf('pricing.edit') BEFORE checking turf.archived_at to prevent tenant archive state leakage.
--    - Checks rule existence, cross-tenant isolation (42501), and resource binding (22023) BEFORE overlap validation.
-- 2. Hardens public.create_walkin_booking:
--    - Evaluates can_turf authorization check first, eliminating state leakage.
-- 3. Hardens public.update_employee_assignments:
--    - Strictly validates capability codes against private.capabilities (scope = 'turf', 22023 INVALID_CAPABILITY) and dedupes grants.
-- 4. Restores and refines public.get_owner_financial_summary:
--    - Restores unsettled_booking_count to true unsettled semantics (count of bookings with remaining payable > 0).
--    - Adds funded_booking_count for count of bookings funded under the next waterfall payout.
--    - Enforces netting formula: P = min(G, max(-L - F, 0)).
-- 5. Standardizes public.get_owner_statement:
--    - Contract: p_start_date and p_end_date are deprecated no-ops retained for API compatibility.
--    - Returns cumulative lifetime balances (period_applied = false) to ensure consistency with lifetime payout allocations.
-- 6. Hardens private.plan_owner_payout:
--    - Closed-form deterministic waterfall distribution: a_i = min(g_i, P - S_{i-1}) for S_{i-1} < P.
--    - Guarantees exact sum preservation (sum(a_i) = P), strictly positive allocations, and prior allocation subtractions.

CREATE OR REPLACE FUNCTION public.upsert_pricing_rule(p_rule_id uuid, p_resource_id uuid, p_valid_from date, p_valid_until date, p_iso_weekdays smallint[], p_starts_local time without time zone, p_ends_local time without time zone, p_amount_per_increment_minor bigint, p_priority integer DEFAULT 0, p_active boolean DEFAULT true, p_expected_version bigint DEFAULT NULL::bigint)
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

  if not private.can_turf(v_uid, v_res.turf_id, 'pricing.edit') then
    raise exception 'PERMISSION_DENIED: Caller lacks pricing.edit capability on turf %', v_res.turf_id using errcode = '42501';
  end if;

  if v_res.archived_at is not null then
    raise exception 'VENUE_ARCHIVED: Cannot configure pricing on archived turf %', v_res.turf_id using errcode = '42501';
  end if;

  if p_rule_id is not null then
    select * into v_existing from public.pricing_rules where id = p_rule_id;
    if not found then
      raise exception 'RULE_NOT_FOUND: Pricing rule % does not exist', p_rule_id using errcode = 'P0002';
    end if;

    -- Cross-tenant isolation check: Rule must belong to the same master owner as the resource
    if v_existing.master_owner_id <> v_res.master_owner_id then
      raise exception 'PERMISSION_DENIED: Caller lacks permission to modify pricing rule %', p_rule_id
        using errcode = '42501';
    end if;

    -- Resource binding check: Rule cannot be moved to a different resource under the same owner
    if v_existing.resource_id <> p_resource_id then
      raise exception 'RESOURCE_MISMATCH: Pricing rule % belongs to resource %, not %', p_rule_id, v_existing.resource_id, p_resource_id
        using errcode = '22023';
    end if;

    if p_expected_version is not null and v_existing.version <> p_expected_version then
      raise exception 'VERSION_CONFLICT: Expected version % but found %', p_expected_version, v_existing.version
        using errcode = '40900';
    end if;
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
      valid_from, valid_until, iso_weekdays, starts_local, ends_local,
      amount_per_increment_minor, priority, active, version
    ) values (
      v_res.master_owner_id, v_res.turf_id, p_resource_id,
      p_valid_from, p_valid_until, p_iso_weekdays, p_starts_local, p_ends_local,
      p_amount_per_increment_minor, p_priority, p_active, 1
    )
    returning id into v_target_id;
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


CREATE OR REPLACE FUNCTION public.create_walkin_booking(p_resource_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_contact_name text, p_contact_phone text, p_contact_email text DEFAULT NULL::text, p_payment_method text DEFAULT 'cash'::text, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
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

  -- Authorization check FIRST: Master Owner or staff with bookings.create_walkin AND payments.record_offline (or bookings.manage)
  -- Note: private.can_turf strictly enforces that archived turfs deny all write capabilities, raising 42501.
  if not (
    (private.can_turf(v_uid, v_res.turf_id, 'bookings.create_walkin') and private.can_turf(v_uid, v_res.turf_id, 'payments.record_offline'))
    or private.can_turf(v_uid, v_res.turf_id, 'bookings.manage')
  ) then
    raise exception 'PERMISSION_DENIED: Caller lacks walk-in creation or offline payment recording authority on turf %', v_res.turf_id
      using errcode = '42501';
  end if;

  -- Venue operational state checks (only evaluated for authorized callers on unarchived turfs)
  if not v_res.active or v_res.approval_status <> 'approved' or v_res.owner_status <> 'active' then
    raise exception 'RESOURCE_UNAVAILABLE: Venue is not active or approved' using errcode = '22023';
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


CREATE OR REPLACE FUNCTION public.update_employee_assignments(p_employee_id uuid, p_turf_id uuid, p_capabilities text[], p_active boolean DEFAULT true)
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

  -- Validate turf belongs to this employee's master owner and is unarchived
  if not exists (
    select 1 from public.turfs
    where id = p_turf_id
      and master_owner_id = v_emp.master_owner_id
      and archived_at is null
  ) then
    raise exception 'INVALID_TURF: Turf % does not belong to owner % or is archived', p_turf_id, v_emp.master_owner_id
      using errcode = '22023';
  end if;

  -- Validate capability codes against registry with scope = 'turf'
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

  insert into public.employee_turf_assignments (
    employee_id, master_owner_id, turf_id, active
  ) values (
    p_employee_id, v_emp.master_owner_id, p_turf_id, p_active
  )
  on conflict (employee_id, turf_id)
  do update set active = p_active
  returning id into v_assign_id;

  delete from private.assignment_grants where assignment_id = v_assign_id;

  -- Insert distinct granted capabilities
  if p_active = true and p_capabilities is not null then
    for v_cap in select distinct unnest(p_capabilities) loop
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
  v_funded_count integer := 0;
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

  -- Calculate gross unallocated online bookings payable and count
  with eligible as (
    select b.id as booking_id,
           b.starts_at,
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
             - coalesce((
                 select sum(pa.amount_minor)
                 from private.payout_allocations pa
                 where pa.booking_id = b.id
               ), 0)
           ) as payable_minor
    from public.bookings b
    where b.master_owner_id = p_master_owner_id
      and b.status in ('confirmed', 'cancelled')
      and b.source = 'online'
  )
  select coalesce(sum(payable_minor), 0), coalesce(count(*), 0)
  into v_unsettled_minor, v_booking_count
  from eligible
  where payable_minor > 0;

  select coalesce(sum(amount_minor), 0) into v_planned_minor
  from private.payouts
  where master_owner_id = p_master_owner_id
    and status in ('planned', 'submitted', 'processing');

  -- Net unsettled payable against owner_payable ledger liability:
  -- Credit balance (< 0) on owner_payable represents platform liability.
  -- Debits from walk-in commission or refunds reduce this liability.
  select least(
    v_unsettled_minor,
    greatest(
      coalesce((
        select -sum(e.amount_minor)
        from private.ledger_entries e
        join private.ledger_accounts a on a.id = e.account_id
        where a.code = 'owner_payable' and a.master_owner_id = p_master_owner_id
      ), 0) - v_planned_minor,
      0
    )
  ) into v_unsettled_minor;

  -- Funded booking count under waterfall capacity:
  -- Count only the bookings funded under the next waterfall payout.
  if v_unsettled_minor <= 0 then
    v_funded_count := 0;
  else
    with eligible as (
      select b.id,
             b.starts_at,
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
               - coalesce((
                   select sum(pa.amount_minor)
                   from private.payout_allocations pa
                   where pa.booking_id = b.id
                 ), 0)
             ) as payable_minor
      from public.bookings b
      where b.master_owner_id = p_master_owner_id
        and b.status in ('confirmed', 'cancelled')
        and b.source = 'online'
    ),
    ordered as (
      select coalesce(sum(payable_minor) over (
        order by starts_at asc, id asc
        rows between unbounded preceding and 1 preceding
      ), 0) as prior_sum
      from eligible
      where payable_minor > 0
    )
    select count(*) into v_funded_count
    from ordered
    where prior_sum < v_unsettled_minor;
  end if;

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
    'funded_booking_count', v_funded_count,
    'planned_payouts_minor', v_planned_minor,
    'settled_payouts_minor', v_settled_minor,
    'currency', 'INR'
  );
end;
$function$;


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
  -- Every journal impacting a master owner contains an entry in that owner's owner_payable account.
  -- Option (b): Note: p_start_date and p_end_date are deprecated no-ops retained for API backwards-compatibility.
  -- Statement returns cumulative lifetime balances (period_applied = false) to ensure consistency with
  -- cumulative lifetime payout allocations and netting against in-flight/settled payouts.
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

  -- Cumulative lifetime payouts
  select coalesce(sum(amount_minor), 0) into v_settled_minor
  from private.payouts
  where master_owner_id = p_master_owner_id and status = 'settled';

  select coalesce(sum(amount_minor), 0) into v_planned_minor
  from private.payouts
  where master_owner_id = p_master_owner_id and status in ('planned', 'submitted', 'processing');

  -- Sign bifurcation: credit balance (< 0) on owner_payable is platform liability (payable to owner);
  -- debit balance (> 0) on owner_payable is owner debt (receivable from owner).
  v_outstanding_payable_minor := greatest(-v_payable_balance, 0);
  v_owner_receivable_minor := greatest(v_payable_balance, 0);

  return jsonb_build_object(
    'master_owner_id', p_master_owner_id,
    'start_date', null,
    'end_date', null,
    'period_applied', false,
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
  v_gross_payable_minor bigint := 0;
  v_owner_payable_net bigint := 0;
  v_inflight_payouts bigint := 0;
  v_available_ledger_liability bigint := 0;
  v_total_minor bigint := 0;
  v_allocated_count integer := 0;
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

  -- 2. Calculate eligible unallocated online bookings gross payable
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
             - coalesce((
                 select sum(pa.amount_minor)
                 from private.payout_allocations pa
                 where pa.booking_id = b.id
               ), 0)
           ) as payable_minor
    from public.bookings b
    where b.master_owner_id = p_master_owner_id
      and b.status in ('confirmed', 'cancelled')
      and b.source = 'online'
      and (p_period_start is null or b.starts_at >= p_period_start)
      and (p_period_end is null or b.starts_at <= p_period_end)
  )
  select coalesce(sum(payable_minor), 0)
  into v_gross_payable_minor
  from eligible
  where payable_minor > 0;

  if v_gross_payable_minor <= 0 then
    return jsonb_build_object(
      'status', 'no_payable_balance',
      'amount_minor', 0,
      'allocated_bookings', 0
    );
  end if;

  -- Query current ledger net liability on owner_payable
  select coalesce(sum(e.amount_minor), 0) into v_owner_payable_net
  from private.ledger_entries e
  join private.ledger_accounts a on a.id = e.account_id
  where a.code = 'owner_payable' and a.master_owner_id = p_master_owner_id;

  -- In-flight payouts that have not yet settled into the ledger
  select coalesce(sum(amount_minor), 0) into v_inflight_payouts
  from private.payouts
  where master_owner_id = p_master_owner_id
    and status in ('planned', 'submitted', 'processing');

  v_available_ledger_liability := greatest(-v_owner_payable_net - v_inflight_payouts, 0);

  -- Effective payout amount is capped by available ledger liability: P = min(G, max(-L - F, 0))
  v_total_minor := least(v_gross_payable_minor, v_available_ledger_liability);

  if v_total_minor <= 0 then
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

  -- 4. Insert allocation line-items using closed-form deterministic waterfall distribution
  with ordered as (
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
             - coalesce((
                 select sum(pa.amount_minor)
                 from private.payout_allocations pa
                 where pa.booking_id = b.id
               ), 0)
           ) as payable_minor,
           coalesce(sum(
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
               - coalesce((
                   select sum(pa.amount_minor)
                   from private.payout_allocations pa
                   where pa.booking_id = b.id
                 ), 0)
             )
           ) over (
             order by b.starts_at asc, b.id asc
             rows between unbounded preceding and 1 preceding
           ), 0) as prior_sum
    from public.bookings b
    where b.master_owner_id = p_master_owner_id
      and b.status in ('confirmed', 'cancelled')
      and b.source = 'online'
      and (p_period_start is null or b.starts_at >= p_period_start)
      and (p_period_end is null or b.starts_at <= p_period_end)
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
        - coalesce((
            select sum(pa.amount_minor)
            from private.payout_allocations pa
            where pa.booking_id = b.id
          ), 0)
      ) > 0
  ),
  allocations as (
    select booking_id,
           least(payable_minor, v_total_minor - prior_sum) as alloc_minor
    from ordered
    where prior_sum < v_total_minor
  )
  insert into private.payout_allocations (
    payout_id, master_owner_id, booking_id, amount_minor
  )
  select v_payout_id,
         p_master_owner_id,
         a.booking_id,
         a.alloc_minor
  from allocations a;

  select count(*) into v_allocated_count
  from private.payout_allocations
  where payout_id = v_payout_id;

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
      'allocated_count', v_allocated_count
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
    jsonb_build_object('amount_minor', v_total_minor, 'status', 'planned', 'allocated_count', v_allocated_count),
    'Payout batch planned'
  );

  return jsonb_build_object(
    'payout_id', v_payout_id,
    'status', 'planned',
    'amount_minor', v_total_minor,
    'allocated_bookings', v_allocated_count
  );
end;
$function$;

