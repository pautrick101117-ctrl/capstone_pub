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
  verification_provider text not null default 'gmail_app_password',
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
  provider text not null default 'gmail_app_password',
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


-- =========================================================
-- DEMO DATA SEED
-- =========================================================

-- Barangay Iba Portal - V3.2 DEMO DATA SEED
-- Run AFTER server/supabase-full-reset.sql.
-- Creates 50 demo residents plus representative records for the major portal features.
-- Demo resident login pattern: resident01 ... resident50
-- Demo resident password (all accounts): Resident123
-- Existing admin remains: admin@gmail.com / Password123
-- Intended for demo/testing only. Do not run on a production database containing real resident data.

begin;

-- Compatibility fix for V3.1 databases that were reset before these option metadata columns were added.
alter table public.election_options
  add column if not exists source_suggestion_id uuid references public.project_suggestions(id) on delete set null;
alter table public.election_options
  add column if not exists image_url text;

-- Safety guard: this seed is intended for a clean/demo database.
do $$
begin
  if not exists (select 1 from public.users where lower(email) = 'admin@gmail.com' and role in ('admin','super_admin')) then
    raise exception 'Demo seed aborted: bootstrap admin admin@gmail.com was not found. Run supabase-full-reset.sql first.';
  end if;

  if exists (select 1 from public.users where role = 'resident') then
    raise exception 'Demo seed aborted: resident records already exist. Use a clean reset before loading this demo dataset.';
  end if;
end $$;

-- =========================================================
-- 1) CONTROLLED FORM OPTIONS / MASTER DATA
-- =========================================================
insert into public.master_data_values (category, value, label, sort_order, is_active) values
  ('purok', 'purok-1', 'Purok 1', 1, true),
  ('purok', 'purok-2', 'Purok 2', 2, true),
  ('purok', 'purok-3', 'Purok 3', 3, true),
  ('purok', 'purok-4', 'Purok 4', 4, true),
  ('purok', 'purok-5', 'Purok 5', 5, true),
  ('purok', 'purok-6', 'Purok 6', 6, true),

  ('administration_term', '2023-2026', '2023–2026', 1, true),
  ('administration_term', '2026-2029', '2026–2029', 2, true),

  ('concern_category', 'noise', 'Noise Complaint', 1, true),
  ('concern_category', 'garbage-sanitation', 'Garbage & Sanitation', 2, true),
  ('concern_category', 'drainage-flooding', 'Drainage & Flooding', 3, true),
  ('concern_category', 'streetlight', 'Streetlight', 4, true),
  ('concern_category', 'road-sidewalk', 'Road & Sidewalk', 5, true),
  ('concern_category', 'peace-order', 'Peace & Order', 6, true),
  ('concern_category', 'stray-animals', 'Stray Animals', 7, true),
  ('concern_category', 'public-facility', 'Public Facility', 8, true),
  ('concern_category', 'other', 'Other', 9, true),

  ('event_category', 'barangay-assembly', 'Barangay Assembly', 1, true),
  ('event_category', 'health', 'Health Program', 2, true),
  ('event_category', 'cleanup', 'Clean-Up Drive', 3, true),
  ('event_category', 'sports', 'Sports Activity', 4, true),
  ('event_category', 'youth', 'Youth Program', 5, true),
  ('event_category', 'senior-citizens', 'Senior Citizens Program', 6, true),
  ('event_category', 'disaster-preparedness', 'Disaster Preparedness', 7, true),
  ('event_category', 'education', 'Education Program', 8, true),

  ('official_position', 'punong-barangay', 'Punong Barangay', 1, true),
  ('official_position', 'barangay-kagawad', 'Barangay Kagawad', 2, true),
  ('official_position', 'sk-chairperson', 'SK Chairperson', 3, true),
  ('official_position', 'barangay-secretary', 'Barangay Secretary', 4, true),
  ('official_position', 'barangay-treasurer', 'Barangay Treasurer', 5, true),
  ('official_position', 'lupon-chairperson', 'Lupon Chairperson', 6, true);

-- =========================================================
-- 2) PORTAL CONTACT / HERO CONTENT
-- =========================================================
insert into public.landing_content (key_name, value) values
  ('hero', jsonb_build_object(
    'title', 'Barangay Iba Digital Services',
    'description', 'Access barangay services, community updates, project voting, concerns, and resource borrowing in one portal.'
  )),
  ('hotline', jsonb_build_object(
    'title', 'Barangay Iba Hotline',
    'phone', '0917 000 1234',
    'hours', '24/7 for urgent community concerns',
    'note', 'Demo contact information. Update this from Admin Portal > Settings.'
  )),
  ('contact', jsonb_build_object(
    'phone', '(046) 000-1234',
    'email', 'barangayiba.demo@gmail.com',
    'address', 'Barangay Iba, Silang, Cavite',
    'facebook', 'Barangay Iba Demo Page'
  ));

-- =========================================================
-- 3) 50 DEMO RESIDENTS
-- =========================================================
with demo_names as (
  select
    n,
    (array['Juan','Maria','Jose','Ana','Mark','Angelica','Carlo','Jessa','Paolo','Nicole','Ramon','Grace','Miguel','Elaine','Joshua','Camille','Daniel','Patricia','Christian','Leah'])[((n - 1) % 20) + 1] as first_name,
    (array['Dela Cruz','Santos','Reyes','Garcia','Mendoza','Bautista','Ramos','Flores','Gonzales','Villanueva','Castillo','Aquino','Navarro','Torres','Domingo','Mercado','Pascual','Cruz','Rivera','Fernandez','Soriano','Manalo','Aguilar'])[((n - 1) % 23) + 1] as last_name
  from generate_series(1, 50) as n
), demo_password as (
  select crypt('Resident123', gen_salt('bf', 12)) as password_hash
)
insert into public.users (
  first_name, middle_name, last_name, full_name,
  email, username, password_hash,
  address, purok, birthdate, contact_number,
  role, status, email_verified, email_verified_at,
  verification_provider, has_voted, must_change_password,
  is_active, created_at, updated_at
)
select
  d.first_name,
  '',
  d.last_name,
  d.first_name || ' ' || d.last_name,
  'resident' || lpad(d.n::text, 2, '0') || '@example.com',
  'resident' || lpad(d.n::text, 2, '0'),
  p.password_hash,
  'House ' || d.n || ', Barangay Iba, Silang, Cavite',
  'Purok ' || (((d.n - 1) % 6) + 1),
  date '1978-01-01' + ((d.n * 173) % 8000),
  '0917' || lpad(d.n::text, 7, '0'),
  'resident',
  'approved',
  true,
  now() - ((d.n % 80) || ' days')::interval,
  'demo_seed',
  false,
  false,
  true,
  now() - ((d.n % 120) || ' days')::interval,
  now() - ((d.n % 20) || ' days')::interval
from demo_names d
cross join demo_password p;

-- =========================================================
-- 4) CENSUS HOUSEHOLDS
-- =========================================================
insert into public.census_households (household_name, purok, members, house_number, status, updated_at, created_at)
select
  (array['Dela Cruz','Santos','Reyes','Garcia','Mendoza','Bautista','Ramos','Flores','Gonzales','Villanueva','Castillo','Aquino','Navarro','Torres','Domingo','Mercado','Pascual','Cruz','Rivera','Fernandez'])[n] || ' Household',
  'Purok ' || (((n - 1) % 6) + 1),
  2 + ((n * 3) % 6),
  'IBA-' || lpad(n::text, 3, '0'),
  case when n in (7, 14) then 'for update' else 'active' end,
  now() - ((n % 15) || ' days')::interval,
  now() - ((30 + n) || ' days')::interval
from generate_series(1, 20) as n;

-- =========================================================
-- 5) BARANGAY OFFICIALS
-- =========================================================
insert into public.officials (name, position, term, contact, status, is_active) values
  ('Roberto Villanueva', 'Punong Barangay', '2023–2026', '0918 100 0001', 'active', true),
  ('Lorna Santos', 'Barangay Kagawad', '2023–2026', '0918 100 0002', 'active', true),
  ('Edgar Mendoza', 'Barangay Kagawad', '2023–2026', '0918 100 0003', 'active', true),
  ('Marites Reyes', 'Barangay Kagawad', '2023–2026', '0918 100 0004', 'active', true),
  ('Nestor Garcia', 'Barangay Kagawad', '2023–2026', '0918 100 0005', 'active', true),
  ('Janine Flores', 'SK Chairperson', '2023–2026', '0918 100 0006', 'active', true),
  ('Alma Navarro', 'Barangay Secretary', '2023–2026', '0918 100 0007', 'active', true),
  ('Romeo Bautista', 'Barangay Treasurer', '2023–2026', '0918 100 0008', 'active', true);

-- =========================================================
-- 6) NEWS / ANNOUNCEMENTS / EVENTS
-- =========================================================
insert into public.announcements (title, body, type, created_at) values
  ('Road Drainage Maintenance Completed', 'Drainage clearing and maintenance along the main barangay road has been completed. Residents are encouraged to keep drainage areas free from household waste.', 'news', now() - interval '2 days'),
  ('Community Garden Program Starts', 'The barangay has started a community garden project with volunteers from different puroks.', 'news', now() - interval '5 days'),
  ('Senior Citizens Health Check Conducted', 'Free blood pressure, blood sugar, and basic health screening services were provided to senior residents.', 'news', now() - interval '9 days'),
  ('Youth Basketball League Opens', 'The inter-purok youth basketball league officially opened at the covered court.', 'news', now() - interval '14 days'),
  ('New LED Streetlights Installed', 'Additional LED streetlights were installed in identified low-light areas of Purok 4 and Purok 5.', 'news', now() - interval '20 days'),
  ('Barangay Clean-Up Drive Successful', 'Residents and volunteers participated in the monthly clean-up drive across community roads and common areas.', 'news', now() - interval '27 days'),

  ('Scheduled Water Interruption Advisory', 'Residents are advised of a scheduled water interruption from 9:00 AM to 2:00 PM for maintenance work.', 'announcement', now() - interval '1 day'),
  ('Barangay Assembly Notice', 'All registered residents are invited to the upcoming Barangay Assembly. Community updates and ongoing projects will be discussed.', 'announcement', now() - interval '3 days'),
  ('ID Pickup Schedule Reminder', 'Residents with confirmed Barangay ID requests should bring one valid identification document when claiming their ID.', 'announcement', now() - interval '6 days'),
  ('Waste Collection Schedule Update', 'Waste collection for Purok 1 to Purok 3 will be every Tuesday and Friday. Purok 4 to Purok 6 will be every Wednesday and Saturday.', 'announcement', now() - interval '10 days'),
  ('Free Anti-Rabies Vaccination', 'Pet owners may register their dogs and cats for the barangay anti-rabies vaccination activity.', 'announcement', now() - interval '15 days'),
  ('Emergency Preparedness Orientation', 'Household representatives are invited to attend the disaster preparedness orientation at the multipurpose hall.', 'announcement', now() - interval '21 days');

insert into public.events (title, date, time, location, description, type) values
  ('Barangay General Assembly', current_date + 5, time '09:00', 'Barangay Covered Court', 'Quarterly barangay assembly covering community programs, projects, and resident concerns.', 'Barangay Assembly'),
  ('Medical Mission', current_date + 8, time '08:00', 'Barangay Health Center', 'Free consultation, blood pressure checks, and basic medicines while supplies last.', 'Health Program'),
  ('Community Clean-Up Drive', current_date + 12, time '06:30', 'Barangay Hall Grounds', 'Monthly clean-up activity. Volunteers are encouraged to bring gloves and reusable water containers.', 'Clean-Up Drive'),
  ('Inter-Purok Basketball Finals', current_date + 16, time '16:00', 'Barangay Covered Court', 'Championship games for the youth inter-purok basketball league.', 'Sports Activity'),
  ('Youth Leadership Workshop', current_date + 21, time '13:00', 'Multipurpose Hall', 'Leadership and community participation workshop for residents aged 18 to 25.', 'Youth Program'),
  ('Earthquake Preparedness Drill', current_date + 28, time '10:00', 'Barangay Hall Grounds', 'Community earthquake response orientation and evacuation drill.', 'Disaster Preparedness');

-- =========================================================
-- 7) FUND TRANSPARENCY
-- =========================================================
insert into public.fund_sources (name, term, allocated_amount, created_at) values
  ('Annual Barangay Development Fund', '2023–2026', 4500000.00, now() - interval '300 days'),
  ('General Fund', '2023–2026', 2500000.00, now() - interval '250 days'),
  ('SK Fund', '2023–2026', 800000.00, now() - interval '200 days'),
  ('Disaster Risk Reduction Fund', '2023–2026', 1200000.00, now() - interval '180 days');

insert into public.fund_projects (name, date, amount, description, term, status) values
  ('Drainage Rehabilitation - Purok 2', current_date - 120, 850000.00, 'Repair and improvement of drainage sections prone to flooding.', '2023–2026', 'completed'),
  ('LED Streetlight Expansion', current_date - 90, 420000.00, 'Installation of energy-efficient streetlights in identified dark areas.', '2023–2026', 'completed'),
  ('Covered Court Roof Repair', current_date - 65, 575000.00, 'Roofing and drainage repair for the barangay covered court.', '2023–2026', 'completed'),
  ('Health Center Equipment Upgrade', current_date - 40, 310000.00, 'Purchase of basic health monitoring and emergency equipment.', '2023–2026', 'ongoing'),
  ('Emergency Response Supplies', current_date - 25, 260000.00, 'Procurement of flashlights, first-aid supplies, rescue ropes, and emergency kits.', '2023–2026', 'ongoing'),
  ('Youth Sports Development Program', current_date - 18, 180000.00, 'Sports equipment and league support for youth activities.', '2023–2026', 'ongoing'),
  ('Public Wi-Fi Pilot', current_date - 12, 145000.00, 'Pilot public Wi-Fi access around the barangay hall and covered court.', '2023–2026', 'ongoing'),
  ('Old Waiting Shed Renovation', current_date - 150, 95000.00, 'Proposed renovation cancelled after structural reassessment.', '2023–2026', 'cancelled');

-- =========================================================
-- 8) COMMUNITY CONCERNS
-- =========================================================
insert into public.complaints (user_id, resident_name, complaint_type, details, status, admin_note, created_at, updated_at) values
  ((select id from public.users where username='resident03'), (select full_name from public.users where username='resident03'), 'Drainage & Flooding', 'Drainage near House 3 overflows after heavy rain.', 'in_review', 'Site inspection scheduled this week.', now() - interval '5 days', now() - interval '1 day'),
  ((select id from public.users where username='resident07'), (select full_name from public.users where username='resident07'), 'Streetlight', 'Streetlight near the corner of Purok 1 has not been working for several nights.', 'resolved', 'Bulb and photocell were replaced.', now() - interval '12 days', now() - interval '3 days'),
  ((select id from public.users where username='resident11'), (select full_name from public.users where username='resident11'), 'Garbage & Sanitation', 'Uncollected garbage was left beside the common collection area.', 'pending', '', now() - interval '1 day', now() - interval '1 day'),
  ((select id from public.users where username='resident14'), (select full_name from public.users where username='resident14'), 'Noise Complaint', 'Loud karaoke continued past midnight on a weekday.', 'in_review', 'Barangay patrol was informed for monitoring.', now() - interval '4 days', now() - interval '2 days'),
  ((select id from public.users where username='resident18'), (select full_name from public.users where username='resident18'), 'Road & Sidewalk', 'Small pothole is getting larger near the Purok 6 entrance.', 'pending', '', now() - interval '2 days', now() - interval '2 days'),
  ((select id from public.users where username='resident22'), (select full_name from public.users where username='resident22'), 'Stray Animals', 'Several stray dogs are staying near the elementary school gate.', 'resolved', 'Animals were coordinated with the municipal veterinary team.', now() - interval '16 days', now() - interval '8 days'),
  ((select id from public.users where username='resident27'), (select full_name from public.users where username='resident27'), 'Public Facility', 'One comfort room faucet at the covered court is leaking.', 'in_review', 'Maintenance personnel assigned.', now() - interval '7 days', now() - interval '1 day'),
  ((select id from public.users where username='resident31'), (select full_name from public.users where username='resident31'), 'Peace & Order', 'Motorcycles have been speeding along the inner road at night.', 'pending', '', now() - interval '3 days', now() - interval '3 days'),
  ((select id from public.users where username='resident38'), (select full_name from public.users where username='resident38'), 'Garbage & Sanitation', 'Requesting additional waste bins near the basketball court.', 'resolved', 'Two temporary waste bins were placed in the area.', now() - interval '20 days', now() - interval '10 days'),
  ((select id from public.users where username='resident45'), (select full_name from public.users where username='resident45'), 'Other', 'Request to repaint faded pedestrian crossing markings near the barangay hall.', 'pending', '', now() - interval '1 day', now() - interval '1 day');

-- =========================================================
-- 9) DOCUMENT / SERVICE REQUESTS + TIMELINE
-- =========================================================
insert into public.requests (user_id, resident_name, request_type, details, status, admin_note, preferred_schedule_date, preferred_time_slot, created_at, updated_at) values
  ((select id from public.users where username='resident01'), (select full_name from public.users where username='resident01'), 'Barangay Clearance', 'Employment requirement.', 'submitted', '', current_date + 2, '09:00 AM - 10:00 AM', now() - interval '1 day', now() - interval '1 day'),
  ((select id from public.users where username='resident02'), (select full_name from public.users where username='resident02'), 'Certificate of Residency', 'Bank account requirement.', 'acknowledged', 'Request received and under verification.', current_date + 2, '10:00 AM - 11:00 AM', now() - interval '3 days', now() - interval '2 days'),
  ((select id from public.users where username='resident04'), (select full_name from public.users where username='resident04'), 'Certificate of Indigency', 'Educational assistance application.', 'processing', 'Supporting details are being reviewed.', current_date + 3, '01:00 PM - 02:00 PM', now() - interval '4 days', now() - interval '1 day'),
  ((select id from public.users where username='resident05'), (select full_name from public.users where username='resident05'), 'Barangay Clearance', 'Local employment requirement.', 'completed', 'Ready for download/claiming.', current_date - 1, '09:00 AM - 10:00 AM', now() - interval '9 days', now() - interval '2 days'),
  ((select id from public.users where username='resident08'), (select full_name from public.users where username='resident08'), 'Certificate of Residency', 'School enrollment.', 'completed', 'Completed.', current_date - 2, '11:00 AM - 12:00 PM', now() - interval '12 days', now() - interval '3 days'),
  ((select id from public.users where username='resident10'), (select full_name from public.users where username='resident10'), 'Barangay Clearance', 'Business permit supporting document.', 'processing', 'Clearance verification in progress.', current_date + 1, '02:00 PM - 03:00 PM', now() - interval '5 days', now() - interval '1 day'),
  ((select id from public.users where username='resident13'), (select full_name from public.users where username='resident13'), 'Certificate of Indigency', 'Medical assistance.', 'submitted', '', current_date + 4, '09:00 AM - 10:00 AM', now() - interval '1 day', now() - interval '1 day'),
  ((select id from public.users where username='resident16'), (select full_name from public.users where username='resident16'), 'Barangay Clearance', 'Government transaction.', 'acknowledged', 'Identity verified.', current_date + 2, '03:00 PM - 04:00 PM', now() - interval '3 days', now() - interval '2 days'),
  ((select id from public.users where username='resident19'), (select full_name from public.users where username='resident19'), 'Certificate of Residency', 'Utility application.', 'completed', 'Completed.', current_date - 5, '09:00 AM - 10:00 AM', now() - interval '14 days', now() - interval '6 days'),
  ((select id from public.users where username='resident23'), (select full_name from public.users where username='resident23'), 'Certificate of Indigency', 'Scholarship application.', 'processing', 'Application being processed.', current_date + 5, '10:00 AM - 11:00 AM', now() - interval '6 days', now() - interval '1 day'),
  ((select id from public.users where username='resident29'), (select full_name from public.users where username='resident29'), 'Barangay Clearance', 'Employment requirement.', 'submitted', '', current_date + 3, '01:00 PM - 02:00 PM', now() - interval '2 days', now() - interval '2 days'),
  ((select id from public.users where username='resident34'), (select full_name from public.users where username='resident34'), 'Certificate of Residency', 'Proof of residence.', 'acknowledged', 'Address verification complete.', current_date + 4, '02:00 PM - 03:00 PM', now() - interval '4 days', now() - interval '2 days'),
  ((select id from public.users where username='resident39'), (select full_name from public.users where username='resident39'), 'Barangay Clearance', 'Loan documentation.', 'completed', 'Completed.', current_date - 4, '10:00 AM - 11:00 AM', now() - interval '11 days', now() - interval '4 days'),
  ((select id from public.users where username='resident43'), (select full_name from public.users where username='resident43'), 'Certificate of Indigency', 'Medical assistance.', 'processing', 'Final review ongoing.', current_date + 2, '11:00 AM - 12:00 PM', now() - interval '7 days', now() - interval '1 day'),
  ((select id from public.users where username='resident48'), (select full_name from public.users where username='resident48'), 'Certificate of Residency', 'School documentation.', 'submitted', '', current_date + 5, '03:00 PM - 04:00 PM', now() - interval '1 day', now() - interval '1 day');

-- Every request gets the original submission event.
insert into public.request_timeline (request_id, status, note, created_at)
select id, 'submitted', 'Request submitted by resident.', created_at
from public.requests;

insert into public.request_timeline (request_id, status, note, created_at)
select id, 'acknowledged', 'Barangay staff acknowledged the request.', created_at + interval '1 day'
from public.requests where status in ('acknowledged','processing','completed');

insert into public.request_timeline (request_id, status, note, created_at)
select id, 'processing', 'Request moved to processing.', created_at + interval '2 days'
from public.requests where status in ('processing','completed');

insert into public.request_timeline (request_id, status, note, created_at)
select id, 'completed', 'Request completed.', updated_at
from public.requests where status = 'completed';

insert into public.clearances (resident_name, type, request_date, issued_date, status, notes)
select resident_name, 'Barangay Clearance', created_at::date, updated_at::date, 'issued', 'Generated from completed demo request.'
from public.requests
where request_type = 'Barangay Clearance' and status = 'completed';

-- =========================================================
-- 10) BARANGAY ID PICKUP SLOTS / REQUESTS
-- =========================================================
insert into public.id_pickup_slots (slot_date, time_slot, capacity, is_active) values
  (current_date + 2, '09:00 AM - 10:00 AM', 8, true),
  (current_date + 2, '10:00 AM - 11:00 AM', 8, true),
  (current_date + 3, '01:00 PM - 02:00 PM', 8, true),
  (current_date + 3, '02:00 PM - 03:00 PM', 8, true),
  (current_date + 5, '09:00 AM - 10:00 AM', 10, true),
  (current_date + 5, '10:00 AM - 11:00 AM', 10, true);

insert into public.id_requests (user_id, purpose, preferred_date, time_slot, status, admin_note, created_at) values
  ((select id from public.users where username='resident06'), 'Primary barangay identification', current_date + 2, '09:00 AM - 10:00 AM', 'submitted', '', now() - interval '1 day'),
  ((select id from public.users where username='resident09'), 'Proof of barangay residency', current_date + 2, '10:00 AM - 11:00 AM', 'confirmed', 'Bring one valid ID when claiming.', now() - interval '3 days'),
  ((select id from public.users where username='resident12'), 'Local government transactions', current_date + 3, '01:00 PM - 02:00 PM', 'confirmed', 'Schedule confirmed.', now() - interval '4 days'),
  ((select id from public.users where username='resident15'), 'Resident identification', current_date + 5, '09:00 AM - 10:00 AM', 'rescheduled', 'Moved to the next available pickup date.', now() - interval '7 days'),
  ((select id from public.users where username='resident20'), 'Barangay services', current_date - 2, '09:00 AM - 10:00 AM', 'completed', 'ID claimed.', now() - interval '12 days'),
  ((select id from public.users where username='resident24'), 'Resident identification', current_date + 3, '02:00 PM - 03:00 PM', 'submitted', '', now() - interval '1 day'),
  ((select id from public.users where username='resident30'), 'Proof of residence', current_date + 5, '10:00 AM - 11:00 AM', 'confirmed', 'Schedule confirmed.', now() - interval '5 days'),
  ((select id from public.users where username='resident35'), 'Personal identification', current_date - 5, '10:00 AM - 11:00 AM', 'completed', 'ID claimed.', now() - interval '15 days'),
  ((select id from public.users where username='resident41'), 'Barangay transactions', current_date + 5, '09:00 AM - 10:00 AM', 'cancelled', 'Cancelled at resident request.', now() - interval '4 days'),
  ((select id from public.users where username='resident47'), 'Resident identification', current_date + 2, '09:00 AM - 10:00 AM', 'submitted', '', now() - interval '1 day');

-- =========================================================
-- 11) PROJECT SUGGESTIONS
-- =========================================================
insert into public.project_suggestions (user_id, title, description, status, created_at) values
  ((select id from public.users where username='resident02'), 'Solar Streetlights for Purok 5', 'Install solar-powered streetlights in darker portions of Purok 5.', 'approved', now() - interval '35 days'),
  ((select id from public.users where username='resident06'), 'Drainage Improvement at Purok 2', 'Improve drainage capacity near the low-lying residential section.', 'approved', now() - interval '33 days'),
  ((select id from public.users where username='resident09'), 'Covered Court Ventilation Upgrade', 'Add industrial fans and improve ventilation around the covered court.', 'approved', now() - interval '31 days'),
  ((select id from public.users where username='resident17'), 'Community Reading Corner', 'Create a small reading and study corner near the barangay hall.', 'approved', now() - interval '29 days'),
  ((select id from public.users where username='resident21'), 'Additional CCTV Cameras', 'Install CCTV cameras at selected high-traffic community intersections.', 'approved', now() - interval '27 days'),
  ((select id from public.users where username='resident26'), 'Public Water Refill Station', 'Provide a safe drinking water refill point near the covered court.', 'approved', now() - interval '25 days'),
  ((select id from public.users where username='resident28'), 'Senior Citizen Waiting Area', 'Create a shaded waiting area near the barangay health center.', 'pending', now() - interval '12 days'),
  ((select id from public.users where username='resident33'), 'Bike Parking Racks', 'Install bicycle parking racks around the barangay hall.', 'pending', now() - interval '9 days'),
  ((select id from public.users where username='resident37'), 'Community Composting Area', 'Create a managed composting area for biodegradable community waste.', 'pending', now() - interval '7 days'),
  ((select id from public.users where username='resident42'), 'Pedestrian Crossing Signs', 'Improve visible warning signs near school and barangay hall crossings.', 'pending', now() - interval '4 days'),
  ((select id from public.users where username='resident44'), 'Private Street Gate', 'Install a gate limiting access to a private street.', 'rejected', now() - interval '20 days'),
  ((select id from public.users where username='resident50'), 'Personal Parking Shed', 'Construct a parking shed beside a private residence.', 'rejected', now() - interval '18 days');

-- =========================================================
-- 12) COMMUNITY PROJECT VOTING - LIVE + CLOSED DEMOS
-- =========================================================
insert into public.elections (title, description, status, starts_at, ends_at, source_suggestion_id, created_at) values
  ('Community Project Voting - September', 'Choose the approved community improvement you want the barangay to prioritize next.', 'live', now() - interval '1 day', now() + interval '7 days', (select id from public.project_suggestions where title='Solar Streetlights for Purok 5'), now() - interval '2 days'),
  ('Community Project Voting - Previous Round', 'Completed community priority voting round for previously approved project proposals.', 'closed', now() - interval '35 days', now() - interval '25 days', (select id from public.project_suggestions where title='Drainage Improvement at Purok 2'), now() - interval '36 days');

insert into public.election_options (election_id, name, description, source_suggestion_id, votes_count)
select e.id, s.title, s.description, s.id, 0
from public.elections e
join public.project_suggestions s on s.title in (
  'Solar Streetlights for Purok 5',
  'Covered Court Ventilation Upgrade',
  'Community Reading Corner',
  'Additional CCTV Cameras'
)
where e.title = 'Community Project Voting - September';

insert into public.election_options (election_id, name, description, source_suggestion_id, votes_count)
select e.id, s.title, s.description, s.id, 0
from public.elections e
join public.project_suggestions s on s.title in (
  'Drainage Improvement at Purok 2',
  'Public Water Refill Station',
  'Solar Streetlights for Purok 5'
)
where e.title = 'Community Project Voting - Previous Round';

-- 18 votes in the live election. resident01 intentionally has NOT voted so it can be used for testing.
with live_election as (
  select id from public.elections where title='Community Project Voting - September'
), voters as (
  select n, (select id from public.users where username='resident' || lpad(n::text,2,'0')) as user_id
  from generate_series(2,19) n
)
insert into public.votes (election_id, option_id, user_id, created_at)
select
  le.id,
  case
    when v.n between 2 and 9 then (select id from public.election_options where election_id=le.id and name='Solar Streetlights for Purok 5')
    when v.n between 10 and 15 then (select id from public.election_options where election_id=le.id and name='Covered Court Ventilation Upgrade')
    else (select id from public.election_options where election_id=le.id and name='Community Reading Corner')
  end,
  v.user_id,
  now() - ((20 - v.n) || ' hours')::interval
from live_election le cross join voters v;

-- 30 votes in the closed election.
with closed_election as (
  select id from public.elections where title='Community Project Voting - Previous Round'
), voters as (
  select n, (select id from public.users where username='resident' || lpad(n::text,2,'0')) as user_id
  from generate_series(1,30) n
)
insert into public.votes (election_id, option_id, user_id, created_at)
select
  ce.id,
  case
    when v.n <= 15 then (select id from public.election_options where election_id=ce.id and name='Drainage Improvement at Purok 2')
    when v.n <= 24 then (select id from public.election_options where election_id=ce.id and name='Public Water Refill Station')
    else (select id from public.election_options where election_id=ce.id and name='Solar Streetlights for Purok 5')
  end,
  v.user_id,
  now() - ((25 + (v.n % 7)) || ' days')::interval
from closed_election ce cross join voters v;

-- Synchronize cached vote counts.
update public.election_options eo
set votes_count = (
  select count(*) from public.votes v where v.option_id = eo.id
);

update public.users u
set has_voted = exists (select 1 from public.votes v where v.user_id = u.id),
    updated_at = now()
where u.role = 'resident';

insert into public.project_completions (election_id, user_id, created_at)
select e.id, u.id, now() - interval '10 days'
from public.elections e
join public.users u on u.username in ('resident01','resident02','resident03','resident04','resident05','resident06','resident07','resident08','resident09','resident10','resident11','resident12')
where e.title='Community Project Voting - Previous Round';

-- =========================================================
-- 13) BORROWABLE FACILITIES & ITEMS
-- =========================================================
insert into public.borrowable_assets (name, category, description, total_quantity, is_active) values
  ('Covered Court', 'facility', 'Barangay covered court for approved community and private activities.', 1, true),
  ('Multipurpose Hall', 'facility', 'Indoor multipurpose room for meetings, seminars, and small community activities.', 1, true),
  ('Event Tent', 'item', 'Large event tents available by quantity.', 6, true),
  ('Monobloc Chairs', 'item', 'Plastic chairs for approved resident and barangay activities.', 200, true),
  ('Folding Tables', 'item', 'Folding tables for meetings and community events.', 30, true),
  ('Sound System', 'item', 'Portable PA sound system set.', 2, true),
  ('Projector', 'item', 'Portable projector for presentations and community programs.', 2, true);

insert into public.borrowing_requests (
  user_id, asset_id, quantity, purpose, event_location, start_at, due_at,
  status, admin_note, terms_accepted_at, approved_by, approved_at,
  borrowed_at, returned_at, returned_quantity, return_condition, return_note,
  created_at, updated_at
) values
  ((select id from public.users where username='resident01'), (select id from public.borrowable_assets where name='Covered Court'), 1, 'Family gathering', 'Barangay Covered Court', now() + interval '3 days', now() + interval '3 days 8 hours', 'pending', '', now(), null, null, null, null, null, null, '', now() - interval '1 day', now() - interval '1 day'),
  ((select id from public.users where username='resident05'), (select id from public.borrowable_assets where name='Monobloc Chairs'), 50, 'Birthday celebration', 'Purok 5 residence', now() + interval '5 days', now() + interval '5 days 10 hours', 'approved', 'Approved for pickup one hour before the event.', now() - interval '2 days', (select id from public.users where email='admin@gmail.com'), now() - interval '1 day', null, null, null, null, '', now() - interval '3 days', now() - interval '1 day'),
  ((select id from public.users where username='resident08'), (select id from public.borrowable_assets where name='Event Tent'), 2, 'Family reunion', 'Purok 2 open area', now() + interval '7 days', now() + interval '8 days', 'approved', 'Please coordinate pickup at the barangay hall.', now() - interval '3 days', (select id from public.users where email='admin@gmail.com'), now() - interval '2 days', null, null, null, null, '', now() - interval '4 days', now() - interval '2 days'),
  ((select id from public.users where username='resident12'), (select id from public.borrowable_assets where name='Folding Tables'), 8, 'Community study session', 'Purok 6 common area', now() - interval '4 hours', now() + interval '6 hours', 'borrowed', 'Released this morning.', now() - interval '2 days', (select id from public.users where email='admin@gmail.com'), now() - interval '1 day', now() - interval '4 hours', null, null, null, '', now() - interval '3 days', now() - interval '4 hours'),
  ((select id from public.users where username='resident16'), (select id from public.borrowable_assets where name='Sound System'), 1, 'Community meeting', 'Purok 4 meeting area', now() - interval '2 days', now() - interval '1 day', 'borrowed', 'Past return deadline - follow-up required.', now() - interval '5 days', (select id from public.users where email='admin@gmail.com'), now() - interval '4 days', now() - interval '2 days', null, null, null, '', now() - interval '6 days', now() - interval '1 day'),
  ((select id from public.users where username='resident20'), (select id from public.borrowable_assets where name='Monobloc Chairs'), 30, 'Wake assistance', 'Purok 2 residence', now() - interval '12 days', now() - interval '11 days', 'returned', 'Completed.', now() - interval '15 days', (select id from public.users where email='admin@gmail.com'), now() - interval '14 days', now() - interval '12 days', now() - interval '11 days', 30, 'good', 'All chairs returned in good condition.', now() - interval '16 days', now() - interval '11 days'),
  ((select id from public.users where username='resident25'), (select id from public.borrowable_assets where name='Folding Tables'), 5, 'Graduation celebration', 'Purok 1 residence', now() - interval '18 days', now() - interval '17 days', 'returned', 'Completed with minor damage noted.', now() - interval '21 days', (select id from public.users where email='admin@gmail.com'), now() - interval '20 days', now() - interval '18 days', now() - interval '17 days', 5, 'minor_damage', 'One table has a loose folding leg and was moved for maintenance.', now() - interval '22 days', now() - interval '17 days'),
  ((select id from public.users where username='resident29'), (select id from public.borrowable_assets where name='Projector'), 1, 'School presentation', 'Purok 5 learning session', now() + interval '9 days', now() + interval '9 days 6 hours', 'rejected', 'Projector is reserved for a barangay training on the same date.', now() - interval '2 days', null, null, null, null, null, null, null, '', now() - interval '3 days', now() - interval '2 days'),
  ((select id from public.users where username='resident33'), (select id from public.borrowable_assets where name='Multipurpose Hall'), 1, 'Homeowners meeting', 'Barangay Multipurpose Hall', now() + interval '10 days', now() + interval '10 days 4 hours', 'pending', '', now() - interval '1 day', null, null, null, null, null, null, null, '', now() - interval '1 day', now() - interval '1 day'),
  ((select id from public.users where username='resident36'), (select id from public.borrowable_assets where name='Event Tent'), 1, 'Birthday celebration', 'Purok 6 residence', now() + interval '12 days', now() + interval '13 days', 'cancelled', 'Cancelled by resident.', now() - interval '5 days', null, null, null, null, null, null, null, '', now() - interval '6 days', now() - interval '2 days'),
  ((select id from public.users where username='resident40'), (select id from public.borrowable_assets where name='Monobloc Chairs'), 80, 'Wedding reception', 'Purok 4 event area', now() + interval '15 days', now() + interval '16 days', 'approved', 'Approved. Confirm pickup details one day before.', now() - interval '5 days', (select id from public.users where email='admin@gmail.com'), now() - interval '3 days', null, null, null, null, '', now() - interval '7 days', now() - interval '3 days'),
  ((select id from public.users where username='resident46'), (select id from public.borrowable_assets where name='Folding Tables'), 10, 'Family gathering', 'Purok 4 residence', now() + interval '18 days', now() + interval '19 days', 'pending', '', now(), null, null, null, null, null, null, null, '', now(), now());

-- =========================================================
-- 14) NOTIFICATIONS / AUDIT TRAIL
-- =========================================================
insert into public.notifications (user_id, title, body, kind, broadcast, is_read, created_at) values
  (null, 'Barangay Assembly', 'The next Barangay General Assembly is scheduled soon. Check the Calendar for details.', 'info', true, false, now() - interval '1 day'),
  (null, 'Community Portal Demo', 'Demo records are currently loaded for system testing and presentation.', 'info', true, false, now()),
  ((select id from public.users where username='resident05'), 'Borrowing request approved', 'Your request for 50 Monobloc Chairs has been approved.', 'success', false, false, now() - interval '1 day'),
  ((select id from public.users where username='resident07'), 'Community concern resolved', 'Your Streetlight concern has been marked resolved.', 'success', false, true, now() - interval '3 days'),
  ((select id from public.users where username='resident10'), 'Request status updated', 'Your Barangay Clearance request is now processing.', 'info', false, false, now() - interval '1 day'),
  ((select id from public.users where username='resident16'), 'Borrowed resource overdue', 'The Sound System is past its expected return time. Please coordinate with the barangay office.', 'warning', false, false, now()),
  ((select id from public.users where username='resident20'), 'Borrowing completed', 'Your Monobloc Chairs borrowing transaction has been completed.', 'success', false, true, now() - interval '11 days'),
  ((select id from public.users where username='resident30'), 'Barangay ID schedule confirmed', 'Your Barangay ID pickup schedule has been confirmed.', 'success', false, false, now() - interval '2 days'),
  ((select id from public.users where username='resident02'), 'Project suggestion approved', 'Your project suggestion is approved for barangay consideration.', 'success', false, true, now() - interval '20 days'),
  ((select id from public.users where username='resident44'), 'Project suggestion reviewed', 'Your project suggestion was not approved for community voting.', 'warning', false, false, now() - interval '15 days');

insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, details, created_at)
select
  (select id from public.users where email='admin@gmail.com'),
  'admin',
  action,
  entity_type,
  entity_id,
  details,
  created_at
from (values
  ('demo_seed_loaded', 'system', 'demo-data', '{"residents":50}'::jsonb, now()),
  ('approve_borrowing_request', 'borrowing_request', 'demo-approved-request', '{"resource":"Monobloc Chairs"}'::jsonb, now() - interval '1 day'),
  ('resolve_community_concern', 'complaint', 'demo-concern', '{"status":"resolved"}'::jsonb, now() - interval '3 days'),
  ('update_request', 'request', 'demo-request', '{"status":"processing"}'::jsonb, now() - interval '1 day'),
  ('publish_election', 'election', 'demo-live-election', '{"status":"live"}'::jsonb, now() - interval '2 days')
) as demo(action, entity_type, entity_id, details, created_at);

commit;
