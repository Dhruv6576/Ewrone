-- Migration: 20260918000025_env_portable_worker_config.sql
-- Description: Environment-portable worker configuration storage via private.app_config
--              Eliminates hardcoded local fallbacks, reads worker URL and secret dynamically,
--              and raises explicit WORKER_CONFIG_MISSING exceptions when unset.

-- 1. Create private.app_config table
create table if not exists private.app_config (
  key text primary key,
  value text not null,
  description text,
  updated_at timestamptz not null default now()
);

revoke all on private.app_config from public, anon, authenticated;
grant select, insert, update, delete on private.app_config to service_role, postgres;

-- 2. CREATE OR REPLACE private.trigger_notification_worker
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
  v_secret text;
  v_request_id bigint;
begin
  -- Resolve edge function URL from private.app_config (primary) with explicit argument override
  select value into v_url
  from private.app_config
  where key in ('notification_worker_url', 'worker_url')
  order by case when key = 'notification_worker_url' then 1 else 2 end
  limit 1;

  v_url := coalesce(p_edge_url, v_url);

  if v_url is null or length(trim(v_url)) = 0 then
    raise exception 'WORKER_CONFIG_MISSING: notification_worker_url is not configured in private.app_config' using errcode = 'P0001';
  end if;

  -- Resolve internal worker secret from private.app_config
  select value into v_secret
  from private.app_config
  where key in ('worker_secret', 'notification_worker_secret')
  order by case when key = 'worker_secret' then 1 else 2 end
  limit 1;

  if v_secret is null or length(trim(v_secret)) = 0 then
    raise exception 'WORKER_CONFIG_MISSING: worker_secret is not configured in private.app_config' using errcode = 'P0001';
  end if;

  -- Dispatch HTTP request via pg_net
  begin
    select net.http_post(
      url := v_url,
      body := '{"batch_size": 50}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-key', v_secret
      ),
      timeout_milliseconds := 10000
    ) into v_request_id;

    return v_request_id;
  exception
    when others then
      -- Log warning without throwing to prevent pg_cron job abort for transient network failures
      raise warning 'NOTIFICATION_WORKER_HTTP_FAIL: Could not trigger notification worker via pg_net: %', sqlerrm;
      return null;
  end;
end;
$$;

revoke all on function private.trigger_notification_worker(text) from public;
grant execute on function private.trigger_notification_worker(text) to service_role, postgres;

-- 3. CREATE OR REPLACE private.check_operational_health to verify worker config
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
  v_worker_url text;
  v_worker_secret text;
begin
  -- 0. Check Worker Configuration
  select value into v_worker_url
  from private.app_config
  where key in ('notification_worker_url', 'worker_url')
  order by case when key = 'notification_worker_url' then 1 else 2 end
  limit 1;

  select value into v_worker_secret
  from private.app_config
  where key in ('worker_secret', 'notification_worker_secret')
  order by case when key = 'worker_secret' then 1 else 2 end
  limit 1;

  if v_worker_url is null or length(trim(v_worker_url)) = 0 or v_worker_secret is null or length(trim(v_worker_secret)) = 0 then
    raise exception 'WORKER_CONFIG_MISSING: Notification worker URL or secret is not configured in private.app_config' using errcode = 'P0001';
  end if;

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

-- 4. Re-schedule pg_cron job trigger-notification-worker
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron' and installed_version is not null) then
    perform cron.unschedule('trigger-notification-worker')
    from cron.job
    where jobname = 'trigger-notification-worker';

    perform cron.schedule(
      'trigger-notification-worker',
      '* * * * *',
      'select private.trigger_notification_worker();'
    );
  end if;
end;
$$;
