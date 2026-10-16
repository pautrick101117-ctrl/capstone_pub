-- BARANGAY IBA V4 / PHASE 5 - STAGED RESIDENT PASSWORD RESET
-- Prerequisites: Phase 1 audit and Phase 2 invitations. NON-DESTRUCTIVE.
-- Back up production data before applying. No existing passwords are changed.
BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pending_password_hash text,
  ADD COLUMN IF NOT EXISTS pending_password_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_password_requested_at timestamptz;

-- The existing password stays valid until the resident logs in with the new
-- temporary password. Promotion is atomic, conditional and only one-time.
CREATE OR REPLACE FUNCTION public.bgy_accept_resident_temporary_password(
  p_user_id uuid, p_expected_hash text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public AS $$
DECLARE promoted_id uuid;
BEGIN
  IF p_expected_hash IS NULL OR length(p_expected_hash) < 55 THEN
    RETURN false;
  END IF;
  UPDATE public.users
    SET password_hash = pending_password_hash,
        pending_password_hash = NULL,
        pending_password_expires_at = NULL,
        pending_password_requested_at = NULL,
        must_change_password = true,
        updated_at = now()
    WHERE id = p_user_id AND role = 'resident'
      AND status = 'approved' AND is_active = true
      AND pending_password_hash = p_expected_hash
      AND pending_password_expires_at > now()
    RETURNING id INTO promoted_id;
  RETURN promoted_id IS NOT NULL;
END; $$;

REVOKE ALL ON FUNCTION public.bgy_accept_resident_temporary_password(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_accept_resident_temporary_password(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.bgy_phase5_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'pending_password_hash')
    AND to_regprocedure('public.bgy_accept_resident_temporary_password(uuid,text)') IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.bgy_phase5_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_phase5_ready() TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
