-- Migration: 20260918000005_inventory_and_holds.sql
-- Description: Inventory allocations with exclusion constraints, bookings, booking slots, contacts, hold transactions, and locking.

-- 1. Commission Rules (Needed for booking commission snapshots)
create table private.commission_rules (
  id uuid primary key default gen_random_uuid(),
  master_owner_id uuid references public.master_owners(id) on delete cascade,
  basis_points integer not null check (basis_points between 0 and 10000),
  fixed_minor bigint not null default 0 check (fixed_minor >= 0),
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  version integer not null default 1,
  created_by uuid references public.profiles(user_id),
  check (effective_until is null or effective_until > effective_from)
);

-- Seed default platform commission rule: 10% (1000 bps)
insert into private.commission_rules (basis_points, fixed_minor, version)
values (1000, 0, 1);

-- 2. API Idempotency
create table private.api_idempotency (
  actor_user_id uuid not null references public.profiles(user_id) on delete cascade,
  operation text not null,
  idempotency_key text not null,
  request_hash text not null,
  response_json jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (actor_user_id, operation, idempotency_key)
);

-- 3. Bookings
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique,
  master_owner_id uuid not null,
  turf_id uuid not null,
  resource_id uuid not null,
  player_user_id uuid references public.players(user_id),
  created_by uuid not null references public.profiles(user_id),
  source text not null check (source in ('online', 'walkin')),
  status text not null default 'held'
    check (
      status in (
        'held', 'confirmed', 'cancelled', 'expired',
        'completed', 'no_show', 'payment_exception'
      )
    ),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  hold_expires_at timestamptz,
  total_minor bigint not null check (total_minor >= 0),
  required_online_minor bigint not null check (required_online_minor >= 0),
  currency text not null default 'INR',
  pricing_snapshot jsonb not null,
  cancellation_snapshot jsonb not null,
  commission_snapshot jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  foreign key (resource_id, turf_id, master_owner_id)
    references public.resources(id, turf_id, master_owner_id) on delete restrict,
  check (ends_at > starts_at),
  check (required_online_minor <= total_minor),
  check (source <> 'online' or player_user_id is not null),
  check (status <> 'held' or hold_expires_at is not null),
  unique (id, master_owner_id),
  unique (id, resource_id, turf_id, master_owner_id)
);

create index bookings_player_history_idx
  on public.bookings(player_user_id, created_at desc);
create index bookings_turf_calendar_idx
  on public.bookings(turf_id, starts_at, status);
create index bookings_owner_history_idx
  on public.bookings(master_owner_id, created_at desc);
create index bookings_expiry_idx
  on public.bookings(hold_expires_at)
  where status = 'held';

-- 4. Booking Slots (Constituent publishable slots reserved by booking)
create table public.booking_slots (
  booking_id uuid not null,
  slot_id uuid not null,
  resource_id uuid not null,
  turf_id uuid not null,
  master_owner_id uuid not null,
  quoted_amount_minor bigint not null check (quoted_amount_minor >= 0),
  foreign key (booking_id, resource_id, turf_id, master_owner_id)
    references public.bookings(id, resource_id, turf_id, master_owner_id) on delete cascade,
  foreign key (slot_id, resource_id, turf_id, master_owner_id)
    references public.slots(id, resource_id, turf_id, master_owner_id) on delete restrict,
  primary key (booking_id, slot_id)
);

-- 5. Inventory Allocations (Postgres Exclusive Inventory Layer)
create table public.inventory_allocations (
  id uuid primary key default gen_random_uuid(),
  master_owner_id uuid not null,
  turf_id uuid not null,
  resource_id uuid not null,
  booking_id uuid,
  kind text not null check (kind in ('hold', 'booking', 'block')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  occupied_period tstzrange generated always as (
    tstzrange(starts_at, ends_at, '[)')
  ) stored,
  expires_at timestamptz,
  released_at timestamptz,
  reason text,
  created_by uuid references public.profiles(user_id),
  created_at timestamptz not null default now(),
  foreign key (resource_id, turf_id, master_owner_id)
    references public.resources(id, turf_id, master_owner_id) on delete cascade,
  -- Crucial FK fix approved in Question 2: references bookings(id, master_owner_id)
  -- so that future rescheduling does not violate FK on past released allocations!
  foreign key (booking_id, master_owner_id)
    references public.bookings(id, master_owner_id) on delete cascade,
  check (ends_at > starts_at),
  check (
    (kind = 'block' and booking_id is null)
    or
    (kind in ('hold', 'booking') and booking_id is not null)
  ),
  check (kind <> 'hold' or expires_at is not null)
);

-- Range Exclusion Constraint for zero-overlap guarantee
alter table public.inventory_allocations
  add constraint inventory_no_overlap
  exclude using gist (
    resource_id with =,
    occupied_period with &&
  )
  where (released_at is null);

create unique index inventory_one_active_allocation_per_booking
  on public.inventory_allocations(booking_id)
  where booking_id is not null and released_at is null;

create index inventory_expiring_holds_idx
  on public.inventory_allocations(expires_at)
  where released_at is null and kind = 'hold';

-- 6. Booking Events & Private Contacts
create table public.booking_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  event_type text not null,
  public_summary text not null,
  created_at timestamptz not null default now()
);

create table private.booking_contacts (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  contact_name text not null,
  contact_phone text,
  contact_email text,
  retention_until timestamptz
);

-- 7. Opportunistic / Batch Hold Expiry Stored Procedure
create or replace function private.expire_booking_holds()
returns integer
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_expired_count integer := 0;
  v_rec record;
begin
  for v_rec in
    select id, booking_id, resource_id
    from public.inventory_allocations
    where kind = 'hold'
      and released_at is null
      and expires_at < now()
    for update skip locked
  loop
    -- Mark allocation released
    update public.inventory_allocations
    set released_at = now()
    where id = v_rec.id;

    -- Mark booking expired
    if v_rec.booking_id is not null then
      update public.bookings
      set status = 'expired',
          version = version + 1
      where id = v_rec.booking_id
        and status = 'held';

      insert into public.booking_events (booking_id, event_type, public_summary)
      values (v_rec.booking_id, 'hold_expired', 'Hold expired due to timeout');
    end if;

    v_expired_count := v_expired_count + 1;
  end loop;

  return v_expired_count;
end;
$$;

revoke all on function private.expire_booking_holds() from public;
grant execute on function private.expire_booking_holds() to authenticated, service_role;

-- 8. Transactional create_booking_hold RPC
create or replace function public.create_booking_hold(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_idempotency_key text,
  p_contact_name text default null,
  p_contact_phone text default null,
  p_contact_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_uid uuid;
  v_profile record;
  v_cached_response jsonb;
  v_req_hash text;
  v_res record;
  v_settings record;
  v_quote jsonb;
  v_hold_seconds integer;
  v_hold_expires_at timestamptz;
  v_booking_id uuid;
  v_ref_code text;
  v_alloc_id uuid;
  v_comm_rule record;
  v_comm_snapshot jsonb;
  v_slot record;
  v_inc record;
  v_inc_start timestamptz;
  v_inc_end timestamptz;
  v_inc_interval interval;
  v_result jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: Authentication required to create booking hold' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where user_id = v_uid;
  if not found then
    raise exception 'PROFILE_NOT_FOUND: User profile does not exist' using errcode = 'P0002';
  end if;

  if p_idempotency_key is null or trim(p_idempotency_key) = '' then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED: An idempotency key is required' using errcode = '22023';
  end if;

  v_req_hash := md5(p_resource_id::text || ':' || p_starts_at::text || ':' || p_ends_at::text);

  -- Step 2: Check Idempotency Table
  select response_json into v_cached_response
  from private.api_idempotency
  where actor_user_id = v_uid
    and operation = 'create_booking_hold'
    and idempotency_key = p_idempotency_key;

  if v_cached_response is not null then
    return v_cached_response;
  end if;

  -- Step 3: SERIALIZE ON THE RESOURCE ROW
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

  -- Step 4: Verification of active venue & business
  if not v_res.active or v_res.archived_at is not null or v_res.approval_status <> 'approved' or v_res.owner_status <> 'active' then
    raise exception 'RESOURCE_UNAVAILABLE: Venue is not active, not approved, or suspended' using errcode = '22023';
  end if;

  -- Step 5: Opportunistic Expiry of stale holds on this resource
  update public.inventory_allocations
  set released_at = now()
  where resource_id = p_resource_id
    and kind = 'hold'
    and released_at is null
    and expires_at < now();

  -- Step 6: JIT Slot Materialization
  perform private.generate_resource_slots(
    p_resource_id,
    (p_starts_at at time zone v_res.timezone)::date,
    (p_ends_at at time zone v_res.timezone)::date
  );

  -- Step 7: Authoritative Pricing Quote Calculation
  v_quote := public.quote_booking(p_resource_id, p_starts_at, p_ends_at);

  -- Fetch booking settings for hold TTL
  select * into v_settings from public.turf_booking_settings where turf_id = v_res.turf_id;
  v_hold_seconds := coalesce(v_settings.hold_seconds, 420);
  v_hold_expires_at := now() + (v_hold_seconds || ' seconds')::interval;

  -- Commission Snapshot
  select basis_points, fixed_minor into v_comm_rule
  from private.commission_rules
  where (master_owner_id = v_res.master_owner_id or master_owner_id is null)
    and effective_from <= now()
    and (effective_until is null or effective_until > now())
  order by master_owner_id nulls last, version desc
  limit 1;

  v_comm_snapshot := jsonb_build_object(
    'basis_points', coalesce(v_comm_rule.basis_points, 1000),
    'fixed_minor', coalesce(v_comm_rule.fixed_minor, 0),
    'estimated_commission_minor', round(((v_quote->>'total_minor')::bigint * coalesce(v_comm_rule.basis_points, 1000)) / 10000.0) + coalesce(v_comm_rule.fixed_minor, 0)
  );

  -- Unique booking reference code
  v_ref_code := 'BK-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
  v_booking_id := gen_random_uuid();

  -- Step 10: Insert Booking record (status = 'held')
  insert into public.bookings (
    id, reference_code, master_owner_id, turf_id, resource_id,
    player_user_id, created_by, source, status,
    starts_at, ends_at, hold_expires_at,
    total_minor, required_online_minor, currency,
    pricing_snapshot, cancellation_snapshot, commission_snapshot
  ) values (
    v_booking_id, v_ref_code, v_res.master_owner_id, v_res.turf_id, p_resource_id,
    v_uid, v_uid, 'online', 'held',
    p_starts_at, p_ends_at, v_hold_expires_at,
    (v_quote->>'total_minor')::bigint, (v_quote->>'required_online_minor')::bigint, 'INR',
    v_quote->'pricing_snapshot', v_quote->'cancellation_snapshot', v_comm_snapshot
  );

  -- Step 11: Insert Inventory Allocation (Exclusion constraint protects here)
  begin
    insert into public.inventory_allocations (
      master_owner_id, turf_id, resource_id, booking_id,
      kind, starts_at, ends_at, expires_at, created_by
    ) values (
      v_res.master_owner_id, v_res.turf_id, p_resource_id, v_booking_id,
      'hold', p_starts_at, p_ends_at, v_hold_expires_at, v_uid
    ) returning id into v_alloc_id;
  exception
    when exclusion_violation then
      raise exception 'SLOT_UNAVAILABLE: This time interval is no longer available' using errcode = '23P01';
  end;

  -- Step 12: Map constituent booking_slots
  v_inc_interval := (v_res.booking_increment_minutes || ' minutes')::interval;
  v_inc_start := p_starts_at;
  while v_inc_start < p_ends_at loop
    v_inc_end := v_inc_start + v_inc_interval;

    select id into v_slot
    from public.slots
    where resource_id = p_resource_id
      and starts_at = v_inc_start;

    if found then
      insert into public.booking_slots (
        booking_id, slot_id, resource_id, turf_id, master_owner_id, quoted_amount_minor
      ) values (
        v_booking_id, v_slot.id, p_resource_id, v_res.turf_id, v_res.master_owner_id,
        round((v_quote->>'total_minor')::bigint / ((v_quote->'pricing_snapshot'->>'increments_count')::int))
      ) on conflict do nothing;
    end if;

    v_inc_start := v_inc_end;
  end loop;

  -- Step 13: Booking Contact
  insert into private.booking_contacts (
    booking_id, contact_name, contact_phone, contact_email
  ) values (
    v_booking_id,
    coalesce(p_contact_name, v_profile.display_name),
    p_contact_phone,
    p_contact_email
  );

  -- Step 14: Booking Event
  insert into public.booking_events (booking_id, event_type, public_summary)
  values (v_booking_id, 'hold_created', 'Booking hold created. Awaiting checkout payment.');

  -- Construct Response
  v_result := jsonb_build_object(
    'booking_id', v_booking_id,
    'reference_code', v_ref_code,
    'status', 'held',
    'resource_id', p_resource_id,
    'turf_id', v_res.turf_id,
    'starts_at', p_starts_at,
    'ends_at', p_ends_at,
    'hold_expires_at', v_hold_expires_at,
    'hold_seconds', v_hold_seconds,
    'total_minor', (v_quote->>'total_minor')::bigint,
    'required_online_minor', (v_quote->>'required_online_minor')::bigint,
    'currency', 'INR'
  );

  -- Step 15: Cache in Idempotency table
  insert into private.api_idempotency (
    actor_user_id, operation, idempotency_key, request_hash, response_json, expires_at
  ) values (
    v_uid, 'create_booking_hold', p_idempotency_key, v_req_hash, v_result, now() + interval '24 hours'
  );

  return v_result;
end;
$$;

revoke all on function public.create_booking_hold(uuid, timestamptz, timestamptz, text, text, text, text) from public;
grant execute on function public.create_booking_hold(uuid, timestamptz, timestamptz, text, text, text, text) to authenticated;

-- 9. Operational Maintenance Blocks RPCs
create or replace function public.block_resource_time(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text default 'Maintenance Block'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_res record;
  v_alloc_id uuid;
begin
  select r.id, r.turf_id, r.master_owner_id
  into v_res
  from public.resources r
  where r.id = p_resource_id
  for update;

  if not found then
    raise exception 'RESOURCE_NOT_FOUND: Resource not found' using errcode = 'P0002';
  end if;

  if not private.can_turf(v_res.turf_id, 'slots.block') then
    raise exception 'PERM_DENIED: slots.block capability required' using errcode = '42501';
  end if;

  begin
    insert into public.inventory_allocations (
      master_owner_id, turf_id, resource_id, booking_id,
      kind, starts_at, ends_at, reason, created_by
    ) values (
      v_res.master_owner_id, v_res.turf_id, p_resource_id, null,
      'block', p_starts_at, p_ends_at, p_reason, auth.uid()
    ) returning id into v_alloc_id;
  exception
    when exclusion_violation then
      raise exception 'SLOT_UNAVAILABLE: Time range overlaps with existing reservation' using errcode = '23P01';
  end;

  return jsonb_build_object(
    'allocation_id', v_alloc_id,
    'resource_id', p_resource_id,
    'kind', 'block',
    'starts_at', p_starts_at,
    'ends_at', p_ends_at,
    'reason', p_reason
  );
end;
$$;

revoke all on function public.block_resource_time(uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.block_resource_time(uuid, timestamptz, timestamptz, text) to authenticated;

create or replace function public.release_resource_block(p_allocation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_alloc record;
begin
  select a.id, a.turf_id, a.kind, a.released_at
  into v_alloc
  from public.inventory_allocations a
  where a.id = p_allocation_id
  for update;

  if not found or v_alloc.kind <> 'block' then
    raise exception 'BLOCK_NOT_FOUND: Maintenance block allocation not found' using errcode = 'P0002';
  end if;

  if not private.can_turf(v_alloc.turf_id, 'slots.block') then
    raise exception 'PERM_DENIED: slots.block capability required' using errcode = '42501';
  end if;

  update public.inventory_allocations
  set released_at = now()
  where id = p_allocation_id;

  return jsonb_build_object(
    'allocation_id', p_allocation_id,
    'released_at', now()
  );
end;
$$;

revoke all on function public.release_resource_block(uuid) from public;
grant execute on function public.release_resource_block(uuid) to authenticated;

-- 10. Restricted Booking Contact RPC
create or replace function public.get_booking_contact(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_b record;
  v_c record;
begin
  select b.id, b.turf_id, b.player_user_id
  into v_b
  from public.bookings b
  where b.id = p_booking_id;

  if not found then
    raise exception 'BOOKING_NOT_FOUND: Booking not found' using errcode = 'P0002';
  end if;

  if auth.uid() <> v_b.player_user_id and not private.can_turf(v_b.turf_id, 'bookings.manage') and not private.can_turf(v_b.turf_id, 'bookings.read') then
    raise exception 'PERM_DENIED: Unauthorized to read booking contact information' using errcode = '42501';
  end if;

  select * into v_c from private.booking_contacts where booking_id = p_booking_id;

  return jsonb_build_object(
    'booking_id', p_booking_id,
    'contact_name', v_c.contact_name,
    'contact_phone', v_c.contact_phone,
    'contact_email', v_c.contact_email
  );
end;
$$;

revoke all on function public.get_booking_contact(uuid) from public;
grant execute on function public.get_booking_contact(uuid) to authenticated;

-- 11. Row Level Security Policies
alter table public.bookings enable row level security;
alter table public.booking_slots enable row level security;
alter table public.inventory_allocations enable row level security;
alter table public.booking_events enable row level security;
alter table private.booking_contacts enable row level security;
alter table private.api_idempotency enable row level security;
alter table private.commission_rules enable row level security;

-- Default Deny & Revocations
revoke all on public.bookings from anon, authenticated;
revoke all on public.booking_slots from anon, authenticated;
revoke all on public.inventory_allocations from anon, authenticated;
revoke all on public.booking_events from anon, authenticated;

-- Bookings read: Player can read own bookings; staff with bookings.read can read turf bookings
grant select on public.bookings to authenticated;
create policy bookings_select
  on public.bookings for select to authenticated
  using (
    player_user_id = auth.uid()
    or private.can_turf(turf_id, 'bookings.read')
  );

-- Booking Slots read: Same as parent booking
grant select on public.booking_slots to authenticated;
create policy booking_slots_select
  on public.booking_slots for select to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_slots.booking_id
        and (b.player_user_id = auth.uid() or private.can_turf(b.turf_id, 'bookings.read'))
    )
  );

-- Inventory Allocations read: Operational staff with calendar.read
grant select on public.inventory_allocations to authenticated;
create policy inventory_allocations_select
  on public.inventory_allocations for select to authenticated
  using (private.can_turf(turf_id, 'calendar.read'));

-- Booking Events read: Same as parent booking
grant select on public.booking_events to authenticated;
create policy booking_events_select
  on public.booking_events for select to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_events.booking_id
        and (b.player_user_id = auth.uid() or private.can_turf(b.turf_id, 'bookings.read'))
    )
  );
