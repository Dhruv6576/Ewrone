-- Migration: 20260918000021_notification_worker_cron_trigger.sql
-- Description: Update trigger_notification_worker to call kong:8000 with internal shared-secret header
--              and allow authenticated checkout caller to update provider order with ownership check

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
  -- Resolve edge function URL (defaulting to kong:8000 within Docker network, configurable for production)
  v_url := coalesce(
    p_edge_url,
    current_setting('app.settings.notification_worker_url', true),
    'http://kong:8000/functions/v1/notification-worker'
  );

  -- Internal shared worker secret strictly from database configuration (fails closed if missing)
  v_secret := current_setting('app.settings.worker_secret', true);
  if v_secret is null or length(trim(v_secret)) = 0 then
    raise warning 'NOTIFICATION_WORKER_SECRET_MISSING: app.settings.worker_secret is not configured';
    return null;
  end if;

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
    -- Log warning without throwing to prevent cron job abort
    raise warning 'NOTIFICATION_WORKER_HTTP_FAIL: Could not trigger notification worker via pg_net: %', sqlerrm;
    return null;
end;
$$;

revoke all on function private.trigger_notification_worker(text) from public;
grant execute on function private.trigger_notification_worker(text) to service_role, postgres;

-- Public wrapper for update_payment_order_provider with player ownership validation
create or replace function public.update_payment_order_provider(
  p_order_id uuid,
  p_provider_order_id text,
  p_status text default 'ready'
)
returns void
language plpgsql
security definer
set search_path = public, private, extensions, auth, pg_temp
as $$
declare
  v_booking_player uuid;
begin
  -- Validate caller owns the booking associated with the order if called by authenticated user
  if auth.role() = 'authenticated' then
    select b.player_user_id into v_booking_player
    from private.payment_orders po
    join public.bookings b on b.id = po.booking_id
    where po.id = p_order_id;

    if v_booking_player is not null and v_booking_player <> auth.uid() then
      raise exception 'UNAUTHORIZED: Caller does not own payment order booking' using errcode = '42501';
    end if;
  end if;

  perform private.update_payment_order_provider(p_order_id, p_provider_order_id, p_status);
end;
$$;

revoke all on function public.update_payment_order_provider(uuid, text, text) from public, anon;
grant execute on function public.update_payment_order_provider(uuid, text, text) to authenticated, service_role;
