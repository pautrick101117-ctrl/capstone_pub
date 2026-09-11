create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  middle_name text default '',
  last_name text not null,
  email text not null unique,
  password_hash text not null,
  address text default '',
  contact_number text default '',
  valid_id_url text,
  role text not null default 'resident' check (role in ('resident', 'admin', 'super_admin')),
  status text not null default 'pending',
  email_verified boolean not null default false,
  email_verified_at timestamptz,
  verification_provider text default 'resend',
  has_voted boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists verification_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code text not null,
  code_hash text,
  attempt_count integer not null default 0,
  sent_to text,
  provider text not null default 'resend',
  method text not null default 'email',
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

alter table users add column if not exists email_verified_at timestamptz;
alter table users add column if not exists verification_provider text default 'resend';
alter table verification_codes add column if not exists code_hash text;
alter table verification_codes add column if not exists attempt_count integer not null default 0;
alter table verification_codes add column if not exists sent_to text;
alter table verification_codes add column if not exists provider text default 'resend';
alter table verification_codes add column if not exists method text default 'email';
alter table verification_codes add column if not exists sent_at timestamptz not null default now();
alter table verification_codes add column if not exists verified_at timestamptz;

update users set role = 'admin' where role = 'staff';
update users set role = 'resident' where role not in ('resident', 'admin', 'super_admin');
update users set role = 'super_admin' where lower(email) = 'superadmin@barangay-iba.gov.ph';

alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in ('resident', 'admin', 'super_admin'));

create table if not exists elections (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  status text not null default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists election_options (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references elections(id) on delete cascade,
  name text not null,
  description text default '',
  votes_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references elections(id) on delete cascade,
  option_id uuid not null references election_options(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (election_id, user_id)
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  title text not null,
  body text not null,
  kind text not null default 'info',
  broadcast boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists landing_content (
  key_name text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists complaints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  resident_name text not null,
  complaint_type text not null,
  details text default '',
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table complaints add column if not exists details text default '';
alter table complaints add column if not exists user_id uuid references users(id) on delete set null;

create table if not exists officials (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position text not null,
  term text not null default '2023-2026',
  contact text default '',
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists clearances (
  id uuid primary key default gen_random_uuid(),
  resident_name text not null,
  type text not null,
  request_date date not null default current_date,
  issued_date date,
  status text not null default 'pending',
  notes text default '',
  created_at timestamptz not null default now()
);

create table if not exists census_households (
  id uuid primary key default gen_random_uuid(),
  household_name text not null,
  purok text not null,
  members integer not null default 1 check (members >= 1),
  house_number text not null,
  status text not null default 'active',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);





-- =========================================================
-- Barangay Iba Portal System feature expansion migration
-- Safe to run in Supabase SQL Editor after the base schema.
-- =========================================================

alter table users alter column email drop not null;

alter table users add column if not exists full_name text;
alter table users add column if not exists purok text default '';
alter table users add column if not exists birthdate date;
alter table users add column if not exists username text;
alter table users add column if not exists must_change_password boolean not null default true;
alter table users add column if not exists is_active boolean not null default true;
alter table users add column if not exists updated_at timestamptz not null default now();

update users
set full_name = trim(concat_ws(' ', first_name, nullif(middle_name, ''), last_name))
where full_name is null;

update users
set username = lower(
  regexp_replace(
    concat_ws('.', first_name, last_name, left(id::text, 6)),
    '[^a-zA-Z0-9\.]+',
    '',
    'g'
  )
)
where username is null;

create unique index if not exists users_username_unique_idx on users (lower(username));
create index if not exists users_role_idx on users (role);

-- Initial administrator requested for this deployment. No mock/demo records are seeded.
insert into users (
  first_name, last_name, full_name, email, username, password_hash,
  role, status, email_verified, email_verified_at, must_change_password, is_active
) values (
  'System', 'Administrator', 'System Administrator', 'admin@gmail.com', 'admin', '$2b$12$um1OPS7mXR.EXp6i6Q0CF.Xv4Hn.LC0TzfdJN/qd7QjaGsKs2a37a',
  'admin', 'approved', true, now(), false, true
)
on conflict (email) do nothing;
create index if not exists users_is_active_idx on users (is_active);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_birthdate_adult_check'
  ) then
    alter table users
    add constraint users_birthdate_adult_check
    check (birthdate is null or birthdate <= (current_date - interval '18 years'));
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'complaints'
  ) and not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'requests'
  ) then
    alter table complaints rename to requests;
  end if;
end $$;

create table if not exists complaints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  resident_name text not null,
  complaint_type text not null,
  details text default '',
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'requests'
      and column_name = 'complaint_type'
  ) then
    alter table requests rename column complaint_type to request_type;
  end if;
end $$;

alter table requests alter column status set default 'submitted';
alter table requests add column if not exists admin_note text default '';
alter table requests add column if not exists preferred_schedule_date date;
alter table requests add column if not exists preferred_time_slot text;
alter table requests add column if not exists updated_at timestamptz not null default now();

update requests
set status = case
  when status = 'pending' then 'submitted'
  when status = 'resolved' then 'completed'
  else status
end;

create index if not exists requests_user_id_idx on requests (user_id);
create index if not exists requests_type_idx on requests (request_type);
create index if not exists requests_status_idx on requests (status);

create table if not exists request_timeline (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  status text not null,
  note text default '',
  created_at timestamptz not null default now()
);

create index if not exists request_timeline_request_id_idx on request_timeline (request_id, created_at);

update census_households set members = 1 where members < 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'census_households_members_positive_check'
  ) then
    alter table census_households
    add constraint census_households_members_positive_check
    check (members >= 1);
  end if;
end $$;

create index if not exists census_households_house_number_idx on census_households (lower(house_number));

create table if not exists project_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  description text not null,
  image_url text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table project_suggestions add column if not exists image_url text;

create index if not exists project_suggestions_user_id_idx on project_suggestions (user_id);
create index if not exists project_suggestions_status_idx on project_suggestions (status);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_suggestions_status_check'
  ) then
    alter table project_suggestions
    add constraint project_suggestions_status_check
    check (status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

alter table elections add column if not exists image_url text;
alter table elections add column if not exists source_suggestion_id uuid references project_suggestions(id) on delete set null;
alter table elections add column if not exists closing_soon_notified_at timestamptz;
-- Election option metadata used by Admin voting UI/API.
alter table election_options add column if not exists source_suggestion_id uuid references project_suggestions(id) on delete set null;
alter table election_options add column if not exists image_url text;


create table if not exists project_completions (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references elections(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (election_id, user_id)
);

create index if not exists project_completions_election_id_idx on project_completions (election_id);

create table if not exists fund_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  date date not null,
  amount numeric(14,2) not null check (amount >= 0),
  description text default '',
  receipt_url text,
  term text not null,
  status text not null default 'ongoing',
  created_at timestamptz not null default now()
);

create index if not exists fund_projects_date_idx on fund_projects (date desc);
create index if not exists fund_projects_status_idx on fund_projects (status);

create table if not exists fund_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  term text not null,
  allocated_amount numeric(14,2) not null check (allocated_amount >= 0),
  created_at timestamptz not null default now()
);

create index if not exists fund_sources_term_idx on fund_sources (term);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fund_projects_status_check'
  ) then
    alter table fund_projects
    add constraint fund_projects_status_check
    check (status in ('ongoing', 'completed', 'cancelled'));
  end if;
end $$;

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  image_url text,
  type text not null,
  created_at timestamptz not null default now()
);

create index if not exists announcements_type_idx on announcements (type, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'announcements_type_check'
  ) then
    alter table announcements
    add constraint announcements_type_check
    check (type in ('news', 'announcement'));
  end if;
end $$;

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  date date not null,
  time time,
  location text default '',
  description text default '',
  type text default 'general',
  created_at timestamptz not null default now()
);

create index if not exists events_date_idx on events (date, time);

create table if not exists id_pickup_slots (
  id uuid primary key default gen_random_uuid(),
  slot_date date not null,
  time_slot text not null,
  capacity integer not null default 1 check (capacity > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (slot_date, time_slot)
);

create table if not exists id_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  purpose text not null,
  preferred_date date,
  time_slot text,
  status text not null default 'submitted',
  admin_note text default '',
  pickup_reminder_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists id_requests_user_id_idx on id_requests (user_id);
create index if not exists id_requests_status_idx on id_requests (status);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'id_requests_status_check'
  ) then
    alter table id_requests
    add constraint id_requests_status_check
    check (status in ('submitted', 'confirmed', 'rescheduled', 'completed', 'cancelled'));
  end if;
end $$;

alter table officials add column if not exists photo_url text;
alter table officials add column if not exists is_active boolean not null default true;

update officials
set is_active = case
  when lower(status) = 'inactive' then false
  else true
end
where is_active is distinct from case when lower(status) = 'inactive' then false else true end;

create index if not exists officials_is_active_idx on officials (is_active);

alter table notifications add column if not exists is_read boolean not null default false;
alter table notifications add column if not exists read_at timestamptz;

create index if not exists notifications_user_read_idx on notifications (user_id, is_read, created_at desc);

create or replace view public_barangay_statistics as
select
  (select count(*) from users where role = 'resident' and is_active = true) as total_registered_residents,
  (select count(*) from fund_projects where status = 'completed') as completed_projects,
  (select count(*) from officials where is_active = true) as active_officials,
  coalesce((select sum(amount) from fund_projects), 0)::numeric(14,2) as total_funds_spent;

create or replace view public_fund_transparency_summary as
with totals as (
  select coalesce(sum(allocated_amount), 0)::numeric(14,2) as total_funds
  from fund_sources
),
spent as (
  select coalesce(sum(amount), 0)::numeric(14,2) as spent
  from fund_projects
  where status in ('ongoing', 'completed')
)
select
  totals.total_funds,
  spent.spent,
  greatest(totals.total_funds - spent.spent, 0)::numeric(14,2) as remaining
from totals, spent;

create or replace view public_upcoming_events_preview as
select id, title, date, time, location, description, type, created_at
from events
where date >= current_date
order by date asc, time asc nulls last
limit 3;

create or replace view public_latest_news_preview as
select id, title, body, image_url, type, created_at
from announcements
where type = 'news'
order by created_at desc
limit 3;

create or replace view public_latest_announcements_preview as
select id, title, body, image_url, type, created_at
from announcements
where type = 'announcement'
order by created_at desc
limit 3;
begin;

-- Resident community concerns: support admin notes and a clearer workflow.
alter table complaints add column if not exists admin_note text default '';
alter table complaints add column if not exists updated_at timestamptz not null default now();
create index if not exists complaints_user_id_idx on complaints (user_id);
create index if not exists complaints_status_idx on complaints (status);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'complaints_status_check') then
    alter table complaints add constraint complaints_status_check check (status in ('pending', 'in_review', 'resolved'));
  end if;
end $$;


-- Inventory of facilities/items available for residents to borrow.
create table if not exists borrowable_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'item',
  description text default '',
  total_quantity integer not null default 1 check (total_quantity >= 1),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (category in ('facility', 'item'))
);
create unique index if not exists borrowable_assets_name_unique_idx on borrowable_assets (lower(name));
create index if not exists borrowable_assets_active_idx on borrowable_assets (is_active, category);

create table if not exists borrowing_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  asset_id uuid not null references borrowable_assets(id) on delete restrict,
  quantity integer not null default 1 check (quantity >= 1),
  purpose text not null,
  event_location text default '',
  start_at timestamptz not null,
  due_at timestamptz not null,
  status text not null default 'pending',
  admin_note text default '',
  terms_accepted_at timestamptz,
  approved_by uuid references users(id) on delete set null,
  approved_at timestamptz,
  borrowed_at timestamptz,
  returned_at timestamptz,
  returned_quantity integer,
  return_condition text,
  return_note text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_at > start_at),
  check (status in ('pending', 'approved', 'rejected', 'borrowed', 'returned', 'cancelled'))
);
create index if not exists borrowing_requests_user_idx on borrowing_requests (user_id, created_at desc);
create index if not exists borrowing_requests_asset_window_idx on borrowing_requests (asset_id, start_at, due_at);
create index if not exists borrowing_requests_status_idx on borrowing_requests (status, due_at);

alter table borrowing_requests add column if not exists event_location text default '';
alter table borrowing_requests add column if not exists terms_accepted_at timestamptz;
alter table borrowing_requests add column if not exists returned_quantity integer;
alter table borrowing_requests add column if not exists return_condition text;
alter table borrowing_requests add column if not exists return_note text default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'borrowing_returned_quantity_check') then
    alter table borrowing_requests add constraint borrowing_returned_quantity_check check (returned_quantity is null or returned_quantity >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'borrowing_return_condition_check') then
    alter table borrowing_requests add constraint borrowing_return_condition_check check (return_condition is null or return_condition in ('good', 'minor_damage', 'damaged', 'missing_items'));
  end if;
end $$;

create index if not exists borrowing_requests_due_active_idx on borrowing_requests (due_at) where status = 'borrowed';


commit;

-- =========================================================
-- V3 UX/master-data upgrade
-- =========================================================
create table if not exists master_data_values (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  value text not null,
  label text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category, value),
  check (category in ('purok', 'administration_term', 'concern_category', 'event_category', 'official_position'))
);
create index if not exists master_data_values_lookup_idx on master_data_values (category, is_active, sort_order, label);

