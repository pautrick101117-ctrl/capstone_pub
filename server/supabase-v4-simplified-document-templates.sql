-- Barangay Iba V4: One-click document template saving with automatic immutable history.
-- NON-DESTRUCTIVE. Run after the Phase 11 document schema. No reset or TRUNCATE.
-- Existing issued/generated Word documents and template versions remain unchanged.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.document_templates') IS NULL
     OR to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'Install the Phase 11 document schema before this migration.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.bgy_template_save_current(
  p_document_type text,
  p_config jsonb,
  p_actor uuid,
  p_expected_id uuid
)
RETURNS public.document_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_current public.document_templates%ROWTYPE;
  v_saved public.document_templates%ROWTYPE;
  v_actor_role text;
  v_label text;
BEGIN
  -- Both app authorization and database authorization are required.
  SELECT u.role INTO v_actor_role FROM public.users u
  WHERE u.id = p_actor AND u.role = 'super_admin'
    AND u.status = 'approved' AND u.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only an active Super Admin may save document templates.' USING ERRCODE = '42501';
  END IF;

  IF p_document_type IS NULL OR p_document_type NOT IN (
    'Barangay Identification Card', 'Certificate of Indigency', 'Barangay Clearance',
    'Barangay Business Clearance', 'Certificate of Residency') THEN
    RAISE EXCEPTION 'Unsupported document type.' USING ERRCODE = '22023';
  END IF;
  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'Invalid document configuration.' USING ERRCODE = '22023';
  END IF;

  FOREACH v_label IN ARRAY ARRAY['title', 'chairmanName', 'designation',
                                  'controlPrefix', 'pickupInstructions', 'officeContact'] LOOP
    IF length(trim(coalesce(p_config->>v_label, ''))) = 0 THEN
      RAISE EXCEPTION 'Missing template field: %', v_label USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF coalesce(p_config->>'controlPrefix', '') !~ '^[A-Z]{1,12}$' THEN
    RAISE EXCEPTION 'The control prefix must contain 1–12 uppercase letters.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_config->'paragraphs') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Document paragraphs must be an array.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_config->'paragraphs') NOT BETWEEN 1 AND 8 THEN
    RAISE EXCEPTION 'Enter between one and eight paragraphs.' USING ERRCODE = '22023';
  END IF;

  -- Serialize saves for one document type; avoid version conflicts or lost edits.
  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext('bgy-document-template'), hashtext(p_document_type));
  SELECT * INTO v_current FROM public.document_templates
   WHERE document_type = p_document_type
   ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document setup is missing. Restore the initial template records.' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_id IS DISTINCT FROM v_current.id THEN
    RAISE EXCEPTION 'This document was changed by someone else. Reload before saving.' USING ERRCODE = '40001';
  END IF;

  -- Re-saving unchanged content should not manufacture a new version.
  IF v_current.approval_state = 'approved' AND v_current.config = p_config THEN
    RETURN v_current;
  END IF;

  -- The original unused draft can be saved in place. This avoids creating
  -- Version 2 simply because someone completed the original setup.
  IF v_current.approval_state = 'draft' THEN
    UPDATE public.document_templates SET
      config = p_config, approval_state = 'approved',
      updated_by = p_actor, approved_by = p_actor,
      approved_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE id = v_current.id
    RETURNING * INTO v_saved;
    RETURN v_saved;
  END IF;

  -- Later edits create a new immutable historical snapshot automatically.
  -- Existing issued documents continue referring to their previous template.
  INSERT INTO public.document_templates (
    document_type, version, display_name, config, approval_state,
    created_by, updated_by, approved_by, approved_at
  ) VALUES (
    p_document_type, v_current.version + 1, p_document_type, p_config, 'approved',
    p_actor, p_actor, p_actor, clock_timestamp()
  ) RETURNING * INTO v_saved;

  RETURN v_saved;
END;
$$;

REVOKE ALL ON FUNCTION public.bgy_template_save_current(text,jsonb,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_template_save_current(text,jsonb,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.bgy_simple_template_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog,public AS $$
  SELECT to_regprocedure('public.bgy_template_save_current(text,jsonb,uuid,uuid)') IS NOT NULL
    AND to_regclass('public.document_templates') IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.bgy_simple_template_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_simple_template_ready() TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
