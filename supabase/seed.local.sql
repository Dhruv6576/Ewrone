-- Seed Data: supabase/seed.sql
-- Idempotent seed data for Box Codex demo venues

do $$
declare
  v_owner_id uuid := 'a7204914-04e3-4c2c-a8d5-e7531db0f48f';
  v_player_id uuid := 'f5000000-0000-0000-0000-000000000001';
  v_policy_id uuid := 'e0bca48c-64bf-4fe5-842d-1bfa3fe92d6d';
  v_turf1_id uuid := '21efb282-8b54-47c2-88bc-987d9c0e208d';
  v_res1_id  uuid := 'f4138071-e886-4c85-8916-2b02f23bfd50';
  v_turf2_id uuid := '77777777-1111-1111-1111-111111111111';
  v_res2_id  uuid := '77777777-2222-2222-2222-222222222222';
  v_turf3_id uuid := '88888888-1111-1111-1111-111111111111';
  v_res3a_id uuid := '88888888-2222-2222-2222-222222222222';
  v_res3b_id uuid := '88888888-3333-3333-3333-333333333333';
  v_staff_id  uuid := '46d01037-f71d-41f2-a4bb-7571c371cf45';
  v_admin_id  uuid := 'da000000-0000-0000-0000-000000000001';
  v_emp_id    uuid := 'e1111111-1111-1111-1111-111111111111';
  v_assign_id uuid := 'a1111111-1111-1111-1111-111111111111';
  d integer;
  h integer;
  v_start_hour text;
  v_end_hour text;
begin
  -- FAIL-CLOSED SECURITY GUARD: Abort unless an explicit session opt-in is provided
  if coalesce(current_setting('app.allow_demo_seed', true), '') <> 'on' then
    raise exception 'FATAL: seed.local.sql contains demo users with static passwords and is blocked by default. To execute locally, set app.allow_demo_seed = ''on'' in this session.';
  end if;

  -- 1. Soft-archive legacy test duplicate turfs
  update public.turfs
  set archived_at = coalesce(archived_at, now())
  where id in (
    '34bf46e5-d53d-4e81-a38a-7ed0f9be0f61',
    'bdbc9d79-bd2e-491b-969c-57c0bb1324df',
    '5239f7ee-ad5b-465f-8ffb-3b2fe4f9983d',
    'b010e08f-2907-439c-9988-d9c78231f915',
    'e1e57847-b865-43a7-9a97-375e7ad41dd2',
    'de7ac8f9-f43f-49de-82ff-19185be20220',
    'ddf4e267-bcb3-4599-a842-dad1a6f2ad53',
    '3e353e38-0545-40a3-8468-80668c8392fd',
    '5e5b9f6b-cd34-46c3-b181-99f4c8ecd2f0',
    '3d977cd9-c490-4c00-bd25-32bf74a22f4a',
    '0667df2f-648f-4539-b00d-1ecae0139e87',
    'a10e279d-76f3-486b-a520-93e56d86a07d',
    'c3333333-cccc-cccc-cccc-cccccccccccc' -- M6 Arena
  );

  -- 2. Ensure Demo Master Owner and Policy Exist
  insert into auth.users (
    id, email, raw_user_meta_data, encrypted_password, aud, role, instance_id, email_confirmed_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token,
    raw_app_meta_data, created_at, updated_at
  )
  values (
    v_owner_id,
    'demo_owner@boxcodex.internal',
    '{"name": "Demo Venue Owner"}'::jsonb,
    extensions.crypt('Password123!', extensions.gen_salt('bf')),
    'authenticated',
    'authenticated',
    '00000000-0000-0000-0000-000000000000',
    now(),
    '', '', '', '',
    '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    now(),
    now()
  )
  on conflict (id) do update set
    encrypted_password = excluded.encrypted_password,
    aud = excluded.aud,
    role = excluded.role,
    instance_id = excluded.instance_id,
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, excluded.email_confirmed_at),
    confirmation_token = excluded.confirmation_token,
    recovery_token = excluded.recovery_token,
    email_change = excluded.email_change,
    email_change_token_new = excluded.email_change_token_new,
    email_change_token_current = excluded.email_change_token_current,
    phone_change = excluded.phone_change,
    phone_change_token = excluded.phone_change_token,
    reauthentication_token = excluded.reauthentication_token,
    raw_app_meta_data = excluded.raw_app_meta_data,
    created_at = coalesce(auth.users.created_at, excluded.created_at),
    updated_at = now();

  insert into auth.identities (provider_id, user_id, identity_data, provider,
                               last_sign_in_at, created_at, updated_at)
  values (v_owner_id::text,
          v_owner_id,
          jsonb_build_object('sub', v_owner_id::text,
                             'email', 'demo_owner@boxcodex.internal',
                             'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now())
  on conflict (provider_id, provider) do nothing;

  -- Ensure Demo Player Exists
  insert into auth.users (
    id, email, raw_user_meta_data, encrypted_password, aud, role, instance_id, email_confirmed_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token,
    raw_app_meta_data, created_at, updated_at
  )
  values (
    v_player_id,
    'live_player@example.com',
    '{"name": "Live Player"}'::jsonb,
    extensions.crypt('Password123!', extensions.gen_salt('bf')),
    'authenticated',
    'authenticated',
    '00000000-0000-0000-0000-000000000000',
    now(),
    '', '', '', '',
    '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    now(),
    now()
  )
  on conflict (id) do update set
    encrypted_password = excluded.encrypted_password,
    aud = excluded.aud,
    role = excluded.role,
    instance_id = excluded.instance_id,
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, excluded.email_confirmed_at),
    confirmation_token = excluded.confirmation_token,
    recovery_token = excluded.recovery_token,
    email_change = excluded.email_change,
    email_change_token_new = excluded.email_change_token_new,
    email_change_token_current = excluded.email_change_token_current,
    phone_change = excluded.phone_change,
    phone_change_token = excluded.phone_change_token,
    reauthentication_token = excluded.reauthentication_token,
    raw_app_meta_data = excluded.raw_app_meta_data,
    created_at = coalesce(auth.users.created_at, excluded.created_at),
    updated_at = now();

  insert into auth.identities (provider_id, user_id, identity_data, provider,
                               last_sign_in_at, created_at, updated_at)
  values (v_player_id::text,
          v_player_id,
          jsonb_build_object('sub', v_player_id::text,
                             'email', 'live_player@example.com',
                             'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now())
  on conflict (provider_id, provider) do nothing;

  insert into public.profiles (user_id, display_name)
  values (v_player_id, 'Live Player')
  on conflict (user_id) do update set display_name = excluded.display_name;

  insert into public.players (user_id)
  values (v_player_id)
  on conflict (user_id) do nothing;

  -- Ensure Demo Staff Exists
  insert into auth.users (
    id, email, raw_user_meta_data, encrypted_password, aud, role, instance_id, email_confirmed_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token,
    raw_app_meta_data, created_at, updated_at
  )
  values (
    v_staff_id,
    'demo_staff@boxcodex.internal',
    '{"name": "Demo Staff"}'::jsonb,
    extensions.crypt('Password123!', extensions.gen_salt('bf')),
    'authenticated',
    'authenticated',
    '00000000-0000-0000-0000-000000000000',
    now(),
    '', '', '', '',
    '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    now(),
    now()
  )
  on conflict (id) do update set
    encrypted_password = excluded.encrypted_password,
    aud = excluded.aud,
    role = excluded.role,
    instance_id = excluded.instance_id,
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, excluded.email_confirmed_at),
    confirmation_token = excluded.confirmation_token,
    recovery_token = excluded.recovery_token,
    email_change = excluded.email_change,
    email_change_token_new = excluded.email_change_token_new,
    email_change_token_current = excluded.email_change_token_current,
    phone_change = excluded.phone_change,
    phone_change_token = excluded.phone_change_token,
    reauthentication_token = excluded.reauthentication_token,
    raw_app_meta_data = excluded.raw_app_meta_data,
    created_at = coalesce(auth.users.created_at, excluded.created_at),
    updated_at = now();

  insert into auth.identities (provider_id, user_id, identity_data, provider,
                               last_sign_in_at, created_at, updated_at)
  values (v_staff_id::text,
          v_staff_id,
          jsonb_build_object('sub', v_staff_id::text,
                             'email', 'demo_staff@boxcodex.internal',
                             'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now())
  on conflict (provider_id, provider) do nothing;

  insert into public.profiles (user_id, display_name)
  values (v_staff_id, 'Demo Staff')
  on conflict (user_id) do update set display_name = excluded.display_name;

  insert into public.players (user_id)
  values (v_staff_id)
  on conflict (user_id) do nothing;

  -- Ensure Demo Platform Admin Exists
  insert into auth.users (
    id, email, raw_user_meta_data, encrypted_password, aud, role, instance_id, email_confirmed_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token,
    raw_app_meta_data, created_at, updated_at
  )
  values (
    v_admin_id,
    'demo_admin@boxcodex.internal',
    '{"name": "Demo Platform Admin"}'::jsonb,
    extensions.crypt('Password123!', extensions.gen_salt('bf')),
    'authenticated',
    'authenticated',
    '00000000-0000-0000-0000-000000000000',
    now(),
    '', '', '', '',
    '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    now(),
    now()
  )
  on conflict (id) do update set
    encrypted_password = excluded.encrypted_password,
    aud = excluded.aud,
    role = excluded.role,
    instance_id = excluded.instance_id,
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, excluded.email_confirmed_at),
    confirmation_token = excluded.confirmation_token,
    recovery_token = excluded.recovery_token,
    email_change = excluded.email_change,
    email_change_token_new = excluded.email_change_token_new,
    email_change_token_current = excluded.email_change_token_current,
    phone_change = excluded.phone_change,
    phone_change_token = excluded.phone_change_token,
    reauthentication_token = excluded.reauthentication_token,
    raw_app_meta_data = excluded.raw_app_meta_data,
    created_at = coalesce(auth.users.created_at, excluded.created_at),
    updated_at = now();

  insert into auth.identities (provider_id, user_id, identity_data, provider,
                               last_sign_in_at, created_at, updated_at)
  values (v_admin_id::text,
          v_admin_id,
          jsonb_build_object('sub', v_admin_id::text,
                             'email', 'demo_admin@boxcodex.internal',
                             'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now())
  on conflict (provider_id, provider) do nothing;

  insert into public.profiles (user_id, display_name)
  values (v_admin_id, 'Demo Platform Admin')
  on conflict (user_id) do update set display_name = excluded.display_name;

  insert into public.players (user_id)
  values (v_admin_id)
  on conflict (user_id) do nothing;

  insert into private.platform_admins (user_id, active)
  values (v_admin_id, true)
  on conflict (user_id) do update set active = true;

  insert into public.master_owners (id, owner_user_id, business_name, status)
  values (v_owner_id, v_owner_id, 'Box Codex Demo Venues', 'active')
  on conflict (id) do update set status = 'active';

  insert into public.cancellation_policies (id, master_owner_id, name, version, rules)
  values (v_policy_id, v_owner_id, 'Standard Demo Policy', 1, '[]'::jsonb)
  on conflict (id) do nothing;

  -- 3. Venue 1: The Dugout Box Cricket (Bengaluru)
  insert into public.turfs (id, master_owner_id, slug, name, address_text, city, location, approval_status, description, timezone)
  values (
    v_turf1_id, v_owner_id, 'the-dugout-indiranagar', 'The Dugout Box Cricket',
    '12 Indiranagar 100ft Road, Indiranagar', 'Bengaluru',
    extensions.st_setsrid(extensions.st_makepoint(77.6412, 12.9784), 4326),
    'approved', 'Premier floodlit AstroTurf arena featuring tournament-grade box pitch and covered dugout lounge.', 'Asia/Kolkata'
  )
  on conflict (id) do update
  set name = excluded.name,
      slug = excluded.slug,
      address_text = excluded.address_text,
      city = excluded.city,
      description = excluded.description,
      archived_at = null,
      approval_status = 'approved',
      timezone = excluded.timezone;

  insert into public.resources (id, master_owner_id, turf_id, name, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes, active)
  select v_res1_id, t.master_owner_id, t.id, 'Match Pitch A', 30, 60, 240, true
  from public.turfs t where t.id = v_turf1_id
  on conflict (id) do update set active = true;

  -- Staff affiliation & assignment for Venue 1 (placed after master_owner & turf exist)
  insert into public.employees (id, master_owner_id, user_id, status)
  values (v_emp_id, v_owner_id, v_staff_id, 'active')
  on conflict (id) do update set status = 'active';

  insert into public.employee_turf_assignments (id, employee_id, master_owner_id, turf_id, active)
  values (v_assign_id, v_emp_id, v_owner_id, v_turf1_id, true)
  on conflict (id) do update set active = true;

  insert into private.assignment_grants (assignment_id, capability, scope)
  select v_assign_id, c.code, c.scope
  from private.capabilities c
  where c.scope = 'turf'
    and c.code in (
      'bookings.read', 'bookings.create_walkin', 'calendar.read',
      'slots.block', 'turf.read', 'listing.edit', 'audit.read'
    )
  on conflict (assignment_id, capability) do nothing;

  -- 4. Venue 2: SmashBox Sports Arena (Bengaluru)
  insert into public.turfs (id, master_owner_id, slug, name, address_text, city, location, approval_status, description, timezone)
  values (
    v_turf2_id, v_owner_id, 'smashbox-arena-hsr', 'SmashBox Sports Arena',
    'Plot 88, 27th Main, Sector 1, HSR Layout', 'Bengaluru',
    extensions.st_setsrid(extensions.st_makepoint(77.6514, 12.9121), 4326),
    'approved', 'Modern multi-sport box arena with automated LED scoreboards and high-traction turf.', 'Asia/Kolkata'
  )
  on conflict (id) do update
  set name = excluded.name,
      slug = excluded.slug,
      address_text = excluded.address_text,
      city = excluded.city,
      description = excluded.description,
      archived_at = null,
      approval_status = 'approved',
      timezone = excluded.timezone;

  insert into public.resources (id, master_owner_id, turf_id, name, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes, active)
  select v_res2_id, t.master_owner_id, t.id, 'Center Court', 60, 60, 240, true
  from public.turfs t where t.id = v_turf2_id
  on conflict (id) do update set active = true;

  -- 5. Venue 3: Apex Sports Hub (Ahmedabad)
  insert into public.turfs (id, master_owner_id, slug, name, address_text, city, location, approval_status, description, timezone)
  values (
    v_turf3_id, v_owner_id, 'apex-sports-hub-bodakdev', 'Apex Sports Hub',
    'Sindhu Bhavan Road, Bodakdev', 'Ahmedabad',
    extensions.st_setsrid(extensions.st_makepoint(72.5074, 23.0373), 4326),
    'approved', 'Elite dual-court sports facility offering professional floodlights and spectator lounge.', 'Asia/Kolkata'
  )
  on conflict (id) do update
  set name = excluded.name,
      slug = excluded.slug,
      address_text = excluded.address_text,
      city = excluded.city,
      description = excluded.description,
      archived_at = null,
      approval_status = 'approved',
      timezone = excluded.timezone;

  insert into public.resources (id, master_owner_id, turf_id, name, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes, active)
  select v_res3a_id, t.master_owner_id, t.id, 'Arena Pitch 1', 60, 60, 240, true
  from public.turfs t where t.id = v_turf3_id
  on conflict (id) do update set active = true;

  insert into public.resources (id, master_owner_id, turf_id, name, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes, active)
  select v_res3b_id, t.master_owner_id, t.id, 'Arena Pitch 2', 60, 60, 240, true
  from public.turfs t where t.id = v_turf3_id
  on conflict (id) do update set active = true;

  -- Ensure Cancellation Policy exists for all demo master owners
  insert into public.cancellation_policies (id, master_owner_id, name, version, rules)
  select gen_random_uuid(), t.master_owner_id, 'Standard Demo Policy', 1, '[]'::jsonb
  from public.turfs t
  where t.id in (v_turf1_id, v_turf2_id, v_turf3_id)
    and not exists (
      select 1 from public.cancellation_policies cp where cp.master_owner_id = t.master_owner_id
    );

  -- Turf booking settings for all 3 demo venues
  insert into public.turf_booking_settings (turf_id, master_owner_id, cancellation_policy_id, advance_basis_points, booking_horizon_days, minimum_lead_minutes, hold_seconds)
  select t.id, t.master_owner_id,
         (select cp.id from public.cancellation_policies cp where cp.master_owner_id = t.master_owner_id limit 1),
         10000, 30, 60, 420
  from public.turfs t
  where t.id in (v_turf1_id, v_turf2_id, v_turf3_id)
  on conflict (turf_id) do nothing;

  -- 6. Pricing Rules (Genuinely idempotent with deterministic NOT EXISTS guard)
  insert into public.pricing_rules (master_owner_id, turf_id, resource_id, priority, valid_from, iso_weekdays, starts_local, ends_local, amount_per_increment_minor, currency, active)
  select r.master_owner_id, r.turf_id, r.id, 0, current_date - 30, array[1,2,3,4,5,6,7], '06:00:00', '23:59:59',
         case 
           when r.id = v_res1_id then 100000
           when r.id = v_res2_id then 120000
           else 150000
         end,
         'INR', true
  from public.resources r
  where r.id in (v_res1_id, v_res2_id, v_res3a_id, v_res3b_id)
    and not exists (
      select 1 from public.pricing_rules pr
      where pr.resource_id = r.id and pr.active = true
    );

  -- 7. Operating Hours for all 3 demo venues' resources (06:00-23:00, all 7 days)
  insert into public.operating_hours (resource_id, iso_weekday, opens_at, closes_at, closes_next_day, valid_from)
  select r.id, gs, '06:00:00'::time, '23:00:00'::time, false, current_date - 30
  from public.resources r
  cross join generate_series(1, 7) as gs
  where r.id in (v_res1_id, v_res2_id, v_res3a_id, v_res3b_id)
    and not exists (
      select 1 from public.operating_hours oh
      where oh.resource_id = r.id
        and oh.iso_weekday = gs
        and oh.valid_from <= current_date
        and (oh.valid_until is null or oh.valid_until >= current_date)
    );

  -- 8. Generate rolling 7-day slots for all demo resources
  for d in 0..6 loop
    for h in 6..22 loop
      v_start_hour := lpad(h::text, 2, '0');
      v_end_hour := lpad((h + 1)::text, 2, '0');

      insert into public.slots (master_owner_id, turf_id, resource_id, starts_at, ends_at, published)
      select r.master_owner_id, r.turf_id, r.id,
             ((current_date + d)::text || ' ' || v_start_hour || ':00:00+05:30')::timestamptz,
             ((current_date + d)::text || ' ' || v_end_hour || ':00:00+05:30')::timestamptz,
             true
      from public.resources r
      where r.id in (v_res1_id, v_res2_id, v_res3a_id, v_res3b_id)
      on conflict do nothing;
    end loop;
  end loop;

  -- 9. Local Worker Configuration in private.app_config
  insert into private.app_config (key, value, description, updated_at)
  values
    ('notification_worker_url', 'http://kong:8000/functions/v1/notification-worker', 'Local Kong edge function worker URL', now()),
    ('worker_secret', 'local-worker-secret-override-for-testing', 'Local worker secret', now())
  on conflict (key) do update set
    value = excluded.value,
    updated_at = now();
end $$;
