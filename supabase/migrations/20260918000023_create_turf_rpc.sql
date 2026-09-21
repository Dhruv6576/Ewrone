-- Migration: 20260918000023_create_turf_rpc.sql
-- Description: SECURITY DEFINER RPC public.create_turf for master owner venue creation.
-- 
-- Why an RPC is required:
-- public.turfs Row Level Security (turfs_select) restricts read access to rows where
-- approval_status = 'approved' OR private.can_turf(id, 'turf.read'). When a master owner
-- creates a brand new venue in 'draft' status, a direct PostgREST INSERT ... RETURNING id
-- cannot select or return the newly inserted row because the creator lacks an active grant
-- or approved status on that draft record at the instant of insertion.
-- The SECURITY DEFINER RPC safely creates the draft venue under strict authorization checks
-- and returns the newly generated turf UUID directly to the caller.

CREATE OR REPLACE FUNCTION public.create_turf(
  p_master_owner_id uuid,
  p_name text,
  p_city text,
  p_address_text text,
  p_location extensions.geography DEFAULT extensions.st_setsrid(extensions.st_makepoint(77.6413, 12.9716), 4326),
  p_description text DEFAULT '',
  p_timezone text DEFAULT 'Asia/Kolkata'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_base_slug text;
  v_slug text;
  v_counter integer := 1;
  v_new_turf_id uuid;
  v_location extensions.geography;
BEGIN
  -- 1. Authentication check
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Caller must be authenticated'
      USING errcode = '42501';
  END IF;

  -- 2. Authorization check: Caller must own target master owner account in onboarding or active status
  IF NOT EXISTS (
    SELECT 1 FROM public.master_owners mo
    WHERE mo.id = p_master_owner_id
      AND mo.owner_user_id = v_uid
      AND mo.status IN ('onboarding', 'active')
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Caller does not own active or onboarding master owner account %', p_master_owner_id
      USING errcode = '42501';
  END IF;

  -- 3. Parameter validation
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Venue name cannot be blank'
      USING errcode = '22023';
  END IF;

  IF p_city IS NULL OR trim(p_city) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: City cannot be blank'
      USING errcode = '22023';
  END IF;

  IF p_address_text IS NULL OR trim(p_address_text) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Address text cannot be blank'
      USING errcode = '22023';
  END IF;

  -- Reject duplicate name under this master owner
  IF EXISTS (
    SELECT 1 FROM public.turfs
    WHERE master_owner_id = p_master_owner_id
      AND lower(trim(name)) = lower(trim(p_name))
      AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_VENUE_NAME: A venue named "%" already exists for this master owner', trim(p_name)
      USING errcode = '22023';
  END IF;

  -- 4. Slug generation & de-duplication
  v_base_slug := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := regexp_replace(v_base_slug, '^-+|-+$', '', 'g');
  IF v_base_slug = '' THEN
    v_base_slug := 'venue';
  END IF;

  v_slug := v_base_slug;
  WHILE EXISTS (SELECT 1 FROM public.turfs WHERE slug = v_slug) LOOP
    v_counter := v_counter + 1;
    v_slug := v_base_slug || '-' || v_counter;
  END LOOP;

  -- 5. Location resolution
  IF p_location IS NOT NULL THEN
    v_location := p_location;
  ELSE
    v_location := extensions.st_setsrid(extensions.st_makepoint(77.6413, 12.9716), 4326)::extensions.geography;
  END IF;

  -- 6. Insert new draft turf
  INSERT INTO public.turfs (
    master_owner_id,
    slug,
    name,
    description,
    address_text,
    city,
    location,
    timezone,
    approval_status,
    version
  )
  VALUES (
    p_master_owner_id,
    v_slug,
    trim(p_name),
    COALESCE(p_description, ''),
    trim(p_address_text),
    trim(p_city),
    v_location,
    COALESCE(p_timezone, 'Asia/Kolkata'),
    'draft',
    1
  )
  RETURNING id INTO v_new_turf_id;

  -- 7. Log immutable audit event
  PERFORM private.log_audit_event(
    p_master_owner_id,
    v_new_turf_id,
    v_uid,
    'user',
    'turf.create',
    'turf',
    v_new_turf_id,
    NULL,
    jsonb_build_object(
      'name', trim(p_name),
      'slug', v_slug,
      'city', trim(p_city),
      'approval_status', 'draft'
    ),
    'Master owner created new venue'
  );

  RETURN v_new_turf_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_turf(uuid, text, text, text, extensions.geography, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_turf(uuid, text, text, text, extensions.geography, text, text) TO authenticated, service_role;
