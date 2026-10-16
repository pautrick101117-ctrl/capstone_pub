-- Barangay Iba V4 | Phase 9: Per-resource borrowing maximums and atomic reservation checks.
-- Apply AFTER Phase 8. NON-DESTRUCTIVE: existing assets/requests are not deleted or rewritten.
-- Legacy active resources with NULL maximum cannot accept new requests until configured.
BEGIN;

ALTER TABLE public.borrowable_assets
  ADD COLUMN IF NOT EXISTS max_borrow_minutes integer;
ALTER TABLE public.borrowing_requests
  ADD COLUMN IF NOT EXISTS max_duration_minutes_at_submission integer;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bgy_phase9_max_borrow_range' AND conrelid='public.borrowable_assets'::regclass) THEN
    ALTER TABLE public.borrowable_assets ADD CONSTRAINT bgy_phase9_max_borrow_range
      CHECK (max_borrow_minutes IS NULL OR max_borrow_minutes BETWEEN 60 AND 129600);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bgy_phase9_request_snapshot_range' AND conrelid='public.borrowing_requests'::regclass) THEN
    ALTER TABLE public.borrowing_requests ADD CONSTRAINT bgy_phase9_request_snapshot_range
      CHECK (max_duration_minutes_at_submission IS NULL OR max_duration_minutes_at_submission BETWEEN 60 AND 129600);
  END IF;
END $$;

-- New resources must be configured; old rows remain valid until the administrator sets their maximum.
CREATE OR REPLACE FUNCTION public.bgy_phase9_asset_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='INSERT' AND NEW.max_borrow_minutes IS NULL THEN
    RAISE EXCEPTION 'BGY_BORROW_DURATION_NOT_CONFIGURED' USING ERRCODE='22023';
  END IF;
  IF NEW.is_active AND NEW.max_borrow_minutes IS NULL AND TG_OP='UPDATE' AND NOT OLD.is_active THEN
    RAISE EXCEPTION 'BGY_BORROW_DURATION_NOT_CONFIGURED' USING ERRCODE='22023';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bgy_phase9_asset_guard_trg ON public.borrowable_assets;
CREATE TRIGGER bgy_phase9_asset_guard_trg BEFORE INSERT OR UPDATE ON public.borrowable_assets
FOR EACH ROW EXECUTE FUNCTION public.bgy_phase9_asset_guard();

-- BEFORE INSERT validates a new request against the authoritative asset policy.
-- BEFORE approval locks the asset row, serializing approvals for overlapping reservations.
-- The existing Phase 6 bgy_case_apply() remains the one authoritative status/history transaction.
CREATE OR REPLACE FUNCTION public.bgy_phase9_request_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_asset public.borrowable_assets%ROWTYPE; v_reserved bigint; v_now timestamptz := clock_timestamp();
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT * INTO v_asset FROM public.borrowable_assets WHERE id=NEW.asset_id FOR SHARE;
    IF NOT FOUND OR NOT v_asset.is_active THEN
      RAISE EXCEPTION 'BGY_BORROW_RESOURCE_UNAVAILABLE' USING ERRCODE='23514';
    END IF;
    IF v_asset.max_borrow_minutes IS NULL THEN
      RAISE EXCEPTION 'BGY_BORROW_DURATION_NOT_CONFIGURED' USING ERRCODE='23514';
    END IF;
    IF NEW.due_at <= NEW.start_at OR NEW.start_at < v_now - interval '5 minutes' THEN
      RAISE EXCEPTION 'BGY_BORROW_INVALID_DATES' USING ERRCODE='22023';
    END IF;
    IF extract(epoch from (NEW.due_at-NEW.start_at)) > v_asset.max_borrow_minutes * 60 THEN
      RAISE EXCEPTION 'BGY_BORROW_DURATION_EXCEEDED' USING ERRCODE='23514';
    END IF;
    IF NEW.quantity < 1 OR (v_asset.category='facility' AND NEW.quantity<>1)
       OR NEW.quantity>v_asset.total_quantity THEN
      RAISE EXCEPTION 'BGY_BORROW_INVALID_QUANTITY' USING ERRCODE='22023';
    END IF;
    NEW.max_duration_minutes_at_submission := v_asset.max_borrow_minutes;
    -- Pending requests do not reserve inventory. A separate check occurs during approval.
  ELSIF OLD.status='pending' AND NEW.status='approved' THEN
    SELECT * INTO v_asset FROM public.borrowable_assets WHERE id=NEW.asset_id FOR UPDATE;
    IF NOT FOUND OR NOT v_asset.is_active THEN
      RAISE EXCEPTION 'BGY_BORROW_RESOURCE_UNAVAILABLE' USING ERRCODE='23514';
    END IF;
    IF NEW.due_at <= v_now THEN
      RAISE EXCEPTION 'BGY_BORROW_WINDOW_EXPIRED' USING ERRCODE='23514';
    END IF;
    -- Do not apply a newer maximum retroactively: submitted terms remain authoritative.
    SELECT coalesce(sum(r.quantity),0) INTO v_reserved FROM public.borrowing_requests r
    WHERE r.asset_id=NEW.asset_id AND r.id<>NEW.id
      AND r.status IN ('approved','borrowed')
      AND r.start_at<NEW.due_at AND r.due_at>NEW.start_at;
    IF v_reserved + NEW.quantity > v_asset.total_quantity THEN
      RAISE EXCEPTION 'BGY_BORROW_OVERBOOKED' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bgy_phase9_request_guard_trg ON public.borrowing_requests;
CREATE TRIGGER bgy_phase9_request_guard_trg BEFORE INSERT OR UPDATE OF status ON public.borrowing_requests
FOR EACH ROW EXECUTE FUNCTION public.bgy_phase9_request_guard();

-- Triggers also guard direct writes. Existing rows are preserved untouched.
CREATE OR REPLACE FUNCTION public.bgy_phase9_ready() RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='borrowable_assets' AND column_name='max_borrow_minutes')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='borrowing_requests' AND column_name='max_duration_minutes_at_submission')
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.borrowable_assets'::regclass AND tgname='bgy_phase9_asset_guard_trg' AND NOT tgisinternal)
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.borrowing_requests'::regclass AND tgname='bgy_phase9_request_guard_trg' AND NOT tgisinternal);
$$;

CREATE OR REPLACE FUNCTION public.bgy_phase9_unconfigured_assets() RETURNS TABLE (id uuid,name text)
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
  SELECT a.id,a.name FROM public.borrowable_assets a
  WHERE a.is_active=true AND a.max_borrow_minutes IS NULL ORDER BY a.name;
$$;

REVOKE ALL ON FUNCTION public.bgy_phase9_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_phase9_ready() TO service_role;
REVOKE ALL ON FUNCTION public.bgy_phase9_unconfigured_assets() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bgy_phase9_unconfigured_assets() TO service_role;
REVOKE ALL ON FUNCTION public.bgy_phase9_asset_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bgy_phase9_request_guard() FROM PUBLIC,anon,authenticated;

COMMIT;
