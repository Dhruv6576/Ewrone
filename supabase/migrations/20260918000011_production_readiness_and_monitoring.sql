-- Migration: 20260918000011_production_readiness_and_monitoring.sql
-- Description: Production readiness operations, pg_cron scheduled jobs, ledger invariant monitor, and operational alerting.

/*
================================================================================
PRODUCTION DEPLOYMENT PREREQUISITES & PRIVILEGE MODEL
================================================================================
1. SUPABASE PLAN & DASHBOARD PREREQUISITE:
   - On managed Supabase, pg_cron requires a Pro tier or higher (or compute add-on).
   - pg_cron must be enabled via the Supabase Dashboard:
     Database -> Extensions -> search "pg_cron" -> Enable.
   - By default, pg_cron background workers connect to the 'postgres' database
     (setting: cron.database_name = 'postgres').

2. EXECUTION PRIVILEGE & SECURITY CONTEXT:
   - Scheduled pg_cron jobs execute under the 'postgres' superuser/owner role.
   - This elevated privilege context is INTENTIONAL and by-design:
     Internal maintenance routines (sweeping abandoned holds across all tenants,
     retrying webhooks, triggering outbox workers, and auditing the global ledger)
     require bypass of tenant RLS boundaries to maintain global platform integrity.
   - All maintenance functions are strictly confined to the 'private' schema with
     EXECUTE privileges revoked from 'public' and 'anon'.
================================================================================
*/

-- 1. Enable Core Operational Extensions
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- 2. Operational Alerts Table & Deduplication Index
create table if not exists private.operational_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null,
  severity text not null check (severity in ('warning', 'error', 'critical')),
  entity_type text not null,
  entity_id text not null,
  title text not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'acknowledged', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- Partial unique index prevents duplicate active alerts for the same underlying entity
create unique index if not exists operational_alerts_active_uniq
  on private.operational_alerts(alert_type, entity_id)
  where status = 'active';

create index if not exists operational_alerts_status_idx
  on private.operational_alerts(status, severity, created_at desc);

revoke all on private.operational_alerts from public, anon;
grant select, update on private.operational_alerts to authenticated, service_role;

-- 3. Human Alert Dispatch Routine (Notifying Platform Admins)
create or replace function private.dispatch_admin_alert(
  p_title text,
  p_body text,
  p_severity text,
  p_details jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = private, public, extensions, pg_temp
as $$
declare
  v_admin record;
  v_count integer := 0;
begin
  -- Notify all active platform administrators across email and push
  for v_admin in (select user_id from private.platform_admins where active = true) loop
    perform private.queue_notification(
      v_admin.user_id,
      'system.alert',
      format('[%s] %s', upper(p_severity), p_title),
      p_body,
      '/admin/alerts',
      array['email', 'push'],
      jsonb_build_object('details', p_details)
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function private.dispatch_admin_alert from public;
grant execute on function private.dispatch_admin_alert to service_role;

-- 4. Edge Function Notification Worker Trigger (via pg_net)
create or replace function private.trigger_notification_worker(
  p_edge_url text default null
)
returns bigint
language plpgsql
security definer
set search_path = public, private, extensions, net, pg_temp
as $$
declare
  v_url text;
  v_request_id bigint;
begin
  -- Resolve edge function URL (defaulting to local edge runtime, configurable for production)
  v_url := coalesce(
    p_edge_url,
    current_setting('app.settings.notification_worker_url', true),
    'http://127.0.0.1:54321/functions/v1/notification-worker'
  );

  select net.http_post(
    url := v_url,
    body := '{"batch_size": 50}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000
  ) into v_request_id;

  return v_request_id;
exception
  when others then
    -- Log warning without throwing to prevent cron job abort
    raise warning 'NOTIFICATION_WORKER_HTTP_FAIL: Could not trigger notification worker via pg_net: %', sqlerrm;
    return null;
end;
$$;

revoke all on function private.trigger_notification_worker from public;
grant execute on function private.trigger_notification_worker to service_role;

-- 5. Ledger Invariant Monitor Routine
create or replace function private.check_ledger_invariants()
returns jsonb
language plpgsql
security definer
set search_path = private, public, extensions, pg_temp
as $$
declare
  v_global_sum bigint;
  v_unbalanced_count integer := 0;
  v_unbalanced_record record;
  v_alerts_raised integer := 0;
  v_healthy boolean := true;
begin
  -- Check 1: Global Ledger Zero-Sum Balance
  select coalesce(sum(amount_minor), 0) into v_global_sum
  from private.ledger_entries;

  if v_global_sum <> 0 then
    v_healthy := false;
    v_alerts_raised := v_alerts_raised + 1;

    insert into private.operational_alerts (
      alert_type, severity, entity_type, entity_id, title, details
    ) values (
      'ledger_invariant_violation',
      'critical',
      'ledger',
      'global_ledger',
      'Global Ledger Zero-Sum Balance Broken',
      jsonb_build_object('global_sum_minor', v_global_sum)
    ) on conflict (alert_type, entity_id) where status = 'active'
      do update set details = excluded.details, created_at = now();

    -- Dispatch critical alert to platform admins
    perform private.dispatch_admin_alert(
      'Ledger Zero-Sum Broken',
      format('CRITICAL: Global ledger net sum is %s (expected 0). Immediate financial audit required.', v_global_sum),
      'critical',
      jsonb_build_object('global_sum_minor', v_global_sum)
    );

    raise warning 'CRITICAL_LEDGER_ALERT: Global ledger zero-sum violated! Net sum: %', v_global_sum;
  else
    -- Auto-resolve global ledger alert if previously active
    update private.operational_alerts
    set status = 'resolved', resolved_at = now()
    where alert_type = 'ledger_invariant_violation'
      and entity_id = 'global_ledger'
      and status = 'active';
  end if;

  -- Check 2: Individual Unbalanced Journals
  for v_unbalanced_record in (
    select j.id as journal_id, j.event_key, coalesce(sum(e.amount_minor), 0) as journal_sum, count(e.id) as entry_count
    from private.ledger_journals j
    left join private.ledger_entries e on e.journal_id = j.id
    group by j.id, j.event_key
    having coalesce(sum(e.amount_minor), 0) <> 0 or count(e.id) < 2
  ) loop
    v_healthy := false;
    v_unbalanced_count := v_unbalanced_count + 1;
    v_alerts_raised := v_alerts_raised + 1;

    insert into private.operational_alerts (
      alert_type, severity, entity_type, entity_id, title, details
    ) values (
      'unbalanced_journal',
      'critical',
      'journal',
      v_unbalanced_record.journal_id::text,
      format('Unbalanced Ledger Journal: %s', v_unbalanced_record.event_key),
      jsonb_build_object(
        'journal_id', v_unbalanced_record.journal_id,
        'event_key', v_unbalanced_record.event_key,
        'journal_sum_minor', v_unbalanced_record.journal_sum,
        'entry_count', v_unbalanced_record.entry_count
      )
    ) on conflict (alert_type, entity_id) where status = 'active'
      do update set details = excluded.details, created_at = now();

    perform private.dispatch_admin_alert(
      format('Unbalanced Journal %s', v_unbalanced_record.event_key),
      format('CRITICAL: Journal %s has net sum %s with %s entries.', v_unbalanced_record.event_key, v_unbalanced_record.journal_sum, v_unbalanced_record.entry_count),
      'critical',
      jsonb_build_object('journal_id', v_unbalanced_record.journal_id, 'net_sum', v_unbalanced_record.journal_sum)
    );
  end loop;

  return jsonb_build_object(
    'healthy', v_healthy,
    'global_sum_minor', v_global_sum,
    'unbalanced_journals_count', v_unbalanced_count,
    'alerts_raised', v_alerts_raised,
    'checked_at', now()
  );
end;
$$;

revoke all on function private.check_ledger_invariants from public;
grant execute on function private.check_ledger_invariants to service_role;

-- 6. Operational Health Check Routine (Dead-Letters, Stuck Webhooks & Payment Exceptions)
create or replace function private.check_operational_health(
  p_stuck_threshold interval default interval '15 minutes'
)
returns jsonb
language plpgsql
security definer
set search_path = private, public, extensions, pg_temp
as $$
declare
  v_dead_letter record;
  v_stuck_webhook record;
  v_pay_ex record;
  v_dead_letter_count integer := 0;
  v_stuck_webhook_count integer := 0;
  v_pay_ex_count integer := 0;
  v_alerts_raised integer := 0;
  v_healthy boolean := true;
begin
  -- 1. Dead-Letter Outbox Events (attempts >= 5 and incomplete)
  for v_dead_letter in (
    select id, topic, dedupe_key, attempts, last_error, created_at
    from private.outbox_events
    where attempts >= 5 and completed_at is null
  ) loop
    v_healthy := false;
    v_dead_letter_count := v_dead_letter_count + 1;
    v_alerts_raised := v_alerts_raised + 1;

    insert into private.operational_alerts (
      alert_type, severity, entity_type, entity_id, title, details
    ) values (
      'dead_letter_outbox',
      'error',
      'outbox_event',
      v_dead_letter.id::text,
      format('Dead-Letter Outbox Event: %s', v_dead_letter.topic),
      jsonb_build_object(
        'outbox_id', v_dead_letter.id,
        'topic', v_dead_letter.topic,
        'dedupe_key', v_dead_letter.dedupe_key,
        'attempts', v_dead_letter.attempts,
        'max_attempts', 5,
        'last_error', v_dead_letter.last_error,
        'created_at', v_dead_letter.created_at
      )
    ) on conflict (alert_type, entity_id) where status = 'active'
      do update set details = excluded.details, created_at = now();

    perform private.dispatch_admin_alert(
      format('Dead-Letter Outbox: %s', v_dead_letter.topic),
      format('Outbox job %s failed after %s attempts. Error: %s', v_dead_letter.id, v_dead_letter.attempts, v_dead_letter.last_error),
      'error',
      jsonb_build_object('outbox_id', v_dead_letter.id, 'error', v_dead_letter.last_error)
    );
  end loop;

  -- 2. Stuck Webhook Events (in 'retryable' for over p_stuck_threshold)
  for v_stuck_webhook in (
    select id, provider, provider_event_id, attempts, last_error, received_at,
      round(extract(epoch from (now() - received_at)) / 60) as stuck_minutes
    from private.webhook_events
    where status = 'retryable'
      and received_at < now() - p_stuck_threshold
  ) loop
    v_healthy := false;
    v_stuck_webhook_count := v_stuck_webhook_count + 1;
    v_alerts_raised := v_alerts_raised + 1;

    insert into private.operational_alerts (
      alert_type, severity, entity_type, entity_id, title, details
    ) values (
      'stuck_webhook',
      case when v_stuck_webhook.stuck_minutes >= 60 then 'error' else 'warning' end,
      'webhook_event',
      v_stuck_webhook.id::text,
      format('Stuck Webhook: %s (%sm)', v_stuck_webhook.provider_event_id, v_stuck_webhook.stuck_minutes),
      jsonb_build_object(
        'webhook_id', v_stuck_webhook.id,
        'provider', v_stuck_webhook.provider,
        'provider_event_id', v_stuck_webhook.provider_event_id,
        'attempts', v_stuck_webhook.attempts,
        'stuck_minutes', v_stuck_webhook.stuck_minutes,
        'last_error', v_stuck_webhook.last_error,
        'received_at', v_stuck_webhook.received_at
      )
    ) on conflict (alert_type, entity_id) where status = 'active'
      do update set details = excluded.details, created_at = now();

    if v_stuck_webhook.stuck_minutes >= 60 then
      perform private.dispatch_admin_alert(
        format('Stuck Webhook: %s', v_stuck_webhook.provider_event_id),
        format('Webhook %s from %s has been stuck in retryable state for %s minutes. Error: %s', v_stuck_webhook.provider_event_id, v_stuck_webhook.provider, v_stuck_webhook.stuck_minutes, v_stuck_webhook.last_error),
        'error',
        jsonb_build_object('webhook_id', v_stuck_webhook.id, 'stuck_minutes', v_stuck_webhook.stuck_minutes)
      );
    end if;
  end loop;

  -- 3. Bookings in 'payment_exception' Status
  for v_pay_ex in (
    select b.id as booking_id, b.master_owner_id, b.reference_code, b.total_minor, b.created_at, b.payment_exception_reason
    from public.bookings b
    where b.status = 'payment_exception'
  ) loop
    v_healthy := false;
    v_pay_ex_count := v_pay_ex_count + 1;
    v_alerts_raised := v_alerts_raised + 1;

    insert into private.operational_alerts (
      alert_type, severity, entity_type, entity_id, title, details
    ) values (
      'payment_exception',
      'error',
      'booking',
      v_pay_ex.booking_id::text,
      format('Payment Exception Booking: %s', v_pay_ex.reference_code),
      jsonb_build_object(
        'booking_id', v_pay_ex.booking_id,
        'master_owner_id', v_pay_ex.master_owner_id,
        'reference_code', v_pay_ex.reference_code,
        'total_minor', v_pay_ex.total_minor,
        'reason', v_pay_ex.payment_exception_reason,
        'created_at', v_pay_ex.created_at
      )
    ) on conflict (alert_type, entity_id) where status = 'active'
      do update set details = excluded.details, created_at = now();

    perform private.dispatch_admin_alert(
      format('Payment Exception Booking: %s', v_pay_ex.reference_code),
      format('Booking %s is in payment_exception status (amount: ₹%s). Manual verification required.', v_pay_ex.reference_code, (v_pay_ex.total_minor / 100)),
      'error',
      jsonb_build_object('booking_id', v_pay_ex.booking_id, 'total_minor', v_pay_ex.total_minor)
    );
  end loop;

  -- 4. Auto-resolve alerts for items that have completed or recovered
  update private.operational_alerts a
  set status = 'resolved', resolved_at = now()
  where a.status = 'active'
    and a.alert_type = 'dead_letter_outbox'
    and exists (
      select 1 from private.outbox_events o
      where o.id::text = a.entity_id and o.completed_at is not null
    );

  update private.operational_alerts a
  set status = 'resolved', resolved_at = now()
  where a.status = 'active'
    and a.alert_type = 'stuck_webhook'
    and exists (
      select 1 from private.webhook_events w
      where w.id::text = a.entity_id and w.status in ('processed', 'failed')
    );

  return jsonb_build_object(
    'healthy', v_healthy,
    'dead_letter_count', v_dead_letter_count,
    'stuck_webhook_count', v_stuck_webhook_count,
    'payment_exception_count', v_pay_ex_count,
    'alerts_raised', v_alerts_raised,
    'checked_at', now()
  );
end;
$$;

revoke all on function private.check_operational_health from public;
grant execute on function private.check_operational_health to service_role;

-- 7. Register Scheduled pg_cron Maintenance Jobs
-- Clean up any existing job registrations with identical names to ensure idempotent migration
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron' and installed_version is not null) then
    perform cron.unschedule(jobname)
    from cron.job
    where jobname in (
      'expire-booking-holds',
      'retry-unprocessed-webhooks',
      'trigger-notification-worker',
      'check-ledger-invariants',
      'check-operational-health'
    );

    -- 7.1 Expire abandoned booking holds every 60 seconds
    perform cron.schedule(
      'expire-booking-holds',
      '* * * * *',
      'select private.expire_booking_holds();'
    );

    -- 7.2 Retry retryable webhooks every 2 minutes
    perform cron.schedule(
      'retry-unprocessed-webhooks',
      '*/2 * * * *',
      'select private.retry_unprocessed_webhooks();'
    );

    -- 7.3 Trigger notification-worker Edge Function via pg_net every 60 seconds
    perform cron.schedule(
      'trigger-notification-worker',
      '* * * * *',
      'select private.trigger_notification_worker();'
    );

    -- 7.4 Monitor double-entry ledger invariants every 5 minutes
    perform cron.schedule(
      'check-ledger-invariants',
      '*/5 * * * *',
      'select private.check_ledger_invariants();'
    );

    -- 7.5 Check operational health (dead-letters, stuck webhooks, exceptions) every 5 minutes
    perform cron.schedule(
      'check-operational-health',
      '*/5 * * * *',
      'select private.check_operational_health();'
    );
  end if;
end;
$$;
