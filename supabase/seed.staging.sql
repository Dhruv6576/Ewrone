-- supabase/seed.staging.sql
-- Idempotent staging environment seed for Box Codex team onboarding
-- Targets hosted staging database: akbndqzrnqxyckldboaw

do $$
declare
  v_owner_id   uuid := 'a7204914-04e3-4c2c-a8d5-e7531db0f48f';
  v_player_id  uuid := 'f5000000-0000-0000-0000-000000000001';
  v_staff_id   uuid := '46d01037-f71d-41f2-a4bb-7571c371cf45';
  v_admin_id   uuid := 'da000000-0000-0000-0000-000000000001';

  v_policy_id  uuid := 'e0bca48c-64bf-4fe5-842d-1bfa3fe92d6d';

  v_turf1_id   uuid := '21efb282-8b54-47c2-88bc-987d9c0e208d';
  v_res1_id    uuid := 'f4138071-e886-4c85-8916-2b02f23bfd50';

  v_turf2_id   uuid := '77777777-1111-1111-1111-111111111111';
  v_res2_id    uuid := '77777777-2222-2222-2222-222222222222';

  v_turf3_id   uuid := '88888888-1111-1111-1111-111111111111';
  v_res3a_id   uuid := '88888888-2222-2222-2222-222222222222';
  v_res3b_id   uuid := '88888888-3333-3333-3333-333333333333';

  v_emp_id     uuid := 'e1111111-1111-1111-1111-111111111111';
  v_assign_id  uuid := 'a1111111-1111-1111-1111-111111111111';

  v_booking1_id uuid := 'b1111111-1111-1111-1111-111111111111';
  v_booking2_id uuid := 'b2222222-2222-2222-2222-222222222222';

  d integer;
  h integer;
  v_start_hour text;
  v_end_hour   text;
begin
  -- --------------------------------------------------------------------------
  -- 1. Demo Auth Users & Identities (Password: Password123!)
  -- --------------------------------------------------------------------------

  -- 1.1 Master Venue Owner: demo_owner@boxcodex.internal
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
    'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(),
    '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb, now(), now()
  )
  on conflict (id) do update set
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, excluded.email_confirmed_at),
    updated_at = now();

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_owner_id::text, v_owner_id,
          jsonb_build_object('sub', v_owner_id::text, 'email', 'demo_owner@boxcodex.internal', 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now())
  on conflict (provider_id, provider) do nothing;

  -- 1.2 Live Player: live_player@example.com
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
    'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(),
    '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb, now(), now()
  )
  on conflict (id) do update set
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, excluded.email_confirmed_at),
    updated_at = now();

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_player_id::text, v_player_id,
          jsonb_build_object('sub', v_player_id::text, 'email', 'live_player@example.com', 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now())
  on conflict (provider_id, provider) do nothing;

  -- 1.3 Staff Member: demo_staff@boxcodex.internal
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
    'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(),
    '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb, now(), now()
  )
  on conflict (id) do update set
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, excluded.email_confirmed_at),
    updated_at = now();

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_staff_id::text, v_staff_id,
          jsonb_build_object('sub', v_staff_id::text, 'email', 'demo_staff@boxcodex.internal', 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now())
  on conflict (provider_id, provider) do nothing;

  -- 1.4 Platform Admin: demo_admin@boxcodex.internal
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
    'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(),
    '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb, now(), now()
  )
  on conflict (id) do update set
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, excluded.email_confirmed_at),
    updated_at = now();

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_admin_id::text, v_admin_id,
          jsonb_build_object('sub', v_admin_id::text, 'email', 'demo_admin@boxcodex.internal', 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now())
  on conflict (provider_id, provider) do nothing;

  -- --------------------------------------------------------------------------
  -- 2. Profiles & Roles (Trigger on_auth_user_created auto-inserts, update names)
  -- --------------------------------------------------------------------------
  insert into public.profiles (user_id, display_name) values
    (v_owner_id, 'Demo Venue Owner'),
    (v_player_id, 'Live Player'),
    (v_staff_id, 'Demo Staff'),
    (v_admin_id, 'Demo Platform Admin')
  on conflict (user_id) do update set display_name = excluded.display_name;

  -- Platform Admin Privilege for demo_admin
  insert into private.platform_admins (user_id, active)
  values (v_admin_id, true)
  on conflict (user_id) do update set active = true;

  -- --------------------------------------------------------------------------
  -- 3. Master Owner & Cancellation Policy
  -- --------------------------------------------------------------------------
  -- NOTE: public.master_owners uses owner_user_id (NOT user_id)
  insert into public.master_owners (id, owner_user_id, business_name, status)
  values (v_owner_id, v_owner_id, 'Box Codex Demo Venues', 'active')
  on conflict (id) do update set status = 'active';

  insert into public.cancellation_policies (id, master_owner_id, name, version, rules)
  values (v_policy_id, v_owner_id, 'Standard Demo Policy', 1, '[]'::jsonb)
  on conflict (id) do nothing;

  -- --------------------------------------------------------------------------
  -- 4. Three Approved Demo Turfs & Resources
  -- --------------------------------------------------------------------------

  -- 4.1 Turf 1: The Dugout Box Cricket (Bengaluru)
  insert into public.turfs (id, master_owner_id, slug, name, address_text, city, location, approval_status, description, timezone)
  values (
    v_turf1_id, v_owner_id, 'the-dugout-indiranagar', 'The Dugout Box Cricket',
    '12 Indiranagar 100ft Road, Indiranagar', 'Bengaluru',
    extensions.st_setsrid(extensions.st_makepoint(77.6412, 12.9784), 4326),
    'approved', 'Premier floodlit AstroTurf arena featuring tournament-grade box pitch and covered dugout lounge.', 'Asia/Kolkata'
  )
  on conflict (id) do update set
    name = excluded.name,
    slug = excluded.slug,
    address_text = excluded.address_text,
    city = excluded.city,
    description = excluded.description,
    archived_at = null,
    approval_status = 'approved',
    timezone = excluded.timezone;

  insert into public.resources (id, master_owner_id, turf_id, name, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes, active)
  values (v_res1_id, v_owner_id, v_turf1_id, 'Match Pitch A', 30, 60, 240, true)
  on conflict (id) do update set active = true;

  -- Staff affiliation & assignment for Turf 1
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
      'bookings.read', 'bookings.create_walkin', 'payments.record_offline', 'calendar.read',
      'slots.block', 'turf.read', 'listing.edit', 'audit.read'
    )
  on conflict (assignment_id, capability) do nothing;

  -- 4.2 Turf 2: SmashBox Sports Arena (Bengaluru)
  insert into public.turfs (id, master_owner_id, slug, name, address_text, city, location, approval_status, description, timezone)
  values (
    v_turf2_id, v_owner_id, 'smashbox-arena-hsr', 'SmashBox Sports Arena',
    'Plot 88, 27th Main, Sector 1, HSR Layout', 'Bengaluru',
    extensions.st_setsrid(extensions.st_makepoint(77.6514, 12.9121), 4326),
    'approved', 'Modern multi-sport box arena with automated LED scoreboards and high-traction turf.', 'Asia/Kolkata'
  )
  on conflict (id) do update set
    name = excluded.name,
    slug = excluded.slug,
    address_text = excluded.address_text,
    city = excluded.city,
    description = excluded.description,
    archived_at = null,
    approval_status = 'approved',
    timezone = excluded.timezone;

  insert into public.resources (id, master_owner_id, turf_id, name, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes, active)
  values (v_res2_id, v_owner_id, v_turf2_id, 'Center Court', 60, 60, 240, true)
  on conflict (id) do update set active = true;

  -- 4.3 Turf 3: Apex Sports Hub (Ahmedabad)
  insert into public.turfs (id, master_owner_id, slug, name, address_text, city, location, approval_status, description, timezone)
  values (
    v_turf3_id, v_owner_id, 'apex-sports-hub-bodakdev', 'Apex Sports Hub',
    'Sindhu Bhavan Road, Bodakdev', 'Ahmedabad',
    extensions.st_setsrid(extensions.st_makepoint(72.5074, 23.0373), 4326),
    'approved', 'Elite dual-court sports facility offering professional floodlights and spectator lounge.', 'Asia/Kolkata'
  )
  on conflict (id) do update set
    name = excluded.name,
    slug = excluded.slug,
    address_text = excluded.address_text,
    city = excluded.city,
    description = excluded.description,
    archived_at = null,
    approval_status = 'approved',
    timezone = excluded.timezone;

  insert into public.resources (id, master_owner_id, turf_id, name, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes, active)
  values (v_res3a_id, v_owner_id, v_turf3_id, 'Arena Pitch 1', 60, 60, 240, true)
  on conflict (id) do update set active = true;

  insert into public.resources (id, master_owner_id, turf_id, name, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes, active)
  values (v_res3b_id, v_owner_id, v_turf3_id, 'Arena Pitch 2', 60, 60, 240, true)
  on conflict (id) do update set active = true;

  -- Turf booking settings
  insert into public.turf_booking_settings (turf_id, master_owner_id, cancellation_policy_id, advance_basis_points, booking_horizon_days, minimum_lead_minutes, hold_seconds)
  select t.id, t.master_owner_id, v_policy_id, 10000, 30, 60, 420
  from public.turfs t
  where t.id in (v_turf1_id, v_turf2_id, v_turf3_id)
  on conflict (turf_id) do nothing;

  -- --------------------------------------------------------------------------
  -- 5. Operating Hours & Pricing Rules
  -- --------------------------------------------------------------------------

  -- 5.1 Operating Hours (06:00 to 23:00, 7 days)
  insert into public.operating_hours (resource_id, iso_weekday, opens_at, closes_at, closes_next_day, valid_from)
  select r.id, gs, '06:00:00'::time, '23:00:00'::time, false, current_date - 30
  from public.resources r
  cross join generate_series(1, 7) as gs
  where r.id in (v_res1_id, v_res2_id, v_res3a_id, v_res3b_id)
    and not exists (
      select 1 from public.operating_hours oh
      where oh.resource_id = r.id and oh.iso_weekday = gs and oh.valid_from <= current_date
        and (oh.valid_until is null or oh.valid_until >= current_date)
    );

  -- 5.2 Pricing Rules
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

  -- --------------------------------------------------------------------------
  -- 6. Generate Rolling 7-Day Slots
  -- --------------------------------------------------------------------------
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

  -- --------------------------------------------------------------------------
  -- 7. Two Seed Bookings (One Confirmed, One Cancelled)
  -- --------------------------------------------------------------------------

  -- 7.1 Booking 1: Confirmed Booking (Tomorrow 18:00 - 19:00 on Match Pitch A)
  insert into public.bookings (
    id, reference_code, master_owner_id, turf_id, resource_id, player_user_id, created_by,
    source, status, starts_at, ends_at, total_minor, required_online_minor, currency,
    pricing_snapshot, cancellation_snapshot, commission_snapshot, version, created_at, confirmed_at
  )
  values (
    v_booking1_id,
    'BK-STG-CONFIRMED-001',
    v_owner_id,
    v_turf1_id,
    v_res1_id,
    v_player_id,
    v_player_id,
    'online',
    'confirmed',
    ((current_date + 1)::text || ' 18:00:00+05:30')::timestamptz,
    ((current_date + 1)::text || ' 19:00:00+05:30')::timestamptz,
    100000,
    100000,
    'INR',
    '{"base_rate": 100000, "duration_minutes": 60}'::jsonb,
    '{"policy": "Standard Demo Policy", "refund_percentage": 100}'::jsonb,
    '{"platform_rate_bps": 1000, "commission_minor": 10000}'::jsonb,
    1,
    now() - interval '2 hours',
    now() - interval '1 hour 50 minutes'
  )
  on conflict (id) do nothing;

  -- Allocation for confirmed booking
  insert into public.inventory_allocations (
    id, master_owner_id, turf_id, resource_id, booking_id, kind, starts_at, ends_at,
    released_at, created_by, created_at
  )
  values (
    'a1000000-0000-0000-0000-000000000001',
    v_owner_id,
    v_turf1_id,
    v_res1_id,
    v_booking1_id,
    'booking',
    ((current_date + 1)::text || ' 18:00:00+05:30')::timestamptz,
    ((current_date + 1)::text || ' 19:00:00+05:30')::timestamptz,
    null,
    v_player_id,
    now() - interval '2 hours'
  )
  on conflict (id) do nothing;

  -- 7.2 Booking 2: Cancelled Booking (Day after tomorrow 10:00 - 11:00 on Match Pitch A)
  insert into public.bookings (
    id, reference_code, master_owner_id, turf_id, resource_id, player_user_id, created_by,
    source, status, starts_at, ends_at, total_minor, required_online_minor, currency,
    pricing_snapshot, cancellation_snapshot, commission_snapshot, version, created_at, confirmed_at, cancelled_at
  )
  values (
    v_booking2_id,
    'BK-STG-CANCELLED-002',
    v_owner_id,
    v_turf1_id,
    v_res1_id,
    v_player_id,
    v_player_id,
    'online',
    'cancelled',
    ((current_date + 2)::text || ' 10:00:00+05:30')::timestamptz,
    ((current_date + 2)::text || ' 11:00:00+05:30')::timestamptz,
    100000,
    100000,
    'INR',
    '{"base_rate": 100000, "duration_minutes": 60}'::jsonb,
    '{"policy": "Standard Demo Policy", "refund_percentage": 50}'::jsonb,
    '{"platform_rate_bps": 1000, "commission_minor": 10000}'::jsonb,
    2,
    now() - interval '1 day',
    now() - interval '23 hours',
    now() - interval '22 hours'
  )
  on conflict (id) do nothing;

  -- Allocation for cancelled booking (released_at populated so it frees inventory)
  insert into public.inventory_allocations (
    id, master_owner_id, turf_id, resource_id, booking_id, kind, starts_at, ends_at,
    released_at, created_by, created_at
  )
  values (
    'a2000000-0000-0000-0000-000000000002',
    v_owner_id,
    v_turf1_id,
    v_res1_id,
    v_booking2_id,
    'booking',
    ((current_date + 2)::text || ' 10:00:00+05:30')::timestamptz,
    ((current_date + 2)::text || ' 11:00:00+05:30')::timestamptz,
    now() - interval '22 hours',
    v_player_id,
    now() - interval '1 day'
  )
  on conflict (id) do nothing;

end $$;
