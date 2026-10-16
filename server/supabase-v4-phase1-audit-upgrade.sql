-- BARANGAY IBA V4 / PHASE 1 - NON-DESTRUCTIVE AUDIT UPGRADE
-- Prerequisite: V4 schema and supabase-v4-postdeploy-fixes.sql are applied.
-- Back up before running. Existing audit and business data are preserved.
-- CRITICAL DEPLOYMENT ORDER: apply this migration BEFORE deploying the Phase 1 API.
BEGIN;

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS event_category text,
  ADD COLUMN IF NOT EXISTS event_source text,
  ADD COLUMN IF NOT EXISTS target_label text,
  ADD COLUMN IF NOT EXISTS changed_fields jsonb,
  ADD COLUMN IF NOT EXISTS correlation_id text;

CREATE INDEX IF NOT EXISTS audit_logs_category_time_idx ON public.audit_logs(event_category, created_at DESC, id);
CREATE INDEX IF NOT EXISTS audit_logs_actor_time_idx ON public.audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_target_time_idx ON public.audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_correlation_idx ON public.audit_logs(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_logs_created_id_idx ON public.audit_logs(created_at DESC, id DESC);

-- Mask credentials, recovery codes, financial/ID attachments and auth secrets before persistence.
-- Note contents and ordinary modified values are kept for accountable administrative review.
CREATE OR REPLACE FUNCTION public.bgy_audit_clean_row(source_row jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE entry record; cleaned jsonb := '{}'::jsonb;
BEGIN
  IF source_row IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(source_row) = 'array' THEN
    SELECT coalesce(jsonb_agg(public.bgy_audit_clean_row(value)), '[]'::jsonb)
      INTO cleaned FROM jsonb_array_elements(source_row) AS elements(value);
    RETURN cleaned;
  END IF;
  IF jsonb_typeof(source_row) <> 'object' THEN RETURN source_row; END IF;
  FOR entry IN SELECT key, value FROM jsonb_each(source_row) LOOP
    IF entry.key ~* '(password|secret|token|(^|_)code(_|$)|authorization|api_key|valid_id|id_photo|gov_id|credential|otp)' THEN
      cleaned := cleaned || jsonb_build_object(entry.key, '[redacted]');
    ELSE
      cleaned := cleaned || jsonb_build_object(entry.key, public.bgy_audit_clean_row(entry.value));
    END IF;
  END LOOP;
  RETURN cleaned;
END; $$;

-- Every row change is inserted within the SAME transaction as the underlying write.
-- The authenticated actor is supplied by the trusted Express service as PostgREST headers.
-- Direct SQL/system writes are recorded as database/system, never attributed to an admin.
CREATE OR REPLACE FUNCTION public.bgy_audit_row_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  headers jsonb := '{}'::jsonb;
  raw_headers text;
  before_row jsonb;
  after_row jsonb;
  diffs jsonb := '{}'::jsonb;
  col text;
  ref_row jsonb;
  record_id text;
  display_name text;
  audit_action text;
  actor_uuid uuid;
  claimed_actor text;
  actor_role_value text;
  actor_name_value text;
  request_id text;
  actor_source text;
BEGIN
  raw_headers := current_setting('request.headers', true);
  IF raw_headers IS NOT NULL AND left(ltrim(raw_headers), 1) = '{' THEN
    headers := raw_headers::jsonb;
  END IF;
  claimed_actor := nullif(headers->>'x-bgy-audit-actor-id', '');
  IF claimed_actor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    actor_uuid := claimed_actor::uuid;
  END IF;
  actor_role_value := coalesce(nullif(headers->>'x-bgy-audit-actor-role',''), 'system');
  IF nullif(headers->>'x-bgy-audit-actor-name','') IS NOT NULL THEN
    actor_name_value := convert_from(decode(headers->>'x-bgy-audit-actor-name', 'base64'), 'UTF8');
  END IF;
  request_id := nullif(headers->>'x-bgy-audit-request-id','');
  actor_source := CASE WHEN actor_uuid IS NOT NULL THEN 'backend' ELSE 'database' END;

  before_row := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE public.bgy_audit_clean_row(to_jsonb(OLD)) END;
  after_row  := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE public.bgy_audit_clean_row(to_jsonb(NEW)) END;
  ref_row := coalesce(after_row, before_row, '{}'::jsonb);
  record_id := coalesce(ref_row->>'id', ref_row->>'key_name', ref_row->>'name', 'unknown');
  display_name := coalesce(ref_row->>'full_name', ref_row->>'title', ref_row->>'name', ref_row->>'username', ref_row->>'key_name', record_id);

  IF TG_OP = 'UPDATE' THEN
    FOR col IN SELECT key FROM jsonb_object_keys(coalesce(before_row,'{}'::jsonb) || coalesce(after_row,'{}'::jsonb)) AS key LOOP
      IF before_row->col IS DISTINCT FROM after_row->col THEN
        -- Do not expose a changed secret's old/new hash or its value in the diff.
        IF after_row->>col = '[redacted]' THEN
          diffs := diffs || jsonb_build_object(col, jsonb_build_object('before','[redacted]','after','[redacted]'));
        ELSE
          diffs := diffs || jsonb_build_object(col, jsonb_build_object('before',before_row->col,'after',after_row->col));
        END IF;
      END IF;
    END LOOP;
    IF diffs = '{}'::jsonb THEN RETURN NEW; END IF;
  ELSIF TG_OP = 'INSERT' THEN
    diffs := coalesce(after_row,'{}'::jsonb);
  ELSE
    diffs := coalesce(before_row,'{}'::jsonb);
  END IF;

  audit_action := TG_TABLE_NAME || '.' || lower(TG_OP);
  IF TG_TABLE_NAME = 'users' AND TG_OP = 'UPDATE' AND (before_row->>'is_active') IS DISTINCT FROM (after_row->>'is_active') THEN
    audit_action := CASE WHEN after_row->>'is_active' = 'false' THEN 'user.deactivated' ELSE 'user.activated' END;
  ELSIF TG_OP = 'UPDATE' AND (before_row->>'status') IS DISTINCT FROM (after_row->>'status') THEN
    audit_action := TG_TABLE_NAME || '.status_changed';
  END IF;

  INSERT INTO public.audit_logs (
    actor_id, actor_role, actor_name_snapshot, action, entity_type, entity_id,
    details, module, before_data, after_data, changed_fields,
    outcome, event_category, event_source, target_label, correlation_id,
    http_method, route, ip_address, user_agent
  ) VALUES (
    actor_uuid, actor_role_value, actor_name_value,
    audit_action, TG_TABLE_NAME, record_id,
    jsonb_build_object('operation', TG_OP, 'table', TG_TABLE_NAME),
    TG_TABLE_NAME, before_row, after_row, diffs,
    'success', 'change', actor_source, left(display_name, 300), request_id,
    nullif(headers->>'x-bgy-audit-method',''), nullif(headers->>'x-bgy-audit-route',''),
    nullif(headers->>'x-bgy-audit-ip',''),
    CASE WHEN nullif(headers->>'x-bgy-audit-user-agent','') IS NOT NULL THEN
      convert_from(decode(headers->>'x-bgy-audit-user-agent', 'base64'), 'UTF8') ELSE NULL END
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$;

-- Only tables actually present get triggers; supports V4 rollouts with optional modules.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users','verification_codes','votes','notifications','complaints','requests','request_timeline',
    'id_requests','id_pickup_slots','project_suggestions','elections','election_options',
    'project_completions','borrowable_assets','borrowing_requests','master_data_values',
    'census_households','clearances','landing_content','officials','announcements','events',
    'fund_sources','fund_projects','community_projects','project_updates'
  ] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = table_name AND t.tgname = 'bgy_audit_row_change_trg'
      ) THEN
        EXECUTE format('CREATE TRIGGER bgy_audit_row_change_trg AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bgy_audit_row_change()', table_name);
      END IF;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_logs FROM PUBLIC, anon, authenticated;
-- Supabase service_role can write audit events and read reports, but cannot modify/delete history.
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM service_role;
GRANT SELECT, INSERT ON public.audit_logs TO service_role;
REVOKE ALL ON FUNCTION public.bgy_audit_clean_row(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bgy_audit_row_change() FROM PUBLIC, anon, authenticated;

-- API startup guard: do not accept writes if audit triggers have not been installed.
CREATE OR REPLACE FUNCTION public.bgy_audit_phase1_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT (
    SELECT count(*) >= 3
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('users', 'requests', 'borrowable_assets')
      AND t.tgname = 'bgy_audit_row_change_trg' AND NOT t.tgisinternal
  );
$$;
REVOKE ALL ON FUNCTION public.bgy_audit_phase1_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_audit_phase1_ready() TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
