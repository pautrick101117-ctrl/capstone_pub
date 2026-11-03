-- Barangay Iba V4: Announcements may publicize future activities.
-- Non-destructive: existing records and published timestamps remain unchanged.
-- Run in Supabase SQL Editor BEFORE deploying the updated backend.
BEGIN;

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS event_at timestamptz;

COMMENT ON COLUMN public.announcements.event_at IS
  'Optional actual date/time of the announced activity, distinct from published_at. May be in the future.';

CREATE INDEX IF NOT EXISTS announcements_event_at_idx
  ON public.announcements (event_at)
  WHERE type = 'announcement' AND event_at IS NOT NULL;

COMMIT;

-- Read-only verification after migration:
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'announcements'
  AND column_name IN ('event_at', 'published_at');
