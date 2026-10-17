-- BARANGAY IBA V4 PHASE 10.5: resident evidence, household relationships and abuse protection.
-- ADDITIVE ONLY. Take a production backup before running. Apply after Phase 10.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS suffix text NOT NULL DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS sex text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS civil_status text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS citizenship text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS place_of_birth text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS residency_since date;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='bgy_p105_resident_sex_check' AND conrelid='public.users'::regclass) THEN
  ALTER TABLE public.users ADD CONSTRAINT bgy_p105_resident_sex_check CHECK (sex IS NULL OR sex IN ('male','female','other','prefer_not_to_say'));
 END IF;
END $$;

ALTER TABLE public.census_households ADD COLUMN IF NOT EXISTS contact_number text NOT NULL DEFAULT '';
ALTER TABLE public.census_households ADD COLUMN IF NOT EXISTS housing_tenure text;
ALTER TABLE public.census_households ADD COLUMN IF NOT EXISTS residency_since date;
ALTER TABLE public.census_households ADD COLUMN IF NOT EXISTS membership_verified boolean NOT NULL DEFAULT false;
ALTER TABLE public.census_households DROP CONSTRAINT IF EXISTS census_households_members_check;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='bgy_p105_nonnegative_members' AND conrelid='public.census_households'::regclass) THEN
  ALTER TABLE public.census_households ADD CONSTRAINT bgy_p105_nonnegative_members CHECK (members >= 0);
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.household_members (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 household_id uuid NOT NULL REFERENCES public.census_households(id) ON DELETE RESTRICT,
 user_id uuid UNIQUE REFERENCES public.users(id) ON DELETE SET NULL,
 first_name text NOT NULL CHECK (length(trim(first_name)) BETWEEN 1 AND 100),
 middle_name text NOT NULL DEFAULT '',
 last_name text NOT NULL CHECK (length(trim(last_name)) BETWEEN 1 AND 100),
 suffix text NOT NULL DEFAULT '',
 relationship text NOT NULL CHECK (length(trim(relationship)) BETWEEN 1 AND 80),
 is_head boolean NOT NULL DEFAULT false,
 sex text,
 birthdate date,
 civil_status text,
 occupation text,
 is_senior boolean NOT NULL DEFAULT false,
 is_pwd boolean NOT NULL DEFAULT false,
 is_solo_parent boolean NOT NULL DEFAULT false,
 is_4ps boolean NOT NULL DEFAULT false,
 is_registered_voter boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT bgy_p105_household_member_sex CHECK (sex IS NULL OR sex IN ('male','female','other','prefer_not_to_say'))
);
CREATE UNIQUE INDEX IF NOT EXISTS bgy_p105_one_household_head ON public.household_members(household_id) WHERE is_head;
CREATE INDEX IF NOT EXISTS bgy_p105_member_household_idx ON public.household_members(household_id);
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.household_members FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.household_members TO service_role;

CREATE OR REPLACE FUNCTION public.bgy_p105_validate_head()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   PERFORM 1 FROM public.census_households WHERE id=NEW.household_id FOR UPDATE;
   IF NOT EXISTS(SELECT 1 FROM public.household_members WHERE household_id=NEW.household_id) AND NOT NEW.is_head THEN
     RAISE EXCEPTION 'The first recorded household member must be the head.' USING ERRCODE='22023';
   END IF;
 END IF;
 IF TG_OP='DELETE' AND OLD.is_head AND (SELECT count(*) FROM public.household_members WHERE household_id=OLD.household_id)>1 THEN
   RAISE EXCEPTION 'Assign another household head before removing the current head.' USING ERRCODE='23503';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bgy_p105_validate_head_trg ON public.household_members;
CREATE TRIGGER bgy_p105_validate_head_trg BEFORE INSERT OR DELETE ON public.household_members
FOR EACH ROW EXECUTE FUNCTION public.bgy_p105_validate_head();

CREATE OR REPLACE FUNCTION public.bgy_p105_sync_household_members()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE hid uuid;
BEGIN
 IF TG_OP='DELETE' THEN hid:=OLD.household_id; ELSE hid:=NEW.household_id; END IF;
 UPDATE public.census_households SET members=(SELECT count(*) FROM public.household_members WHERE household_id=hid),
   membership_verified=true, updated_at=clock_timestamp() WHERE id=hid;
 IF TG_OP='UPDATE' AND NEW.household_id IS DISTINCT FROM OLD.household_id THEN
   UPDATE public.census_households SET members=(SELECT count(*) FROM public.household_members WHERE household_id=OLD.household_id),
     membership_verified=true, updated_at=clock_timestamp() WHERE id=OLD.household_id;
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS bgy_p105_member_count_trg ON public.household_members;
CREATE TRIGGER bgy_p105_member_count_trg AFTER INSERT OR UPDATE OR DELETE ON public.household_members
FOR EACH ROW EXECUTE FUNCTION public.bgy_p105_sync_household_members();

-- Atomic reassignment avoids a window with two heads or none.
CREATE OR REPLACE FUNCTION public.bgy_p105_assign_household_head(p_household_id uuid,p_member_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM public.census_households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.household_members WHERE id=p_member_id AND household_id=p_household_id) THEN
   RAISE EXCEPTION 'Household member not found' USING ERRCODE='22023';
 END IF;
 UPDATE public.household_members SET is_head=false,updated_at=clock_timestamp()
 WHERE household_id=p_household_id AND is_head=true AND id<>p_member_id;
 UPDATE public.household_members SET is_head=true,relationship='Head',updated_at=clock_timestamp()
 WHERE id=p_member_id AND household_id=p_household_id;
END $$;
REVOKE ALL ON FUNCTION public.bgy_p105_assign_household_head(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_p105_assign_household_head(uuid,uuid) TO service_role;

-- Disable the obsolete destructive RPC for the API service account.
REVOKE EXECUTE ON FUNCTION public.replace_census_households(jsonb) FROM service_role;
-- Safety net for the original destructive Excel import RPC. The API now disables replacement.
-- Never allow a legacy client to erase a household with attached persons.
CREATE OR REPLACE FUNCTION public.bgy_p105_block_linked_household_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.household_members WHERE household_id=OLD.id) THEN
   RAISE EXCEPTION 'Household has recorded members; remove or reassign members first.' USING ERRCODE='23503';
 END IF;
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS bgy_p105_household_delete_guard ON public.census_households;
CREATE TRIGGER bgy_p105_household_delete_guard BEFORE DELETE ON public.census_households
FOR EACH ROW EXECUTE FUNCTION public.bgy_p105_block_linked_household_delete();

CREATE TABLE IF NOT EXISTS public.resident_id_types (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 label text NOT NULL UNIQUE CHECK (length(trim(label)) BETWEEN 2 AND 80),
 is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.resident_id_types(label) VALUES
 ('Barangay ID'),('Student ID'),('National ID'),('Driver''s License'),('Passport'),('Postal ID'),('Voter''s ID'),('Senior Citizen ID'),('PWD ID')
ON CONFLICT(label) DO NOTHING;
ALTER TABLE public.resident_id_types ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.resident_id_types FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.resident_id_types TO service_role;

CREATE TABLE IF NOT EXISTS public.resident_id_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 document_type_id uuid REFERENCES public.resident_id_types(id),
 document_label text NOT NULL CHECK (length(trim(document_label)) BETWEEN 2 AND 80),
 storage_path text NOT NULL UNIQUE,
 content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
 byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
 uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT bgy_p105_evidence_path CHECK (storage_path LIKE 'resident-ids/%')
);
CREATE INDEX IF NOT EXISTS bgy_p105_id_evidence_user ON public.resident_id_evidence(user_id);
ALTER TABLE public.resident_id_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.resident_id_evidence FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.resident_id_evidence TO service_role;

-- Private bucket; server-side service_role uploads only. No public URL or data: fallback.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('barangay-resident-ids','barangay-resident-ids',false,5242880,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=5242880,
 allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp'];

-- Incident photos are private evidence, not public suggestion uploads.
CREATE TABLE IF NOT EXISTS public.concern_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 complaint_id uuid NOT NULL UNIQUE REFERENCES public.complaints(id) ON DELETE CASCADE,
 uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
 storage_path text NOT NULL UNIQUE CHECK (storage_path LIKE 'concerns/%'),
 content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
 byte_size integer NOT NULL CHECK (byte_size BETWEEN 100 AND 5242880),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.concern_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.concern_evidence FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.concern_evidence TO service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('barangay-concern-evidence','barangay-concern-evidence',false,5242880,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=5242880,
 allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp'];

-- Persistent, atomic rate windows; only the server's service_role may invoke these.
CREATE TABLE IF NOT EXISTS public.bgy_rate_limit_counters (
 key_hash text PRIMARY KEY CHECK (length(key_hash)=64),
 count integer NOT NULL DEFAULT 0,
 window_ends_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bgy_rate_limit_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bgy_rate_limit_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.bgy_rate_limit_counters TO service_role;

CREATE OR REPLACE FUNCTION public.bgy_p105_rate_check(p_key text,p_limit integer,p_window_seconds integer,p_increment boolean DEFAULT true)
RETURNS TABLE(allowed boolean, retry_after integer, used integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count integer; v_end timestamptz; v_now timestamptz:=clock_timestamp();
BEGIN
 IF p_key !~ '^[a-f0-9]{64}$' OR p_limit NOT BETWEEN 1 AND 10000 OR p_window_seconds NOT BETWEEN 1 AND 2678400 THEN
   RAISE EXCEPTION 'Invalid rate-limit input' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_key,1007));
 SELECT count,window_ends_at INTO v_count,v_end FROM public.bgy_rate_limit_counters WHERE key_hash=p_key FOR UPDATE;
 IF v_end IS NULL OR v_end <= v_now THEN
   v_count:=0;v_end:=v_now+make_interval(secs=>p_window_seconds);
 END IF;
 allowed:=v_count < p_limit;
 IF p_increment AND allowed THEN v_count:=v_count+1; END IF;
 retry_after:=CASE WHEN allowed THEN 0 ELSE GREATEST(1,CEIL(EXTRACT(EPOCH FROM v_end-v_now))::integer) END;
 used:=v_count;
 IF p_increment AND allowed THEN
   INSERT INTO public.bgy_rate_limit_counters(key_hash,count,window_ends_at,updated_at)
     VALUES(p_key,v_count,v_end,v_now)
   ON CONFLICT(key_hash) DO UPDATE SET count=EXCLUDED.count,window_ends_at=EXCLUDED.window_ends_at,updated_at=v_now;
 END IF;
 RETURN NEXT;
END $$;
CREATE OR REPLACE FUNCTION public.bgy_p105_rate_clear(p_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_key !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid key' USING ERRCODE='22023'; END IF;
 DELETE FROM public.bgy_rate_limit_counters WHERE key_hash=p_key;
END $$;
REVOKE ALL ON FUNCTION public.bgy_p105_rate_check(text,integer,integer,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bgy_p105_rate_clear(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_p105_rate_check(text,integer,integer,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.bgy_p105_rate_clear(text) TO service_role;

CREATE INDEX IF NOT EXISTS bgy_p105_rate_expiry_idx ON public.bgy_rate_limit_counters(window_ends_at);
CREATE OR REPLACE FUNCTION public.bgy_p105_prune_rate_counters()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_deleted integer;
BEGIN
 DELETE FROM public.bgy_rate_limit_counters WHERE window_ends_at < clock_timestamp()-interval '1 day';
 GET DIAGNOSTICS v_deleted=ROW_COUNT;
 RETURN v_deleted;
END $$;
REVOKE ALL ON FUNCTION public.bgy_p105_prune_rate_counters() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_p105_prune_rate_counters() TO service_role;

-- No new duplicate active requests, even under concurrent submissions. Existing records untouched.
CREATE OR REPLACE FUNCTION public.bgy_p105_guard_duplicate_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status IN ('submitted','acknowledged','processing') THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text || ':' || TG_TABLE_NAME,103));
   IF TG_TABLE_NAME='requests' THEN
     IF EXISTS (SELECT 1 FROM public.requests r WHERE r.user_id=NEW.user_id AND r.request_type=NEW.request_type
       AND r.status IN ('submitted','acknowledged','processing') AND r.id<>NEW.id) THEN
       RAISE EXCEPTION 'You already have an active request for this document type.' USING ERRCODE='P0001';
     END IF;
   ELSE
     IF EXISTS (SELECT 1 FROM public.id_requests r WHERE r.user_id=NEW.user_id
       AND r.status IN ('submitted','acknowledged','processing') AND r.id<>NEW.id) THEN
       RAISE EXCEPTION 'You already have an active Barangay ID request.' USING ERRCODE='P0001';
     END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bgy_p105_request_guard ON public.requests;
CREATE TRIGGER bgy_p105_request_guard BEFORE INSERT OR UPDATE OF status ON public.requests
FOR EACH ROW EXECUTE FUNCTION public.bgy_p105_guard_duplicate_request();
DROP TRIGGER IF EXISTS bgy_p105_id_guard ON public.id_requests;
CREATE TRIGGER bgy_p105_id_guard BEFORE INSERT OR UPDATE OF status ON public.id_requests
FOR EACH ROW EXECUTE FUNCTION public.bgy_p105_guard_duplicate_request();

-- Business cap: at most three suggestions per resident per rolling 7x24 hours.
-- Lock user to serialize concurrent requests. Editing does not consume a slot.
CREATE OR REPLACE FUNCTION public.bgy_p105_suggestion_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_role text;
BEGIN
 SELECT role INTO v_role FROM public.users WHERE id=NEW.user_id FOR UPDATE;
 IF v_role <> 'resident' THEN RAISE EXCEPTION 'Only residents may submit suggestions' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.project_suggestions WHERE user_id=NEW.user_id AND created_at>clock_timestamp()-interval '7 days') >= 3 THEN
   RAISE EXCEPTION 'Only 3 project suggestions may be submitted every 7 days.' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bgy_p105_suggestion_limit ON public.project_suggestions;
CREATE TRIGGER bgy_p105_suggestion_limit BEFORE INSERT ON public.project_suggestions
 FOR EACH ROW EXECUTE FUNCTION public.bgy_p105_suggestion_cap();

ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS incident_purok text;
-- Business cap: at most three suggestions per resident per rolling 7x24 hours.
-- Lock user to serialize concurrent requests. Editing does not consume a slot.
CREATE OR REPLACE FUNCTION public.bgy_p105_suggestion_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_role text;
BEGIN
 SELECT role INTO v_role FROM public.users WHERE id=NEW.user_id FOR UPDATE;
 IF v_role <> 'resident' THEN RAISE EXCEPTION 'Only residents may submit suggestions' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.project_suggestions WHERE user_id=NEW.user_id AND created_at>clock_timestamp()-interval '7 days') >= 3 THEN
   RAISE EXCEPTION 'Only 3 project suggestions may be submitted every 7 days.' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bgy_p105_suggestion_limit ON public.project_suggestions;
CREATE TRIGGER bgy_p105_suggestion_limit BEFORE INSERT ON public.project_suggestions
 FOR EACH ROW EXECUTE FUNCTION public.bgy_p105_suggestion_cap();

ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS incident_location text;
-- Business cap: at most three suggestions per resident per rolling 7x24 hours.
-- Lock user to serialize concurrent requests. Editing does not consume a slot.
CREATE OR REPLACE FUNCTION public.bgy_p105_suggestion_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_role text;
BEGIN
 SELECT role INTO v_role FROM public.users WHERE id=NEW.user_id FOR UPDATE;
 IF v_role <> 'resident' THEN RAISE EXCEPTION 'Only residents may submit suggestions' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.project_suggestions WHERE user_id=NEW.user_id AND created_at>clock_timestamp()-interval '7 days') >= 3 THEN
   RAISE EXCEPTION 'Only 3 project suggestions may be submitted every 7 days.' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bgy_p105_suggestion_limit ON public.project_suggestions;
CREATE TRIGGER bgy_p105_suggestion_limit BEFORE INSERT ON public.project_suggestions
 FOR EACH ROW EXECUTE FUNCTION public.bgy_p105_suggestion_cap();

ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS incident_at timestamptz;
-- Business cap: at most three suggestions per resident per rolling 7x24 hours.
-- Lock user to serialize concurrent requests. Editing does not consume a slot.
CREATE OR REPLACE FUNCTION public.bgy_p105_suggestion_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_role text;
BEGIN
 SELECT role INTO v_role FROM public.users WHERE id=NEW.user_id FOR UPDATE;
 IF v_role <> 'resident' THEN RAISE EXCEPTION 'Only residents may submit suggestions' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.project_suggestions WHERE user_id=NEW.user_id AND created_at>clock_timestamp()-interval '7 days') >= 3 THEN
   RAISE EXCEPTION 'Only 3 project suggestions may be submitted every 7 days.' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bgy_p105_suggestion_limit ON public.project_suggestions;
CREATE TRIGGER bgy_p105_suggestion_limit BEFORE INSERT ON public.project_suggestions
 FOR EACH ROW EXECUTE FUNCTION public.bgy_p105_suggestion_cap();

ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS respondent_name text;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS copies_requested smallint NOT NULL DEFAULT 1;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS purpose_category text;
ALTER TABLE public.borrowing_requests ADD COLUMN IF NOT EXISTS booking_contact text;
ALTER TABLE public.borrowing_requests ADD COLUMN IF NOT EXISTS expected_attendees integer;
ALTER TABLE public.project_suggestions ADD COLUMN IF NOT EXISTS affected_purok text;
ALTER TABLE public.project_suggestions ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.project_suggestions ADD COLUMN IF NOT EXISTS estimated_beneficiaries integer;
ALTER TABLE public.project_suggestions ADD COLUMN IF NOT EXISTS estimated_cost numeric(14,2);

-- Atomic enriched concern submission wraps the Phase 8 quota lock and insert.
CREATE OR REPLACE FUNCTION public.bgy_p105_submit_concern(
 p_resident_id uuid,p_type text,p_details text,p_operation_id uuid,
 p_incident_purok text DEFAULT NULL,p_incident_location text DEFAULT NULL,
 p_incident_at timestamptz DEFAULT NULL,p_respondent_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result jsonb;v_id uuid;
BEGIN
 IF length(coalesce(p_incident_location,''))>250 OR length(coalesce(p_respondent_name,''))>180 OR length(coalesce(p_incident_purok,''))>100 THEN
   RAISE EXCEPTION 'Incident fields are too long' USING ERRCODE='22023';
 END IF;
 v_result:=public.bgy_phase8_submit_concern(p_resident_id,p_type,p_details,p_operation_id);
 v_id:=(v_result->'complaint'->>'id')::uuid;
 IF coalesce((v_result->>'replayed')::boolean,false)=false THEN
   UPDATE public.complaints SET incident_purok=NULLIF(trim(p_incident_purok),''),
    incident_location=NULLIF(trim(p_incident_location),''),incident_at=p_incident_at,
    respondent_name=NULLIF(trim(p_respondent_name),'') WHERE id=v_id;
 END IF;
 RETURN jsonb_set(v_result,'{complaint}',
   (SELECT to_jsonb(c) FROM public.complaints c WHERE c.id=v_id));
END $$;
REVOKE ALL ON FUNCTION public.bgy_p105_submit_concern(uuid,text,text,uuid,text,text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_p105_submit_concern(uuid,text,text,uuid,text,text,timestamptz,text) TO service_role;

-- Never return private ID evidence to anon/authenticated; Phase 1 row auditing is supported.
DO $$
DECLARE v_table text;
BEGIN
 FOREACH v_table IN ARRAY ARRAY['household_members','resident_id_types'] LOOP
   IF to_regprocedure('public.bgy_audit_row_change()') IS NOT NULL THEN
     EXECUTE format('DROP TRIGGER IF EXISTS bgy_p105_audit_trg ON public.%I',v_table);
     EXECUTE format('CREATE TRIGGER bgy_p105_audit_trg AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bgy_audit_row_change()',v_table);
   END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.bgy_p105_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT to_regclass('public.household_members') IS NOT NULL
 AND to_regclass('public.resident_id_evidence') IS NOT NULL
 AND to_regclass('public.concern_evidence') IS NOT NULL
 AND to_regclass('public.bgy_rate_limit_counters') IS NOT NULL
 AND to_regclass('storage.buckets') IS NOT NULL
 AND to_regprocedure('public.bgy_p105_rate_check(text,integer,integer,boolean)') IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.bgy_p105_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_p105_ready() TO service_role;
COMMIT;
