-- Barangay Iba Phase 6: immutable case histories, non-destructive upgrade.
-- Requires Phases 1-5. Apply BEFORE the Phase 6 API. Back up production first.
BEGIN;
CREATE TABLE IF NOT EXISTS public.case_history_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('request','id_request','complaint','borrowing_request','project_suggestion')),
  entity_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('submitted','status_changed','schedule_changed','response_added','internal_note','legacy_note')),
  actor_id uuid,
  actor_name_snapshot text,
  actor_role text NOT NULL DEFAULT 'system',
  previous_status text,
  new_status text,
  message text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'resident' CHECK (visibility IN ('resident','internal')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  operation_id uuid UNIQUE,
  legacy_key text UNIQUE
);
CREATE INDEX IF NOT EXISTS case_history_entity_idx ON public.case_history_events(entity_type, entity_id, created_at, id);
CREATE INDEX IF NOT EXISTS case_history_visibility_idx ON public.case_history_events(entity_type, entity_id, visibility);
ALTER TABLE public.case_history_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_history_events FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.case_history_events FROM service_role;
GRANT SELECT, INSERT ON public.case_history_events TO service_role;

-- Preserve existing document timeline timestamps and actual notes.
INSERT INTO public.case_history_events(entity_type,entity_id,event_type,actor_role,new_status,message,created_at,metadata,legacy_key)
SELECT 'request', t.request_id, CASE WHEN t.status='submitted' THEN 'submitted' ELSE 'status_changed' END,
       'system', t.status, coalesce(t.note,''), t.created_at,
       jsonb_build_object('source','request_timeline','imported',true), 'request_timeline:'||t.id::text
FROM public.request_timeline t
WHERE NOT EXISTS (SELECT 1 FROM public.case_history_events h
  WHERE h.entity_type='request' AND h.entity_id=t.request_id AND h.new_status=t.status
    AND h.message=coalesce(t.note,'') AND abs(extract(epoch from (h.created_at-t.created_at))) <= 5)
ON CONFLICT (legacy_key) DO NOTHING;

-- Preserve latest known legacy notes without claiming when they were originally authored.
DO $$ DECLARE row_info record; table_name text; kind text; note_field text;
BEGIN
  FOR row_info IN SELECT * FROM (VALUES
    ('requests','request','admin_note'),('id_requests','id_request','admin_note'),
    ('complaints','complaint','admin_note'),('borrowing_requests','borrowing_request','admin_note'),
    ('project_suggestions','project_suggestion','review_note')
  ) AS x(tbl,entity,field) LOOP
    table_name := row_info.tbl; kind := row_info.entity; note_field := row_info.field;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=table_name AND column_name=note_field) THEN
      EXECUTE format($f$
        INSERT INTO public.case_history_events(entity_type,entity_id,event_type,actor_role,new_status,message,metadata,legacy_key)
        SELECT %L,id,'legacy_note','system',status,%I::text,
               jsonb_build_object('source',%L,'original_author_unknown',true,'original_time_unknown',true),
               %L||id::text
        FROM public.%I x
        WHERE nullif(btrim(%I::text),'') IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.case_history_events h
            WHERE h.entity_type=%L AND h.entity_id=x.id AND h.message=%I::text)
        ON CONFLICT (legacy_key) DO NOTHING
      $f$,kind,note_field,table_name||'.'||note_field,kind||':legacy:',table_name,note_field,kind,note_field);
    END IF;
  END LOOP;
END $$;

-- If no historical timeline exists, show an honest submission event with the record's real date.
DO $$ DECLARE row_info record;
BEGIN
  FOR row_info IN SELECT * FROM (VALUES
    ('requests','request'),('id_requests','id_request'),('complaints','complaint'),
    ('borrowing_requests','borrowing_request'),('project_suggestions','project_suggestion')
  ) AS x(tbl,entity) LOOP
    EXECUTE format($f$
      INSERT INTO public.case_history_events(entity_type,entity_id,event_type,actor_role,new_status,created_at,metadata,legacy_key)
      SELECT %L,id,'submitted','resident',status,created_at,jsonb_build_object('source','legacy_record'),%L||id::text
      FROM public.%I x
      WHERE NOT EXISTS (SELECT 1 FROM public.case_history_events h WHERE h.entity_type=%L AND h.entity_id=x.id AND h.event_type='submitted')
      ON CONFLICT (legacy_key) DO NOTHING
    $f$,row_info.entity,row_info.entity||':submitted:',row_info.tbl,row_info.entity);
  END LOOP;
END $$;

-- Automatically log future resident submissions in the same insert transaction.
CREATE OR REPLACE FUNCTION public.bgy_case_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE kind text; resident_name text;
BEGIN
  kind := CASE TG_TABLE_NAME WHEN 'requests' THEN 'request' WHEN 'id_requests' THEN 'id_request'
    WHEN 'complaints' THEN 'complaint' WHEN 'borrowing_requests' THEN 'borrowing_request'
    ELSE 'project_suggestion' END;
  SELECT coalesce(nullif(full_name,''),nullif(concat_ws(' ',first_name,last_name),''),'Resident')
    INTO resident_name FROM public.users WHERE id=NEW.user_id;
  INSERT INTO public.case_history_events(entity_type,entity_id,event_type,actor_id,actor_name_snapshot,actor_role,
    new_status,created_at,metadata,legacy_key)
  VALUES(kind,NEW.id,'submitted',NEW.user_id,resident_name,'resident',NEW.status,NEW.created_at,
    jsonb_build_object('source','new_submission'),kind||':submitted:'||NEW.id::text);
  RETURN NEW;
END $$;
DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['requests','id_requests','complaints','borrowing_requests','project_suggestions'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='bgy_case_created_trg' AND tgrelid=format('public.%I',table_name)::regclass) THEN
      EXECUTE format('CREATE TRIGGER bgy_case_created_trg AFTER INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bgy_case_created()',table_name);
    END IF;
  END LOOP;
END $$;

-- The server invokes this RPC using its service-role connection and verified req.currentUser.
-- Row update and history insert are atomic; unexpected status changes fail closed.
CREATE OR REPLACE FUNCTION public.bgy_case_apply(
  p_entity_type text, p_entity_id uuid, p_expected_status text, p_status text,
  p_message text, p_visibility text, p_actor_id uuid, p_operation_id uuid,
  p_extra jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE current_record jsonb; new_record jsonb; t text; actor_record record; clean_message text := btrim(coalesce(p_message,''));
  event_kind text; next_status text; changed boolean; schedule_changed boolean := false; event_details jsonb;
BEGIN
  IF p_entity_type NOT IN ('request','id_request','complaint','borrowing_request','project_suggestion') THEN
    RAISE EXCEPTION 'Unsupported case type' USING ERRCODE='22023';
  END IF;
  IF p_visibility NOT IN ('resident','internal') OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'Invalid response visibility or operation ID' USING ERRCODE='22023';
  END IF;
  IF length(clean_message)>2000 THEN RAISE EXCEPTION 'Response is limited to 2,000 characters' USING ERRCODE='22023'; END IF;
  SELECT id,role,coalesce(nullif(full_name,''),concat_ws(' ',first_name,last_name),'Administrator') AS name
    INTO actor_record FROM public.users WHERE id=p_actor_id AND is_active=true AND role IN ('admin','super_admin');
  IF NOT FOUND THEN RAISE EXCEPTION 'Administrator account is not authorized' USING ERRCODE='42501'; END IF;
  -- Idempotency of retries: do not repeat an already completed operation.
  IF EXISTS(SELECT 1 FROM public.case_history_events WHERE operation_id=p_operation_id) THEN
    RAISE EXCEPTION 'This case operation has already been processed' USING ERRCODE='23505';
  END IF;
  t := CASE p_entity_type WHEN 'request' THEN 'requests' WHEN 'id_request' THEN 'id_requests'
       WHEN 'complaint' THEN 'complaints' WHEN 'borrowing_request' THEN 'borrowing_requests'
       ELSE 'project_suggestions' END;
  EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE r.id=$1 FOR UPDATE',t) INTO current_record USING p_entity_id;
  IF current_record IS NULL THEN RAISE EXCEPTION 'Case record not found' USING ERRCODE='P0002'; END IF;
  IF (current_record->>'status') IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'This record changed since it was opened. Refresh and try again' USING ERRCODE='P0001';
  END IF;
  next_status:=coalesce(nullif(p_status,''),p_expected_status);
  IF (p_entity_type='request' AND next_status NOT IN ('submitted','acknowledged','processing','completed'))
   OR (p_entity_type='id_request' AND next_status NOT IN ('submitted','confirmed','rescheduled','completed','cancelled'))
   OR (p_entity_type='complaint' AND next_status NOT IN ('pending','in_review','resolved'))
   OR (p_entity_type='borrowing_request' AND next_status NOT IN ('pending','approved','rejected','borrowed','returned','cancelled'))
   OR (p_entity_type='project_suggestion' AND next_status NOT IN ('pending','approved','rejected')) THEN
    RAISE EXCEPTION 'Invalid case status' USING ERRCODE='22023';
  END IF;
  changed:=next_status IS DISTINCT FROM p_expected_status;
  IF p_entity_type='id_request' THEN
    schedule_changed := (p_extra ? 'preferred_date' AND nullif(p_extra->>'preferred_date','') IS DISTINCT FROM (current_record->>'preferred_date'))
      OR (p_extra ? 'time_slot' AND nullif(p_extra->>'time_slot','') IS DISTINCT FROM (current_record->>'time_slot'));
  END IF;
  event_details := coalesce(p_extra,'{}'::jsonb);
  IF schedule_changed THEN
    event_details := event_details || jsonb_build_object('previous_preferred_date',current_record->>'preferred_date',
      'previous_time_slot',current_record->>'time_slot');
  END IF;
  IF (changed OR schedule_changed) AND p_visibility='internal' THEN RAISE EXCEPTION 'Status and schedule changes must be resident-visible' USING ERRCODE='22023'; END IF;
  IF NOT changed AND NOT schedule_changed AND clean_message='' THEN
    RAISE EXCEPTION 'No change or new response to save' USING ERRCODE='22023';
  END IF;
  -- Internal-only notes MUST NOT enter legacy resident-facing admin_note fields.
  IF changed AND (
    (p_entity_type='request' AND NOT (
      (p_expected_status='submitted' AND next_status='acknowledged') OR
      (p_expected_status='acknowledged' AND next_status='processing') OR
      (p_expected_status='processing' AND next_status='completed'))) OR
    (p_entity_type='id_request' AND NOT (
      (p_expected_status='submitted' AND next_status IN ('confirmed','rescheduled','cancelled')) OR
      (p_expected_status='confirmed' AND next_status IN ('rescheduled','completed','cancelled')) OR
      (p_expected_status='rescheduled' AND next_status IN ('rescheduled','completed','cancelled')))) OR
    (p_entity_type='borrowing_request' AND NOT (
      (p_expected_status='pending' AND next_status IN ('approved','rejected')) OR
      (p_expected_status='approved' AND next_status='borrowed') OR
      (p_expected_status='borrowed' AND next_status='returned'))) OR
    (p_entity_type='complaint' AND NOT (
      (p_expected_status='pending' AND next_status IN ('in_review','resolved')) OR
      (p_expected_status='in_review' AND next_status IN ('pending','resolved')) OR
      (p_expected_status='resolved' AND next_status='in_review')))
  ) THEN RAISE EXCEPTION 'Invalid workflow status transition' USING ERRCODE='22023'; END IF;
  IF p_entity_type='project_suggestion' AND changed AND p_expected_status <> 'pending' THEN
    RAISE EXCEPTION 'Project suggestion already reviewed' USING ERRCODE='P0001';
  END IF;
  IF p_entity_type='request' THEN
    UPDATE public.requests SET status=next_status,updated_at=now(),
      admin_note=CASE WHEN p_visibility='resident' AND clean_message<>'' THEN clean_message ELSE admin_note END
      WHERE id=p_entity_id RETURNING to_jsonb(requests.*) INTO new_record;
    IF changed OR (clean_message<>'' AND p_visibility='resident') THEN
      INSERT INTO public.request_timeline(request_id,status,note)
      VALUES(p_entity_id,next_status,CASE WHEN p_visibility='resident' THEN clean_message ELSE '' END);
    END IF;
  ELSIF p_entity_type='id_request' THEN
    UPDATE public.id_requests SET status=next_status,
      preferred_date=CASE WHEN p_extra ? 'preferred_date' THEN nullif(p_extra->>'preferred_date','')::date ELSE preferred_date END,
      time_slot=CASE WHEN p_extra ? 'time_slot' THEN nullif(p_extra->>'time_slot','') ELSE time_slot END,
      admin_note=CASE WHEN p_visibility='resident' AND clean_message<>'' THEN clean_message ELSE admin_note END
      WHERE id=p_entity_id RETURNING to_jsonb(id_requests.*) INTO new_record;
  ELSIF p_entity_type='complaint' THEN
    UPDATE public.complaints SET status=next_status,updated_at=now(),
      admin_note=CASE WHEN p_visibility='resident' AND clean_message<>'' THEN clean_message ELSE admin_note END
      WHERE id=p_entity_id RETURNING to_jsonb(complaints.*) INTO new_record;
  ELSIF p_entity_type='borrowing_request' THEN
    UPDATE public.borrowing_requests SET status=next_status,updated_at=now(),
      admin_note=CASE WHEN p_visibility='resident' AND clean_message<>'' THEN clean_message ELSE admin_note END,
      approved_by=CASE WHEN next_status='approved' AND changed THEN p_actor_id ELSE approved_by END,
      approved_at=CASE WHEN next_status='approved' AND changed THEN now() ELSE approved_at END,
      borrowed_at=CASE WHEN next_status='borrowed' AND changed THEN now() ELSE borrowed_at END,
      returned_at=CASE WHEN next_status='returned' AND changed THEN now() ELSE returned_at END,
      returned_quantity=CASE WHEN next_status='returned' AND changed THEN nullif(p_extra->>'returned_quantity','')::integer ELSE returned_quantity END,
      return_condition=CASE WHEN next_status='returned' AND changed THEN nullif(p_extra->>'return_condition','') ELSE return_condition END,
      return_note=CASE WHEN next_status='returned' AND changed THEN coalesce(p_extra->>'return_note','') ELSE return_note END
      WHERE id=p_entity_id RETURNING to_jsonb(borrowing_requests.*) INTO new_record;
  ELSE
    UPDATE public.project_suggestions SET status=next_status,
      review_note=CASE WHEN p_visibility='resident' AND clean_message<>'' THEN clean_message ELSE review_note END,
      reviewed_by=CASE WHEN changed THEN p_actor_id ELSE reviewed_by END,
      reviewed_at=CASE WHEN changed THEN now() ELSE reviewed_at END
      WHERE id=p_entity_id RETURNING to_jsonb(project_suggestions.*) INTO new_record;
  END IF;
  event_kind:=CASE WHEN p_visibility='internal' AND clean_message<>'' AND NOT changed THEN 'internal_note'
    WHEN changed THEN 'status_changed' WHEN schedule_changed THEN 'schedule_changed' ELSE 'response_added' END;
  INSERT INTO public.case_history_events(entity_type,entity_id,event_type,actor_id,actor_name_snapshot,actor_role,
    previous_status,new_status,message,visibility,metadata,operation_id)
  VALUES(p_entity_type,p_entity_id,event_kind,p_actor_id,actor_record.name,actor_record.role,
    p_expected_status,next_status,clean_message,p_visibility,event_details,p_operation_id);
  RETURN new_record;
END $$;
REVOKE ALL ON FUNCTION public.bgy_case_apply(text,uuid,text,text,text,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_case_apply(text,uuid,text,text,text,text,uuid,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.bgy_case_created() FROM PUBLIC,anon,authenticated;

-- Case history appears in Phase 1 Audit Logs as its own immutable mutation event.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='bgy_audit_row_change_trg' AND tgrelid='public.case_history_events'::regclass) THEN
    CREATE TRIGGER bgy_audit_row_change_trg AFTER INSERT ON public.case_history_events
      FOR EACH ROW EXECUTE FUNCTION public.bgy_audit_row_change();
  END IF;
END $$;

-- Resident cancellation is a separate, narrowly authorized transaction.
CREATE OR REPLACE FUNCTION public.bgy_case_resident_cancel_borrowing(
 p_entity_id uuid, p_actor_id uuid, p_expected_status text, p_operation_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE record_before public.borrowing_requests%ROWTYPE; record_after jsonb; resident_name text;
BEGIN
  SELECT * INTO record_before FROM public.borrowing_requests
    WHERE id=p_entity_id AND user_id=p_actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Borrowing request not found' USING ERRCODE='P0002'; END IF;
  IF record_before.status IS DISTINCT FROM p_expected_status OR record_before.status NOT IN ('pending','approved') THEN
    RAISE EXCEPTION 'Request has changed or can no longer be cancelled' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_actor_id AND role='resident' AND is_active=true) THEN
    RAISE EXCEPTION 'Resident account is not authorized' USING ERRCODE='42501';
  END IF;
  UPDATE public.borrowing_requests SET status='cancelled',updated_at=now() WHERE id=p_entity_id
    RETURNING to_jsonb(borrowing_requests.*) INTO record_after;
  SELECT coalesce(nullif(full_name,''), concat_ws(' ',first_name,last_name),'Resident') INTO resident_name
    FROM public.users WHERE id=p_actor_id;
  INSERT INTO public.case_history_events(entity_type,entity_id,event_type,actor_id,actor_name_snapshot,
    actor_role,previous_status,new_status,message,visibility,operation_id)
    VALUES('borrowing_request',p_entity_id,'status_changed',p_actor_id,resident_name,
      'resident',p_expected_status,'cancelled','Request cancelled by resident','resident',p_operation_id);
  RETURN record_after;
END $$;
REVOKE ALL ON FUNCTION public.bgy_case_resident_cancel_borrowing(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_case_resident_cancel_borrowing(uuid,uuid,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.bgy_phase6_ready() RETURNS boolean LANGUAGE sql STABLE
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT to_regclass('public.case_history_events') IS NOT NULL
  AND to_regprocedure('public.bgy_case_apply(text,uuid,text,text,text,text,uuid,uuid,jsonb)') IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.bgy_phase6_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_phase6_ready() TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
