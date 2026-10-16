-- BARANGAY IBA V4 / PHASE 2 - ADD ADMIN INVITATIONS, NON-DESTRUCTIVE
-- REQUIRED: Phase 1 audit migration already installed. Back up before applying.
-- Does not deactivate/reset/change any existing administrator account.
BEGIN;
CREATE TABLE IF NOT EXISTS public.admin_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  delivery_status text NOT NULL DEFAULT 'pending_delivery'
    CHECK (delivery_status IN ('pending_delivery','sent','delivery_failed','accepted')),
  sent_at timestamptz,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_invitations_expires_idx ON public.admin_invitations(expires_at) WHERE accepted_at IS NULL;
ALTER TABLE public.admin_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.admin_invitations TO service_role;
-- No browser client receives an invitation token hash or elevated database privileges.

CREATE OR REPLACE FUNCTION public.bgy_create_admin_invitation(
  p_full_name text, p_first_name text, p_middle_name text, p_last_name text,
  p_email text, p_username text, p_contact_number text, p_password_hash text,
  p_token_hash text, p_expires_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE new_id uuid;
BEGIN
  IF p_full_name IS NULL OR length(btrim(p_full_name)) < 3
    OR p_email IS NULL OR p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR p_username IS NULL OR length(btrim(p_username)) < 3
    OR p_password_hash IS NULL OR p_password_hash !~ '^\$2[aby]\$12\$'
    OR p_token_hash !~ '^[0-9a-f]{64}$'
    OR p_expires_at <= now() OR p_expires_at > now() + interval '49 hours' THEN
    RAISE EXCEPTION 'Invalid administrator invitation request' USING ERRCODE = 'P0001';
  END IF;
  -- Serialize creation by normalized email to prevent case-variant duplicate accounts.
  PERFORM pg_advisory_xact_lock(hashtext(lower(btrim(p_email))));
  IF EXISTS (SELECT 1 FROM public.users WHERE lower(email) = lower(btrim(p_email))) THEN
    RAISE EXCEPTION 'Account email already exists' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.users (
    full_name, first_name, middle_name, last_name, email, username, contact_number,
    password_hash, role, status, is_active, email_verified, must_change_password,
    verification_provider, address, purok, has_voted, updated_at
  ) VALUES (
    btrim(p_full_name), btrim(p_first_name), coalesce(btrim(p_middle_name),''), btrim(p_last_name),
    lower(btrim(p_email)), lower(btrim(p_username)), coalesce(p_contact_number,''),
    p_password_hash, 'admin', 'pending', false, false, false,
    'resend', '', '', false, now()
  ) RETURNING id INTO new_id;
  INSERT INTO public.admin_invitations (user_id, token_hash, expires_at)
    VALUES (new_id, p_token_hash, p_expires_at);
  RETURN new_id;
END; $$;

CREATE OR REPLACE FUNCTION public.bgy_refresh_admin_invitation(
  p_user_id uuid, p_token_hash text, p_expires_at timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE invitation public.admin_invitations%ROWTYPE;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$'
    OR p_expires_at <= now() OR p_expires_at > now() + interval '49 hours' THEN
    RAISE EXCEPTION 'Invalid invitation' USING ERRCODE = 'P0001';
  END IF;
  SELECT i.* INTO invitation FROM public.admin_invitations i
    JOIN public.users u ON u.id = i.user_id
    WHERE i.user_id = p_user_id AND i.accepted_at IS NULL
      AND u.role = 'admin' AND u.status = 'pending' AND u.is_active = false
    FOR UPDATE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation is not pending' USING ERRCODE = 'P0001'; END IF;
  IF invitation.last_attempt_at > now() - interval '2 minutes' THEN
    RAISE EXCEPTION 'Wait two minutes before resending' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.admin_invitations SET token_hash = p_token_hash, expires_at = p_expires_at,
    delivery_status = 'pending_delivery', last_attempt_at = now(), sent_at = null, updated_at = now()
    WHERE id = invitation.id;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.bgy_accept_admin_invitation(
  p_token_hash text, p_password_hash text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE invitation public.admin_invitations%ROWTYPE;
DECLARE linked_role text;
DECLARE linked_status text;
DECLARE linked_active boolean;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_password_hash !~ '^\$2[aby]\$12\$' THEN
    RAISE EXCEPTION 'Invalid invitation' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO invitation FROM public.admin_invitations
    WHERE token_hash = p_token_hash AND accepted_at IS NULL AND expires_at > now()
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid or expired invitation' USING ERRCODE = 'P0001'; END IF;
  SELECT role, status, is_active INTO linked_role, linked_status, linked_active FROM public.users
    WHERE id = invitation.user_id FOR UPDATE;
  IF linked_role IS DISTINCT FROM 'admin' OR linked_status IS DISTINCT FROM 'pending'
     OR linked_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Invitation can no longer be accepted' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.users SET password_hash = p_password_hash, role = 'admin', status = 'approved',
    is_active = true, email_verified = true, email_verified_at = now(),
    must_change_password = false, verification_provider = 'resend', updated_at = now()
    WHERE id = invitation.user_id;
  UPDATE public.admin_invitations SET accepted_at = now(), delivery_status = 'accepted',
    updated_at = now() WHERE id = invitation.id;
  RETURN invitation.user_id;
END; $$;

REVOKE ALL ON FUNCTION public.bgy_create_admin_invitation(text,text,text,text,text,text,text,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bgy_refresh_admin_invitation(uuid,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bgy_accept_admin_invitation(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_create_admin_invitation(text,text,text,text,text,text,text,text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.bgy_refresh_admin_invitation(uuid,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.bgy_accept_admin_invitation(text,text) TO service_role;

-- Phase 1 database change capture also applies to invitation lifecycle transitions.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.admin_invitations'::regclass
    AND tgname='bgy_audit_row_change_trg') THEN
    CREATE TRIGGER bgy_audit_row_change_trg AFTER INSERT OR UPDATE OR DELETE
      ON public.admin_invitations FOR EACH ROW EXECUTE FUNCTION public.bgy_audit_row_change();
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.bgy_phase2_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT to_regclass('public.admin_invitations') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.admin_invitations'::regclass
       AND tgname = 'bgy_audit_row_change_trg' AND NOT tgisinternal);
$$;
REVOKE ALL ON FUNCTION public.bgy_phase2_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_phase2_ready() TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
