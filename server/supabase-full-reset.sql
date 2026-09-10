-- Barangay Iba Portal - FULL DATABASE RESET / REBUILD (V3)
-- WARNING: DESTRUCTIVE. This removes ALL application data in the public schema.
-- It does NOT drop Supabase system schemas such as auth, storage, extensions, realtime, etc.
-- No mock/sample barangay records are inserted. Only the requested bootstrap admin account is created.

begin;

-- =========================================================
-- 1) DROP ALL APPLICATION OBJECTS
-- =========================================================
drop schema if exists public cascade;
create schema public;

-- Restore schema ownership/access expected by Supabase.
grant usage on schema public to postgres, anon, authenticated, service_role;
grant create on schema public to postgres, service_role;
grant all on schema public to postgres, service_role;

alter default privileges in schema public grant all on tables to postgres, service_role;
alter default privileges in schema public grant all on sequences to postgres, service_role;
alter default privileges in schema public grant all on functions to postgres, service_role;

create extension if not exists pgcrypto;

-- =========================================================
-- 2) USERS / AUTH SUPPORT
-- =========================================================
create table public.users (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  middle_name text not null default '',
  last_name text not null,
  full_name text,
  email text unique,
  username text,
  password_hash text not null,
  address text not null default '',
  purok text not null default '',
  birthdate date,
  contact_number text not null default '',
  valid_id_url text,
  role text not null default 'resident'
    check (role in ('resident', 'admin', 'super_admin')),
  status text not null default 'pending',
  email_verified boolean not null default false,
  email_verified_at timestamptz,
  verification_provider text not null default 'resend',
  has_voted boolean not null default false,
  must_change_password boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index users_username_unique_idx
  on public.users (lower(username))
  where username is not null;
create index users_role_idx on public.users (role);
create index users_is_active_idx on public.users (is_active);
create index users_purok_idx on public.users (purok);

-- Initial administrator requested for this deployment.
-- Bootstrap administrator. Change this credential after deployment.
-- The password is stored only as a bcrypt hash in the database.
insert into public.users (
  first_name, last_name, full_name, email, username, password_hash,
  role, status, email_verified, email_verified_at, must_change_password, is_active
) values (
  'System', 'Administrator', 'System Administrator', 'admin@gmail.com', 'admin', '$2b$12$yuya5obK75OCqqpBUl/RGOuRsZ2WFxyyQozl20PjHpMLeWj0Pad.C',
  'admin', 'approved', true, now(), false, true
);

-- Secondary administrator requested for this deployment.
insert into public.users (
  first_name, last_name, full_name, email, username, password_hash,
  role, status, email_verified, email_verified_at, must_change_password, is_active
) values (
  'Pautrick', 'Administrator', 'Pautrick Administrator', 'pautrick101117@gmail.com', 'pautrick101117', crypt('Password123', gen_salt('bf', 12)),
  'admin', 'approved', true, now(), false, true
)
on conflict (email) do update set
  username = excluded.username,
  password_hash = excluded.password_hash,
  role = 'admin',
  status = 'approved',
  email_verified = true,
  email_verified_at = coalesce(public.users.email_verified_at, now()),
  must_change_password = false,
  is_active = true,
  updated_at = now();


-- Birthdate changes are validated without using CURRENT_DATE in a CHECK constraint.
create or replace function public.enforce_adult_birthdate()
returns trigger
language plpgsql
as $$
begin
  if new.birthdate is not null and new.birthdate > (current_date - interval '18 years')::date then
    raise exception 'Resident must be at least 18 years old.';
  end if;
  return new;
end;
$$;

create trigger users_adult_birthdate_trigger
before insert or update of birthdate on public.users
for each row execute function public.enforce_adult_birthdate();

create table public.verification_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code text,
  code_hash text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  sent_to text,
  provider text not null default 'resend',
  method text not null default 'email',
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index verification_codes_email_idx on public.verification_codes (lower(email), created_at desc);
create index verification_codes_expiry_idx on public.verification_codes (expires_at);

-- =========================================================
-- 3) CENTRALIZED MASTER DATA
-- Empty by design. Populate real barangay values from Admin Settings.
-- =========================================================
create table public.master_data_values (
  id uuid primary key default gen_random_uuid(),
  category text not null
    check (category in ('purok', 'administration_term', 'concern_category', 'event_category', 'official_position')),
  value text not null,
  label text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category, value)
);
create index master_data_values_lookup_idx
  on public.master_data_values (category, is_active, sort_order, label);

-- =========================================================
-- 4) NOTIFICATIONS / AUDIT / SETTINGS CONTENT
-- =========================================================
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  title text not null,
  body text not null,
  kind text not null default 'info',
  broadcast boolean not null default false,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_read_idx
  on public.notifications (user_id, is_read, created_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

create table public.landing_content (
  key_name text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- =========================================================
-- 5) COMMUNITY CONCERNS
-- =========================================================
create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  resident_name text not null,
  complaint_type text not null,
  details text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'in_review', 'resolved')),
  admin_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index complaints_user_id_idx on public.complaints (user_id);
create index complaints_status_idx on public.complaints (status, created_at desc);

-- =========================================================
-- 6) DOCUMENT / SERVICE REQUESTS
-- =========================================================
create table public.requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  resident_name text not null,
  request_type text not null,
  details text not null default '',
  status text not null default 'submitted'
    check (status in ('submitted', 'acknowledged', 'processing', 'completed')),
  admin_note text not null default '',
  preferred_schedule_date date,
  preferred_time_slot text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index requests_user_id_idx on public.requests (user_id);
create index requests_type_idx on public.requests (request_type);
create index requests_status_idx on public.requests (status, created_at desc);

create table public.request_timeline (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  status text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index request_timeline_request_id_idx
  on public.request_timeline (request_id, created_at);

create table public.clearances (
  id uuid primary key default gen_random_uuid(),
  resident_name text not null,
  type text not null,
  request_date date not null default current_date,
  issued_date date,
  status text not null default 'pending',
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- =========================================================
-- 7) BARANGAY ID APPOINTMENT / PICKUP
-- =========================================================
create table public.id_pickup_slots (
  id uuid primary key default gen_random_uuid(),
  slot_date date not null,
  time_slot text not null,
  capacity integer not null default 1 check (capacity > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (slot_date, time_slot)
);
create index id_pickup_slots_date_idx on public.id_pickup_slots (slot_date, is_active);

create table public.id_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  purpose text not null,
  preferred_date date,
  time_slot text,
  status text not null default 'submitted'
    check (status in ('submitted', 'confirmed', 'rescheduled', 'completed', 'cancelled')),
  admin_note text not null default '',
  pickup_reminder_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index id_requests_user_id_idx on public.id_requests (user_id);
create index id_requests_status_idx on public.id_requests (status, created_at desc);

-- =========================================================
-- 8) CENSUS
-- =========================================================
create table public.census_households (
  id uuid primary key default gen_random_uuid(),
  household_name text not null,
  purok text not null,
  members integer not null default 1 check (members >= 1),
  house_number text not null,
  status text not null default 'active',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index census_households_house_number_idx on public.census_households (lower(house_number));
create index census_households_purok_idx on public.census_households (purok);

-- =========================================================
-- 9) OFFICIALS
-- =========================================================
create table public.officials (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position text not null,
  term text not null,
  contact text not null default '',
  status text not null default 'active',
  photo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index officials_is_active_idx on public.officials (is_active);
create index officials_position_idx on public.officials (position);

-- =========================================================
-- 10) PROJECT SUGGESTIONS + COMMUNITY VOTING
-- =========================================================
create table public.project_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  description text not null,
  image_url text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
create index project_suggestions_user_id_idx on public.project_suggestions (user_id);
create index project_suggestions_status_idx on public.project_suggestions (status, created_at desc);

create table public.elections (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  status text not null default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  image_url text,
  source_suggestion_id uuid references public.project_suggestions(id) on delete set null,
  closing_soon_notified_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index elections_status_window_idx on public.elections (status, starts_at, ends_at);

create table public.election_options (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  name text not null,
  description text not null default '',
  source_suggestion_id uuid references public.project_suggestions(id) on delete set null,
  image_url text,
  votes_count integer not null default 0 check (votes_count >= 0),
  created_at timestamptz not null default now()
);
create index election_options_election_idx on public.election_options (election_id, created_at);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  option_id uuid not null references public.election_options(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (election_id, user_id)
);
create index votes_election_idx on public.votes (election_id);
create index votes_option_idx on public.votes (option_id);

create table public.project_completions (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (election_id, user_id)
);
create index project_completions_election_id_idx on public.project_completions (election_id);

-- =========================================================
-- 11) FUNDS / TRANSPARENCY
-- =========================================================
create table public.fund_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  term text not null,
  allocated_amount numeric(14,2) not null check (allocated_amount >= 0),
  created_at timestamptz not null default now()
);
create index fund_sources_term_idx on public.fund_sources (term);

create table public.fund_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  date date not null,
  amount numeric(14,2) not null check (amount >= 0),
  description text not null default '',
  receipt_url text,
  term text not null,
  status text not null default 'ongoing'
    check (status in ('ongoing', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);
create index fund_projects_date_idx on public.fund_projects (date desc);
create index fund_projects_status_idx on public.fund_projects (status);
create index fund_projects_term_idx on public.fund_projects (term);

-- =========================================================
-- 12) NEWS / ANNOUNCEMENTS / EVENTS
-- =========================================================
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  image_url text,
  type text not null check (type in ('news', 'announcement')),
  created_at timestamptz not null default now()
);
create index announcements_type_idx on public.announcements (type, created_at desc);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  date date not null,
  time time,
  location text not null default '',
  description text not null default '',
  type text not null default 'general',
  created_at timestamptz not null default now()
);
create index events_date_idx on public.events (date, time);
create index events_type_idx on public.events (type);

-- =========================================================
-- 13) BORROWABLE FACILITIES / ITEMS
-- =========================================================
create table public.borrowable_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'item'
    check (category in ('facility', 'item')),
  description text not null default '',
  total_quantity integer not null default 1 check (total_quantity >= 1),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index borrowable_assets_name_unique_idx on public.borrowable_assets (lower(name));
create index borrowable_assets_active_idx on public.borrowable_assets (is_active, category);

create table public.borrowing_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  asset_id uuid not null references public.borrowable_assets(id) on delete restrict,
  quantity integer not null default 1 check (quantity >= 1),
  purpose text not null,
  event_location text not null default '',
  start_at timestamptz not null,
  due_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'borrowed', 'returned', 'cancelled')),
  admin_note text not null default '',
  terms_accepted_at timestamptz,
  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  borrowed_at timestamptz,
  returned_at timestamptz,
  returned_quantity integer check (returned_quantity is null or returned_quantity >= 0),
  return_condition text
    check (return_condition is null or return_condition in ('good', 'minor_damage', 'damaged', 'missing_items')),
  return_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_at > start_at)
);
create index borrowing_requests_user_idx on public.borrowing_requests (user_id, created_at desc);
create index borrowing_requests_asset_window_idx on public.borrowing_requests (asset_id, start_at, due_at);
create index borrowing_requests_status_idx on public.borrowing_requests (status, due_at);
create index borrowing_requests_due_active_idx on public.borrowing_requests (due_at) where status = 'borrowed';

-- =========================================================
-- 14) PUBLIC READ-MODEL VIEWS
-- =========================================================
create view public.public_barangay_statistics
with (security_invoker = true)
as
select
  (select count(*) from public.users where role = 'resident' and is_active = true) as total_registered_residents,
  (select count(*) from public.fund_projects where status = 'completed') as completed_projects,
  (select count(*) from public.officials where is_active = true) as active_officials,
  coalesce((select sum(amount) from public.fund_projects), 0)::numeric(14,2) as total_funds_spent;

create view public.public_fund_transparency_summary
with (security_invoker = true)
as
with totals as (
  select coalesce(sum(allocated_amount), 0)::numeric(14,2) as total_funds
  from public.fund_sources
),
spent as (
  select coalesce(sum(amount), 0)::numeric(14,2) as spent
  from public.fund_projects
  where status in ('ongoing', 'completed')
)
select
  totals.total_funds,
  spent.spent,
  greatest(totals.total_funds - spent.spent, 0)::numeric(14,2) as remaining
from totals, spent;

create view public.public_upcoming_events_preview
with (security_invoker = true)
as
select id, title, date, time, location, description, type, created_at
from public.events
where date >= current_date
order by date asc, time asc nulls last
limit 3;

create view public.public_latest_news_preview
with (security_invoker = true)
as
select id, title, body, image_url, type, created_at
from public.announcements
where type = 'news'
order by created_at desc
limit 3;

create view public.public_latest_announcements_preview
with (security_invoker = true)
as
select id, title, body, image_url, type, created_at
from public.announcements
where type = 'announcement'
order by created_at desc
limit 3;

-- =========================================================
-- 15) SECURITY HARDENING / RLS
-- Browser client uses the Render API. Render uses service_role.
-- No direct anon/authenticated table access is required.
-- =========================================================
alter table public.users enable row level security;
alter table public.verification_codes enable row level security;
alter table public.master_data_values enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.landing_content enable row level security;
alter table public.complaints enable row level security;
alter table public.requests enable row level security;
alter table public.request_timeline enable row level security;
alter table public.clearances enable row level security;
alter table public.id_pickup_slots enable row level security;
alter table public.id_requests enable row level security;
alter table public.census_households enable row level security;
alter table public.officials enable row level security;
alter table public.project_suggestions enable row level security;
alter table public.elections enable row level security;
alter table public.election_options enable row level security;
alter table public.votes enable row level security;
alter table public.project_completions enable row level security;
alter table public.fund_sources enable row level security;
alter table public.fund_projects enable row level security;
alter table public.announcements enable row level security;
alter table public.events enable row level security;
alter table public.borrowable_assets enable row level security;
alter table public.borrowing_requests enable row level security;

-- Explicitly prevent browser roles from bypassing the API by direct PostgREST table access.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- Service role / postgres retain complete access.
grant all on all tables in schema public to postgres, service_role;
grant all on all sequences in schema public to postgres, service_role;
grant all on all functions in schema public to postgres, service_role;

commit;

-- =========================================================
-- IMPORTANT AFTER RUNNING
-- =========================================================
-- This database is intentionally EMPTY.
-- There is NO admin, super-admin, resident, Purok, hotline, facility, item,
-- official, event, announcement, fund, census, election, request, or complaint data.
--
-- You MUST bootstrap your first real super_admin account before the Admin Portal
-- can be used. Do not put a plaintext password directly in users.password_hash.
-- Generate a bcrypt hash using the same application/bcryptjs flow first.
--
-- Then add REAL master-data values in Admin Settings, including actual Puroks,
-- official positions, administration terms, event categories, and concern categories.
