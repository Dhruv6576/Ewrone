-- Test: 09_production_monitoring_test.sql
-- Description: pgTAP tests for production readiness, pg_cron jobs, ledger monitoring, and operational alerting.

begin;
select plan(16);

-- 1. Verify Extensions
select has_extension('pg_cron', 'Extension pg_cron is installed');
select has_extension('pg_net', 'Extension pg_net is installed');

-- 2. Verify Operational Alerts Table & Index
select has_table('private', 'operational_alerts', 'private.operational_alerts exists');
select has_index('private', 'operational_alerts', 'operational_alerts_active_uniq', 'operational_alerts_active_uniq index exists');

-- 3. Verify Operational Procedures
select has_function('private', 'trigger_notification_worker', array['text'], 'private.trigger_notification_worker(text) exists');
select has_function('private', 'check_ledger_invariants', 'private.check_ledger_invariants() exists');
select has_function('private', 'check_operational_health', array['interval'], 'private.check_operational_health(interval) exists');
select has_function('private', 'dispatch_admin_alert', array['text', 'text', 'text', 'jsonb'], 'private.dispatch_admin_alert exists');

-- 4. Verify pg_cron Job Registrations in cron.job
select is(
  (select count(*)::integer from cron.job where jobname in (
    'expire-booking-holds',
    'retry-unprocessed-webhooks',
    'trigger-notification-worker',
    'check-ledger-invariants',
    'check-operational-health'
  )),
  5,
  'All 5 operational maintenance jobs are scheduled in cron.job'
);

-- 5. Test Ledger Invariant Check on Clean Zero-Sum Database
select is(
  (select (private.check_ledger_invariants()->>'healthy')::boolean),
  true,
  'Ledger invariant monitor reports healthy on zero-sum ledger'
);

select is(
  (select (private.check_ledger_invariants()->>'alerts_raised')::integer),
  0,
  'Zero alerts raised on healthy zero-sum ledger'
);

-- 6. Setup Fixtures for Operational Health Check Testing
insert into auth.users (id, email, raw_user_meta_data) values
  ('40404040-4040-4040-4040-404040404040'::uuid, 'ops_admin@example.com', '{"name": "Ops Admin"}'::jsonb),
  ('50505050-5050-5050-5050-505050505050'::uuid, 'owner_m11@example.com', '{"name": "Owner M11"}'::jsonb)
on conflict (id) do nothing;

insert into private.platform_admins (user_id, active)
values ('40404040-4040-4040-4040-404040404040'::uuid, true)
on conflict do nothing;

insert into public.master_owners (id, owner_user_id, business_name, status)
values ('eeeeeeee-1111-1111-1111-eeeeeeeeeeee'::uuid, '50505050-5050-5050-5050-505050505050'::uuid, 'M11 Sports', 'active')
on conflict do nothing;

-- 7. Test Dead-Letter Outbox Detection
insert into private.outbox_events (id, topic, aggregate_type, aggregate_id, dedupe_key, payload, attempts, last_error)
values (
  '11111111-0000-0000-0000-000000000001'::uuid,
  'payment.settle_failed',
  'payout',
  gen_random_uuid(),
  'idemp_dead_letter_pgtap',
  '{}'::jsonb,
  5,
  'FATAL: Upstream gateway connection rejected'
) on conflict do nothing;

select is(
  (select (private.check_operational_health(interval '0 seconds')->>'dead_letter_count')::integer >= 1),
  true,
  'Operational health monitor detected dead-letter outbox event'
);

select is(
  (select count(*)::integer from private.operational_alerts where alert_type = 'dead_letter_outbox' and entity_id = '11111111-0000-0000-0000-000000000001' and status = 'active'),
  1,
  'Active operational alert recorded for dead_letter_outbox'
);

-- 8. Test Stuck Webhook Detection (>15 min in retryable)
insert into private.webhook_events (id, provider, provider_account_scope, provider_event_id, event_type, raw_body, body_hash, status, attempts, last_error, received_at)
values (
  '22222222-0000-0000-0000-000000000002'::uuid,
  'razorpay',
  'global',
  'evt_stuck_pgtap_test',
  'payment.captured',
  '{}',
  'hash_placeholder',
  'retryable',
  3,
  'ORDER_NOT_FOUND: Temporary order synchronization lag',
  now() - interval '20 minutes'
) on conflict do nothing;

select is(
  (select (private.check_operational_health(interval '15 minutes')->>'stuck_webhook_count')::integer >= 1),
  true,
  'Operational health monitor detected stuck webhook (>15 minutes)'
);

select is(
  (select count(*)::integer from private.operational_alerts where alert_type = 'stuck_webhook' and entity_id = '22222222-0000-0000-0000-000000000002' and status = 'active'),
  1,
  'Active operational alert recorded for stuck_webhook'
);

-- 9. Verify Admin Alert Notification Dispatch
select is(
  (select count(*)::integer from public.notifications where user_id = '40404040-4040-4040-4040-404040404040'::uuid and kind = 'system.alert') >= 1,
  true,
  'Human notification queued for platform admin upon error-level operational alert'
);

rollback;
