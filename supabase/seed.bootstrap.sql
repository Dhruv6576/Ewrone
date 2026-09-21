-- ==============================================================================
-- Template: Hosted Platform Administrator Bootstrap
-- Location: supabase/seed.bootstrap.sql
-- ==============================================================================
-- INSTRUCTIONS FOR HOSTED STAGING/PRODUCTION:
-- 1. Sign up the administrator account via the application Auth flow (site URL).
-- 2. Obtain the user UUID from auth.users:
--      SELECT id, email FROM auth.users WHERE email = 'admin@example.com';
-- 3. Replace the placeholder UUID below and execute this script in Supabase SQL Editor.
--
-- INVARIANTS:
-- - NEVER hardcode passwords or mock credentials in this file.
-- - Must be executed by a database superuser (postgres role) with access to private schema.
-- ==============================================================================

DO $$
DECLARE
  -- Replace with the real registered user UUID from auth.users:
  v_admin_uuid UUID := NULL; -- e.g. '00000000-0000-0000-0000-000000000000'::uuid
BEGIN
  IF v_admin_uuid IS NULL THEN
    RAISE NOTICE 'seed.bootstrap.sql: v_admin_uuid is unset. No platform admin seeded. Please register the user via Auth UI first and provide their UUID.';
    RETURN;
  END IF;

  -- Ensure the user actually exists in auth.users
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_admin_uuid) THEN
    RAISE EXCEPTION 'USER_NOT_FOUND: User ID % does not exist in auth.users', v_admin_uuid;
  END IF;

  -- Grant platform admin privilege
  INSERT INTO private.platform_admins (user_id, active)
  VALUES (v_admin_uuid, true)
  ON CONFLICT (user_id) DO UPDATE SET active = true;

  RAISE NOTICE 'SUCCESS: User % granted active platform_admin privileges.', v_admin_uuid;
END $$;
