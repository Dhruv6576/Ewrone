-- Test Suite: 07_audit_notifications_and_admin_test.sql
-- Description: pgTAP tests for Milestone 9: Audit events, notifications pipeline, realtime channel authorization, and platform admin workflows.

begin;
select plan(18);

-- 1. Table Existence Checks
select has_table('private', 'audit_events', 'private.audit_events table exists');
select has_table('private', 'device_tokens', 'private.device_tokens table exists');
select has_table('public', 'notifications', 'public.notifications table exists');
select has_table('private', 'notification_deliveries', 'private.notification_deliveries table exists');
select has_table('private', 'turf_approval_events', 'private.turf_approval_events table exists');
select has_table('private', 'daily_turf_metrics', 'private.daily_turf_metrics table exists');

-- 2. Function Existence Checks
select has_function('private', 'log_audit_event', 'private.log_audit_event exists');
select has_function('public', 'get_audit_events', 'public.get_audit_events exists');
select has_function('public', 'register_device_token', 'public.register_device_token exists');
select has_function('public', 'submit_turf_for_approval', 'public.submit_turf_for_approval exists');
select has_function('public', 'admin_review_turf', 'public.admin_review_turf exists');
select has_function('public', 'get_owner_dashboard', 'public.get_owner_dashboard exists');
select has_function('public', 'get_owner_statement', 'public.get_owner_statement exists');
select has_function('public', 'authorize_realtime_channel', 'public.authorize_realtime_channel exists');

-- 3. Audit Immutability Test (Trigger Defense-in-Depth)
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_mo_id uuid := gen_random_uuid();
  v_audit_id uuid;
begin
  insert into auth.users (id, email) values (v_uid, 'audit_immut_test@example.com');
  insert into public.master_owners (id, owner_user_id, business_name, status)
  values (v_mo_id, v_uid, 'Audit Test Corp', 'active');

  insert into private.audit_events (
    master_owner_id, actor_user_id, actor_type, action, entity_type, entity_id
  ) values (
    v_mo_id, v_uid, 'user', 'test.create', 'test', gen_random_uuid()
  ) returning id into v_audit_id;

  -- Test UPDATE blocked
  begin
    update private.audit_events set action = 'test.tampered' where id = v_audit_id;
    raise exception 'FAIL: Audit update should have been blocked';
  exception when sqlstate '55000' then
    -- Expected
  end;

  -- Test DELETE blocked
  begin
    delete from private.audit_events where id = v_audit_id;
    raise exception 'FAIL: Audit delete should have been blocked';
  exception when sqlstate '55000' then
    -- Expected
  end;
end;
$$;

select pass('Audit records strictly block UPDATE and DELETE with SQLSTATE 55000');

-- 4. Notification Queueing Test
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_notif_id uuid;
  v_deliv_count integer;
begin
  insert into auth.users (id, email, phone) values (v_uid, 'notif_user@example.com', '+919876543210');

  -- Register token
  insert into private.device_tokens (user_id, app_id, token, platform)
  values (v_uid, 'app-player', 'fcm_token_12345', 'android');

  -- Queue multi-channel notification
  v_notif_id := private.queue_notification(
    v_uid,
    'booking.confirmed',
    'Booking Confirmed!',
    'Your cricket turf reservation is confirmed.',
    '/bookings/123',
    array['push', 'sms', 'email']
  );

  select count(*) into v_deliv_count
  from private.notification_deliveries
  where notification_id = v_notif_id and status = 'pending';

  if v_deliv_count <> 3 then
    raise exception 'Expected 3 pending delivery records, got %', v_deliv_count;
  end if;
end;
$$;

select pass('Multi-channel notifications queue correctly across push, sms, and email');

-- 5. Turf Approval Workflow & State Machine Guards
do $$
declare
  v_owner_uid uuid := gen_random_uuid();
  v_admin_uid uuid := gen_random_uuid();
  v_mo_id uuid := gen_random_uuid();
  v_turf_id uuid := gen_random_uuid();
  v_loc extensions.geography := extensions.st_setsrid(extensions.st_makepoint(72.8777, 19.0760), 4326);
begin
  -- Setup owner
  insert into auth.users (id, email) values (v_owner_uid, 'owner_turf_flow@example.com');
  insert into public.master_owners (id, owner_user_id, business_name, status)
  values (v_mo_id, v_owner_uid, 'Turf Flow Corp', 'active');

  -- Setup admin
  insert into auth.users (id, email) values (v_admin_uid, 'admin_turf_flow@example.com');
  insert into private.platform_admins (user_id, active) values (v_admin_uid, true);
  insert into private.admin_grants (user_id, capability) values (v_admin_uid, 'turfs.approve');

  -- Create turf in 'draft'
  insert into public.turfs (
    id, master_owner_id, slug, name, address_text, city, location, approval_status
  ) values (
    v_turf_id, v_mo_id, 'flow-turf-999', 'Flow Turf', '123 Main St', 'Mumbai', v_loc, 'draft'
  );

  -- Guard B: Admin attempts to review turf while still in 'draft' -> must fail with 22023
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_uid::text, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_review_turf(v_turf_id, 'approved', 'Premature approval');
    raise exception 'FAIL: Should reject reviewing draft turf';
  exception when sqlstate '22023' then
    -- Expected
  end;

  -- Owner submits turf for approval -> transitions to 'pending'
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_uid::text, 'role', 'authenticated')::text, true);
  perform public.submit_turf_for_approval(v_turf_id);

  -- Admin reviews and approves
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_uid::text, 'role', 'authenticated')::text, true);
  perform public.admin_review_turf(v_turf_id, 'approved', 'Verified and compliant');

  -- Guard A: Attempting to approve an already approved turf -> must fail with 22023
  begin
    perform public.admin_review_turf(v_turf_id, 'approved', 'Second approval attempt');
    raise exception 'FAIL: Should reject re-approving already approved turf';
  exception when sqlstate '22023' then
    -- Expected
  end;
end;
$$;

select pass('Turf approval workflow transitions correctly and enforces invalid state transition guards');

-- 6. Realtime Topic Authorization Logic Check
select is(
  public.authorize_realtime_channel('turf:availability:11111111-1111-1111-1111-111111111111'),
  true,
  'turf:availability channel allows public access'
);

select * from finish();
rollback;
