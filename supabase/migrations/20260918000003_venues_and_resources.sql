-- Migration: 20260918000003_venues_and_resources.sql
-- Description: Turfs, bookable resources, employee turf assignments, grants, sports, amenities, operating hours, and can_turf capability helper.

-- 1. Turfs (Managed Venues)
create table public.turfs (
  id uuid primary key default gen_random_uuid(),
  master_owner_id uuid not null references public.master_owners(id) on delete restrict,
  slug text not null unique,
  name text not null,
  description text not null default '',
  address_text text not null,
  city text not null,
  location extensions.geography(Point, 4326) not null,
  timezone text not null default 'Asia/Kolkata',
  approval_status text not null default 'draft'
    check (
      approval_status in (
        'draft', 'pending', 'approved', 'rejected', 'suspended'
      )
    ),
  archived_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, master_owner_id)
);

create index turfs_owner_idx on public.turfs(master_owner_id);
create index turfs_location_idx on public.turfs using gist(location);
create index turfs_public_city_idx
  on public.turfs(city, approval_status)
  where archived_at is null;

-- 2. Bookable Resources (Exclusive Inventory Ground/Court)
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  master_owner_id uuid not null,
  turf_id uuid not null,
  name text not null,
  active boolean not null default true,
  booking_increment_minutes integer not null default 30
    check (booking_increment_minutes > 0),
  minimum_duration_minutes integer not null default 60
    check (minimum_duration_minutes > 0),
  maximum_duration_minutes integer not null default 240,
  foreign key (turf_id, master_owner_id)
    references public.turfs(id, master_owner_id) on delete cascade,
  check (maximum_duration_minutes >= minimum_duration_minutes),
  unique (id, turf_id, master_owner_id)
);

create index resources_turf_idx on public.resources(turf_id);

-- 3. Employee Turf Assignments & Grants
create table public.employee_turf_assignments (
  id uuid primary key default gen_random_uuid(),
  master_owner_id uuid not null,
  employee_id uuid not null,
  turf_id uuid not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (employee_id, master_owner_id)
    references public.employees(id, master_owner_id) on delete cascade,
  foreign key (turf_id, master_owner_id)
    references public.turfs(id, master_owner_id) on delete cascade,
  unique (employee_id, turf_id),
  unique (id, master_owner_id)
);

create index assignments_turf_employee_idx
  on public.employee_turf_assignments(turf_id, employee_id)
  where active;

create table private.assignment_grants (
  assignment_id uuid not null
    references public.employee_turf_assignments(id) on delete cascade,
  capability text not null,
  scope text not null default 'turf' check (scope = 'turf'),
  max_amount_minor bigint check (max_amount_minor >= 0),
  foreign key (capability, scope)
    references private.capabilities(code, scope),
  primary key (assignment_id, capability)
);

-- 4. Sports & Amenities Catalogue
create table public.sports (
  code text primary key,
  name text not null
);

insert into public.sports (code, name) values
  ('cricket', 'Cricket'),
  ('box_cricket', 'Box Cricket'),
  ('football', 'Football'),
  ('badminton', 'Badminton'),
  ('tennis', 'Tennis'),
  ('pickleball', 'Pickleball');

create table public.resource_sports (
  resource_id uuid not null references public.resources(id) on delete cascade,
  sport_code text not null references public.sports(code) on delete cascade,
  primary key (resource_id, sport_code)
);

create table public.amenities (
  code text primary key,
  name text not null
);

insert into public.amenities (code, name) values
  ('floodlights', 'Floodlights'),
  ('parking', 'Parking'),
  ('changing_room', 'Changing Room'),
  ('drinking_water', 'Drinking Water'),
  ('washroom', 'Washroom'),
  ('canteen', 'Cafeteria / Canteen'),
  ('equipment_rental', 'Equipment Rental');

create table public.turf_amenities (
  turf_id uuid not null references public.turfs(id) on delete cascade,
  amenity_code text not null references public.amenities(code) on delete cascade,
  primary key (turf_id, amenity_code)
);

-- 5. Turf Media (Photos)
create table public.turf_photos (
  id uuid primary key default gen_random_uuid(),
  turf_id uuid not null references public.turfs(id) on delete cascade,
  storage_path text not null unique,
  sort_order integer not null default 0,
  published boolean not null default false,
  created_at timestamptz not null default now()
);

-- 6. Operating Hours & Exceptions
create table public.operating_hours (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  iso_weekday integer not null check (iso_weekday between 1 and 7),
  opens_at time not null,
  closes_at time not null,
  closes_next_day boolean not null default false,
  valid_from date not null,
  valid_until date,
  check (valid_until is null or valid_until >= valid_from)
);

create table public.operating_exceptions (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  local_date date not null,
  closed boolean not null,
  override_periods jsonb,
  reason text,
  unique (resource_id, local_date)
);

-- 7. Authoritative Security Definer Capability Helper: private.can_turf
create or replace function private.can_turf(
  p_turf_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, auth, pg_temp
as $$
  select exists (
    select 1
    from public.turfs t
    join public.master_owners mo
      on mo.id = t.master_owner_id
    join private.capabilities c
      on c.code = p_capability and c.scope = 'turf'
    where t.id = p_turf_id
      and (
        -- Master Owner authority:
        -- Active owners have all capabilities on unarchived turfs, and historical read capabilities on archived turfs.
        -- Onboarding owners have configuration capabilities to set up their unarchived venue.
        (
          mo.owner_user_id = auth.uid()
          and (
            (
              mo.status = 'active'
              and (t.archived_at is null or p_capability in ('turf.read', 'audit.read', 'finance.read'))
            )
            or (
              mo.status = 'onboarding'
              and t.archived_at is null
              and p_capability in ('turf.read', 'listing.edit', 'pricing.edit')
            )
          )
        )
        or
        -- Employee authority:
        -- Strictly requires active business, unarchived turf, active membership, active assignment, and explicit grant.
        (
          mo.status = 'active'
          and t.archived_at is null
          and exists (
            select 1
            from public.employees e
            join public.employee_turf_assignments a
              on a.employee_id = e.id
             and a.master_owner_id = e.master_owner_id
            join private.assignment_grants g
              on g.assignment_id = a.id
            where e.user_id = auth.uid()
              and e.master_owner_id = t.master_owner_id
              and e.status = 'active'
              and a.active = true
              and a.turf_id = t.id
              and g.capability = p_capability
          )
        )
      )
  );
$$;

revoke all on function private.can_turf(uuid, text) from public;
grant execute on function private.can_turf(uuid, text) to authenticated, service_role;

-- 8. Row Level Security Policies

alter table public.turfs enable row level security;
alter table public.resources enable row level security;
alter table public.employee_turf_assignments enable row level security;
alter table private.assignment_grants enable row level security;
alter table public.sports enable row level security;
alter table public.resource_sports enable row level security;
alter table public.amenities enable row level security;
alter table public.turf_amenities enable row level security;
alter table public.turf_photos enable row level security;
alter table public.operating_hours enable row level security;
alter table public.operating_exceptions enable row level security;

-- Default Deny & Revocations
revoke all on public.turfs from anon, authenticated;
revoke all on public.resources from anon, authenticated;
revoke all on public.employee_turf_assignments from anon, authenticated;
revoke all on public.sports from anon, authenticated;
revoke all on public.resource_sports from anon, authenticated;
revoke all on public.amenities from anon, authenticated;
revoke all on public.turf_amenities from anon, authenticated;
revoke all on public.turf_photos from anon, authenticated;
revoke all on public.operating_hours from anon, authenticated;
revoke all on public.operating_exceptions from anon, authenticated;

-- Turfs: Public can view approved active turfs; staff/owners view via can_turf
grant select on public.turfs to anon, authenticated;
create policy turfs_select
  on public.turfs for select to anon, authenticated
  using (
    (approval_status = 'approved' and archived_at is null)
    or private.can_turf(id, 'turf.read')
  );

grant insert on public.turfs to authenticated;
create policy turfs_insert
  on public.turfs for insert to authenticated
  with check (
    exists (
      select 1 from public.master_owners mo
      where mo.id = master_owner_id
        and mo.owner_user_id = auth.uid()
        and mo.status in ('onboarding', 'active')
    )
  );

grant update on public.turfs to authenticated;
create policy turfs_update
  on public.turfs for update to authenticated
  using (private.can_turf(id, 'listing.edit'))
  with check (private.can_turf(id, 'listing.edit'));

-- Resources: Public can view active resources of approved turfs; staff view via can_turf
grant select on public.resources to anon, authenticated;
create policy resources_select
  on public.resources for select to anon, authenticated
  using (
    exists (
      select 1 from public.turfs t
      where t.id = resources.turf_id
        and (
          (t.approval_status = 'approved' and t.archived_at is null and resources.active = true)
          or private.can_turf(t.id, 'turf.read')
        )
    )
  );

grant insert, update, delete on public.resources to authenticated;
create policy resources_write
  on public.resources for all to authenticated
  using (private.can_turf(turf_id, 'listing.edit'))
  with check (private.can_turf(turf_id, 'listing.edit'));

-- Employee Turf Assignments: Assigned employee or owning Master Owner can view
grant select on public.employee_turf_assignments to authenticated;
create policy assignments_select
  on public.employee_turf_assignments for select to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = employee_turf_assignments.employee_id
        and e.user_id = auth.uid()
    )
    or exists (
      select 1 from public.master_owners mo
      where mo.id = employee_turf_assignments.master_owner_id
        and mo.owner_user_id = auth.uid()
    )
  );

grant insert, update, delete on public.employee_turf_assignments to authenticated;
create policy assignments_write
  on public.employee_turf_assignments for all to authenticated
  using (
    exists (
      select 1 from public.master_owners mo
      where mo.id = employee_turf_assignments.master_owner_id
        and mo.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.master_owners mo
      where mo.id = employee_turf_assignments.master_owner_id
        and mo.owner_user_id = auth.uid()
    )
  );

-- Sports & Amenities: Public read
grant select on public.sports to anon, authenticated;
create policy sports_select on public.sports for select to anon, authenticated using (true);

grant select on public.amenities to anon, authenticated;
create policy amenities_select on public.amenities for select to anon, authenticated using (true);

-- Resource Sports & Turf Amenities: Public read if parent is readable
grant select on public.resource_sports to anon, authenticated;
create policy resource_sports_select
  on public.resource_sports for select to anon, authenticated
  using (
    exists (
      select 1 from public.resources r
      join public.turfs t on t.id = r.turf_id
      where r.id = resource_sports.resource_id
        and ((t.approval_status = 'approved' and t.archived_at is null) or private.can_turf(t.id, 'turf.read'))
    )
  );

grant insert, update, delete on public.resource_sports to authenticated;
create policy resource_sports_write
  on public.resource_sports for all to authenticated
  using (
    exists (
      select 1 from public.resources r
      where r.id = resource_sports.resource_id
        and private.can_turf(r.turf_id, 'listing.edit')
    )
  );

grant select on public.turf_amenities to anon, authenticated;
create policy turf_amenities_select
  on public.turf_amenities for select to anon, authenticated
  using (
    exists (
      select 1 from public.turfs t
      where t.id = turf_amenities.turf_id
        and ((t.approval_status = 'approved' and t.archived_at is null) or private.can_turf(t.id, 'turf.read'))
    )
  );

grant insert, update, delete on public.turf_amenities to authenticated;
create policy turf_amenities_write
  on public.turf_amenities for all to authenticated
  using (private.can_turf(turf_id, 'listing.edit'));

-- Turf Photos: Published are public; unpublished are restricted to staff
grant select on public.turf_photos to anon, authenticated;
create policy turf_photos_select
  on public.turf_photos for select to anon, authenticated
  using (
    published = true
    or private.can_turf(turf_id, 'turf.read')
  );

grant insert, update, delete on public.turf_photos to authenticated;
create policy turf_photos_write
  on public.turf_photos for all to authenticated
  using (private.can_turf(turf_id, 'listing.edit'))
  with check (private.can_turf(turf_id, 'listing.edit'));

-- Operating Hours & Exceptions: Readable if resource is readable
grant select on public.operating_hours to anon, authenticated;
create policy operating_hours_select
  on public.operating_hours for select to anon, authenticated
  using (
    exists (
      select 1 from public.resources r
      join public.turfs t on t.id = r.turf_id
      where r.id = operating_hours.resource_id
        and ((t.approval_status = 'approved' and t.archived_at is null) or private.can_turf(t.id, 'turf.read'))
    )
  );

grant insert, update, delete on public.operating_hours to authenticated;
create policy operating_hours_write
  on public.operating_hours for all to authenticated
  using (
    exists (
      select 1 from public.resources r
      where r.id = operating_hours.resource_id
        and private.can_turf(r.turf_id, 'listing.edit')
    )
  );

grant select on public.operating_exceptions to anon, authenticated;
create policy operating_exceptions_select
  on public.operating_exceptions for select to anon, authenticated
  using (
    exists (
      select 1 from public.resources r
      join public.turfs t on t.id = r.turf_id
      where r.id = operating_exceptions.resource_id
        and ((t.approval_status = 'approved' and t.archived_at is null) or private.can_turf(t.id, 'turf.read'))
    )
  );

grant insert, update, delete on public.operating_exceptions to authenticated;
create policy operating_exceptions_write
  on public.operating_exceptions for all to authenticated
  using (
    exists (
      select 1 from public.resources r
      where r.id = operating_exceptions.resource_id
        and private.can_turf(r.turf_id, 'listing.edit')
    )
  );
