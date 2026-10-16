-- Barangay Iba V4 | Phase 7: editable community hotlines.
-- Back up first. Non-destructive: keeps all existing content and prior hotline row.
-- Run after Phases 1-6, before deploying the Phase 7 backend.
BEGIN;

INSERT INTO public.landing_content(key_name, value, updated_at)
VALUES ('hotlines', jsonb_build_object('hotlines', jsonb_build_array(
  jsonb_build_object('id','hotline_1','label','Barangay Iba Hotline 1','phone','09165222147','hours','','note','','is_active',true),
  jsonb_build_object('id','hotline_2','label','Barangay Iba Hotline 2','phone','09912678875','hours','','note','','is_active',true)
)), now())
ON CONFLICT (key_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.bgy_phase7_save_hotlines(
  p_hotlines jsonb,
  p_expected_updated_at timestamptz
) RETURNS TABLE(value jsonb, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_old_updated_at timestamptz;
  v_entry jsonb;
  v_i integer := 0;
  v_active integer := 0;
  v_numbers text[] := ARRAY[]::text[];
  v_phone text;
BEGIN
  SELECT lc.updated_at INTO v_old_updated_at FROM public.landing_content lc
  WHERE lc.key_name = 'hotlines' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hotline configuration is missing. Run Phase 7 migration.' USING ERRCODE = 'P0001'; END IF;
  IF p_expected_updated_at IS NULL OR v_old_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Hotline settings were updated by someone else. Reload and try again.' USING ERRCODE = '40001';
  END IF;
  IF p_hotlines IS NULL OR jsonb_typeof(p_hotlines) <> 'object'
     OR jsonb_typeof(p_hotlines->'hotlines') <> 'array'
     OR jsonb_array_length(p_hotlines->'hotlines') <> 2 THEN
    RAISE EXCEPTION 'Exactly two hotlines are required.' USING ERRCODE = '22023';
  END IF;
  FOR v_entry IN SELECT el.value FROM jsonb_array_elements(p_hotlines->'hotlines') AS el(value) LOOP
    v_i := v_i + 1;
    IF v_entry->>'id' <> ('hotline_' || v_i::text)
       OR jsonb_typeof(v_entry->'is_active') <> 'boolean'
       OR jsonb_typeof(v_entry->'label') <> 'string'
       OR length(trim(v_entry->>'label')) NOT BETWEEN 1 AND 80
       OR jsonb_typeof(v_entry->'phone') <> 'string'
       OR jsonb_typeof(v_entry->'hours') <> 'string'
       OR length(v_entry->>'hours') > 100
       OR jsonb_typeof(v_entry->'note') <> 'string'
       OR length(v_entry->>'note') > 300 THEN
      RAISE EXCEPTION 'Invalid hotline settings.' USING ERRCODE = '22023';
    END IF;
    v_phone := v_entry->>'phone';
    IF v_phone <> '' AND v_phone !~ '^09[0-9]{9}$' THEN
      RAISE EXCEPTION 'Invalid hotline phone number.' USING ERRCODE = '22023';
    END IF;
    IF v_entry->>'is_active' = 'true' THEN
      v_active := v_active + 1;
      IF v_phone = '' THEN RAISE EXCEPTION 'Active hotline requires a phone number.' USING ERRCODE = '22023'; END IF;
    END IF;
    IF v_phone <> '' THEN
      IF v_phone = ANY(v_numbers) THEN RAISE EXCEPTION 'Hotline numbers must be different.' USING ERRCODE = '22023'; END IF;
      v_numbers := array_append(v_numbers, v_phone);
    END IF;
  END LOOP;
  IF v_active < 1 THEN RAISE EXCEPTION 'At least one hotline must remain active.' USING ERRCODE = '22023'; END IF;

  -- No-op saves should not change timestamps or generate misleading audit events.
  IF (SELECT lc.value FROM public.landing_content lc WHERE lc.key_name = 'hotlines') = p_hotlines THEN
    RETURN QUERY SELECT lc.value, lc.updated_at FROM public.landing_content lc WHERE lc.key_name = 'hotlines';
    RETURN;
  END IF;

  -- The existing Phase 1 landing_content trigger records before and after values
  -- within the same transaction as this change.
  UPDATE public.landing_content AS lc
  SET value = p_hotlines, updated_at = clock_timestamp()
  WHERE lc.key_name = 'hotlines';
  RETURN QUERY SELECT lc.value, lc.updated_at FROM public.landing_content lc WHERE lc.key_name = 'hotlines';
END; $$;

REVOKE ALL ON FUNCTION public.bgy_phase7_save_hotlines(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_phase7_save_hotlines(jsonb, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.bgy_phase7_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.landing_content WHERE key_name = 'hotlines'
    AND jsonb_typeof(value->'hotlines') = 'array'
    AND jsonb_array_length(value->'hotlines') = 2
 ) AND EXISTS(
  SELECT 1 FROM pg_trigger
  WHERE tgrelid = 'public.landing_content'::regclass
    AND tgname = 'bgy_audit_row_change_trg' AND NOT tgisinternal
 );
$$;
REVOKE ALL ON FUNCTION public.bgy_phase7_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_phase7_ready() TO service_role;

COMMIT;
