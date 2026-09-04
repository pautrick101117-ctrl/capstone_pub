-- Barangay Iba demo reset
-- WARNING: DESTRUCTIVE. This removes ALL application data in public tables.
-- It intentionally does NOT touch Supabase system schemas (auth, storage, realtime, etc.).
-- Run the security/voting migration first so every listed table exists.

begin;

truncate table
  public.project_completion_confirmations,
  public.project_updates,
  public.community_projects,
  public.election_results,
  public.election_voters,
  public.project_completions,
  public.votes,
  public.election_options,
  public.elections,
  public.request_timeline,
  public.id_requests,
  public.id_pickup_slots,
  public.project_suggestions,
  public.requests,
  public.complaints,
  public.clearances,
  public.census_households,
  public.notifications,
  public.verification_codes,
  public.audit_logs,
  public.portal_settings,
  public.landing_content,
  public.announcements,
  public.events,
  public.fund_projects,
  public.fund_sources,
  public.officials,
  public.users
restart identity cascade;

commit;
