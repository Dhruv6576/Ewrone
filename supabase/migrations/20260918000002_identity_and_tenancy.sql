-- Migration: 20260918000002_identity_and_tenancy.sql
-- Description: Core identity, Master Owner tenancy, employee memberships, platform admins, and capability catalogue.

-- 1. Profiles & Players
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.players (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  preferred_timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);

-- 2. Master Owners (The Tenant Boundary)
create table public.master_owners (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(user_id),
  business_name text not null,
  status text not null default 'onboarding'
    check (status in ('onboarding', 'active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index master_owners_owner_user_idx
  on public.master_owners(owner_user_id);

-- 3. Employees
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  master_owner_id uuid not null references public.master_owners(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id),
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  permission_version bigint not null default 1,
  created_at timestamptz not null default now(),
  unique (master_owner_id, user_id),
  unique (id, master_owner_id)
);

create index employees_user_status_idx
  on public.employees(user_id, status, master_owner_id);

-- 4. Capabilities Catalogue
create table private.capabilities (
  code text primary key,
  scope text not null check (scope in ('turf', 'owner')),
  description text not null,
  unique (code, scope)
);

-- Seed authoritative capability catalogue
insert into private.capabilities (code, scope, description) values
  ('turf.read', 'turf', 'View operational turf details'),
  ('listing.edit', 'turf', 'Edit permitted listing information'),
  ('calendar.read', 'turf', 'View operational calendar'),
  ('slots.block', 'turf', 'Create/remove operational blocks'),
  ('pricing.read', 'turf', 'View internal pricing rules'),
  ('pricing.edit', 'turf', 'Change pricing rules'),
  ('bookings.read', 'turf', 'View bookings'),
  ('bookings.create_walkin', 'turf', 'Create offline/walk-in bookings'),
  ('bookings.manage', 'turf', 'Check in players and manage operational details'),
  ('bookings.cancel', 'turf', 'Cancel bookings under allowed policy'),
  ('bookings.reschedule', 'turf', 'Move bookings under allowed policy'),
  ('payments.record_offline', 'turf', 'Record authorized cash/offline collections'),
  ('refunds.request', 'turf', 'Request a refund for a turf booking'),
  ('refunds.issue', 'turf', 'Authorize a refund within configured limits'),
  ('finance.read', 'turf', 'Read the assigned turf’s financial reporting'),
  ('analytics.read', 'turf', 'Read the assigned turf’s analytics'),
  ('audit.read', 'turf', 'Read the assigned turf’s activity'),
  ('payouts.read', 'owner', 'Read consolidated owner settlement information'),
  ('payouts.request', 'owner', 'Request release of eligible settlements');

-- 5. Platform Admins
create table private.platform_admins (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table private.admin_grants (
  user_id uuid not null references private.platform_admins(user_id) on delete cascade,
  capability text not null,
  primary key (user_id, capability)
);

-- 6. Employee Invites & Owner Grants
create table private.employee_invites (
  id uuid primary key default gen_random_uuid(),
  master_owner_id uuid not null references public.master_owners(id) on delete cascade,
  normalized_email text not null,
  token_hash text not null unique,
  proposed_assignments jsonb not null,
  invited_by uuid not null references public.profiles(user_id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table private.employee_owner_grants (
  employee_id uuid not null references public.employees(id) on delete cascade,
  capability text not null,
  scope text not null default 'owner' check (scope = 'owner'),
  foreign key (capability, scope)
    references private.capabilities(code, scope),
  primary key (employee_id, capability)
);

-- 7. Automatic User Onboarding Trigger (profiles + players)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_display_name text;
begin
  v_display_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1),
    'Player'
  );

  insert into public.profiles (user_id, display_name)
  values (new.id, v_display_name)
  on conflict (user_id) do nothing;

  insert into public.players (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 8. Core User Context RPC (get_my_context)
create or replace function public.get_my_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_uid uuid;
  v_result jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object(
      'authenticated', false,
      'user_id', null
    );
  end if;

  select jsonb_build_object(
    'authenticated', true,
    'user_id', v_uid,
    'profile', (
      select to_jsonb(p) from public.profiles p where p.user_id = v_uid
    ),
    'player', (
      select to_jsonb(pl) from public.players pl where pl.user_id = v_uid
    ),
    'master_owner_accounts', coalesce(
      (
        select jsonb_agg(to_jsonb(mo))
        from public.master_owners mo
        where mo.owner_user_id = v_uid
      ),
      '[]'::jsonb
    ),
    'employee_memberships', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'employee_id', e.id,
            'master_owner_id', e.master_owner_id,
            'business_name', mo.business_name,
            'status', e.status,
            'permission_version', e.permission_version
          )
        )
        from public.employees e
        join public.master_owners mo on mo.id = e.master_owner_id
        where e.user_id = v_uid
      ),
      '[]'::jsonb
    ),
    'is_platform_admin', exists (
      select 1 from private.platform_admins pa
      where pa.user_id = v_uid and pa.active = true
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_my_context() from public;
grant execute on function public.get_my_context() to authenticated, anon;

-- 9. Disable Employee RPC
create or replace function public.disable_employee(p_employee_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_uid uuid;
  v_emp record;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: Authentication required' using errcode = '42501';
  end if;

  select e.id, e.master_owner_id, e.user_id, e.status, mo.owner_user_id
  into v_emp
  from public.employees e
  join public.master_owners mo on mo.id = e.master_owner_id
  where e.id = p_employee_id;

  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND: Employee record not found' using errcode = 'P0002';
  end if;

  -- Only the owning Master Owner can disable an employee
  if v_emp.owner_user_id <> v_uid then
    raise exception 'PERM_DENIED: Only the Master Owner can disable an employee' using errcode = '42501';
  end if;

  update public.employees
  set status = 'disabled',
      permission_version = permission_version + 1
  where id = p_employee_id;

  return jsonb_build_object(
    'employee_id', p_employee_id,
    'status', 'disabled',
    'revoked_at', now()
  );
end;
$$;

revoke all on function public.disable_employee(uuid) from public;
grant execute on function public.disable_employee(uuid) to authenticated;

-- 10. Row Level Security Policies
alter table public.profiles enable row level security;
alter table public.players enable row level security;
alter table public.master_owners enable row level security;
alter table public.employees enable row level security;

alter table private.capabilities enable row level security;
alter table private.platform_admins enable row level security;
alter table private.admin_grants enable row level security;
alter table private.employee_invites enable row level security;
alter table private.employee_owner_grants enable row level security;

-- Default Deny & Revocations
revoke all on public.profiles from anon, authenticated;
revoke all on public.players from anon, authenticated;
revoke all on public.master_owners from anon, authenticated;
revoke all on public.employees from anon, authenticated;

-- Profiles: Users can view their own profile; authenticated users can update their own profile
grant select, update on public.profiles to authenticated;
create policy profiles_select_self
  on public.profiles for select to authenticated
  using (user_id = auth.uid());

create policy profiles_update_self
  on public.profiles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Players: Users can view and update their own player record
grant select, update on public.players to authenticated;
create policy players_select_self
  on public.players for select to authenticated
  using (user_id = auth.uid());

create policy players_update_self
  on public.players for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Master Owners: Owning user, active business employee, or platform admin can read
grant select on public.master_owners to authenticated;
create policy master_owners_select
  on public.master_owners for select to authenticated
  using (
    owner_user_id = auth.uid()
    or exists (
      select 1 from public.employees e
      where e.master_owner_id = master_owners.id
        and e.user_id = auth.uid()
        and e.status = 'active'
    )
    or exists (
      select 1 from private.platform_admins pa
      where pa.user_id = auth.uid()
        and pa.active = true
    )
  );

-- Master Owners insert: Only authenticated user creating their own business
grant insert on public.master_owners to authenticated;
create policy master_owners_insert
  on public.master_owners for insert to authenticated
  with check (owner_user_id = auth.uid());

-- Employees: Self membership or owning Master Owner can view
grant select on public.employees to authenticated;
create policy employees_select
  on public.employees for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.master_owners mo
      where mo.id = employees.master_owner_id
        and mo.owner_user_id = auth.uid()
    )
  );
