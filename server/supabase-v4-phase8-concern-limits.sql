-- Barangay Iba V4 | Phase 8: configurable resident concern submission limits.
-- Non-destructive; run after Phases 1-7 and BEFORE deploying the Phase 8 API.
-- Enforcement is DISABLED by default. Do not run a full-reset script.
BEGIN;

INSERT INTO public.landing_content(key_name, value, updated_at)
VALUES ('concern_submission_limits', '{"enabled":false,"rolling_window":{"max_submissions":3,"period_days":7},"unresolved_limit":{"enabled":true,"max_concerns":5}}'::jsonb, now())
ON CONFLICT (key_name) DO NOTHING;

ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS submission_operation_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS complaints_submission_operation_unique_idx
 ON public.complaints(submission_operation_id) WHERE submission_operation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS complaints_user_created_phase8_idx ON public.complaints(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS complaints_user_open_phase8_idx ON public.complaints(user_id, status)
 WHERE status IN ('pending','in_review');

CREATE OR REPLACE FUNCTION public.bgy_phase8_validate_policy(p_policy jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE win jsonb; opn jsonb;
BEGIN
  IF p_policy IS NULL OR jsonb_typeof(p_policy) <> 'object' THEN
    RAISE EXCEPTION 'Invalid concern settings' USING ERRCODE = '22023';
  END IF;
  win := p_policy->'rolling_window'; opn := p_policy->'unresolved_limit';
  IF jsonb_typeof(p_policy->'enabled') <> 'boolean'
     OR jsonb_typeof(win) <> 'object' OR jsonb_typeof(opn) <> 'object'
     OR jsonb_typeof(opn->'enabled') <> 'boolean'
     OR jsonb_typeof(win->'max_submissions') <> 'number'
     OR jsonb_typeof(win->'period_days') <> 'number'
     OR jsonb_typeof(opn->'max_concerns') <> 'number' THEN
    RAISE EXCEPTION 'Invalid concern settings' USING ERRCODE = '22023';
  END IF;
  IF (win->>'max_submissions') !~ '^[0-9]{1,3}$'
     OR (win->>'period_days') !~ '^[0-9]{1,3}$'
     OR (opn->>'max_concerns') !~ '^[0-9]{1,3}$' THEN
    RAISE EXCEPTION 'Quota values must be whole numbers' USING ERRCODE='22023';
  END IF;
  IF (win->>'max_submissions')::int NOT BETWEEN 1 AND 100
     OR (win->>'period_days')::int NOT BETWEEN 1 AND 365
     OR (opn->>'max_concerns')::int NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Quota limits are outside the allowed range' USING ERRCODE='22023';
  END IF;
  IF p_policy IS DISTINCT FROM jsonb_build_object(
     'enabled', p_policy->'enabled',
     'rolling_window', jsonb_build_object('max_submissions',win->'max_submissions','period_days',win->'period_days'),
     'unresolved_limit', jsonb_build_object('enabled',opn->'enabled','max_concerns',opn->'max_concerns')) THEN
    RAISE EXCEPTION 'Unrecognized quota configuration fields' USING ERRCODE='22023';
  END IF;
  RETURN p_policy;
END; $$;

CREATE OR REPLACE FUNCTION public.bgy_phase8_save_concern_limits(
 p_policy jsonb, p_expected_updated_at timestamptz)
RETURNS TABLE(value jsonb, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE previous record; checked jsonb;
BEGIN
  checked := public.bgy_phase8_validate_policy(p_policy);
  SELECT lc.value, lc.updated_at INTO previous FROM public.landing_content lc
    WHERE lc.key_name='concern_submission_limits' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Phase 8 configuration is missing' USING ERRCODE='P0001'; END IF;
  IF p_expected_updated_at IS NULL OR previous.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Concern settings were changed by another administrator. Reload and try again.' USING ERRCODE='40001';
  END IF;
  IF previous.value IS DISTINCT FROM checked THEN
    UPDATE public.landing_content lc SET value=checked, updated_at=clock_timestamp()
      WHERE lc.key_name='concern_submission_limits';
  END IF;
  RETURN QUERY SELECT lc.value, lc.updated_at FROM public.landing_content lc WHERE lc.key_name='concern_submission_limits';
END; $$;

-- Eligibility is advisory: the submitting function checks again inside a lock.
CREATE OR REPLACE FUNCTION public.bgy_phase8_concern_eligibility(p_resident_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE policy jsonb; v_window_count bigint; v_open_count bigint; v_period int; v_max int;
  v_open_max int; v_next timestamptz; v_enabled boolean; v_open_enabled boolean;
  v_user uuid; v_reasons jsonb := '[]'::jsonb; v_now timestamptz := clock_timestamp();
BEGIN
  SELECT id INTO v_user FROM public.users WHERE id=p_resident_id AND role='resident' AND is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'BGY_CONCERN_UNAUTHORIZED' USING ERRCODE='42501'; END IF;
  SELECT public.bgy_phase8_validate_policy(lc.value) INTO policy FROM public.landing_content lc WHERE key_name='concern_submission_limits';
  IF policy IS NULL THEN RAISE EXCEPTION 'Phase 8 configuration is missing' USING ERRCODE='P0001'; END IF;
  v_enabled := (policy->>'enabled')::boolean;
  v_period := (policy->'rolling_window'->>'period_days')::int;
  v_max := (policy->'rolling_window'->>'max_submissions')::int;
  v_open_enabled := (policy->'unresolved_limit'->>'enabled')::boolean;
  v_open_max := (policy->'unresolved_limit'->>'max_concerns')::int;
  SELECT count(*) INTO v_window_count FROM public.complaints
    WHERE user_id=p_resident_id AND created_at > v_now - make_interval(days=>v_period);
  SELECT count(*) INTO v_open_count FROM public.complaints
    WHERE user_id=p_resident_id AND status IN ('pending','in_review');
  IF v_enabled AND v_window_count>=v_max THEN
    v_reasons := v_reasons || '"CONCERN_WINDOW_LIMIT_REACHED"'::jsonb;
    SELECT c.created_at + make_interval(days=>v_period) INTO v_next FROM public.complaints c
      WHERE c.user_id=p_resident_id AND c.created_at > v_now - make_interval(days=>v_period)
      ORDER BY c.created_at DESC, c.id DESC OFFSET (v_max - 1) LIMIT 1;
  END IF;
  IF v_enabled AND v_open_enabled AND v_open_count>=v_open_max THEN
    v_reasons := v_reasons || '"CONCERN_OPEN_LIMIT_REACHED"'::jsonb;
  END IF;
  RETURN jsonb_build_object(
    'enabled',v_enabled,'allowed',jsonb_array_length(v_reasons)=0,
    'rollingPeriod',jsonb_build_object('days',v_period,'maximum',v_max,'used',v_window_count,'remaining',greatest(0,v_max-v_window_count)),
    'unresolved',jsonb_build_object('enabled',v_open_enabled,'maximum',v_open_max,'used',v_open_count,'remaining',greatest(0,v_open_max-v_open_count)),
    'nextAvailableAt', CASE WHEN v_enabled THEN v_next ELSE NULL END,
    'blockedReasons',v_reasons);
END; $$;

-- The service-role API supplies p_resident_id only after requireCurrentUser().
-- Locking policy before resident row serializes policy changes and same-resident submissions.
-- Triggers installed by Phases 1 and 6 record audit and case history in this transaction.
CREATE OR REPLACE FUNCTION public.bgy_phase8_submit_concern(
  p_resident_id uuid, p_type text, p_details text, p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_user record; v_existing public.complaints%ROWTYPE; v_created public.complaints%ROWTYPE;
  v_policy jsonb; v_eligibility jsonb; v_type text:=btrim(coalesce(p_type,''));
  v_details text:=btrim(coalesce(p_details,''));
BEGIN
  IF p_resident_id IS NULL OR p_operation_id IS NULL OR length(v_type) NOT BETWEEN 1 AND 100
     OR length(v_details) NOT BETWEEN 10 AND 1500 THEN
    RAISE EXCEPTION 'BGY_CONCERN_INVALID' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.landing_content WHERE key_name='concern_submission_limits' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Phase 8 configuration is missing' USING ERRCODE='P0001'; END IF;
  SELECT id,first_name,last_name INTO v_user FROM public.users
    WHERE id=p_resident_id AND role='resident' AND is_active=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BGY_CONCERN_UNAUTHORIZED' USING ERRCODE='42501'; END IF;

  -- A replay must not consume another slot; a reused key with different details is rejected.
  SELECT * INTO v_existing FROM public.complaints WHERE submission_operation_id=p_operation_id;
  IF FOUND THEN
    IF v_existing.user_id<>p_resident_id OR v_existing.complaint_type<>v_type OR v_existing.details<>v_details THEN
      RAISE EXCEPTION 'BGY_CONCERN_OPERATION_REUSED' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('complaint',to_jsonb(v_existing),'replayed',true);
  END IF;

  IF NOT EXISTS(SELECT 1 FROM public.master_data_values
      WHERE category='concern_category' AND is_active=true AND lower(label)=lower(v_type)) THEN
    RAISE EXCEPTION 'BGY_CONCERN_INVALID' USING ERRCODE='22023';
  END IF;
  v_eligibility := public.bgy_phase8_concern_eligibility(p_resident_id);
  IF v_eligibility->>'allowed'='false' THEN
    IF (v_eligibility->'blockedReasons') ? 'CONCERN_OPEN_LIMIT_REACHED' THEN
      RAISE EXCEPTION 'BGY_CONCERN_OPEN_LIMIT' USING ERRCODE='P0001';
    END IF;
    RAISE EXCEPTION 'BGY_CONCERN_WINDOW_LIMIT' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.complaints(user_id,resident_name,complaint_type,details,status,submission_operation_id)
    VALUES(p_resident_id, btrim(concat_ws(' ',v_user.first_name,v_user.last_name)), v_type,v_details,'pending',p_operation_id)
    RETURNING * INTO v_created;
  RETURN jsonb_build_object('complaint',to_jsonb(v_created),'replayed',false);
END; $$;

REVOKE ALL ON FUNCTION public.bgy_phase8_validate_policy(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bgy_phase8_save_concern_limits(jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bgy_phase8_concern_eligibility(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bgy_phase8_submit_concern(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_phase8_validate_policy(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.bgy_phase8_save_concern_limits(jsonb,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.bgy_phase8_concern_eligibility(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bgy_phase8_submit_concern(uuid,text,text,uuid) TO service_role;

-- Prevent direct PostgREST INSERTs from bypassing quota checks.
-- The SECURITY DEFINER function above performs authorized inserts as the function owner.
REVOKE INSERT ON public.complaints FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bgy_phase8_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.landing_content WHERE key_name='concern_submission_limits')
   AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='complaints' AND column_name='submission_operation_id')
   AND EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.bgy_phase8_submit_concern(uuid,text,text,uuid)'::regprocedure)
   AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.complaints'::regclass AND tgname='bgy_case_created_trg' AND NOT tgisinternal)
   AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.complaints'::regclass AND tgname='bgy_audit_row_change_trg' AND NOT tgisinternal);
$$;
REVOKE ALL ON FUNCTION public.bgy_phase8_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_phase8_ready() TO service_role;
COMMIT;
