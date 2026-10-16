-- BARANGAY IBA V4 / PHASE 10. Apply only after Phase 9 and after taking a backup.
-- NON-DESTRUCTIVE: no existing votes, elections, projects or updates are removed.
-- RPCs are intentionally executable by service_role ONLY; Express verifies the actor.
BEGIN;

ALTER TABLE public.elections
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS opened_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS early_close_reason text,
  ADD COLUMN IF NOT EXISTS result_kind text,
  ADD COLUMN IF NOT EXISTS winner_option_id uuid,
  ADD COLUMN IF NOT EXISTS runoff_parent_id uuid REFERENCES public.elections(id) ON DELETE SET NULL;
ALTER TABLE public.elections DROP CONSTRAINT IF EXISTS bgy_phase10_result_kind_check;
ALTER TABLE public.elections ADD CONSTRAINT bgy_phase10_result_kind_check
  CHECK (result_kind IS NULL OR result_kind IN ('winner','tie','no_votes'));
CREATE INDEX IF NOT EXISTS bgy_phase10_elections_finalized_idx ON public.elections (status, finalized_at);

-- Existing completion confirmations might have been made before construction finished;
-- preserve their original timestamps and classify them as unverified legacy data.
ALTER TABLE public.project_completions
 ADD COLUMN IF NOT EXISTS acknowledged_after_official_completion boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS official_acknowledged_at timestamptz;

ALTER TABLE public.project_updates ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE public.project_updates ADD COLUMN IF NOT EXISTS corrected_at timestamptz;
-- Legacy updates were publicly visible; preserve them as published rather than hiding them.
UPDATE public.project_updates SET published_at = COALESCE(created_at, now()) WHERE published_at IS NULL;

-- Durable, idempotent in-app notification events. Dispatch can be retried safely.
CREATE TABLE IF NOT EXISTS public.bgy_phase10_notification_outbox (
  event_key text PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  kind text NOT NULL DEFAULT 'info',
  destination text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
ALTER TABLE public.bgy_phase10_notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bgy_phase10_notification_outbox FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.bgy_phase10_notification_outbox TO service_role;

CREATE OR REPLACE FUNCTION public.bgy_phase10_dispatch_notifications(p_limit integer DEFAULT 10)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e record; delivered integer :=0;
BEGIN
 FOR e IN SELECT * FROM public.bgy_phase10_notification_outbox
   WHERE delivered_at IS NULL ORDER BY created_at LIMIT LEAST(greatest(p_limit,1),50)
   FOR UPDATE SKIP LOCKED
 LOOP
   INSERT INTO public.notifications(user_id,title,body,kind,broadcast,entity_type,entity_id,destination)
   SELECT u.id,e.title,e.body,e.kind,false,'community_project',NULL,e.destination
   FROM public.users u WHERE u.role='resident' AND u.is_active=true;
   UPDATE public.bgy_phase10_notification_outbox SET delivered_at=now() WHERE event_key=e.event_key;
   delivered:=delivered+1;
 END LOOP;
 RETURN delivered;
END $$;

-- Mark scheduled rounds as open once, queue resident announcement at start time.
CREATE OR REPLACE FUNCTION public.bgy_phase10_queue_opened_rounds(p_limit integer DEFAULT 10)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e record; queued integer :=0;
BEGIN
 FOR e IN SELECT id,title FROM public.elections
  WHERE status='live' AND starts_at<=now() AND ends_at>now() AND opened_notified_at IS NULL
  ORDER BY starts_at LIMIT LEAST(greatest(p_limit,1),50) FOR UPDATE SKIP LOCKED
 LOOP
   INSERT INTO public.bgy_phase10_notification_outbox(event_key,title,body,kind,destination)
   VALUES('election_opened:'||e.id,'Community voting is open',
          e.title||' is now open for voting. Select your preferred project.','info','/portal/voting')
   ON CONFLICT (event_key) DO NOTHING;
   UPDATE public.elections SET opened_notified_at=now() WHERE id=e.id;
   queued:=queued+1;
 END LOOP;
 RETURN queued;
END $$;

-- Phase 1 audit history remains intact. Future ballots are anonymized in audit
-- so general staff reports cannot correlate an identity with an election option.
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
  IF TG_TABLE_NAME = 'votes' THEN
    actor_uuid := NULL; actor_role_value := 'anonymous_ballot'; actor_name_value := NULL;
    request_id := NULL; actor_source := 'private_vote';
  END IF;

  before_row := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE public.bgy_audit_clean_row(to_jsonb(OLD)) END;
  after_row  := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE public.bgy_audit_clean_row(to_jsonb(NEW)) END;
  -- A ballot is recorded as an anonymous aggregate election event.
  -- Do not expose resident identity, selected option, request/route or client metadata.
  IF TG_TABLE_NAME = 'votes' THEN
    before_row := CASE WHEN TG_OP='INSERT' THEN NULL ELSE jsonb_build_object('election_id',OLD.election_id) END;
    after_row := CASE WHEN TG_OP='DELETE' THEN NULL ELSE jsonb_build_object('election_id',NEW.election_id) END;
  END IF;
  ref_row := coalesce(after_row, before_row, '{}'::jsonb);
  record_id := coalesce(ref_row->>'id', ref_row->>'key_name', ref_row->>'name', ref_row->>'election_id', 'unknown');
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
    CASE WHEN TG_TABLE_NAME='votes' THEN NULL ELSE nullif(headers->>'x-bgy-audit-method','') END,
    CASE WHEN TG_TABLE_NAME='votes' THEN NULL ELSE nullif(headers->>'x-bgy-audit-route','') END,
    CASE WHEN TG_TABLE_NAME='votes' THEN NULL ELSE nullif(headers->>'x-bgy-audit-ip','') END,
    CASE WHEN TG_TABLE_NAME='votes' THEN NULL WHEN nullif(headers->>'x-bgy-audit-user-agent','') IS NOT NULL THEN
      convert_from(decode(headers->>'x-bgy-audit-user-agent', 'base64'), 'UTF8') ELSE NULL END
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$;

-- A finalized vote must never be silently altered by application writes.
CREATE OR REPLACE FUNCTION public.bgy_phase10_vote_consistency()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE e_id uuid; o_election uuid; e_status text; starts timestamptz; ends timestamptz;
BEGIN
 IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
   RAISE EXCEPTION 'Committed votes cannot be edited or deleted' USING ERRCODE='23514';
 END IF;
 SELECT election_id INTO o_election FROM public.election_options WHERE id = NEW.option_id;
 IF o_election IS DISTINCT FROM NEW.election_id THEN
   RAISE EXCEPTION 'Voting option does not belong to the election' USING ERRCODE='23514';
 END IF;
 SELECT status, starts_at, ends_at INTO e_status, starts, ends
 FROM public.elections WHERE id=NEW.election_id FOR UPDATE;
 IF NOT FOUND OR e_status <> 'live' OR starts > now() OR ends <= now() THEN
   RAISE EXCEPTION 'Voting is not open' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bgy_phase10_vote_consistency_trigger ON public.votes;
CREATE TRIGGER bgy_phase10_vote_consistency_trigger
BEFORE INSERT OR UPDATE OR DELETE ON public.votes
FOR EACH ROW EXECUTE FUNCTION public.bgy_phase10_vote_consistency();

-- Closed rounds are immutable; publishing is one-way, and only the finalize RPC
-- may transition live -> closed. Historical draft deletion remains allowed.
CREATE OR REPLACE FUNCTION public.bgy_phase10_protect_election()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   IF OLD.status<>'draft' THEN RAISE EXCEPTION 'Published elections cannot be deleted' USING ERRCODE='23514'; END IF;
   RETURN OLD;
 END IF;
 IF OLD.status='closed' THEN RAISE EXCEPTION 'Finalized elections cannot be edited' USING ERRCODE='23514'; END IF;
 IF OLD.status='live' THEN
   IF NEW.status='closed' AND current_setting('bgy.phase10_finalizing',true)='on' THEN RETURN NEW; END IF;
   IF NEW.status='live' AND (NEW.title,NEW.description,NEW.starts_at,NEW.ends_at,NEW.image_url,NEW.source_suggestion_id,NEW.runoff_parent_id)
     IS NOT DISTINCT FROM (OLD.title,OLD.description,OLD.starts_at,OLD.ends_at,OLD.image_url,OLD.source_suggestion_id,OLD.runoff_parent_id)
     THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'Published election details are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bgy_phase10_election_guard ON public.elections;
CREATE TRIGGER bgy_phase10_election_guard BEFORE UPDATE OR DELETE ON public.elections
FOR EACH ROW EXECUTE FUNCTION public.bgy_phase10_protect_election();

-- Published ballot options cannot be deleted, edited or appended through direct writes.
CREATE OR REPLACE FUNCTION public.bgy_phase10_lock_published_options()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE election_status text; target_id uuid;
BEGIN
 IF TG_OP='DELETE' THEN target_id := OLD.election_id; ELSE target_id := NEW.election_id; END IF;
 SELECT status INTO election_status FROM public.elections WHERE id=target_id;
 IF election_status IS NULL AND TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF election_status IS DISTINCT FROM 'draft' THEN
   -- A cached counter is never authoritative, but legacy maintenance may update it;
   -- all other fields must remain immutable.
   IF TG_OP='UPDATE' AND (to_jsonb(NEW) - 'votes_count') = (to_jsonb(OLD) - 'votes_count') THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'Published voting options cannot be changed' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bgy_phase10_options_locked ON public.election_options;
CREATE TRIGGER bgy_phase10_options_locked BEFORE INSERT OR UPDATE OR DELETE ON public.election_options
FOR EACH ROW EXECUTE FUNCTION public.bgy_phase10_lock_published_options();

CREATE OR REPLACE FUNCTION public.bgy_phase10_is_admin(p_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.users WHERE id=p_actor AND is_active=true AND role IN ('admin','super_admin'))
$$;

-- Once a suggestion appears on a published ballot, its public candidate text
-- and approval status cannot be rewritten through a separate suggestion endpoint.
CREATE OR REPLACE FUNCTION public.bgy_phase10_lock_published_suggestions()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF (OLD.title, OLD.description, OLD.image_url, OLD.status)
    IS DISTINCT FROM (NEW.title, NEW.description, NEW.image_url, NEW.status)
 AND EXISTS(
   SELECT 1 FROM public.election_options o JOIN public.elections e ON e.id=o.election_id
   WHERE o.source_suggestion_id=OLD.id AND e.status IN ('live','closed')
 ) THEN RAISE EXCEPTION 'A suggestion on a published ballot cannot be altered' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bgy_phase10_suggestion_lock ON public.project_suggestions;
CREATE TRIGGER bgy_phase10_suggestion_lock BEFORE UPDATE ON public.project_suggestions
FOR EACH ROW EXECUTE FUNCTION public.bgy_phase10_lock_published_suggestions();

-- Transactional voting post creation and publishing; the published ballot is immutable.
CREATE OR REPLACE FUNCTION public.bgy_phase10_save_election(
 p_actor uuid, p_id uuid, p_title text, p_description text, p_status text,
 p_starts_at timestamptz, p_ends_at timestamptz, p_image_url text, p_options jsonb,
 p_runoff_parent uuid DEFAULT NULL
) RETURNS public.elections LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.elections%ROWTYPE; item jsonb; sid uuid; s public.project_suggestions%ROWTYPE;
        seen uuid[] := '{}'; option_count int:=0; overlap_count int; published_before boolean:=false;
BEGIN
 IF NOT public.bgy_phase10_is_admin(p_actor) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF length(trim(coalesce(p_title,'')))<3 THEN RAISE EXCEPTION 'Voting title is required' USING ERRCODE='22023'; END IF;
 IF p_status NOT IN ('draft','live') THEN RAISE EXCEPTION 'Voting can only be saved as Draft or Published' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_options) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Options must be an array' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(49310,1);
 IF p_id IS NOT NULL THEN
   SELECT * INTO e FROM public.elections WHERE id=p_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Election not found' USING ERRCODE='P0002'; END IF;
   IF e.status <> 'draft' THEN RAISE EXCEPTION 'Published elections and ballots are locked' USING ERRCODE='23514'; END IF;
 END IF;
 IF p_status='live' THEN
   IF p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at OR p_ends_at <= now() THEN
     RAISE EXCEPTION 'A published round needs a valid future closing date' USING ERRCODE='22023';
   END IF;
   SELECT count(*) INTO overlap_count FROM public.elections x
   WHERE x.status='live' AND x.id IS DISTINCT FROM p_id
    AND tstzrange(x.starts_at,x.ends_at,'[)') && tstzrange(p_starts_at,p_ends_at,'[)');
   IF overlap_count>0 THEN RAISE EXCEPTION 'Another voting round overlaps this schedule' USING ERRCODE='23505'; END IF;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_options) LOOP
   sid:=NULLIF(coalesce(item->>'sourceSuggestionId',item->>'source_suggestion_id'), '')::uuid;
   IF sid IS NULL THEN
     IF p_status='live' THEN RAISE EXCEPTION 'Only approved project suggestions may be published' USING ERRCODE='22023'; END IF;
     CONTINUE;
   END IF;
   IF sid=ANY(seen) THEN RAISE EXCEPTION 'Duplicate suggestion in voting options' USING ERRCODE='23505'; END IF;
   seen:=array_append(seen,sid);
   SELECT * INTO s FROM public.project_suggestions WHERE id=sid FOR SHARE;
   IF NOT FOUND OR s.status <> 'approved' THEN RAISE EXCEPTION 'Only approved suggestions may be selected' USING ERRCODE='22023'; END IF;
   option_count:=option_count+1;
 END LOOP;
 IF p_status='live' AND option_count<2 THEN RAISE EXCEPTION 'Choose at least two approved suggestions' USING ERRCODE='22023'; END IF;
 IF p_runoff_parent IS NOT NULL THEN
   IF NOT EXISTS (SELECT 1 FROM public.elections WHERE id=p_runoff_parent AND status='closed' AND finalized_at IS NOT NULL AND result_kind='tie') THEN
     RAISE EXCEPTION 'Runoff parent must be a finalized tied election' USING ERRCODE='22023';
   END IF;
   IF p_status='live' AND (
     SELECT coalesce(array_agg(q.source_suggestion_id ORDER BY q.source_suggestion_id),'{}'::uuid[])
     FROM (
       SELECT o.source_suggestion_id FROM public.election_options o
       LEFT JOIN public.votes v ON v.option_id=o.id
       WHERE o.election_id=p_runoff_parent GROUP BY o.id
       HAVING count(v.id)=(SELECT max(c) FROM (
         SELECT count(v2.id) c FROM public.election_options o2 LEFT JOIN public.votes v2 ON v2.option_id=o2.id
         WHERE o2.election_id=p_runoff_parent GROUP BY o2.id
       ) vote_counts)
     ) q
   ) IS DISTINCT FROM (
     SELECT coalesce(array_agg(t.id ORDER BY t.id),'{}'::uuid[]) FROM unnest(seen) AS t(id)
   ) THEN RAISE EXCEPTION 'Runoff candidates must match the tied highest-vote suggestions' USING ERRCODE='23514'; END IF;
 END IF;
 IF p_id IS NULL THEN
   INSERT INTO public.elections(title,description,status,starts_at,ends_at,image_url,source_suggestion_id,runoff_parent_id)
   VALUES(trim(p_title),coalesce(p_description,''),'draft',p_starts_at,p_ends_at,p_image_url,seen[1],p_runoff_parent)
   RETURNING * INTO e;
 ELSE
   UPDATE public.elections SET title=trim(p_title),description=coalesce(p_description,''),
     starts_at=p_starts_at,ends_at=p_ends_at,image_url=p_image_url,source_suggestion_id=seen[1],
     runoff_parent_id=p_runoff_parent
   WHERE id=e.id RETURNING * INTO e;
 END IF;
 DELETE FROM public.election_options WHERE election_id=e.id;
 FOR item IN SELECT value FROM jsonb_array_elements(p_options) LOOP
   sid:=NULLIF(coalesce(item->>'sourceSuggestionId',item->>'source_suggestion_id'), '')::uuid;
   IF sid IS NOT NULL THEN
     SELECT * INTO s FROM public.project_suggestions WHERE id=sid FOR SHARE;
     INSERT INTO public.election_options(election_id,name,description,source_suggestion_id,image_url,votes_count)
     VALUES(e.id,s.title,coalesce(s.description,''),s.id,s.image_url,0);
   ELSIF p_status='draft' AND NULLIF(trim(coalesce(item->>'name','')),'') IS NOT NULL THEN
     INSERT INTO public.election_options(election_id,name,description,image_url,votes_count)
     VALUES(e.id,trim(item->>'name'),coalesce(item->>'description',''),item->>'imageUrl',0);
   END IF;
 END LOOP;
 IF p_status='live' THEN
   UPDATE public.elections SET status='live' WHERE id=e.id RETURNING * INTO e;
   INSERT INTO public.bgy_phase10_notification_outbox(event_key,title,body,kind,destination)
   VALUES('election_published:'||e.id,'Community voting published',
     e.title||' — see the voting schedule in the Voting Center.','info','/portal/voting')
   ON CONFLICT (event_key) DO NOTHING;
 END IF;
 RETURN e;
END $$;

-- Cast vote and validate vote in ONE transaction. No user.has_voted dependency.
CREATE OR REPLACE FUNCTION public.bgy_phase10_cast_vote(p_user uuid,p_option uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE eid uuid; vote_id uuid; e public.elections%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user AND role='resident' AND is_active=true AND coalesce(must_change_password,false)=false) THEN
   RAISE EXCEPTION 'Only active residents can vote' USING ERRCODE='42501';
 END IF;
 SELECT election_id INTO eid FROM public.election_options WHERE id=p_option;
 IF eid IS NULL THEN RAISE EXCEPTION 'Voting option not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO e FROM public.elections WHERE id=eid FOR UPDATE;
 IF e.status<>'live' OR e.starts_at>now() OR e.ends_at<=now() OR e.finalized_at IS NOT NULL THEN
   RAISE EXCEPTION 'Voting is not currently open' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.votes WHERE election_id=eid AND user_id=p_user) THEN
   RAISE EXCEPTION 'You have already voted in this round' USING ERRCODE='23505';
 END IF;
 INSERT INTO public.votes(election_id,option_id,user_id) VALUES(eid,p_option,p_user) RETURNING id INTO vote_id;
 RETURN vote_id;
END $$;

-- Unified, idempotent close and result finalization. Historical closed elections are not changed automatically.
CREATE OR REPLACE FUNCTION public.bgy_phase10_finalize_election(
 p_election_id uuid,p_actor uuid DEFAULT NULL,p_early_reason text DEFAULT NULL
) RETURNS public.elections LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.elections%ROWTYPE; highest int; winners uuid[]; total int; winning public.election_options%ROWTYPE;
BEGIN
 IF p_actor IS NOT NULL AND NOT public.bgy_phase10_is_admin(p_actor) THEN
   RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO e FROM public.elections WHERE id=p_election_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Election not found' USING ERRCODE='P0002'; END IF;
 IF e.finalized_at IS NOT NULL THEN RETURN e; END IF;
 IF e.status <> 'live' THEN RAISE EXCEPTION 'Only published elections can be finalized' USING ERRCODE='23514'; END IF;
 IF e.ends_at > now() AND (p_actor IS NULL OR length(trim(coalesce(p_early_reason,'')))<5) THEN
   RAISE EXCEPTION 'Early closure requires an administrator reason' USING ERRCODE='22023';
 END IF;
 SELECT count(*) INTO total FROM public.votes WHERE election_id=e.id;
 SELECT max(votes) INTO highest FROM (
   SELECT o.id, count(v.id)::integer AS votes FROM public.election_options o
   LEFT JOIN public.votes v ON v.option_id=o.id WHERE o.election_id=e.id GROUP BY o.id
 ) c;
 SELECT array_agg(id) INTO winners FROM (
   SELECT o.id FROM public.election_options o LEFT JOIN public.votes v ON v.option_id=o.id
   WHERE o.election_id=e.id GROUP BY o.id HAVING count(v.id)=highest
 ) w;
 PERFORM set_config('bgy.phase10_finalizing','on',true);
 UPDATE public.elections SET status='closed',closed_at=now(),finalized_at=now(),
   early_close_reason=CASE WHEN ends_at>now() THEN trim(p_early_reason) ELSE NULL END,
   result_kind=CASE WHEN total=0 THEN 'no_votes' WHEN array_length(winners,1)>1 THEN 'tie' ELSE 'winner' END,
   winner_option_id=CASE WHEN total>0 AND array_length(winners,1)=1 THEN winners[1] ELSE NULL END
 WHERE id=e.id RETURNING * INTO e;
 INSERT INTO public.bgy_phase10_notification_outbox(event_key,title,body,kind,destination)
 VALUES('election_finalized:'||e.id,'Community voting results finalized',
  e.title||' — '||CASE WHEN e.result_kind='tie' THEN 'The vote ended in a tie; a runoff is required.'
  WHEN e.result_kind='no_votes' THEN 'No votes were recorded.'
  ELSE 'A winning community project has been selected.' END,
  'info','/portal/voting-result') ON CONFLICT (event_key) DO NOTHING;
 IF e.result_kind='winner' THEN
   SELECT * INTO winning FROM public.election_options WHERE id=e.winner_option_id;
   INSERT INTO public.community_projects(election_id,election_option_id,source_suggestion_id,
       title,description,cover_image_url,status,progress_percentage,created_by,updated_at)
   VALUES(e.id,winning.id,winning.source_suggestion_id,winning.name,
      coalesce(winning.description,e.description,''),coalesce(winning.image_url,e.image_url),
      'planned',0,p_actor,now()) ON CONFLICT (election_id) DO NOTHING;
 END IF;
 RETURN e;
END $$;

-- A resident can acknowledge an officially completed project, never mark it completed themselves.
CREATE OR REPLACE FUNCTION public.bgy_phase10_acknowledge_completion(p_user uuid,p_election uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user AND role='resident' AND is_active=true) THEN
   RAISE EXCEPTION 'Active resident account required' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.community_projects WHERE election_id=p_election AND status='completed') THEN
   RAISE EXCEPTION 'Project must be officially completed first' USING ERRCODE='23514';
 END IF;
 INSERT INTO public.project_completions(election_id,user_id,acknowledged_after_official_completion,official_acknowledged_at)
 VALUES(p_election,p_user,true,now())
 ON CONFLICT (election_id,user_id) DO UPDATE
 SET acknowledged_after_official_completion=true,
     official_acknowledged_at=coalesce(public.project_completions.official_acknowledged_at,now());
 RETURN true;
END $$;

-- Staff can update status/progress and create a matching public event atomically.
CREATE OR REPLACE FUNCTION public.bgy_phase10_update_project(
 p_actor uuid,p_project uuid,p_changes jsonb,p_reason text DEFAULT NULL
) RETURNS public.community_projects LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE original public.community_projects%ROWTYPE; saved public.community_projects%ROWTYPE;
        next_status text; next_progress integer; explanation text; milestone public.project_updates%ROWTYPE;
BEGIN
 IF NOT public.bgy_phase10_is_admin(p_actor) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO original FROM public.community_projects WHERE id=p_project FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Project not found' USING ERRCODE='P0002'; END IF;
 next_status:=coalesce(p_changes->>'status',original.status);
 IF next_status NOT IN ('planned','ongoing','on_hold','completed','cancelled') THEN RAISE EXCEPTION 'Invalid project status' USING ERRCODE='22023'; END IF;
 next_progress:=coalesce((p_changes->>'progress_percentage')::integer,original.progress_percentage);
 IF next_status='completed' THEN next_progress:=100; END IF;
 IF next_progress NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Progress must be between 0 and 100' USING ERRCODE='22023'; END IF;
 explanation:=trim(coalesce(p_reason,''));
 IF (next_status IN ('on_hold','cancelled') AND next_status IS DISTINCT FROM original.status OR
     next_progress < original.progress_percentage OR
     original.status='completed' AND next_status<>'completed' OR
     next_status='completed' AND original.status<>'completed') AND length(explanation)<5 THEN
   RAISE EXCEPTION 'This lifecycle change requires a reason or completion explanation' USING ERRCODE='22023';
 END IF;
 UPDATE public.community_projects SET
   title=CASE WHEN p_changes ? 'title' THEN trim(p_changes->>'title') ELSE title END,
   description=CASE WHEN p_changes ? 'description' THEN coalesce(p_changes->>'description','') ELSE description END,
   status=next_status,progress_percentage=next_progress,
   planned_start_date=CASE WHEN p_changes ? 'planned_start_date' THEN nullif(p_changes->>'planned_start_date','')::date ELSE planned_start_date END,
   actual_start_date=CASE WHEN p_changes ? 'actual_start_date' THEN nullif(p_changes->>'actual_start_date','')::date
     WHEN next_status='ongoing' AND actual_start_date IS NULL THEN current_date ELSE actual_start_date END,
   expected_completion_date=CASE WHEN p_changes ? 'expected_completion_date' THEN nullif(p_changes->>'expected_completion_date','')::date ELSE expected_completion_date END,
   completed_at=CASE WHEN next_status='completed' THEN coalesce(completed_at,now()) WHEN status='completed' AND next_status<>'completed' THEN NULL ELSE completed_at END,
   updated_at=now()
 WHERE id=p_project RETURNING * INTO saved;
 IF next_status IS DISTINCT FROM original.status OR next_progress IS DISTINCT FROM original.progress_percentage THEN
   INSERT INTO public.project_updates(project_id,title,description,progress_percentage,project_status,
       update_date,created_by,updated_at,published_at)
   VALUES(saved.id,'Project status and progress updated',
     coalesce(nullif(explanation,''),'Barangay updated the official project progress to '||next_progress||'%.'),
     next_progress,next_status,current_date,p_actor,now(),now()) RETURNING * INTO milestone;
   INSERT INTO public.bgy_phase10_notification_outbox(event_key,title,body,kind,destination)
   VALUES('project_status:'||milestone.id,'Community Project Status: '||saved.title,
     left(next_status||' — '||milestone.description,350),
     CASE WHEN next_status='completed' THEN 'success' ELSE 'info' END,
     '/project-updates/'||saved.id::text) ON CONFLICT (event_key) DO NOTHING;
 END IF;
 RETURN saved;
END $$;

-- Publish one project milestone and update the official project in one transaction.
CREATE OR REPLACE FUNCTION public.bgy_phase10_publish_project_update(
 p_actor uuid,p_project uuid,p_title text,p_description text,p_image_url text,
 p_progress integer,p_status text,p_update_date date,p_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE project public.community_projects%ROWTYPE; milestone public.project_updates%ROWTYPE; changes jsonb;
BEGIN
 IF NOT public.bgy_phase10_is_admin(p_actor) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF length(trim(coalesce(p_title,'')))<3 OR length(trim(coalesce(p_description,'')))<3 THEN
  RAISE EXCEPTION 'Update title and description are required' USING ERRCODE='22023'; END IF;
 IF p_status='completed' AND length(trim(coalesce(p_description,'')))<10 THEN
  RAISE EXCEPTION 'Explain the completed work before publishing completion' USING ERRCODE='22023'; END IF;
 IF p_progress IS NOT NULL AND (p_progress<0 OR p_progress>100) THEN RAISE EXCEPTION 'Invalid progress' USING ERRCODE='22023'; END IF;
 IF p_status IS NOT NULL AND p_status NOT IN ('planned','ongoing','on_hold','completed','cancelled') THEN
   RAISE EXCEPTION 'Invalid project status' USING ERRCODE='22023'; END IF;
 SELECT * INTO project FROM public.community_projects WHERE id=p_project FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Project not found' USING ERRCODE='P0002'; END IF;
 IF (p_status IN ('on_hold','cancelled') OR p_progress < project.progress_percentage OR project.status='completed' AND p_status IS DISTINCT FROM 'completed')
 AND length(trim(coalesce(p_reason,'')))<5 THEN
  RAISE EXCEPTION 'Explain this important project status or progress change' USING ERRCODE='22023'; END IF;
 INSERT INTO public.project_updates(project_id,title,description,image_url,progress_percentage,project_status,
      update_date,created_by,updated_at,published_at)
 VALUES(p_project,trim(p_title),trim(p_description),p_image_url,
      CASE WHEN p_status='completed' THEN 100 ELSE p_progress END,p_status,coalesce(p_update_date,current_date),p_actor,now(),now())
 RETURNING * INTO milestone;
 UPDATE public.community_projects SET
   progress_percentage=CASE WHEN p_status='completed' THEN 100 ELSE coalesce(p_progress,progress_percentage) END,
   status=coalesce(p_status,status),
   actual_start_date=CASE WHEN p_status='ongoing' AND actual_start_date IS NULL THEN coalesce(p_update_date,current_date) ELSE actual_start_date END,
   completed_at=CASE WHEN p_status='completed' THEN coalesce(completed_at,now()) WHEN p_status IS NOT NULL THEN NULL ELSE completed_at END,
   updated_at=now()
 WHERE id=p_project RETURNING * INTO project;
 INSERT INTO public.bgy_phase10_notification_outbox(event_key,title,body,kind,destination)
 VALUES('project_update:'||milestone.id,'Project Update: '||project.title,
   left(milestone.title||' — '||milestone.description,350),
   CASE WHEN project.status='completed' THEN 'success' ELSE 'info' END,
   '/project-updates/'||p_project::text)
 ON CONFLICT (event_key) DO NOTHING;
 RETURN jsonb_build_object('update',to_jsonb(milestone),'project',to_jsonb(project));
END $$;

-- No changes to current project state when correcting historical milestone content.
CREATE OR REPLACE FUNCTION public.bgy_phase10_correct_project_update(
 p_actor uuid,p_project uuid,p_update uuid,p_title text,p_description text,p_image_url text,
 p_progress integer,p_status text,p_update_date date
) RETURNS public.project_updates LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE milestone public.project_updates%ROWTYPE;
BEGIN
 IF NOT public.bgy_phase10_is_admin(p_actor) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF length(trim(coalesce(p_title,'')))<3 OR length(trim(coalesce(p_description,'')))<3 THEN RAISE EXCEPTION 'Title and description required' USING ERRCODE='22023'; END IF;
 IF p_progress IS NOT NULL AND (p_progress<0 OR p_progress>100) THEN RAISE EXCEPTION 'Invalid progress' USING ERRCODE='22023'; END IF;
 IF p_status IS NOT NULL AND p_status NOT IN ('planned','ongoing','on_hold','completed','cancelled') THEN RAISE EXCEPTION 'Invalid status' USING ERRCODE='22023'; END IF;
 UPDATE public.project_updates SET title=trim(p_title),description=trim(p_description),image_url=p_image_url,
   progress_percentage=p_progress,project_status=p_status,update_date=coalesce(p_update_date,update_date),
   corrected_at=now(),updated_at=now()
 WHERE id=p_update AND project_id=p_project RETURNING * INTO milestone;
 IF NOT FOUND THEN RAISE EXCEPTION 'Milestone not found' USING ERRCODE='P0002'; END IF;
 RETURN milestone;
END $$;

-- Report potential legacy issues without rewriting any votes, elections or projects.
CREATE OR REPLACE FUNCTION public.bgy_phase10_legacy_diagnostics()
RETURNS TABLE(election_id uuid, issue text, vote_count bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH counts AS (
 SELECT e.id, count(v.id) as all_votes, count(DISTINCT v.option_id) as voted_options,
        (SELECT count(*) FROM (SELECT v2.option_id FROM public.votes v2 WHERE v2.election_id=e.id
          GROUP BY v2.option_id HAVING count(*)=(SELECT max(c) FROM (SELECT count(*) c FROM public.votes v3 WHERE v3.election_id=e.id GROUP BY v3.option_id) t)) tops) z) as top_ties
 FROM public.elections e LEFT JOIN public.votes v ON v.election_id=e.id
 WHERE e.status='closed' AND e.finalized_at IS NULL GROUP BY e.id
 )
 SELECT c.id,CASE WHEN c.all_votes=0 THEN 'legacy_no_votes'
 WHEN c.top_ties>1 THEN 'legacy_tie_review'
 ELSE 'legacy_unfinalized' END,c.all_votes FROM counts c
$$;

CREATE OR REPLACE FUNCTION public.bgy_phase10_ready() RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT to_regprocedure('public.bgy_phase10_cast_vote(uuid,uuid)') IS NOT NULL
 AND to_regprocedure('public.bgy_phase10_save_election(uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,text,jsonb,uuid)') IS NOT NULL
 AND to_regprocedure('public.bgy_phase10_finalize_election(uuid,uuid,text)') IS NOT NULL
 AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='elections' AND column_name='finalized_at');
$$;

REVOKE ALL ON FUNCTION public.bgy_phase10_queue_opened_rounds(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_phase10_queue_opened_rounds(integer) TO service_role;
REVOKE ALL ON FUNCTION public.bgy_phase10_dispatch_notifications(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_phase10_dispatch_notifications(integer) TO service_role;
REVOKE ALL ON FUNCTION public.bgy_phase10_is_admin(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bgy_phase10_save_election(uuid,uuid,text,text,text,timestamptz,timestamptz,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bgy_phase10_cast_vote(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bgy_phase10_finalize_election(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bgy_phase10_acknowledge_completion(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bgy_phase10_update_project(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_phase10_update_project(uuid,uuid,jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION public.bgy_phase10_publish_project_update(uuid,uuid,text,text,text,integer,text,date,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bgy_phase10_correct_project_update(uuid,uuid,uuid,text,text,text,integer,text,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bgy_phase10_legacy_diagnostics() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_phase10_is_admin(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bgy_phase10_save_election(uuid,uuid,text,text,text,timestamptz,timestamptz,text,jsonb,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bgy_phase10_cast_vote(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bgy_phase10_finalize_election(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bgy_phase10_acknowledge_completion(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bgy_phase10_publish_project_update(uuid,uuid,text,text,text,integer,text,date,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bgy_phase10_correct_project_update(uuid,uuid,uuid,text,text,text,integer,text,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.bgy_phase10_legacy_diagnostics() TO service_role;
GRANT EXECUTE ON FUNCTION public.bgy_phase10_ready() TO service_role;
COMMIT;

NOTIFY pgrst, 'reload schema';
