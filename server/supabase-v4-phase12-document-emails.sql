-- Barangay Iba V4: automatic, durable document-status emails.
-- Apply AFTER Phase 11 + Nov 2 workflow fixes + simplified templates.
-- NON-DESTRUCTIVE. Nothing is sent merely by installing this migration.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.requests') IS NULL OR to_regclass('public.notification_logs') IS NULL
     OR to_regprocedure('public.bgy_phase11_ready()') IS NULL
     OR NOT public.bgy_phase11_ready() THEN
    RAISE EXCEPTION 'Install the Phase 11 document migration before the email outbox';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.document_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE RESTRICT,
  resident_id uuid REFERENCES public.users(id),
  status_version integer NOT NULL CHECK (status_version >= 0),
  status_snapshot text NOT NULL,
  notification_type text NOT NULL CHECK(notification_type IN
    ('received','reviewing','revision','rejected','approved','ready','collected')),
  -- Snapshot only scheduling and identifying metadata; no ID images or verification notes.
  request_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  queue_state text NOT NULL DEFAULT 'pending' CHECK(queue_state IN
    ('pending','processing','done','failed','skipped')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_message_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(request_id,status_version,notification_type)
);
CREATE INDEX IF NOT EXISTS bgy_doc_email_ready
  ON public.document_email_outbox(queue_state,next_attempt_at,created_at);
CREATE INDEX IF NOT EXISTS bgy_doc_email_by_request
  ON public.document_email_outbox(request_id,created_at DESC);
ALTER TABLE public.document_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_email_outbox FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.document_email_outbox TO service_role;

-- Enqueue in the same DB transaction as the request status change. Never call
-- Resend from a trigger: network errors must not roll back resident requests.
CREATE OR REPLACE FUNCTION public.bgy_doc_email_enqueue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  -- Only registered official document request types participate.
  IF NOT EXISTS(SELECT 1 FROM public.document_templates d
                WHERE d.document_type=NEW.request_type) THEN RETURN NEW; END IF;
  t := CASE NEW.status
    WHEN 'submitted' THEN 'received'
    WHEN 'under_review' THEN 'reviewing'
    WHEN 'needs_revision' THEN 'revision'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'approved' THEN 'approved'
    WHEN 'ready_for_pickup' THEN 'ready'
    WHEN 'claimed' THEN 'collected'
    ELSE NULL END;
  IF t IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.document_email_outbox (
    request_id,resident_id,status_version,status_snapshot,notification_type,request_snapshot
  ) VALUES (
    NEW.id,NEW.user_id,NEW.lock_version,NEW.status,t,
    jsonb_build_object('requestType',NEW.request_type,
                       'pickupAt',NEW.pickup_scheduled_for,
                       'pickupInstructions',NEW.pickup_instructions)
  )
  ON CONFLICT (request_id,status_version,notification_type) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bgy_doc_email_status_trigger ON public.requests;
CREATE TRIGGER bgy_doc_email_status_trigger
AFTER INSERT OR UPDATE OF status ON public.requests
FOR EACH ROW EXECUTE FUNCTION public.bgy_doc_email_enqueue();

-- Claim a bounded batch under PostgreSQL row locks. Leases are fenced by a
-- unique token so an expired worker cannot finish another worker's claim.
-- Automatic retries use the SAME event ID as Resend's Idempotency-Key.
CREATE OR REPLACE FUNCTION public.bgy_doc_email_claim(
  p_limit integer DEFAULT 10, p_only_id uuid DEFAULT NULL, p_force boolean DEFAULT false
) RETURNS SETOF public.document_email_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_limit NOT BETWEEN 1 AND 25 THEN
    RAISE EXCEPTION 'Invalid outbox batch size' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  WITH pending AS (
    SELECT q.id FROM public.document_email_outbox q
    WHERE (p_only_id IS NULL OR q.id=p_only_id)
      AND q.attempt_count < 6
      -- After 23h Resend may no longer deduplicate; don't risk a duplicate email.
      AND q.created_at > now() - interval '23 hours'
      AND (
        (q.queue_state IN ('pending','failed') AND (p_force OR q.next_attempt_at <= now()))
        OR (q.queue_state='processing' AND q.lease_expires_at < now())
      )
    ORDER BY q.created_at, q.id
    LIMIT p_limit FOR UPDATE SKIP LOCKED
  )
  UPDATE public.document_email_outbox q
  SET queue_state='processing',attempt_count=q.attempt_count+1,
      lease_token=gen_random_uuid(), lease_expires_at=now()+interval '2 minutes',
      updated_at=now()
  FROM pending p WHERE p.id=q.id
  RETURNING q.*;
END $$;

CREATE OR REPLACE FUNCTION public.bgy_doc_email_finish(
  p_id uuid,p_lease_token uuid,p_state text,p_provider_id text DEFAULT NULL,
  p_error text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE changed integer;
BEGIN
  IF p_state NOT IN ('done','failed','skipped') THEN
    RAISE EXCEPTION 'Invalid outbox state' USING ERRCODE='22023';
  END IF;
  UPDATE public.document_email_outbox
  SET queue_state=p_state, provider_message_id=left(p_provider_id,200),
      error_code=left(p_error,120),
      lease_token=NULL, lease_expires_at=NULL,updated_at=now(),
      next_attempt_at=CASE WHEN p_state='failed'
        THEN now()+(least(3600,30*power(2,least(attempt_count,6)))::integer * interval '1 second')
        ELSE next_attempt_at END,
      completed_at=CASE WHEN p_state IN ('done','skipped') THEN now() ELSE completed_at END
  WHERE id=p_id AND lease_token=p_lease_token AND queue_state='processing';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed=1;
END $$;

CREATE OR REPLACE FUNCTION public.bgy_phase12_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT to_regclass('public.document_email_outbox') IS NOT NULL
  AND to_regprocedure('public.bgy_doc_email_claim(integer,uuid,boolean)') IS NOT NULL
  AND to_regprocedure('public.bgy_doc_email_finish(uuid,uuid,text,text,text)') IS NOT NULL
  AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='bgy_doc_email_status_trigger'
             AND tgrelid='public.requests'::regclass AND NOT tgisinternal);
$$;

-- Service key only. SECURITY DEFINER must not remain callable via PUBLIC.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc
  WHERE pronamespace='public'::regnamespace AND proname IN (
    'bgy_doc_email_enqueue','bgy_doc_email_claim','bgy_doc_email_finish','bgy_phase12_ready')
 LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;
COMMIT;
-- Verify (read-only): SELECT public.bgy_phase12_ready();
-- Refresh Supabase PostgREST's function cache so new RPCs are available quickly.
NOTIFY pgrst, 'reload schema';
