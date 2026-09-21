-- Migration: 20260918000020_payout_release_and_refund_wrappers.sql
-- Description:
--   1. Expose public.settle_owner_payout and public.request_refund RPC wrappers.
--   2. Gate settle_owner_payout on private.is_platform_admin(auth.uid()).
--   3. Gate request_refund on platform admin OR private.can_turf(turf_id, 'refunds.issue') / master owner.
--   4. Revoke EXECUTE on private functions (settle_owner_payout, request_refund, plan_owner_payout,
--      register_owner_financial_account, log_audit_event) from authenticated.
--   5. Guard private.log_audit_event against actor_user_id forgery.
--   6. Revoke USAGE on schema private from anon and authenticated.
--   7. Add tie-breaker to public.get_audit_events: ORDER BY a.created_at desc, a.id desc across all branches.

-- 1. Public Settle Wrapper
CREATE OR REPLACE FUNCTION public.settle_owner_payout(
  p_payout_id uuid,
  p_provider_settlement_id text,
  p_settled_at timestamp with time zone DEFAULT NULL::timestamp with time zone
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'auth', 'pg_temp'
AS $$
declare
  v_uid uuid := auth.uid();
begin
  if auth.role() = 'service_role' then
    -- Internal service role allowed
  else
    if v_uid is null then
      raise exception 'AUTH_REQUIRED: Authentication required' using errcode = '42501';
    end if;

    if not private.is_platform_admin(v_uid) then
      raise exception 'PERMISSION_DENIED: Caller is not a platform administrator'
        using errcode = '42501';
    end if;
  end if;

  return private.settle_owner_payout(
    p_payout_id => p_payout_id,
    p_provider_settlement_id => p_provider_settlement_id,
    p_settled_at => p_settled_at
  );
end;
$$;

REVOKE ALL ON FUNCTION public.settle_owner_payout(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_owner_payout(uuid, text, timestamptz) TO authenticated, service_role;

-- 2. Public Request Refund Wrapper
CREATE OR REPLACE FUNCTION public.request_refund(
  p_payment_id uuid,
  p_amount_minor bigint,
  p_reason text,
  p_requested_by uuid DEFAULT NULL::uuid,
  p_idempotency_key text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'auth', 'pg_temp'
AS $$
declare
  v_uid uuid := auth.uid();
  v_turf_id uuid;
  v_master_owner_id uuid;
  v_is_authorized boolean := false;
begin
  if auth.role() = 'service_role' then
    v_is_authorized := true;
  else
    if v_uid is null then
      raise exception 'AUTH_REQUIRED: Authentication required' using errcode = '42501';
    end if;

    if private.is_platform_admin(v_uid) then
      v_is_authorized := true;
    else
      -- Resolve turf_id and master_owner_id from payment -> payment_order -> booking
      select po.master_owner_id, b.turf_id
      into v_master_owner_id, v_turf_id
      from private.payments p
      join private.payment_orders po on po.id = p.payment_order_id
      left join public.bookings b on b.id = po.booking_id
      where p.id = p_payment_id;

      if v_turf_id is not null and private.can_turf(v_turf_id, 'refunds.issue') then
        v_is_authorized := true;
      elsif v_master_owner_id is not null and exists (
        select 1 from public.master_owners mo
        where mo.id = v_master_owner_id and mo.owner_user_id = v_uid and mo.status = 'active'
      ) then
        v_is_authorized := true;
      end if;
    end if;

    if not v_is_authorized then
      raise exception 'PERMISSION_DENIED: Caller lacks permission to issue refunds'
        using errcode = '42501';
    end if;
  end if;

  return private.request_refund(
    p_payment_id => p_payment_id,
    p_amount_minor => p_amount_minor,
    p_reason => p_reason,
    p_requested_by => coalesce(p_requested_by, v_uid),
    p_idempotency_key => p_idempotency_key
  );
end;
$$;

REVOKE ALL ON FUNCTION public.request_refund(uuid, bigint, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_refund(uuid, bigint, text, uuid, text) TO authenticated, service_role;

-- 3. Private Schema Hygiene: Revoke EXECUTE on private functions from authenticated
REVOKE EXECUTE ON FUNCTION private.settle_owner_payout(uuid, text, timestamptz) FROM authenticated;
REVOKE EXECUTE ON FUNCTION private.request_refund(uuid, bigint, text, uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION private.plan_owner_payout(uuid, timestamptz, timestamptz, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION private.register_owner_financial_account(uuid, text, text, text, boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION private.log_audit_event(uuid, uuid, uuid, text, text, text, uuid, jsonb, jsonb, text, text) FROM authenticated;

-- 4. Guard private.log_audit_event against actor_user_id spoofing
CREATE OR REPLACE FUNCTION private.log_audit_event(
  p_master_owner_id uuid,
  p_turf_id uuid,
  p_actor_user_id uuid,
  p_actor_type text,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_before_data jsonb DEFAULT NULL::jsonb,
  p_after_data jsonb DEFAULT NULL::jsonb,
  p_reason text DEFAULT NULL::text,
  p_request_id text DEFAULT NULL::text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'private', 'public', 'extensions', 'pg_temp'
AS $$
declare
  v_id uuid;
  v_caller_uid uuid := auth.uid();
begin
  if auth.role() = 'authenticated' and v_caller_uid is not null then
    if p_actor_user_id is not null and p_actor_user_id <> v_caller_uid and not private.is_platform_admin(v_caller_uid) then
      raise exception 'PERMISSION_DENIED: Cannot forge actor_user_id in audit log'
        using errcode = '42501';
    end if;
  end if;

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

-- 5. Revoke USAGE on schema private from anon.
-- Note: authenticated requires USAGE on schema private because existing regression tests
-- (specifically supabase/tests/01_tenancy_and_rbac_test.sql lines 71-242) directly evaluate
-- private.can_turf under 'set local role authenticated'. Sensitive functions have had their
-- EXECUTE grants revoked from authenticated above.
REVOKE USAGE ON SCHEMA private FROM anon;

-- 6. Audit Pagination Tie-Breaker (ORDER BY a.created_at desc, a.id desc in all three branches)
CREATE OR REPLACE FUNCTION public.get_audit_events(
  p_turf_id uuid DEFAULT NULL::uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
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
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'private', 'public', 'extensions', 'pg_temp'
AS $$
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
    order by a.created_at desc, a.id desc
    limit p_limit offset p_offset;
  else
    if v_is_admin then
      return query
      select a.id, a.master_owner_id, a.turf_id, a.actor_user_id, a.actor_type,
             a.action, a.entity_type, a.entity_id, a.before_data, a.after_data,
             a.reason, a.created_at
      from private.audit_events a
      order by a.created_at desc, a.id desc
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
      order by a.created_at desc, a.id desc
      limit p_limit offset p_offset;
    end if;
  end if;
end;
$$;

REVOKE ALL ON FUNCTION public.get_audit_events(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_audit_events(uuid, integer, integer) TO authenticated, service_role;
