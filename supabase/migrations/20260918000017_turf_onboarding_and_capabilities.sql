-- Migration: 20260918000017_turf_onboarding_and_capabilities.sql
-- Description: Phase 1 Owner Portal: Normalized turf onboarding RPC (writing to turf_photos, turf_amenities, resource_sports)
--              and authoritative capability resolution (public.get_my_capabilities reconciling with public.get_my_context).
-- Constraints: Zero new columns on public.turfs. turfs_update policy preserved.

-- ============================================================================
-- 1. Atomic Turf Onboarding RPC
-- ============================================================================
-- Optimistic Concurrency Contract (p_expected_version):
-- turfs.version guards core listing identity fields (description, address_text).
-- Calling update_turf_onboarding with unchanged description/address_text leaves turfs.version
-- unchanged, allowing non-disruptive child collection syncs (amenities, photos, sports).
-- Callers modifying core listing attributes MUST pass p_expected_version to prevent lost updates.
-- Child entity concurrency (photos, amenities, resource_sports) is governed at the row/table level
-- via unique keys and declarative diffing.
CREATE OR REPLACE FUNCTION public.update_turf_onboarding(
  p_turf_id uuid,
  p_expected_version bigint DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_address_text text DEFAULT NULL,
  p_amenities text[] DEFAULT NULL,
  p_photos jsonb DEFAULT NULL,
  p_resource_sports jsonb DEFAULT NULL
)
RETURNS public.turfs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_turf public.turfs;
  v_photo jsonb;
  v_res_sport jsonb;
  v_sport text;
  v_amenity text;
BEGIN
  -- Authoritative capability check
  -- private.can_turf strictly enforces listing.edit, rejecting foreign and archived turfs with 42501
  IF NOT private.can_turf(p_turf_id, 'listing.edit') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Caller lacks listing.edit capability on turf %', p_turf_id
      USING errcode = '42501';
  END IF;

  SELECT * INTO v_turf FROM public.turfs WHERE id = p_turf_id;
  IF v_turf.id IS NULL THEN
    RAISE EXCEPTION 'TURF_NOT_FOUND: Turf % does not exist', p_turf_id USING errcode = 'P0002';
  END IF;

  -- Optimistic concurrency check against turfs.version
  IF p_expected_version IS NOT NULL AND v_turf.version != p_expected_version THEN
    RAISE EXCEPTION 'VERSION_MISMATCH: Expected version % does not match current version %',
      p_expected_version, v_turf.version
      USING errcode = '40001';
  END IF;

  -- Check if core listing fields actually changed
  -- Passing NULL means "leave unchanged". Passing '' or new text updates the field.
  -- Version bump occurs ONLY when core fields actually change.
  IF (p_description IS NOT NULL AND p_description IS DISTINCT FROM v_turf.description)
     OR (p_address_text IS NOT NULL AND p_address_text IS DISTINCT FROM v_turf.address_text) THEN
    UPDATE public.turfs
    SET
      description = COALESCE(p_description, description),
      address_text = COALESCE(p_address_text, address_text),
      version = version + 1,
      updated_at = now()
    WHERE id = p_turf_id
    RETURNING * INTO v_turf;
  END IF;

  -- Reconcile amenities if provided (writing to public.turf_amenities)
  IF p_amenities IS NOT NULL THEN
    FOREACH v_amenity IN ARRAY p_amenities LOOP
      IF NOT EXISTS (SELECT 1 FROM public.amenities WHERE code = v_amenity) THEN
        RAISE EXCEPTION 'INVALID_AMENITY: Amenity code % does not exist', v_amenity USING errcode = '23503';
      END IF;
    END LOOP;

    DELETE FROM public.turf_amenities WHERE turf_id = p_turf_id;
    INSERT INTO public.turf_amenities (turf_id, amenity_code)
    SELECT p_turf_id, unnest(p_amenities)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Reconcile photos if provided (writing to public.turf_photos)
  -- Expects jsonb array of { storage_path, sort_order, published }
  IF p_photos IS NOT NULL THEN
    -- Check for duplicate storage_path within payload
    IF (
      SELECT count(DISTINCT elem->>'storage_path') != count(*)
      FROM jsonb_array_elements(p_photos) elem
    ) THEN
      RAISE EXCEPTION 'PHOTO_PATH_CONFLICT: Duplicate storage_path found in photos payload'
        USING errcode = '23505';
    END IF;

    -- Check for cross-tenant collision (storage_path already in use by another turf)
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_photos) elem
      JOIN public.turf_photos tp ON tp.storage_path = elem->>'storage_path'
      WHERE tp.turf_id != p_turf_id
    ) THEN
      RAISE EXCEPTION 'PHOTO_PATH_CONFLICT: Storage path is already in use by another venue'
        USING errcode = '23505';
    END IF;

    -- Delete photos for this turf that are not in the new payload
    DELETE FROM public.turf_photos
    WHERE turf_id = p_turf_id
      AND storage_path NOT IN (
        SELECT elem->>'storage_path'
        FROM jsonb_array_elements(p_photos) elem
      );

    -- Upsert incoming photos (preserves id and created_at on existing photos)
    FOR v_photo IN SELECT * FROM jsonb_array_elements(p_photos) LOOP
      INSERT INTO public.turf_photos (turf_id, storage_path, sort_order, published)
      VALUES (
        p_turf_id,
        v_photo->>'storage_path',
        COALESCE((v_photo->>'sort_order')::integer, 0),
        COALESCE((v_photo->>'published')::boolean, false)
      )
      ON CONFLICT (storage_path) DO UPDATE
      SET
        sort_order = CASE WHEN v_photo ? 'sort_order' THEN (v_photo->>'sort_order')::integer ELSE public.turf_photos.sort_order END,
        published  = CASE WHEN v_photo ? 'published'  THEN (v_photo->>'published')::boolean  ELSE public.turf_photos.published  END;
    END LOOP;
  END IF;

  -- Reconcile resource sports if provided (writing to public.resource_sports)
  -- Expects jsonb array of { resource_id, sport_codes: [...] }
  IF p_resource_sports IS NOT NULL THEN
    FOR v_res_sport IN SELECT * FROM jsonb_array_elements(p_resource_sports) LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.resources
        WHERE id = (v_res_sport->>'resource_id')::uuid AND turf_id = p_turf_id
      ) THEN
        RAISE EXCEPTION 'RESOURCE_NOT_FOUND: Resource % does not belong to turf %',
          v_res_sport->>'resource_id', p_turf_id USING errcode = '23503';
      END IF;

      DELETE FROM public.resource_sports WHERE resource_id = (v_res_sport->>'resource_id')::uuid;

      FOR v_sport IN SELECT jsonb_array_elements_text(v_res_sport->'sport_codes') LOOP
        IF NOT EXISTS (SELECT 1 FROM public.sports WHERE code = v_sport) THEN
          RAISE EXCEPTION 'INVALID_SPORT: Sport code % does not exist', v_sport USING errcode = '23503';
        END IF;

        INSERT INTO public.resource_sports (resource_id, sport_code)
        VALUES ((v_res_sport->>'resource_id')::uuid, v_sport)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END LOOP;
  END IF;

  RETURN v_turf;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_turf_onboarding FROM public;
GRANT EXECUTE ON FUNCTION public.update_turf_onboarding TO authenticated, service_role;

-- ============================================================================
-- 2. Authoritative Capability Resolution RPC (get_my_capabilities)
-- ============================================================================
-- Reconciles with and extends the resolution of public.get_my_context (Migration 02:149).
-- While get_my_context provides account summaries (master_owner_accounts, employee_memberships),
-- get_my_capabilities resolves authoritative capabilities:
--   - Owners receive implicit full capabilities (all codes from private.capabilities, including
--     both turf-scope and owner-scope 'payouts.read', 'payouts.request').
--   - Staff members receive capabilities unioned from private.assignment_grants.
--   - If p_master_owner_id is supplied, caller MUST be a member of that owner, raising 42501
--     to prevent leaking business_name.
CREATE OR REPLACE FUNCTION public.get_my_capabilities(p_master_owner_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_target_owner_id uuid := p_master_owner_id;
  v_mo record;
  v_emp record;
  v_caps text[];
  v_turf_ids uuid[];
  v_is_owner boolean := false;
  v_is_staff boolean := false;
  v_is_admin boolean := false;
  v_biz_name text;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'authenticated', false,
      'is_owner', false,
      'is_staff', false,
      'is_admin', false,
      'capabilities', '[]'::jsonb
    );
  END IF;

  v_is_admin := private.is_platform_admin(v_uid);

  -- If specific master_owner_id requested, enforce membership check
  IF v_target_owner_id IS NOT NULL THEN
    SELECT id, business_name, status INTO v_mo
    FROM public.master_owners
    WHERE id = v_target_owner_id AND owner_user_id = v_uid;

    IF v_mo.id IS NOT NULL THEN
      v_is_owner := true;
      v_biz_name := v_mo.business_name;
      v_status := v_mo.status;
    ELSE
      SELECT e.id, e.master_owner_id, mo.business_name, e.status INTO v_emp
      FROM public.employees e
      JOIN public.master_owners mo ON mo.id = e.master_owner_id
      WHERE e.master_owner_id = v_target_owner_id
        AND e.user_id = v_uid
        AND e.status = 'active';

      IF v_emp.id IS NOT NULL THEN
        v_is_staff := true;
        v_biz_name := v_emp.business_name;
        v_status := v_emp.status;
      ELSIF NOT v_is_admin THEN
        -- STRICT 42501: do not leak business_name or existence to non-members
        RAISE EXCEPTION 'PERMISSION_DENIED: Caller is not a member of master owner %', v_target_owner_id
          USING errcode = '42501';
      END IF;
    END IF;
  ELSE
    -- Resolve primary owner or employee affiliation
    SELECT id, business_name, status INTO v_mo
    FROM public.master_owners
    WHERE owner_user_id = v_uid
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_mo.id IS NOT NULL THEN
      v_target_owner_id := v_mo.id;
      v_is_owner := true;
      v_biz_name := v_mo.business_name;
      v_status := v_mo.status;
    ELSE
      SELECT e.id, e.master_owner_id, mo.business_name, e.status INTO v_emp
      FROM public.employees e
      JOIN public.master_owners mo ON mo.id = e.master_owner_id
      WHERE e.user_id = v_uid
        AND e.status = 'active'
      ORDER BY e.created_at ASC
      LIMIT 1;

      IF v_emp.id IS NOT NULL THEN
        v_target_owner_id := v_emp.master_owner_id;
        v_is_staff := true;
        v_biz_name := v_emp.business_name;
        v_status := v_emp.status;
      END IF;
    END IF;
  END IF;

  -- Return empty capabilities for unaffiliated players
  IF NOT v_is_owner AND NOT v_is_staff AND NOT v_is_admin THEN
    RETURN jsonb_build_object(
      'authenticated', true,
      'is_owner', false,
      'is_staff', false,
      'is_admin', false,
      'capabilities', '[]'::jsonb
    );
  END IF;

  -- Owners get implicit capabilities for their owned domain (turf and owner scope: exactly 19 codes)
  -- Excludes platform-scoped codes (turfs.approve, turfs.manage, commissions.manage, payouts.release, audit.read_all, platform.admin)
  IF v_is_owner THEN
    SELECT array_agg(code ORDER BY code) INTO v_caps
    FROM private.capabilities
    WHERE scope IN ('turf', 'owner');
    SELECT COALESCE(array_agg(id), '{}') INTO v_turf_ids
    FROM public.turfs WHERE master_owner_id = v_target_owner_id;
  ELSIF v_is_admin THEN
    SELECT array_agg(code ORDER BY code) INTO v_caps FROM private.capabilities;
    SELECT COALESCE(array_agg(id), '{}') INTO v_turf_ids
    FROM public.turfs WHERE master_owner_id = v_target_owner_id;
  ELSIF v_is_staff THEN
    -- Staff gets granted capabilities from private.assignment_grants across active assignments
    SELECT COALESCE(array_agg(DISTINCT g.capability ORDER BY g.capability), '{}'), COALESCE(array_agg(DISTINCT a.turf_id), '{}')
    INTO v_caps, v_turf_ids
    FROM public.employee_turf_assignments a
    JOIN private.assignment_grants g ON g.assignment_id = a.id
    WHERE a.employee_id = v_emp.id AND a.active = true;
  END IF;

  RETURN jsonb_build_object(
    'authenticated', true,
    'is_owner', v_is_owner,
    'is_staff', v_is_staff,
    'is_admin', v_is_admin,
    'master_owner_id', v_target_owner_id,
    'business_name', v_biz_name,
    'status', v_status,
    'turf_ids', COALESCE(to_jsonb(v_turf_ids), '[]'::jsonb),
    'capabilities', COALESCE(to_jsonb(v_caps), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_capabilities FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_capabilities TO authenticated, anon, service_role;
