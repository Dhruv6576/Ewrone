-- ============================================================================
-- Migration: Fix mutual RLS recursion between master_owners and employees
-- Justification: PostgREST read of public.employees by master owner failed with
-- 42P17 "infinite recursion detected in policy for relation master_owners"
-- because master_owners_select queried employees and employees_select queried
-- master_owners directly. Additionally, master_owners_select queried
-- private.platform_admins directly, triggering 42501 permission denied for authenticated role.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.is_master_owner_user(p_master_owner_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.master_owners
    WHERE id = p_master_owner_id AND owner_user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION private.is_business_employee(p_master_owner_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees
    WHERE master_owner_id = p_master_owner_id AND user_id = p_user_id AND status = 'active'
  );
$$;

DROP POLICY IF EXISTS employees_select ON public.employees;
CREATE POLICY employees_select
  ON public.employees FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR private.is_master_owner_user(employees.master_owner_id, auth.uid())
  );

DROP POLICY IF EXISTS assignments_select ON public.employee_turf_assignments;
CREATE POLICY assignments_select
  ON public.employee_turf_assignments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_turf_assignments.employee_id
        AND e.user_id = auth.uid()
    )
    OR private.is_master_owner_user(employee_turf_assignments.master_owner_id, auth.uid())
  );

DROP POLICY IF EXISTS master_owners_select ON public.master_owners;
CREATE POLICY master_owners_select
  ON public.master_owners FOR SELECT TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR private.is_business_employee(master_owners.id, auth.uid())
    OR private.is_platform_admin(auth.uid())
  );

REVOKE ALL ON FUNCTION private.is_master_owner_user(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION private.is_master_owner_user(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.is_business_employee(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION private.is_business_employee(uuid, uuid) TO authenticated, service_role;

