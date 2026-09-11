begin;

-- Barangay Iba Portal V4 upgrade
-- Safe to run after the current V3.x schema. Existing data is preserved.

-- =========================================================
-- 1) Census: stable household reference + full address
-- =========================================================
alter table public.census_households
  add column if not exists household_ref text,
  add column if not exists address text;

update public.census_households
set household_ref = coalesce(nullif(household_ref, ''), 'HH-' || upper(substr(replace(id::text, '-', ''), 1, 12))),
    address = coalesce(nullif(address, ''), house_number, 'Address not set')
where household_ref is null or household_ref = '' or address is null or address = '';

alter table public.census_households
  alter column household_ref set not null,
  alter column address set not null;

create unique index if not exists census_households_ref_uidx
  on public.census_households (household_ref);
create index if not exists census_households_address_idx
  on public.census_households (lower(address));

-- house_number is retained for backward compatibility only. New V4 code writes address.

-- =========================================================
-- 2) Project suggestion review metadata
-- =========================================================
alter table public.project_suggestions
  add column if not exists review_note text not null default '',
  add column if not exists reviewed_by uuid references public.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

-- =========================================================
-- 3) Winning community projects + implementation updates
-- =========================================================
create table if not exists public.community_projects (
  id uuid primary key default gen_random_uuid(),
  election_id uuid references public.elections(id) on delete set null,
  election_option_id uuid references public.election_options(id) on delete set null,
  source_suggestion_id uuid references public.project_suggestions(id) on delete set null,
  title text not null,
  description text not null default '',
  cover_image_url text,
  status text not null default 'planned'
    check (status in ('planned', 'ongoing', 'on_hold', 'completed', 'cancelled')),
  progress_percentage integer not null default 0
    check (progress_percentage between 0 and 100),
  planned_start_date date,
  actual_start_date date,
  expected_completion_date date,
  completed_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists community_projects_election_uidx
  on public.community_projects (election_id) where election_id is not null;
create index if not exists community_projects_status_idx
  on public.community_projects (status, updated_at desc);
create index if not exists community_projects_suggestion_idx
  on public.community_projects (source_suggestion_id);

create table if not exists public.project_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.community_projects(id) on delete cascade,
  title text not null,
  description text not null default '',
  image_url text,
  progress_percentage integer check (progress_percentage between 0 and 100),
  project_status text check (project_status is null or project_status in ('planned', 'ongoing', 'on_hold', 'completed', 'cancelled')),
  update_date date not null default current_date,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_updates_project_idx
  on public.project_updates (project_id, update_date desc, created_at desc);

-- =========================================================
-- 4) Notifications can deep-link to the relevant record
-- =========================================================
alter table public.notifications
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists destination text;

-- =========================================================
-- 5) Expanded admin audit metadata
-- =========================================================
alter table public.audit_logs
  add column if not exists actor_name_snapshot text,
  add column if not exists module text,
  add column if not exists http_method text,
  add column if not exists route text,
  add column if not exists ip_address text,
  add column if not exists user_agent text,
  add column if not exists before_data jsonb,
  add column if not exists after_data jsonb,
  add column if not exists outcome text not null default 'success';

create index if not exists audit_logs_module_idx
  on public.audit_logs (module, created_at desc);
create index if not exists audit_logs_action_idx
  on public.audit_logs (action, created_at desc);
create index if not exists audit_logs_outcome_idx
  on public.audit_logs (outcome, created_at desc);

alter table public.community_projects enable row level security;
alter table public.project_updates enable row level security;
revoke all on public.community_projects, public.project_updates from anon, authenticated;
grant all on public.community_projects, public.project_updates to postgres, service_role;


-- Transactional census replacement used by the V4 Excel import flow.
create or replace function public.replace_census_households(rows jsonb)
returns table(inserted_count integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.census_households;

  insert into public.census_households (
    household_ref, household_name, purok, members, address, house_number, status, created_at, updated_at
  )
  select
    coalesce(nullif(x.household_ref, ''), 'HH-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
    x.household_name,
    x.purok,
    x.members,
    x.address,
    coalesce(nullif(x.house_number, ''), x.address),
    x.status,
    now(),
    now()
  from jsonb_to_recordset(rows) as x(
    household_ref text,
    household_name text,
    purok text,
    members integer,
    address text,
    house_number text,
    status text
  );

  get diagnostics inserted_count = row_count;
  return next;
end;
$$;
revoke all on function public.replace_census_households(jsonb) from anon, authenticated;
grant execute on function public.replace_census_households(jsonb) to service_role, postgres;

commit;
