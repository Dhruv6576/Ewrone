-- Migration: 20260918000004_pricing_and_slots.sql
-- Description: Pricing rules, cancellation policies, turf booking settings, calendar slots, JIT slot generator, and authoritative quote_booking RPC.

-- 1. Cancellation Policies
create table public.cancellation_policies (
  id uuid primary key default gen_random_uuid(),
  master_owner_id uuid not null references public.master_owners(id) on delete cascade,
  name text not null,
  version integer not null default 1,
  rules jsonb not null,
  created_at timestamptz not null default now(),
  unique (master_owner_id, name, version),
  unique (id, master_owner_id)
);

-- 2. Turf Booking Settings
create table public.turf_booking_settings (
  turf_id uuid primary key,
  master_owner_id uuid not null,
  cancellation_policy_id uuid not null,
  advance_basis_points integer not null default 10000
    check (advance_basis_points between 1 and 10000),
  booking_horizon_days integer not null default 60
    check (booking_horizon_days between 1 and 365),
  minimum_lead_minutes integer not null default 60
    check (minimum_lead_minutes >= 0),
  hold_seconds integer not null default 420
    check (hold_seconds between 60 and 1200),
  foreign key (turf_id, master_owner_id)
    references public.turfs(id, master_owner_id) on delete cascade,
  foreign key (cancellation_policy_id, master_owner_id)
    references public.cancellation_policies(id, master_owner_id)
);

-- 3. Pricing Rules
create table public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  master_owner_id uuid not null,
  turf_id uuid not null,
  resource_id uuid not null,
  priority integer not null default 0,
  valid_from date not null,
  valid_until date,
  iso_weekdays smallint[] not null,
  starts_local time not null,
  ends_local time not null,
  amount_per_increment_minor bigint not null
    check (amount_per_increment_minor >= 0),
  currency text not null default 'INR',
  active boolean not null default true,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (resource_id, turf_id, master_owner_id)
    references public.resources(id, turf_id, master_owner_id) on delete cascade,
  check (valid_until is null or valid_until >= valid_from),
  check (ends_local > starts_local)
);

create index pricing_rules_resource_idx
  on public.pricing_rules(resource_id, active, valid_from);

-- 4. Slots (Published Schedule Units)
create table public.slots (
  id uuid primary key default gen_random_uuid(),
  master_owner_id uuid not null,
  turf_id uuid not null,
  resource_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  published boolean not null default true,
  schedule_version bigint not null default 1,
  foreign key (resource_id, turf_id, master_owner_id)
    references public.resources(id, turf_id, master_owner_id) on delete cascade,
  check (ends_at > starts_at),
  unique (resource_id, starts_at),
  unique (id, resource_id, turf_id, master_owner_id)
);

create index slots_resource_time_idx
  on public.slots(resource_id, starts_at, ends_at);

-- 5. Just-In-Time Slot Generator Function
create or replace function private.generate_resource_slots(
  p_resource_id uuid,
  p_start_date date,
  p_end_date date
)
returns integer
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_res record;
  v_curr_date date;
  v_dow integer;
  v_oh record;
  v_ex record;
  v_period record;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_inc_interval interval;
  v_generated_count integer := 0;
begin
  select r.id, r.turf_id, r.master_owner_id, r.booking_increment_minutes, r.active, t.timezone
  into v_res
  from public.resources r
  join public.turfs t on t.id = r.turf_id
  where r.id = p_resource_id;

  if not found then
    raise exception 'RESOURCE_NOT_FOUND: Resource % not found', p_resource_id using errcode = 'P0002';
  end if;

  if not v_res.active then
    return 0;
  end if;

  v_inc_interval := (v_res.booking_increment_minutes || ' minutes')::interval;
  v_curr_date := p_start_date;

  while v_curr_date <= p_end_date loop
    v_dow := extract(isodow from v_curr_date)::integer;

    -- Check for exceptions on this local date
    select * into v_ex
    from public.operating_exceptions
    where resource_id = p_resource_id and local_date = v_curr_date;

    if v_ex.id is not null and v_ex.closed then
      -- Closed on this exception date
      v_curr_date := v_curr_date + 1;
      continue;
    end if;

    if v_ex.id is not null and v_ex.override_periods is not null then
      -- Operating override periods
      for v_period in select * from jsonb_to_recordset(v_ex.override_periods) as (opens_at time, closes_at time, closes_next_day boolean) loop
        v_window_start := (v_curr_date + v_period.opens_at) at time zone v_res.timezone;
        if coalesce(v_period.closes_next_day, false) then
          v_window_end := ((v_curr_date + 1) + v_period.closes_at) at time zone v_res.timezone;
        else
          v_window_end := (v_curr_date + v_period.closes_at) at time zone v_res.timezone;
        end if;

        v_slot_start := v_window_start;
        while v_slot_start + v_inc_interval <= v_window_end loop
          v_slot_end := v_slot_start + v_inc_interval;
          insert into public.slots (master_owner_id, turf_id, resource_id, starts_at, ends_at)
          values (v_res.master_owner_id, v_res.turf_id, p_resource_id, v_slot_start, v_slot_end)
          on conflict (resource_id, starts_at) do nothing;
          v_generated_count := v_generated_count + 1;
          v_slot_start := v_slot_end;
        end loop;
      end loop;
    else
      -- Standard operating hours for this weekday
      for v_oh in
        select * from public.operating_hours
        where resource_id = p_resource_id
          and iso_weekday = v_dow
          and valid_from <= v_curr_date
          and (valid_until is null or valid_until >= v_curr_date)
      loop
        v_window_start := (v_curr_date + v_oh.opens_at) at time zone v_res.timezone;
        if v_oh.closes_next_day then
          v_window_end := ((v_curr_date + 1) + v_oh.closes_at) at time zone v_res.timezone;
        else
          v_window_end := (v_curr_date + v_oh.closes_at) at time zone v_res.timezone;
        end if;

        v_slot_start := v_window_start;
        while v_slot_start + v_inc_interval <= v_window_end loop
          v_slot_end := v_slot_start + v_inc_interval;
          insert into public.slots (master_owner_id, turf_id, resource_id, starts_at, ends_at)
          values (v_res.master_owner_id, v_res.turf_id, p_resource_id, v_slot_start, v_slot_end)
          on conflict (resource_id, starts_at) do nothing;
          v_generated_count := v_generated_count + 1;
          v_slot_start := v_slot_end;
        end loop;
      end loop;
    end if;

    v_curr_date := v_curr_date + 1;
  end loop;

  return v_generated_count;
end;
$$;

revoke all on function private.generate_resource_slots(uuid, date, date) from public;
grant execute on function private.generate_resource_slots(uuid, date, date) to authenticated, service_role;

-- 6. Authoritative Pricing Quote RPC: quote_booking
create or replace function public.quote_booking(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_res record;
  v_settings record;
  v_policy record;
  v_total_minutes integer;
  v_inc_minutes integer;
  v_inc_count integer;
  v_curr_start timestamptz;
  v_curr_end timestamptz;
  v_local_ts timestamp;
  v_local_date date;
  v_local_time time;
  v_dow smallint;
  v_rule record;
  v_total_minor bigint := 0;
  v_required_online_minor bigint;
  v_increments jsonb := '[]'::jsonb;
  v_pricing_snapshot jsonb;
  v_cancellation_snapshot jsonb;
begin
  if p_ends_at <= p_starts_at then
    raise exception 'INVALID_TIME_RANGE: ends_at must be strictly after starts_at' using errcode = '22023';
  end if;

  select
    r.id, r.turf_id, r.master_owner_id, r.name, r.active,
    r.booking_increment_minutes, r.minimum_duration_minutes, r.maximum_duration_minutes,
    t.timezone, t.approval_status, t.archived_at
  into v_res
  from public.resources r
  join public.turfs t on t.id = r.turf_id
  where r.id = p_resource_id;

  if not found then
    raise exception 'RESOURCE_NOT_FOUND: Resource % not found', p_resource_id using errcode = 'P0002';
  end if;

  if not v_res.active or v_res.archived_at is not null then
    raise exception 'RESOURCE_UNAVAILABLE: Resource is inactive or archived' using errcode = '22023';
  end if;

  -- Validate caller permission: approved turf is publicly quotable; draft requires pricing.read
  if v_res.approval_status <> 'approved' and not private.can_turf(v_res.turf_id, 'pricing.read') then
    raise exception 'PERM_DENIED: Turf is not approved' using errcode = '42501';
  end if;

  v_total_minutes := extract(epoch from (p_ends_at - p_starts_at)) / 60;
  v_inc_minutes := v_res.booking_increment_minutes;

  if v_total_minutes < v_res.minimum_duration_minutes then
    raise exception 'DURATION_TOO_SHORT: Minimum duration is % minutes', v_res.minimum_duration_minutes using errcode = '22023';
  end if;

  if v_total_minutes > v_res.maximum_duration_minutes then
    raise exception 'DURATION_TOO_LONG: Maximum duration is % minutes', v_res.maximum_duration_minutes using errcode = '22023';
  end if;

  if (v_total_minutes % v_inc_minutes) <> 0 then
    raise exception 'INVALID_INCREMENT: Duration must be an exact multiple of % minutes', v_inc_minutes using errcode = '22023';
  end if;

  v_inc_count := v_total_minutes / v_inc_minutes;
  v_curr_start := p_starts_at;

  -- Iterate through every increment and evaluate authoritative pricing precedence
  while v_curr_start < p_ends_at loop
    v_curr_end := v_curr_start + (v_inc_minutes || ' minutes')::interval;
    v_local_ts := v_curr_start at time zone v_res.timezone;
    v_local_date := v_local_ts::date;
    v_local_time := v_local_ts::time;
    v_dow := extract(isodow from v_local_ts)::smallint;

    -- Highest priority matching active rule wins
    select
      id, amount_per_increment_minor, currency, priority
    into v_rule
    from public.pricing_rules
    where resource_id = p_resource_id
      and active = true
      and valid_from <= v_local_date
      and (valid_until is null or valid_until >= v_local_date)
      and v_dow = any(iso_weekdays)
      and starts_local <= v_local_time
      and ends_local > v_local_time
    order by priority desc, created_at desc
    limit 1;

    if not found then
      raise exception 'PRICING_NOT_CONFIGURED: No active pricing rule covers slot starting at % (local % %)',
        v_curr_start, v_local_date, v_local_time using errcode = 'P0002';
    end if;

    v_total_minor := v_total_minor + v_rule.amount_per_increment_minor;

    v_increments := v_increments || jsonb_build_object(
      'starts_at', v_curr_start,
      'ends_at', v_curr_end,
      'amount_minor', v_rule.amount_per_increment_minor,
      'rule_id', v_rule.id,
      'priority', v_rule.priority
    );

    v_curr_start := v_curr_end;
  end loop;

  -- Booking settings & cancellation policy
  select * into v_settings
  from public.turf_booking_settings
  where turf_id = v_res.turf_id;

  if found then
    select * into v_policy
    from public.cancellation_policies
    where id = v_settings.cancellation_policy_id;

    v_cancellation_snapshot := jsonb_build_object(
      'policy_id', v_policy.id,
      'name', v_policy.name,
      'version', v_policy.version,
      'rules', v_policy.rules
    );

    v_required_online_minor := round((v_total_minor * v_settings.advance_basis_points) / 10000.0);
  else
    -- Default fallback settings if not configured yet
    v_cancellation_snapshot := jsonb_build_object(
      'policy_id', null,
      'name', 'Default Non-Refundable',
      'version', 1,
      'rules', '[]'::jsonb
    );
    v_required_online_minor := v_total_minor;
  end if;

  v_pricing_snapshot := jsonb_build_object(
    'resource_id', p_resource_id,
    'increment_minutes', v_inc_minutes,
    'increments_count', v_inc_count,
    'increments', v_increments
  );

  return jsonb_build_object(
    'resource_id', p_resource_id,
    'turf_id', v_res.turf_id,
    'master_owner_id', v_res.master_owner_id,
    'currency', 'INR',
    'starts_at', p_starts_at,
    'ends_at', p_ends_at,
    'duration_minutes', v_total_minutes,
    'total_minor', v_total_minor,
    'required_online_minor', v_required_online_minor,
    'advance_basis_points', coalesce(v_settings.advance_basis_points, 10000),
    'pricing_snapshot', v_pricing_snapshot,
    'cancellation_snapshot', v_cancellation_snapshot
  );
end;
$$;

revoke all on function public.quote_booking(uuid, timestamptz, timestamptz) from public;
grant execute on function public.quote_booking(uuid, timestamptz, timestamptz) to anon, authenticated;

-- 7. Row Level Security Policies
alter table public.cancellation_policies enable row level security;
alter table public.turf_booking_settings enable row level security;
alter table public.pricing_rules enable row level security;
alter table public.slots enable row level security;

-- Default Deny & Revocations
revoke all on public.cancellation_policies from anon, authenticated;
revoke all on public.turf_booking_settings from anon, authenticated;
revoke all on public.pricing_rules from anon, authenticated;
revoke all on public.slots from anon, authenticated;

-- Cancellation policies: Public can read published policies
grant select on public.cancellation_policies to anon, authenticated;
create policy cancellation_policies_select
  on public.cancellation_policies for select to anon, authenticated
  using (true);

grant insert, update, delete on public.cancellation_policies to authenticated;
create policy cancellation_policies_write
  on public.cancellation_policies for all to authenticated
  using (
    exists (
      select 1 from public.master_owners mo
      where mo.id = cancellation_policies.master_owner_id
        and mo.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.master_owners mo
      where mo.id = cancellation_policies.master_owner_id
        and mo.owner_user_id = auth.uid()
    )
  );

-- Turf Booking Settings: Public can read settings for checkout projection
grant select on public.turf_booking_settings to anon, authenticated;
create policy turf_booking_settings_select
  on public.turf_booking_settings for select to anon, authenticated
  using (true);

grant insert, update, delete on public.turf_booking_settings to authenticated;
create policy turf_booking_settings_write
  on public.turf_booking_settings for all to authenticated
  using (private.can_turf(turf_id, 'listing.edit'))
  with check (private.can_turf(turf_id, 'listing.edit'));

-- Pricing Rules: Read by staff with pricing.read or owner; write with pricing.edit
grant select on public.pricing_rules to authenticated;
create policy pricing_rules_select
  on public.pricing_rules for select to authenticated
  using (private.can_turf(turf_id, 'pricing.read'));

grant insert, update, delete on public.pricing_rules to authenticated;
create policy pricing_rules_write
  on public.pricing_rules for all to authenticated
  using (private.can_turf(turf_id, 'pricing.edit'))
  with check (private.can_turf(turf_id, 'pricing.edit'));

-- Slots: Public can read published slots of approved turfs; staff with calendar.read
grant select on public.slots to anon, authenticated;
create policy slots_select
  on public.slots for select to anon, authenticated
  using (
    exists (
      select 1 from public.turfs t
      where t.id = slots.turf_id
        and (
          (t.approval_status = 'approved' and t.archived_at is null and slots.published = true)
          or private.can_turf(t.id, 'calendar.read')
        )
    )
  );
