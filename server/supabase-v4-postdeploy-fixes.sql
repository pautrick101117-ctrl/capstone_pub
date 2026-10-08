-- Safe compatibility/security corrections for an EXISTING Barangay Iba database.
-- This is NOT a database reset, seed, or full schema migration.
-- Run V4's supabase-v4-upgrade.sql first if the V4 objects do not yet exist.
begin;

-- Older V3 deployments sometimes lack these election-option metadata columns.
alter table public.election_options
  add column if not exists source_suggestion_id uuid references public.project_suggestions(id) on delete set null;
alter table public.election_options
  add column if not exists image_url text;

-- REVOKE from PUBLIC as well, not just anon/authenticated, because SECURITY
-- DEFINER functions have PUBLIC EXECUTE permission by default in PostgreSQL.
revoke all on function public.replace_census_households(jsonb)
  from PUBLIC, anon, authenticated;
grant execute on function public.replace_census_households(jsonb)
  to service_role, postgres;

commit;
