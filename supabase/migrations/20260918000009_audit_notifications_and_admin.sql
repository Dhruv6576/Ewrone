-- Migration: 20260918000009_audit_notifications_and_admin.sql
-- Description: Audit event logging, device tokens & notification delivery pipeline, Realtime broadcast authorization, and platform administration workflows.

-- 1. Ensure Platform Admin Capabilities in private.capabilities
alter table private.capabilities
  drop constraint if exists capabilities_scope_check;

alter table private.capabilities
  add constraint capabilities_scope_check check (scope in ('turf', 'owner', 'platform'));

insert into private.capabilities (code, scope, description) values
  ('turfs.approve', 'platform', 'Approve, reject, or suspend turfs'),
  ('turfs.manage', 'platform', 'Manage platform-wide turf listings'),
  ('commissions.manage', 'platform', 'Manage platform commission rules'),
  ('payouts.release', 'platform', 'Approve and release owner payouts'),
  ('audit.read_all', 'platform', 'Read audit logs across all tenants'),
  ('platform.admin', 'platform', 'Full platform administrator access')
on conflict (code, scope) do nothing;

-- 2. Audit Events Table & Defense-in-Depth Immutability (§5.7, §11.1, §11.2)
create table if not exists private.audit_events (
  id uuid primary key default gen_random_uuid(),
  master_owner_id uuid references public.master_owners(id) on delete set null,
  turf_id uuid,
  actor_user_id uuid references public.profiles(user_id) on delete set null,
  actor_type text not null
    check (actor_type in ('user', 'system', 'gateway')),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  reason text,
  request_id text,
  created_at timestamptz not null default now(),
  foreign key (turf_id, master_owner_id)
    references public.turfs(id, master_owner_id) on delete set null,
  check (turf_id is null or master_owner_id is not null)
);

create index if not exists audit_owner_time_idx
  on private.audit_events(master_owner_id, created_at desc);
create index if not exists audit_turf_time_idx
  on private.audit_events(turf_id, created_at desc);
create index if not exists audit_actor_time_idx
  on private.audit_events(actor_user_id, created_at desc);

-- Defense-in-depth trigger: blocking UPDATE and DELETE on audit_events
create or replace function private.trg_prevent_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'CANNOT_MUTATE_AUDIT_LOG: Audit records are strictly append-only and immutable'
    using errcode = '55000';
end;
$$;

drop trigger if exists trg_audit_events_immutability on private.audit_events;
create trigger trg_audit_events_immutability
before update or delete on private.audit_events
for each row execute function private.trg_prevent_audit_mutation();

-- Revoke mutation privileges from all non-superuser roles
revoke update, delete, truncate on private.audit_events from authenticated, anon, service_role;

-- 3. Device Tokens Table (§5.7)
create table if not exists private.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  app_id text not null check (app_id in ('app-player', 'app-owner', 'web-player', 'web-owner', 'web-admin')),
  token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web')),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists device_tokens_user_idx
  on private.device_tokens(user_id) where revoked_at is null;

-- 4. User In-App Notifications (§5.7, §12.2)
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  deep_link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "Users can view own notifications" on public.notifications;
create policy "Users can view own notifications"
  on public.notifications for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can mark own notifications read" on public.notifications;
create policy "Users can mark own notifications read"
  on public.notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 5. Multi-Channel Notification Deliveries (§5.7, §12.2)
create table if not exists private.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  channel text not null check (channel in ('push', 'sms', 'email')),
  recipient_key text not null,
  provider_message_id text,
  status text not null default 'pending'
    check (status in ('pending', 'delivered', 'failed', 'suppressed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (notification_id, channel, recipient_key)
);

create index if not exists notification_deliveries_pending_idx
  on private.notification_deliveries(status, next_attempt_at)
  where status in ('pending', 'failed');

-- 6. Turf Approval Events Table (§5.7, §14.1)
create table if not exists private.turf_approval_events (
  id uuid primary key default gen_random_uuid(),
  turf_id uuid not null references public.turfs(id) on delete cascade,
  actor_user_id uuid not null references public.profiles(user_id),
  from_status text not null,
  to_status text not null check (to_status in ('draft', 'pending', 'approved', 'rejected', 'suspended')),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists turf_approval_events_turf_idx
  on private.turf_approval_events(turf_id, created_at desc);

-- 7. Daily Turf Metrics Aggregations (§5.7)
create table if not exists private.daily_turf_metrics (
  master_owner_id uuid not null,
  turf_id uuid not null,
  local_date date not null,
  currency text not null default 'INR',
  confirmed_bookings integer not null default 0,
  booked_minutes integer not null default 0,
  scheduled_minutes integer not null default 0,
  blocked_minutes integer not null default 0,
  gross_booking_minor bigint not null default 0,
  captured_minor bigint not null default 0,
  refunded_minor bigint not null default 0,
  earned_owner_minor bigint not null default 0,
  refreshed_at timestamptz not null default now(),
  foreign key (turf_id, master_owner_id)
    references public.turfs(id, master_owner_id) on delete cascade,
  primary key (turf_id, local_date, currency)
);

-- ================================================================
-- STORED PROCEDURES & BUSINESS LOGIC
-- ================================================================

-- Overload: 3-argument can_turf supporting explicit user_id evaluation
create or replace function private.can_turf(
  p_user_id uuid,
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
        (
          mo.owner_user_id = coalesce(p_user_id, auth.uid())
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
            where e.user_id = coalesce(p_user_id, auth.uid())
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

revoke all on function private.can_turf(uuid, uuid, text) from public;
grant execute on function private.can_turf(uuid, uuid, text) to authenticated, service_role;

-- Helper: Append Audit Event
create or replace function private.log_audit_event(
  p_master_owner_id uuid,
  p_turf_id uuid,
  p_actor_user_id uuid,
  p_actor_type text,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_before_data jsonb default null,
  p_after_data jsonb default null,
  p_reason text default null,
  p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = private, public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into private.audit_events (
    master_owner_id, turf_id, actor_user_id, actor_type,
    action, entity_type, entity_id, before_data, after_data,
    reason, request_id
  ) values (
    p_master_owner_id, p_turf_id, p_actor_user_id, p_actor_type,
    p_action, p_entity_type, p_entity_id, p_before_data, p_after_data,
    p_reason, p_request_id
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function private.log_audit_event from public;
grant execute on function private.log_audit_event to authenticated, service_role;

-- Public: Query Scoped Audit Events
create or replace function public.get_audit_events(
  p_turf_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  master_owner_id uuid,
  turf_id uuid,
  actor_user_id uuid,
  actor_type text,
  action text,
  entity_type text,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = private, public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_owner_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: Authentication required' using errcode = '42501';
  end if;

  v_is_admin := private.is_platform_admin(v_uid);

  if p_turf_id is not null then
    select t.master_owner_id into v_owner_id from public.turfs t where t.id = p_turf_id;
    if v_owner_id is null then
      raise exception 'TURF_NOT_FOUND: Turf % does not exist', p_turf_id using errcode = 'P0002';
    end if;

    if not v_is_admin and not private.can_turf(v_uid, p_turf_id, 'audit.read') then
      raise exception 'PERMISSION_DENIED: Caller lacks audit.read capability for turf %', p_turf_id
        using errcode = '42501';
    end if;

    return query
    select a.id, a.master_owner_id, a.turf_id, a.actor_user_id, a.actor_type,
           a.action, a.entity_type, a.entity_id, a.before_data, a.after_data,
           a.reason, a.created_at
    from private.audit_events a
    where a.turf_id = p_turf_id
    order by a.created_at desc
    limit p_limit offset p_offset;
  else
    if v_is_admin then
      return query
      select a.id, a.master_owner_id, a.turf_id, a.actor_user_id, a.actor_type,
             a.action, a.entity_type, a.entity_id, a.before_data, a.after_data,
             a.reason, a.created_at
      from private.audit_events a
      order by a.created_at desc
      limit p_limit offset p_offset;
    else
      select mo.id into v_owner_id from public.master_owners mo where mo.owner_user_id = v_uid and mo.status = 'active';
      if v_owner_id is null then
        raise exception 'PERMISSION_DENIED: Only Master Owners or Platform Admins can list unfiltered audit events'
          using errcode = '42501';
      end if;

      return query
      select a.id, a.master_owner_id, a.turf_id, a.actor_user_id, a.actor_type,
             a.action, a.entity_type, a.entity_id, a.before_data, a.after_data,
             a.reason, a.created_at
      from private.audit_events a
      where a.master_owner_id = v_owner_id
      order by a.created_at desc
      limit p_limit offset p_offset;
    end if;
  end if;
end;
$$;

revoke all on function public.get_audit_events from public;
grant execute on function public.get_audit_events to authenticated, service_role;

-- Public: Register / Update Device Token
create or replace function public.register_device_token(
  p_app_id text,
  p_token text,
  p_platform text
)
returns uuid
language plpgsql
security definer
set search_path = private, public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: Authentication required' using errcode = '42501';
  end if;

  insert into private.device_tokens (user_id, app_id, token, platform, last_seen_at, revoked_at)
  values (v_uid, p_app_id, p_token, p_platform, now(), null)
  on conflict (token) do update
  set user_id = excluded.user_id,
      app_id = excluded.app_id,
      platform = excluded.platform,
      last_seen_at = now(),
      revoked_at = null
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.register_device_token from public;
grant execute on function public.register_device_token to authenticated, service_role;

-- Public: Mark Notification as Read
create or replace function public.mark_notification_read(p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_updated integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: Authentication required' using errcode = '42501';
  end if;

  update public.notifications
  set read_at = now()
  where id = p_notification_id and user_id = v_uid;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.mark_notification_read from public;
grant execute on function public.mark_notification_read to authenticated, service_role;

-- Public: List My Notifications
create or replace function public.get_my_notifications(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  kind text,
  title text,
  body text,
  deep_link text,
  read_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: Authentication required' using errcode = '42501';
  end if;

  return query
  select n.id, n.kind, n.title, n.body, n.deep_link, n.read_at, n.created_at
  from public.notifications n
  where n.user_id = v_uid
  order by n.created_at desc
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.get_my_notifications from public;
grant execute on function public.get_my_notifications to authenticated, service_role;

-- Helper: Emit Outbox Event
create or replace function private.emit_outbox_event(
  p_topic text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_dedupe_key text,
  p_payload jsonb,
  p_available_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = private, public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into private.outbox_events (
    topic, aggregate_type, aggregate_id, dedupe_key, payload, available_at
  ) values (
    p_topic, p_aggregate_type, p_aggregate_id, p_dedupe_key, p_payload, p_available_at
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function private.emit_outbox_event from public;
grant execute on function private.emit_outbox_event to authenticated, service_role;

-- Private: Queue Notification & Deliveries
create or replace function private.queue_notification(
  p_user_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_deep_link text default null,
  p_channels text[] default array['push'],
  p_recipient_contacts jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = private, public, extensions, pg_temp
as $$
declare
  v_notif_id uuid;
  v_ch text;
  v_recipient_key text;
begin
  insert into public.notifications (user_id, kind, title, body, deep_link)
  values (p_user_id, p_kind, p_title, p_body, p_deep_link)
  returning id into v_notif_id;

  foreach v_ch in array p_channels loop
    v_recipient_key := coalesce(
      p_recipient_contacts->>v_ch,
      case 
        when v_ch = 'push' then (select token from private.device_tokens where user_id = p_user_id and revoked_at is null order by last_seen_at desc limit 1)
        when v_ch = 'email' then (select email from auth.users where id = p_user_id)
        when v_ch = 'sms' then (select phone from auth.users where id = p_user_id)
        else null
      end,
      'user:' || p_user_id::text
    );

    insert into private.notification_deliveries (
      notification_id, channel, recipient_key, status
    ) values (
      v_notif_id, v_ch, v_recipient_key, 'pending'
    ) on conflict (notification_id, channel, recipient_key) do nothing;
  end loop;

  -- Queue in outbox for asynchronous dispatch worker
  perform private.emit_outbox_event(
    'notification.dispatch',
    'notification',
    v_notif_id,
    format('notif_dispatch_%s', v_notif_id),
    jsonb_build_object(
      'notification_id', v_notif_id,
      'user_id', p_user_id,
      'kind', p_kind,
      'title', p_title,
      'channels', p_channels
    )
  );

  return v_notif_id;
end;
$$;

revoke all on function private.queue_notification from public;
grant execute on function private.queue_notification to authenticated, service_role;

-- Public: Submit Turf for Approval (§14.1)
create or replace function public.submit_turf_for_approval(p_turf_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_turf record;
  v_is_owner boolean;
  v_has_perm boolean;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: Authentication required' using errcode = '42501';
  end if;

  select * into v_turf from public.turfs where id = p_turf_id;
  if v_turf.id is null then
    raise exception 'TURF_NOT_FOUND: Turf % does not exist', p_turf_id using errcode = 'P0002';
  end if;

  -- Check if caller is Master Owner or has listing.edit
  select exists (
    select 1 from public.master_owners where id = v_turf.master_owner_id and owner_user_id = v_uid
  ) into v_is_owner;

  if not v_is_owner then
    v_has_perm := private.can_turf(v_uid, p_turf_id, 'listing.edit');
    if not v_has_perm then
      raise exception 'PERMISSION_DENIED: Caller lacks permission to submit turf for approval'
        using errcode = '42501';
    end if;
  end if;

  if v_turf.approval_status not in ('draft', 'rejected') then
    raise exception 'INVALID_STATE_TRANSITION: Turf in % status cannot be submitted for approval', v_turf.approval_status
      using errcode = '22023';
  end if;

  update public.turfs
  set approval_status = 'pending', updated_at = now()
  where id = p_turf_id;

  insert into private.turf_approval_events (
    turf_id, actor_user_id, from_status, to_status, reason
  ) values (
    p_turf_id, v_uid, v_turf.approval_status, 'pending', 'Submitted for review'
  );

  perform private.log_audit_event(
    v_turf.master_owner_id, p_turf_id, v_uid, 'user',
    'turf.submit_approval', 'turf', p_turf_id,
    jsonb_build_object('approval_status', v_turf.approval_status),
    jsonb_build_object('approval_status', 'pending'),
    'Submitted for review'
  );

  return jsonb_build_object(
    'turf_id', p_turf_id,
    'status', 'pending'
  );
end;
$$;

revoke all on function public.submit_turf_for_approval from public;
grant execute on function public.submit_turf_for_approval to authenticated, service_role;

-- Public: Admin Review Turf (§14.1)
create or replace function public.admin_review_turf(
  p_turf_id uuid,
  p_decision text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_turf record;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: Authentication required' using errcode = '42501';
  end if;

  if not private.is_platform_admin(v_uid) then
    raise exception 'PERMISSION_DENIED: Caller is not a platform administrator'
      using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected', 'suspended') then
    raise exception 'INVALID_ARGUMENT: Decision must be approved, rejected, or suspended'
      using errcode = '22023';
  end if;

  select t.*, mo.owner_user_id into v_turf
  from public.turfs t
  join public.master_owners mo on mo.id = t.master_owner_id
  where t.id = p_turf_id;

  if v_turf.id is null then
    raise exception 'TURF_NOT_FOUND: Turf % does not exist', p_turf_id using errcode = 'P0002';
  end if;

  -- Validation Guards:
  -- Guard A: Attempting to approve an already approved turf
  if v_turf.approval_status = 'approved' and p_decision = 'approved' then
    raise exception 'INVALID_STATE_TRANSITION: Turf is already approved' using errcode = '22023';
  end if;

  -- Guard B: Reviewing a draft turf that was never submitted to pending
  if v_turf.approval_status = 'draft' then
    raise exception 'INVALID_STATE_TRANSITION: Turf must be submitted to pending before review' using errcode = '22023';
  end if;

  -- Guard C: If reviewing pending, valid decisions are approved or rejected
  if v_turf.approval_status = 'pending' and p_decision not in ('approved', 'rejected') then
    raise exception 'INVALID_STATE_TRANSITION: Pending turf can only transition to approved or rejected' using errcode = '22023';
  end if;

  update public.turfs
  set approval_status = p_decision, updated_at = now()
  where id = p_turf_id;

  insert into private.turf_approval_events (
    turf_id, actor_user_id, from_status, to_status, reason
  ) values (
    p_turf_id, v_uid, v_turf.approval_status, p_decision, p_reason
  );

  perform private.log_audit_event(
    v_turf.master_owner_id, p_turf_id, v_uid, 'user',
    'turf.admin_review', 'turf', p_turf_id,
    jsonb_build_object('approval_status', v_turf.approval_status),
    jsonb_build_object('approval_status', p_decision),
    p_reason
  );

  -- Notify Master Owner
  perform private.queue_notification(
    v_turf.owner_user_id,
    'turf.review_' || p_decision,
    'Turf ' || initcap(p_decision),
    'Your turf "' || v_turf.name || '" was ' || p_decision || '. Reason: ' || coalesce(p_reason, 'No details provided'),
    '/turfs/' || p_turf_id::text
  );

  return jsonb_build_object(
    'turf_id', p_turf_id,
    'status', p_decision,
    'reason', p_reason
  );
end;
$$;

revoke all on function public.admin_review_turf from public;
grant execute on function public.admin_review_turf to authenticated, service_role;

-- Public: Get Owner Dashboard Metrics (§14.1)
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

  -- Strict Cross-Tenant Isolation:
  if not v_is_admin and not v_is_owner then
    raise exception 'PERMISSION_DENIED: Caller is not authorized to view dashboard for owner %', p_master_owner_id
      using errcode = '42501';
  end if;

  -- Aggregate metrics across all turfs belonging to this master owner
  select jsonb_build_object(
    'total_bookings', coalesce(count(b.id), 0),
    'confirmed_bookings', coalesce(count(b.id) filter (where b.status = 'confirmed'), 0),
    'cancelled_bookings', coalesce(count(b.id) filter (where b.status = 'cancelled'), 0),
    'gross_booking_minor', coalesce(sum(b.total_minor) filter (where b.status = 'confirmed'), 0),
    'commission_minor', coalesce(sum(coalesce((b.commission_snapshot->>'estimated_commission_minor')::bigint, 0)) filter (where b.status = 'confirmed'), 0),
    'net_owner_minor', coalesce(sum(b.total_minor - coalesce((b.commission_snapshot->>'estimated_commission_minor')::bigint, 0)) filter (where b.status = 'confirmed'), 0)
  ) into v_summary
  from public.bookings b
  where b.master_owner_id = p_master_owner_id
    and b.created_at::date between v_start and v_end;

  -- Per-turf breakdown
  select coalesce(jsonb_agg(turf_data), '[]'::jsonb) into v_turfs
  from (
    select jsonb_build_object(
      'turf_id', t.id,
      'turf_name', t.name,
      'approval_status', t.approval_status,
      'bookings_count', count(b.id) filter (where b.status = 'confirmed'),
      'gross_minor', coalesce(sum(b.total_minor) filter (where b.status = 'confirmed'), 0),
      'net_minor', coalesce(sum(b.total_minor - coalesce((b.commission_snapshot->>'estimated_commission_minor')::bigint, 0)) filter (where b.status = 'confirmed'), 0)
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

revoke all on function public.get_owner_dashboard from public;
grant execute on function public.get_owner_dashboard to authenticated, service_role;

-- Public: Get Owner Statement (§14.1)
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

  -- Fetch double-entry ledger balances for this tenant
  select coalesce(sum(e.amount_minor), 0) into v_gateway_balance
  from private.ledger_entries e
  join private.ledger_accounts a on a.id = e.account_id
  where a.code = 'gateway_clearing';

  select coalesce(sum(e.amount_minor), 0) into v_payable_balance
  from private.ledger_entries e
  join private.ledger_accounts a on a.id = e.account_id
  where a.code = 'owner_payable' and a.master_owner_id = p_master_owner_id;

  select coalesce(sum(e.amount_minor), 0) into v_commission_balance
  from private.ledger_entries e
  join private.ledger_accounts a on a.id = e.account_id
  where a.code = 'platform_commission';

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

-- Public & Realtime: Topic Authorization (§12.1)
create or replace function public.authorize_realtime_channel(p_topic text)
returns boolean
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_parts text[];
  v_scope text;
  v_subscope text;
  v_entity_id uuid;
begin
  if p_topic is null then
    return false;
  end if;

  v_parts := string_to_array(p_topic, ':');
  v_scope := v_parts[1];

  -- Case 1: Public discovery: turf:availability:<resource_id>
  if v_scope = 'turf' and v_parts[2] = 'availability' then
    return true;
  end if;

  if v_uid is null then
    return false;
  end if;

  -- Platform Admin can access all channels
  if private.is_platform_admin(v_uid) then
    return true;
  end if;

  -- Case 2: Turf calendar: turf:calendar:<turf_id>
  if v_scope = 'turf' and v_parts[2] = 'calendar' then
    begin
      v_entity_id := v_parts[3]::uuid;
    exception when others then
      return false;
    end;
    return private.can_turf(v_uid, v_entity_id, 'calendar.read');
  end if;

  -- Case 3: Player bookings: player:bookings:<user_id>
  if v_scope = 'player' and v_parts[2] = 'bookings' then
    begin
      v_entity_id := v_parts[3]::uuid;
    exception when others then
      return false;
    end;
    return v_entity_id = v_uid;
  end if;

  -- Case 4: Owner metrics: owner:metrics:<master_owner_id>
  if v_scope = 'owner' and v_parts[2] = 'metrics' then
    begin
      v_entity_id := v_parts[3]::uuid;
    exception when others then
      return false;
    end;
    return exists (
      select 1 from public.master_owners where id = v_entity_id and owner_user_id = v_uid and status = 'active'
    );
  end if;

  return false;
end;
$$;

revoke all on function public.authorize_realtime_channel from public;
grant execute on function public.authorize_realtime_channel to authenticated, anon, service_role;

-- RLS Policy on realtime.messages
drop policy if exists "realtime_messages_authorization" on realtime.messages;
create policy "realtime_messages_authorization"
  on realtime.messages
  for all
  to authenticated, anon
  using (public.authorize_realtime_channel(topic))
  with check (public.authorize_realtime_channel(topic));
