-- Migration: 20260918000022_admin_portal_rpc_and_read_paths.sql
-- Description: Platform admin read paths, commission rules management, and client helper

-- 1. Client Helper: public.is_platform_admin()
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'auth', 'pg_temp'
AS $$
  SELECT coalesce(private.is_platform_admin(auth.uid()), false);
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO anon, authenticated, service_role;

-- 2. Root Platform Admin Bootstrap Mechanism
-- Root platform administrators are granted via superuser SQL:
-- INSERT INTO private.platform_admins (user_id, active) VALUES ('<user_id>', true) ON CONFLICT (user_id) DO UPDATE SET active = true;

-- 3. Read Path: Turf Approval Queue (admin_get_turf_queue)
DROP FUNCTION IF EXISTS public.admin_get_turf_queue(text, integer, integer);
CREATE OR REPLACE FUNCTION public.admin_get_turf_queue(
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  master_owner_id uuid,
  business_name text,
  owner_email text,
  name text,
  slug text,
  city text,
  address_text text,
  approval_status text,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'auth', 'pg_temp'
AS $$
BEGIN
  IF NOT private.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Caller is not a platform administrator'
      USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT 
    t.id,
    t.master_owner_id,
    mo.business_name,
    u.email::text AS owner_email,
    t.name,
    t.slug,
    t.city,
    t.address_text,
    t.approval_status,
    t.created_at,
    t.updated_at,
    count(*) OVER() AS total_count
  FROM public.turfs t
  JOIN public.master_owners mo ON mo.id = t.master_owner_id
  LEFT JOIN auth.users u ON u.id = mo.owner_user_id
  WHERE (p_status IS NULL OR t.approval_status = p_status)
    AND t.archived_at IS NULL
  ORDER BY t.created_at DESC, t.id DESC
  LIMIT least(coalesce(p_limit, 50), 100) OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_turf_queue(text, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_turf_queue(text, integer, integer) TO authenticated, service_role;

-- 4. Read Path: Admin Payouts Queue (admin_get_payouts)
DROP FUNCTION IF EXISTS public.admin_get_payouts(text, integer, integer);
CREATE OR REPLACE FUNCTION public.admin_get_payouts(
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  master_owner_id uuid,
  business_name text,
  financial_account_id uuid,
  provider text,
  provider_account_id text,
  masked_bank_label text,
  currency text,
  amount_minor bigint,
  status text,
  provider_settlement_id text,
  idempotency_key text,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz,
  settled_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'auth', 'pg_temp'
AS $$
BEGIN
  IF NOT private.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Caller is not a platform administrator'
      USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT 
    p.id,
    p.master_owner_id,
    mo.business_name,
    p.financial_account_id,
    fa.provider,
    fa.provider_account_id,
    fa.masked_bank_label,
    p.currency,
    p.amount_minor,
    p.status,
    p.provider_settlement_id,
    p.idempotency_key,
    p.period_start,
    p.period_end,
    p.created_at,
    p.settled_at,
    count(*) OVER() AS total_count
  FROM private.payouts p
  JOIN public.master_owners mo ON mo.id = p.master_owner_id
  LEFT JOIN private.owner_financial_accounts fa ON fa.id = p.financial_account_id
  WHERE (p_status IS NULL OR p.status = p_status)
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT least(coalesce(p_limit, 50), 100) OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_payouts(text, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_payouts(text, integer, integer) TO authenticated, service_role;

-- 5. Read Path: Tenants List (admin_get_tenants)
DROP FUNCTION IF EXISTS public.admin_get_tenants(integer, integer);
CREATE OR REPLACE FUNCTION public.admin_get_tenants(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  owner_user_id uuid,
  owner_email text,
  business_name text,
  status text,
  created_at timestamptz,
  turf_count bigint,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'auth', 'pg_temp'
AS $$
BEGIN
  IF NOT private.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Caller is not a platform administrator'
      USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT 
    mo.id,
    mo.owner_user_id,
    u.email::text AS owner_email,
    mo.business_name,
    mo.status,
    mo.created_at,
    COALESCE(tc.turf_count, 0)::bigint AS turf_count,
    count(*) OVER() AS total_count
  FROM public.master_owners mo
  LEFT JOIN auth.users u ON u.id = mo.owner_user_id
  LEFT JOIN (
    SELECT master_owner_id, count(*) AS turf_count
    FROM public.turfs
    WHERE archived_at IS NULL
    GROUP BY master_owner_id
  ) tc ON tc.master_owner_id = mo.id
  ORDER BY mo.created_at DESC, mo.id DESC
  LIMIT least(coalesce(p_limit, 50), 100) OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_tenants(integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_tenants(integer, integer) TO authenticated, service_role;

-- 6. Read Path: Commission Rules (admin_get_commission_rules)
DROP FUNCTION IF EXISTS public.admin_get_commission_rules();
CREATE OR REPLACE FUNCTION public.admin_get_commission_rules()
RETURNS TABLE (
  id uuid,
  master_owner_id uuid,
  business_name text,
  basis_points integer,
  fixed_minor bigint,
  effective_from timestamptz,
  effective_until timestamptz,
  version integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'auth', 'pg_temp'
AS $$
BEGIN
  IF NOT private.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Caller is not a platform administrator'
      USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT 
    cr.id,
    cr.master_owner_id,
    mo.business_name,
    cr.basis_points,
    cr.fixed_minor,
    cr.effective_from,
    cr.effective_until,
    cr.version
  FROM private.commission_rules cr
  LEFT JOIN public.master_owners mo ON mo.id = cr.master_owner_id
  ORDER BY cr.effective_from DESC, cr.version DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_commission_rules() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_commission_rules() TO authenticated, service_role;

-- 7. Write Path: Commission Rule Configuration (admin_set_commission_rule)
DROP FUNCTION IF EXISTS public.admin_set_commission_rule(uuid, integer, bigint);
CREATE OR REPLACE FUNCTION public.admin_set_commission_rule(
  p_master_owner_id uuid DEFAULT NULL,
  p_basis_points integer DEFAULT 1000,
  p_fixed_minor bigint DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'auth', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_next_version integer;
  v_new_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Authentication required' USING errcode = '42501';
  END IF;

  IF NOT private.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Only platform admins can configure commission rules'
      USING errcode = '42501';
  END IF;

  IF p_basis_points < 0 OR p_basis_points > 10000 THEN
    RAISE EXCEPTION 'INVALID_COMMISSION: Basis points must be between 0 and 10000'
      USING errcode = '22023';
  END IF;

  IF p_fixed_minor < 0 THEN
    RAISE EXCEPTION 'INVALID_COMMISSION: Fixed minor fee must be non-negative'
      USING errcode = '22023';
  END IF;

  IF p_master_owner_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.master_owners WHERE id = p_master_owner_id) THEN
      RAISE EXCEPTION 'MASTER_OWNER_NOT_FOUND: Master owner % does not exist', p_master_owner_id
        USING errcode = 'P0002';
    END IF;
  END IF;

  -- Expire current active rule for this target scope
  UPDATE private.commission_rules
  SET effective_until = greatest(now(), effective_from + interval '1 millisecond')
  WHERE (master_owner_id IS NOT DISTINCT FROM p_master_owner_id)
    AND effective_until IS NULL;

  -- Compute next sequential version
  SELECT COALESCE(max(version), 0) + 1 INTO v_next_version
  FROM private.commission_rules
  WHERE (master_owner_id IS NOT DISTINCT FROM p_master_owner_id);

  -- Insert new active commission rule
  INSERT INTO private.commission_rules (
    master_owner_id,
    basis_points,
    fixed_minor,
    effective_from,
    effective_until,
    version,
    created_by
  ) VALUES (
    p_master_owner_id,
    p_basis_points,
    p_fixed_minor,
    now(),
    NULL,
    v_next_version,
    v_uid
  ) RETURNING id INTO v_new_id;

  -- Log immutable audit event
  PERFORM private.log_audit_event(
    p_master_owner_id,
    NULL,
    v_uid,
    'user',
    'commission.configure',
    'commission_rule',
    v_new_id,
    NULL,
    jsonb_build_object(
      'basis_points', p_basis_points,
      'fixed_minor', p_fixed_minor,
      'version', v_next_version
    ),
    'Admin configured commission rule'
  );

  RETURN jsonb_build_object(
    'id', v_new_id,
    'master_owner_id', p_master_owner_id,
    'basis_points', p_basis_points,
    'fixed_minor', p_fixed_minor,
    'version', v_next_version,
    'status', 'active'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_commission_rule(uuid, integer, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_set_commission_rule(uuid, integer, bigint) TO authenticated, service_role;
