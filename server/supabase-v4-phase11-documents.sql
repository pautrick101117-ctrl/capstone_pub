-- Additive upgrade after Phase 10.5. Never run a reset script to install this feature.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.bgy_p105_ready()') IS NULL OR NOT public.bgy_p105_ready() THEN
  RAISE EXCEPTION 'Apply the Phase 10.5 migration first';
 END IF;
END $$;
ALTER TABLE public.users
 ADD COLUMN IF NOT EXISTS house_number text,
 ADD COLUMN IF NOT EXISTS street text,
 ADD COLUMN IF NOT EXISTS barangay text,
 ADD COLUMN IF NOT EXISTS municipality text,
 ADD COLUMN IF NOT EXISTS province text,
 ADD COLUMN IF NOT EXISTS profile_photo_path text,
 ADD COLUMN IF NOT EXISTS photo_uploaded_at timestamptz,
 ADD COLUMN IF NOT EXISTS photo_updated_at timestamptz;

CREATE TABLE IF NOT EXISTS public.document_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_type text NOT NULL CHECK(document_type IN ('Barangay Identification Card','Certificate of Indigency','Barangay Clearance','Barangay Business Clearance','Certificate of Residency')),
 version integer NOT NULL CHECK(version>0), display_name text NOT NULL,
 approval_state text NOT NULL DEFAULT 'draft' CHECK(approval_state IN ('draft','approved','retired')),
 config jsonb NOT NULL CHECK(jsonb_typeof(config)='object'),
 created_by uuid REFERENCES public.users(id), updated_by uuid REFERENCES public.users(id),
 approved_by uuid REFERENCES public.users(id), approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(document_type,version), CHECK(approval_state<>'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
ALTER TABLE public.requests
 ADD COLUMN IF NOT EXISTS document_data jsonb NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS verified_snapshot jsonb,
 ADD COLUMN IF NOT EXISTS review_checks jsonb NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS lock_version integer NOT NULL DEFAULT 0 CHECK(lock_version>=0),
 ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.document_templates(id),
 ADD COLUMN IF NOT EXISTS control_number text,
 ADD COLUMN IF NOT EXISTS review_note text,
 ADD COLUMN IF NOT EXISTS rejection_reason text,
 ADD COLUMN IF NOT EXISTS revision_instructions text,
 ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id),
 ADD COLUMN IF NOT EXISTS approved_at timestamptz,
 ADD COLUMN IF NOT EXISTS issue_date date,
 ADD COLUMN IF NOT EXISTS expiration_date date,
 ADD COLUMN IF NOT EXISTS ready_for_pickup_at timestamptz,
 ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
 ADD COLUMN IF NOT EXISTS issuance_reference text,
 ADD COLUMN IF NOT EXISTS generated_document_id uuid;
-- Keep the legacy statuses and their original meaning; completed is never backfilled to claimed.
-- Preserve unrelated checks. The known legacy requests_status_check contains only the old status enum.
ALTER TABLE public.requests DROP CONSTRAINT IF EXISTS requests_status_check;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='bgy_documents_status' AND conrelid='public.requests'::regclass) THEN
 ALTER TABLE public.requests ADD CONSTRAINT bgy_documents_status CHECK(status IN
  ('submitted','acknowledged','processing','completed','under_review','needs_revision','rejected','approved','document_prepared','ready_for_pickup','claimed','cancelled')) NOT VALID;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='bgy_documents_copies' AND conrelid='public.requests'::regclass) THEN
 ALTER TABLE public.requests ADD CONSTRAINT bgy_documents_copies CHECK(copies_requested BETWEEN 1 AND 10) NOT VALID;
END IF; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS bgy_document_control_unique ON public.requests(control_number) WHERE control_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS bgy_documents_queue ON public.requests(status,request_type,created_at DESC);
CREATE TABLE IF NOT EXISTS public.document_number_counters (
 document_type text NOT NULL, issue_year integer NOT NULL, last_value bigint NOT NULL CHECK(last_value>0),
 PRIMARY KEY(document_type,issue_year)
);
CREATE TABLE IF NOT EXISTS public.generated_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE RESTRICT,
 template_id uuid NOT NULL REFERENCES public.document_templates(id), template_version integer NOT NULL,
 version_number integer NOT NULL CHECK(version_number>0), storage_path text NOT NULL UNIQUE,
 file_type text NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 source text NOT NULL CHECK(source IN ('generated','uploaded')), sha256 text NOT NULL,
 generated_at timestamptz NOT NULL DEFAULT now(), generated_by uuid NOT NULL REFERENCES public.users(id),
 finalized_at timestamptz, finalized_by uuid REFERENCES public.users(id),
 UNIQUE(request_id,version_number), CHECK((finalized_at IS NULL)=(finalized_by IS NULL))
);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='bgy_request_generated_fk') THEN
 ALTER TABLE public.requests ADD CONSTRAINT bgy_request_generated_fk FOREIGN KEY(generated_document_id) REFERENCES public.generated_documents(id) ON DELETE RESTRICT;
END IF; END $$;
CREATE TABLE IF NOT EXISTS public.request_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE RESTRICT,
 storage_path text NOT NULL UNIQUE, kind text NOT NULL CHECK(kind IN ('photo','supporting')),
 content_type text NOT NULL CHECK(content_type IN ('image/png')), uploaded_by uuid NOT NULL REFERENCES public.users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bgy_document_attachments_request ON public.request_attachments(request_id,created_at);
CREATE TABLE IF NOT EXISTS public.notification_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE RESTRICT,
 resident_id uuid REFERENCES public.users(id), notification_type text NOT NULL, recipient text,
 provider text NOT NULL DEFAULT 'resend', provider_message_id text,
 attempt_status text NOT NULL CHECK(attempt_status IN ('sending','accepted','failed','skipped')),
 error_code text, retry_count integer NOT NULL DEFAULT 0, initiated_by uuid NOT NULL REFERENCES public.users(id),
 idempotency_key uuid NOT NULL UNIQUE, message_snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bgy_notification_request ON public.notification_logs(request_id,created_at DESC);

-- Seed proposed wording only. Officials, validity, contact details and approvals must be supplied by staff.
INSERT INTO public.document_templates(document_type,version,display_name,config)
SELECT type,1,type,jsonb_build_object('title',title,'paragraphs',paragraphs,'chairmanName','','designation','Barangay Chairman',
 'footer','NOT VALID WITHOUT DRY SEAL','validityMonths',NULL,'controlPrefix',prefix,'issuanceStage','approved',
 'pickupInstructions','','officeContact','','requiredBusinessFields',jsonb_build_array('businessName','businessAddress','businessKind','permitYear'))
FROM (VALUES
 ('Barangay Identification Card','Barangay Identification Card',jsonb_build_array('{{fullName}}','{{address}}','The resident whose photograph appears here is a bona fide resident of this Barangay.'),'IBA'),
 ('Certificate of Indigency','CERTIFICATION OF INDIGENCY',jsonb_build_array('This is to certify that {{fullName}} is a bona fide resident of {{address}}.','{{incomeStatement}}','This certification is issued upon request for {{purpose}}.'),'I'),
 ('Barangay Clearance','FREE-BARANGAY CLEARANCE',jsonb_build_array('This is to certify that {{fullName}}, a bona fide resident of {{address}}, has completed the verification required by this office.','{{backgroundStatement}}','This certification is issued upon request for {{purpose}}.'),'C'),
 ('Barangay Business Clearance','FREE-BARANGAY BUSINESS CLEARANCE',jsonb_build_array('This clearance is issued for the business described below, operating in Barangay Iba, Silang, Cavite.','This certification is issued for securing the relevant business permit for {{permitYear}}.'),'BC'),
 ('Certificate of Residency','CERTIFICATION',jsonb_build_array('This is to certify that {{fullName}}, {{ageStatement}}, is a bona fide resident of {{address}}, residing in this community since {{residencySince}}.','This certification is issued upon request for {{purpose}}.'),'R')
) AS seed(type,title,paragraphs,prefix)
WHERE NOT EXISTS(SELECT 1 FROM public.document_templates t WHERE t.document_type=seed.type);

-- All private data is served through the verified Express service, never directly to anon/authenticated.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['document_templates','document_number_counters','generated_documents','request_attachments','notification_logs'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',t);
 END LOOP;
END $$;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('barangay-documents','barangay-documents',false,10485760,ARRAY['image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=10485760,allowed_mime_types=EXCLUDED.allowed_mime_types;

-- Includes every new active state and fixes the earlier ID guard's missing confirmed/rescheduled states.
CREATE OR REPLACE FUNCTION public.bgy_p105_guard_duplicate_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text||':'||TG_TABLE_NAME,103));
 IF TG_TABLE_NAME='requests' AND NEW.status IN ('submitted','acknowledged','processing','under_review','needs_revision','approved','document_prepared','ready_for_pickup') THEN
  IF EXISTS(SELECT 1 FROM public.requests r WHERE r.user_id=NEW.user_id AND r.request_type=NEW.request_type AND r.id<>NEW.id
   AND r.status IN ('submitted','acknowledged','processing','under_review','needs_revision','approved','document_prepared','ready_for_pickup')) THEN
   RAISE EXCEPTION 'You already have an active request for this document type.' USING ERRCODE='P0001';
  END IF;
 ELSIF TG_TABLE_NAME='id_requests' AND NEW.status IN ('submitted','confirmed','rescheduled') THEN
  IF EXISTS(SELECT 1 FROM public.id_requests r WHERE r.user_id=NEW.user_id AND r.id<>NEW.id AND r.status IN ('submitted','confirmed','rescheduled')) THEN
   RAISE EXCEPTION 'You already have an active Barangay ID appointment.' USING ERRCODE='P0001';
  END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.bgy_document_transition(p_id uuid,p_actor uuid,p_version integer,p_status text,p_note text,p_extra jsonb,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE r public.requests%ROWTYPE; a public.users%ROWTYPE; t public.document_templates%ROWTYPE;
 n bigint; yr integer; result jsonb; note text:=btrim(coalesce(p_note,'')); prev text;
BEGIN
 SELECT * INTO a FROM public.users WHERE id=p_actor AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account is not authorized' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.requests WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Request not found' USING ERRCODE='P0002'; END IF;
 IF a.role='resident' AND r.user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 IF r.lock_version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Request changed. Refresh and try again' USING ERRCODE='40001'; END IF;
 IF p_operation IS NULL OR EXISTS(SELECT 1 FROM public.case_history_events WHERE operation_id=p_operation) THEN
  RAISE EXCEPTION 'Operation already saved or invalid' USING ERRCODE='23505';
 END IF;
 IF length(note)>2000 THEN RAISE EXCEPTION 'Note is too long' USING ERRCODE='22023'; END IF;
 prev:=r.status;
 IF a.role='resident' THEN
  IF NOT ((prev='needs_revision' AND p_status='submitted') OR (prev IN ('submitted','needs_revision') AND p_status='cancelled')) THEN
   RAISE EXCEPTION 'Resident cannot make this transition' USING ERRCODE='42501';
  END IF;
  IF p_status='submitted' THEN
   r.details:=p_extra->>'details'; r.document_data:=p_extra->'document_data';
   r.copies_requested:=(p_extra->>'copies_requested')::smallint; r.purpose_category:=p_extra->>'purpose_category';
  END IF;
 ELSE
  IF a.role NOT IN ('admin','super_admin') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
  IF p_status<>prev AND NOT (
   (prev IN ('submitted','acknowledged','processing') AND p_status='under_review') OR
   (prev='under_review' AND p_status IN ('needs_revision','rejected','approved')) OR
   (prev='needs_revision' AND p_status IN ('under_review','rejected')) OR
   (prev='document_prepared' AND p_status='ready_for_pickup') OR
   (prev='ready_for_pickup' AND p_status='claimed')
  ) THEN RAISE EXCEPTION 'Invalid document status transition' USING ERRCODE='22023'; END IF;
  IF p_status=prev AND note='' THEN RAISE EXCEPTION 'A response is required' USING ERRCODE='22023'; END IF;
  IF p_status IN ('needs_revision','rejected') AND length(note)<3 THEN RAISE EXCEPTION 'Resident-facing instructions or rejection reason required' USING ERRCODE='22023'; END IF;
  IF p_status='approved' AND prev<>p_status THEN
   PERFORM 1 FROM public.users WHERE id=r.user_id AND updated_at=(p_extra->>'resident_updated_at')::timestamptz FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Resident profile changed during review' USING ERRCODE='40001'; END IF;
   SELECT * INTO t FROM public.document_templates WHERE id=(p_extra->>'template_id')::uuid AND approval_state='approved' AND document_type=r.request_type;
   IF NOT FOUND THEN RAISE EXCEPTION 'An approved document template is required' USING ERRCODE='22023'; END IF;
   IF coalesce(p_extra->'review_checks'->>'identityVerified','false')<>'true' OR coalesce(p_extra->'review_checks'->>'residencyVerified','false')<>'true' THEN
    RAISE EXCEPTION 'Verify identity and residency first' USING ERRCODE='22023'; END IF;
   IF r.request_type='Certificate of Indigency' AND coalesce(p_extra->'review_checks'->>'indigencyVerified','false')<>'true' THEN
    RAISE EXCEPTION 'Staff indigency verification required' USING ERRCODE='22023'; END IF;
   IF r.request_type='Barangay Clearance' AND coalesce(p_extra->'review_checks'->>'backgroundVerified','false')<>'true' THEN
    RAISE EXCEPTION 'Staff background verification required' USING ERRCODE='22023'; END IF;
   IF r.request_type='Barangay Business Clearance' AND coalesce(p_extra->'review_checks'->>'businessVerified','false')<>'true' THEN
    RAISE EXCEPTION 'Staff business verification required' USING ERRCODE='22023'; END IF;
   IF p_extra->'verified_snapshot' IS NULL OR p_extra->>'issue_date' IS NULL THEN RAISE EXCEPTION 'Verified snapshot and issue date required' USING ERRCODE='22023'; END IF;
   r.template_id:=t.id; r.verified_snapshot:=p_extra->'verified_snapshot'; r.review_checks:=p_extra->'review_checks';
   r.issue_date:=(p_extra->>'issue_date')::date; r.expiration_date:=nullif(p_extra->>'expiration_date','')::date;
   r.approved_by:=p_actor; r.approved_at:=now();
   IF t.config->>'issuanceStage'<>'approved' THEN RAISE EXCEPTION 'Unsupported numbering stage' USING ERRCODE='22023'; END IF;
   yr:=extract(year FROM r.issue_date);
   INSERT INTO public.document_number_counters(document_type,issue_year,last_value) VALUES(t.config->>'controlPrefix',yr,1)
    ON CONFLICT(document_type,issue_year) DO UPDATE SET last_value=document_number_counters.last_value+1 RETURNING last_value INTO n;
   r.control_number:=(t.config->>'controlPrefix')||yr::text||'-'||lpad(n::text,greatest(4,length(n::text)),'0');
   r.issuance_reference:=r.control_number;
  END IF;
 END IF;
 UPDATE public.requests SET status=p_status,details=r.details,document_data=r.document_data,copies_requested=r.copies_requested,
  purpose_category=r.purpose_category,verified_snapshot=r.verified_snapshot,review_checks=r.review_checks,template_id=r.template_id,
  control_number=r.control_number,issuance_reference=r.issuance_reference,issue_date=r.issue_date,expiration_date=r.expiration_date,
  approved_by=r.approved_by,approved_at=r.approved_at,lock_version=lock_version+1,updated_at=now(),
  admin_note=CASE WHEN a.role<>'resident' AND note<>'' THEN note ELSE admin_note END,
  review_note=CASE WHEN a.role<>'resident' AND note<>'' THEN note ELSE review_note END,
  revision_instructions=CASE WHEN p_status='needs_revision' THEN note ELSE revision_instructions END,
  rejection_reason=CASE WHEN p_status='rejected' THEN note ELSE rejection_reason END,
  ready_for_pickup_at=CASE WHEN p_status='ready_for_pickup' AND prev<>p_status THEN now() ELSE ready_for_pickup_at END,
  claimed_at=CASE WHEN p_status='claimed' AND prev<>p_status THEN now() ELSE claimed_at END
 WHERE id=p_id RETURNING to_jsonb(requests.*) INTO result;
 INSERT INTO public.request_timeline(request_id,status,note) VALUES(p_id,p_status,note);
 INSERT INTO public.case_history_events(entity_type,entity_id,event_type,actor_id,actor_name_snapshot,actor_role,previous_status,new_status,message,visibility,operation_id)
 VALUES('request',p_id,CASE WHEN prev=p_status THEN 'response_added' ELSE 'status_changed' END,p_actor,coalesce(a.full_name,a.first_name),a.role,prev,p_status,note,'resident',p_operation);
 INSERT INTO public.notifications(user_id,title,body,kind,broadcast) VALUES(r.user_id,'Document request update',r.request_type||': '||replace(p_status,'_',' ')||'. '||note,'info',false);
 RETURN result;
END $$;

-- Storage upload is staged under a random name, then attached here under a row lock. Failed commits are cleaned up by the API.
CREATE OR REPLACE FUNCTION public.bgy_document_save_version(p_id uuid,p_actor uuid,p_version integer,p_file jsonb,p_finalize boolean,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE r public.requests%ROWTYPE; a public.users%ROWTYPE; d public.generated_documents%ROWTYPE; v integer;
BEGIN
 SELECT * INTO a FROM public.users WHERE id=p_actor AND is_active AND role IN ('admin','super_admin');
 IF NOT FOUND THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.requests WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Request not found' USING ERRCODE='P0002'; END IF;
 IF r.lock_version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Request changed. Refresh and try again' USING ERRCODE='40001'; END IF;
 IF r.status<>'approved' THEN RAISE EXCEPTION 'Only approved requests accept document versions' USING ERRCODE='22023'; END IF;
 SELECT coalesce(max(version_number),0)+1 INTO v FROM public.generated_documents WHERE request_id=p_id;
 INSERT INTO public.generated_documents(id,request_id,template_id,template_version,version_number,storage_path,source,sha256,generated_by,finalized_at,finalized_by)
 VALUES((p_file->>'id')::uuid,p_id,r.template_id,(SELECT version FROM public.document_templates WHERE id=r.template_id),v,p_file->>'storage_path',p_file->>'source',p_file->>'sha256',p_actor,
  CASE WHEN p_finalize THEN now() END,CASE WHEN p_finalize THEN p_actor END) RETURNING * INTO d;
 UPDATE public.requests SET lock_version=lock_version+1,updated_at=now(),generated_document_id=d.id,
  status=CASE WHEN p_finalize THEN 'document_prepared' ELSE status END WHERE id=p_id;
 IF p_finalize THEN INSERT INTO public.request_timeline(request_id,status,note) VALUES(p_id,'document_prepared','Document reviewed and prepared by staff.'); END IF;
 INSERT INTO public.case_history_events(entity_type,entity_id,event_type,actor_id,actor_name_snapshot,actor_role,previous_status,new_status,message,visibility,metadata,operation_id)
 VALUES('request',p_id,CASE WHEN p_finalize THEN 'status_changed' ELSE 'internal_note' END,p_actor,a.full_name,a.role,r.status,
  CASE WHEN p_finalize THEN 'document_prepared' ELSE r.status END,
  CASE WHEN p_finalize THEN 'Document reviewed and prepared by staff.' ELSE 'Document version saved.' END,
  CASE WHEN p_finalize THEN 'resident' ELSE 'internal' END,jsonb_build_object('documentId',d.id,'version',v),p_operation);
 RETURN to_jsonb(d);
END $$;

CREATE OR REPLACE FUNCTION public.bgy_document_attach(p_id uuid,p_actor uuid,p_version integer,p_file jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE r public.requests%ROWTYPE; a public.users%ROWTYPE; item public.request_attachments%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public.users WHERE id=p_actor AND is_active;
 SELECT * INTO r FROM public.requests WHERE id=p_id FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found' USING ERRCODE='P0002'; END IF;
 IF a.id IS NULL OR a.role NOT IN ('resident','admin','super_admin') OR (a.role='resident' AND a.id IS DISTINCT FROM r.user_id) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 IF r.lock_version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='40001'; END IF;
 IF r.status NOT IN ('submitted','needs_revision','under_review','acknowledged','processing') THEN RAISE EXCEPTION 'Request files are locked after approval' USING ERRCODE='22023'; END IF;
 IF a.role='resident' AND r.status NOT IN ('submitted','needs_revision') THEN RAISE EXCEPTION 'Request is being reviewed' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.request_attachments WHERE request_id=p_id)>=5 THEN RAISE EXCEPTION 'Maximum five request images' USING ERRCODE='22023'; END IF;
 INSERT INTO public.request_attachments(request_id,storage_path,kind,content_type,uploaded_by)
 VALUES(p_id,p_file->>'storage_path',p_file->>'kind','image/png',p_actor) RETURNING * INTO item;
 UPDATE public.requests SET lock_version=lock_version+1,updated_at=now() WHERE id=p_id;
 RETURN to_jsonb(item);
END $$;

CREATE OR REPLACE FUNCTION public.bgy_document_remove_attachment(p_id uuid,p_actor uuid,p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE item public.request_attachments%ROWTYPE; r public.requests%ROWTYPE; a public.users%ROWTYPE;
BEGIN
 SELECT * INTO item FROM public.request_attachments WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Request image not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO r FROM public.requests WHERE id=item.request_id FOR UPDATE;
 SELECT * INTO a FROM public.users WHERE id=p_actor AND is_active;
 IF a.id IS NULL OR a.role NOT IN ('resident','admin','super_admin') OR (a.role='resident' AND a.id IS DISTINCT FROM r.user_id) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 IF r.lock_version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='40001'; END IF;
 IF r.status NOT IN ('submitted','needs_revision','under_review','acknowledged','processing') OR
  (a.role='resident' AND r.status NOT IN ('submitted','needs_revision')) THEN
  RAISE EXCEPTION 'Request images are locked during review or after approval' USING ERRCODE='42501';
 END IF;
 DELETE FROM public.request_attachments WHERE id=p_id;
 UPDATE public.requests SET lock_version=lock_version+1,updated_at=now() WHERE id=r.id;
 RETURN to_jsonb(item);
END $$;
GRANT DELETE ON public.request_attachments TO service_role;

-- Final documents and approved wording are immutable. Revisions always create a new version.
CREATE OR REPLACE FUNCTION public.bgy_document_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='generated_documents' THEN
  RAISE EXCEPTION 'Document versions are immutable';
 ELSIF TG_TABLE_NAME='document_templates' THEN
  IF OLD.approval_state='approved' THEN RAISE EXCEPTION 'Create a new template version to change approved wording'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bgy_document_immutable ON public.generated_documents;
CREATE TRIGGER bgy_document_immutable BEFORE UPDATE OR DELETE ON public.generated_documents FOR EACH ROW EXECUTE FUNCTION public.bgy_document_immutable();
DROP TRIGGER IF EXISTS bgy_template_immutable ON public.document_templates;
CREATE TRIGGER bgy_template_immutable BEFORE UPDATE OR DELETE ON public.document_templates FOR EACH ROW EXECUTE FUNCTION public.bgy_document_immutable();

DO $$ DECLARE f record; t text; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
  ('bgy_document_transition','bgy_document_save_version','bgy_document_attach','bgy_document_remove_attachment') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['document_templates','generated_documents','request_attachments','notification_logs'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='bgy_audit_row_change_trg' AND tgrelid=('public.'||t)::regclass) THEN
   EXECUTE format('CREATE TRIGGER bgy_audit_row_change_trg AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bgy_audit_row_change()',t);
  END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.bgy_phase11_ready() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT to_regclass('public.generated_documents') IS NOT NULL AND to_regclass('public.notification_logs') IS NOT NULL
 AND (SELECT count(*) FROM public.document_templates WHERE version=1)=5
 AND EXISTS(SELECT 1 FROM storage.buckets WHERE id='barangay-documents' AND public=false)
 AND to_regprocedure('public.bgy_document_transition(uuid,uuid,integer,text,text,jsonb,uuid)') IS NOT NULL
 AND to_regprocedure('public.bgy_document_save_version(uuid,uuid,integer,jsonb,boolean,uuid)') IS NOT NULL
 AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='bgy_document_immutable' AND tgrelid='public.generated_documents'::regclass);
$$;
REVOKE ALL ON FUNCTION public.bgy_phase11_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_phase11_ready() TO service_role;
COMMIT;
