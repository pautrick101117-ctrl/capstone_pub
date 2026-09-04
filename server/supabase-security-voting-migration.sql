-- Barangay Iba security hardening + voting/workflow expansion
-- Safe to run on the current Supabase project after taking a backup.
-- The application uses the service-role key ONLY on the Express server.

begin;

create extension if not exists "pgcrypto";

-- =========================================================
-- 1) COMPLAINT WORKFLOW EXPANSION
-- =========================================================

alter table public.complaints add column if not exists reference_code text;
alter table public.complaints add column if not exists priority text not null default 'normal';
alter table public.complaints add column if not exists admin_note text not null default '';
alter table public.complaints add column if not exists updated_at timestamptz not null default now();
alter table public.complaints add column if not exists resolved_at timestamptz;

update public.complaints
set reference_code = 'CMP-' || upper(substr(replace(id::text, '-', ''), 1, 8))
where reference_code is null or reference_code = '';

update public.complaints
set status = case
  when status = 'pending' then 'submitted'
  when status = 'resolved' then 'resolved'
  else status
end;

alter table public.complaints alter column reference_code set not null;
create unique index if not exists complaints_reference_code_uidx on public.complaints(reference_code);
create index if not exists complaints_status_updated_idx on public.complaints(status, updated_at desc);

alter table public.complaints drop constraint if exists complaints_status_check;
alter table public.complaints
  add constraint complaints_status_check
  check (status in ('submitted', 'under_review', 'in_progress', 'resolved', 'closed'));

alter table public.complaints drop constraint if exists complaints_priority_check;
alter table public.complaints
  add constraint complaints_priority_check
  check (priority in ('low', 'normal', 'high', 'urgent'));


-- =========================================================
-- REQUEST STATUS WORKFLOW
-- =========================================================

update public.requests set status = 'submitted' where status = 'pending';
alter table public.requests drop constraint if exists requests_status_check;
alter table public.requests
  add constraint requests_status_check
  check (status in ('submitted', 'acknowledged', 'processing', 'needs_information', 'ready_for_release', 'completed', 'rejected', 'cancelled'));

alter table public.id_requests drop constraint if exists id_requests_status_check;
alter table public.id_requests
  add constraint id_requests_status_check
  check (status in ('submitted', 'confirmed', 'rescheduled', 'ready_for_pickup', 'completed', 'cancelled'));

-- =========================================================
-- 2) PROJECT SUGGESTION REVIEW LIFECYCLE
-- =========================================================

alter table public.project_suggestions add column if not exists admin_feedback text not null default '';
alter table public.project_suggestions add column if not exists reviewed_by uuid references public.users(id) on delete set null;
alter table public.project_suggestions add column if not exists reviewed_at timestamptz;
alter table public.project_suggestions add column if not exists updated_at timestamptz not null default now();
alter table public.project_suggestions add column if not exists purok text not null default '';
alter table public.project_suggestions add column if not exists category text not null default 'general';

update public.project_suggestions
set status = 'submitted'
where status = 'pending';

alter table public.project_suggestions drop constraint if exists project_suggestions_status_check;
alter table public.project_suggestions
  add constraint project_suggestions_status_check
  check (status in ('submitted', 'under_review', 'needs_revision', 'approved', 'rejected', 'included_in_voting', 'selected'));

create index if not exists project_suggestions_review_idx on public.project_suggestions(status, created_at desc);

-- =========================================================
-- 3) ELECTION LIFECYCLE + PRIVACY/FINALIZATION
-- =========================================================

alter table public.elections add column if not exists results_visibility text not null default 'after_close';
alter table public.elections add column if not exists finalized_at timestamptz;
alter table public.elections add column if not exists finalized_by uuid references public.users(id) on delete set null;
alter table public.elections add column if not exists result_status text;
alter table public.elections add column if not exists winning_option_id uuid references public.election_options(id) on delete set null;
alter table public.elections add column if not exists runoff_of_election_id uuid references public.elections(id) on delete set null;
alter table public.elections add column if not exists opened_notified_at timestamptz;
alter table public.elections add column if not exists closed_notified_at timestamptz;
alter table public.elections add column if not exists updated_at timestamptz not null default now();

-- Repair old rows that were marked live even though the opening time is in the future.
update public.elections
set status = 'scheduled'
where status = 'live'
  and starts_at is not null
  and starts_at > now();

alter table public.elections drop constraint if exists elections_status_check;
alter table public.elections
  add constraint elections_status_check
  check (status in ('draft', 'scheduled', 'live', 'closed', 'finalized', 'archived', 'cancelled'));

alter table public.elections drop constraint if exists elections_results_visibility_check;
alter table public.elections
  add constraint elections_results_visibility_check
  check (results_visibility in ('after_close', 'after_vote', 'live'));

alter table public.elections drop constraint if exists elections_result_status_check;
alter table public.elections
  add constraint elections_result_status_check
  check (result_status is null or result_status in ('winner', 'tie', 'no_votes', 'cancelled', 'invalidated'));

create index if not exists elections_status_schedule_idx on public.elections(status, starts_at, ends_at);

-- Freeze the eligible voter roll per election.
create table if not exists public.election_voters (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  eligible boolean not null default true,
  voted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (election_id, user_id)
);

create index if not exists election_voters_election_idx on public.election_voters(election_id, eligible, voted_at);
create index if not exists election_voters_user_idx on public.election_voters(user_id, election_id);

-- Give every vote an opaque receipt/reference. The receipt does not reveal the selected option.
alter table public.votes add column if not exists receipt_code text;
update public.votes
set receipt_code = 'VOTE-' || upper(substr(replace(id::text, '-', ''), 1, 8))
where receipt_code is null or receipt_code = '';
alter table public.votes alter column receipt_code set default ('VOTE-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)));
alter table public.votes alter column receipt_code set not null;
create unique index if not exists votes_receipt_code_uidx on public.votes(receipt_code);

-- Official result snapshot. Results are finalized explicitly by an admin.
create table if not exists public.election_results (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null unique references public.elections(id) on delete cascade,
  result_status text not null check (result_status in ('winner', 'tie', 'no_votes', 'cancelled', 'invalidated')),
  winning_option_id uuid references public.election_options(id) on delete set null,
  total_votes integer not null default 0 check (total_votes >= 0),
  eligible_voters integer not null default 0 check (eligible_voters >= 0),
  participation_rate numeric(6,2) not null default 0,
  finalized_by uuid references public.users(id) on delete set null,
  finalized_at timestamptz not null default now(),
  snapshot jsonb not null default '{}'::jsonb
);

-- Winning election options become trackable community projects.
create table if not exists public.community_projects (
  id uuid primary key default gen_random_uuid(),
  source_election_id uuid unique references public.elections(id) on delete set null,
  winning_option_id uuid references public.election_options(id) on delete set null,
  source_suggestion_id uuid references public.project_suggestions(id) on delete set null,
  title text not null,
  description text not null default '',
  location text not null default '',
  purok text not null default '',
  status text not null default 'planned',
  progress_percentage integer not null default 0 check (progress_percentage between 0 and 100),
  planned_start_date date,
  actual_start_date date,
  target_completion_date date,
  actual_completion_date date,
  allocated_budget numeric(14,2) check (allocated_budget is null or allocated_budget >= 0),
  actual_cost numeric(14,2) check (actual_cost is null or actual_cost >= 0),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('planned', 'preparation', 'in_progress', 'completed', 'cancelled'))
);

create index if not exists community_projects_status_idx on public.community_projects(status, updated_at desc);

create table if not exists public.project_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.community_projects(id) on delete cascade,
  title text not null,
  description text not null default '',
  progress_percentage integer check (progress_percentage is null or progress_percentage between 0 and 100),
  image_url text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists project_updates_project_idx on public.project_updates(project_id, created_at desc);

create table if not exists public.project_completion_confirmations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.community_projects(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create index if not exists project_completion_confirmations_project_idx
  on public.project_completion_confirmations(project_id, created_at desc);

-- =========================================================
-- 4) PORTAL SETTINGS THAT ACTUALLY PERSIST
-- =========================================================

create table if not exists public.portal_settings (
  key_name text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.portal_settings (key_name, value)
values
  ('resident_login_enabled', 'true'::jsonb),
  ('maintenance_mode', 'false'::jsonb),
  ('timezone', '"Asia/Manila"'::jsonb),
  ('date_format', '"MM-DD-YYYY"'::jsonb),
  ('complaint_email_alerts', 'true'::jsonb),
  ('notification_email', '"barangayiba@gmail.com"'::jsonb)
on conflict (key_name) do nothing;

-- =========================================================
-- 5) ATOMIC CORE VOTE TRANSACTION
-- =========================================================

create or replace function public.cast_election_vote(
  p_election_id uuid,
  p_option_id uuid,
  p_user_id uuid
)
returns table (
  vote_id uuid,
  receipt_code text,
  recorded_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_vote public.votes%rowtype;
begin
  select e.status, e.starts_at, e.ends_at
    into v_status, v_starts_at, v_ends_at
  from public.elections e
  where e.id = p_election_id
  for update;

  if not found then
    raise exception 'Election not found.';
  end if;

  if v_status <> 'live'
     or v_starts_at is null
     or v_ends_at is null
     or now() < v_starts_at
     or now() >= v_ends_at then
    raise exception 'Voting is not currently open.';
  end if;

  if not exists (
    select 1
    from public.election_voters ev
    where ev.election_id = p_election_id
      and ev.user_id = p_user_id
      and ev.eligible = true
  ) then
    raise exception 'This resident is not on the eligible voter list for this election.';
  end if;

  if exists (
    select 1
    from public.votes v
    where v.election_id = p_election_id
      and v.user_id = p_user_id
  ) then
    raise exception 'You have already voted in this election.';
  end if;

  if not exists (
    select 1
    from public.election_options eo
    where eo.id = p_option_id
      and eo.election_id = p_election_id
  ) then
    raise exception 'Invalid voting option.';
  end if;

  insert into public.votes (election_id, option_id, user_id)
  values (p_election_id, p_option_id, p_user_id)
  returning * into v_vote;

  update public.election_voters
  set voted_at = v_vote.created_at
  where election_id = p_election_id
    and user_id = p_user_id;

  return query
  select v_vote.id, v_vote.receipt_code, v_vote.created_at;
end;
$$;

revoke all on function public.cast_election_vote(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.cast_election_vote(uuid, uuid, uuid) to service_role;

-- =========================================================
-- 6) SUPABASE SECURITY ADVISOR: RLS ON PUBLIC TABLES
-- =========================================================

alter table public.verification_codes enable row level security;
alter table public.votes enable row level security;
alter table public.election_options enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.landing_content enable row level security;
alter table public.clearances enable row level security;
alter table public.census_households enable row level security;
alter table public.users enable row level security;
alter table public.requests enable row level security;
alter table public.request_timeline enable row level security;
alter table public.project_completions enable row level security;
alter table public.project_suggestions enable row level security;
alter table public.elections enable row level security;
alter table public.announcements enable row level security;
alter table public.events enable row level security;
alter table public.fund_sources enable row level security;
alter table public.fund_projects enable row level security;
alter table public.id_pickup_slots enable row level security;
alter table public.complaints enable row level security;
alter table public.id_requests enable row level security;
alter table public.officials enable row level security;
alter table public.election_voters enable row level security;
alter table public.election_results enable row level security;
alter table public.community_projects enable row level security;
alter table public.project_updates enable row level security;
alter table public.project_completion_confirmations enable row level security;
alter table public.portal_settings enable row level security;

-- The React client does not query Supabase directly. Keep Data API access private.
revoke all privileges on table public.verification_codes from anon, authenticated;
revoke all privileges on table public.votes from anon, authenticated;
revoke all privileges on table public.election_options from anon, authenticated;
revoke all privileges on table public.notifications from anon, authenticated;
revoke all privileges on table public.audit_logs from anon, authenticated;
revoke all privileges on table public.landing_content from anon, authenticated;
revoke all privileges on table public.clearances from anon, authenticated;
revoke all privileges on table public.census_households from anon, authenticated;
revoke all privileges on table public.users from anon, authenticated;
revoke all privileges on table public.requests from anon, authenticated;
revoke all privileges on table public.request_timeline from anon, authenticated;
revoke all privileges on table public.project_completions from anon, authenticated;
revoke all privileges on table public.project_suggestions from anon, authenticated;
revoke all privileges on table public.elections from anon, authenticated;
revoke all privileges on table public.announcements from anon, authenticated;
revoke all privileges on table public.events from anon, authenticated;
revoke all privileges on table public.fund_sources from anon, authenticated;
revoke all privileges on table public.fund_projects from anon, authenticated;
revoke all privileges on table public.id_pickup_slots from anon, authenticated;
revoke all privileges on table public.complaints from anon, authenticated;
revoke all privileges on table public.id_requests from anon, authenticated;
revoke all privileges on table public.officials from anon, authenticated;
revoke all privileges on table public.election_voters from anon, authenticated;
revoke all privileges on table public.election_results from anon, authenticated;
revoke all privileges on table public.community_projects from anon, authenticated;
revoke all privileges on table public.project_updates from anon, authenticated;
revoke all privileges on table public.project_completion_confirmations from anon, authenticated;
revoke all privileges on table public.portal_settings from anon, authenticated;

-- =========================================================
-- 7) SECURITY DEFINER VIEW WARNINGS -> SECURITY INVOKER
-- =========================================================

alter view if exists public.public_barangay_statistics set (security_invoker = true);
alter view if exists public.public_fund_transparency_summary set (security_invoker = true);
alter view if exists public.public_upcoming_events_preview set (security_invoker = true);
alter view if exists public.public_latest_news_preview set (security_invoker = true);
alter view if exists public.public_latest_announcements_preview set (security_invoker = true);

revoke all privileges on table public.public_barangay_statistics from anon, authenticated;
revoke all privileges on table public.public_fund_transparency_summary from anon, authenticated;
revoke all privileges on table public.public_upcoming_events_preview from anon, authenticated;
revoke all privileges on table public.public_latest_news_preview from anon, authenticated;
revoke all privileges on table public.public_latest_announcements_preview from anon, authenticated;

commit;
