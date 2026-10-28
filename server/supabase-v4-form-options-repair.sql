-- Run this entire file in the Supabase SQL Editor for an existing portal database.
-- Repeatable: adds missing form options without deleting records or overwriting
-- existing labels, ordering, or active/inactive settings. No demo accounts/data.
-- Starter labels match this repository's existing seed. Adjust the defaults below
-- if your actual puroks or administration terms differ.
begin;

create table if not exists public.master_data_values (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in (
    'purok', 'administration_term', 'concern_category', 'event_category', 'official_position'
  )),
  value text not null,
  label text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category, value)
);

create index if not exists master_data_values_lookup_idx
  on public.master_data_values (category, is_active, sort_order, label);

-- The Express API uses service_role. Keep RLS enabled and do not expose the
-- table to anonymous clients through a new public policy.
alter table public.master_data_values enable row level security;
grant select, insert, update on public.master_data_values to service_role;

-- Recover exact labels so editing an older record still selects its saved value.
-- A stable suffix prevents key collisions between legacy spelling/dash variants
-- without renaming stored resident, official, event, or fund records.
with existing_labels(category, label) as (
  select 'purok', purok from public.users
  union
  select 'purok', purok from public.census_households
  union
  select 'administration_term', term from public.officials
  union
  select 'administration_term', term from public.fund_sources
  union
  select 'administration_term', term from public.fund_projects
  union
  select 'official_position', position from public.officials
  union
  select 'event_category', type from public.events
),
recovered as (
  select distinct category, btrim(label) as label
  from existing_labels where nullif(btrim(label), '') is not null
)
insert into public.master_data_values (category, value, label, sort_order, is_active)
select recovered.category,
  trim(both '_' from regexp_replace(lower(recovered.label), '[^a-z0-9]+', '_', 'g'))
    || '_' || md5(recovered.label),
  recovered.label, 0, true
from recovered
where not exists (
  select 1 from public.master_data_values existing
  where existing.category = recovered.category and btrim(existing.label) = recovered.label
)
on conflict (category, value) do nothing;

-- Fill remaining gaps with the existing seed's starter options.
with defaults(category, label, sort_order) as (
  values
    ('purok', 'Purok 1', 1),
    ('purok', 'Purok 2', 2),
    ('purok', 'Purok 3', 3),
    ('purok', 'Purok 4', 4),
    ('purok', 'Purok 5', 5),
    ('purok', 'Purok 6', 6),
    ('administration_term', '2023-2026', 1),
    ('administration_term', '2026-2029', 2),
    ('official_position', 'Punong Barangay', 1),
    ('official_position', 'Barangay Kagawad', 2),
    ('official_position', 'SK Chairperson', 3),
    ('official_position', 'Barangay Secretary', 4),
    ('official_position', 'Barangay Treasurer', 5),
    ('official_position', 'Lupon Chairperson', 6),
    ('event_category', 'Barangay Assembly', 1),
    ('event_category', 'Health Program', 2),
    ('event_category', 'Clean-Up Drive', 3),
    ('event_category', 'Sports Activity', 4),
    ('event_category', 'Youth Program', 5),
    ('event_category', 'Senior Citizens Program', 6),
    ('event_category', 'Disaster Preparedness', 7),
    ('event_category', 'Education Program', 8)
),
normalized as (
  select *, trim(both '_' from regexp_replace(lower(label), '[^a-z0-9]+', '_', 'g')) as value
  from defaults
),
missing as (
  select
    candidate.category, candidate.value, candidate.label, candidate.sort_order
  from normalized candidate
  where candidate.value <> ''
    and not exists (
      select 1 from public.master_data_values existing
      where existing.category = candidate.category and (
        -- Older seeds use hyphens, Settings uses underscores, and term labels
        -- may use en dashes. Recognize them without inserting duplicate options.
        trim(both '_' from regexp_replace(lower(existing.value), '[^a-z0-9]+', '_', 'g')) = candidate.value
        or trim(both '_' from regexp_replace(lower(existing.label), '[^a-z0-9]+', '_', 'g')) = candidate.value
      )
    )
)
insert into public.master_data_values (category, value, label, sort_order, is_active)
select category, value, label, sort_order, true from missing
on conflict (category, value) do nothing;

commit;

-- All four categories should have active options. Existing inactive choices stay
-- inactive; activate them in Admin Settings if they are meant to be selectable.
select categories.category,
  count(options.id) filter (where options.is_active) as active_options,
  count(options.id) filter (where not options.is_active) as inactive_options
from (values ('purok'), ('administration_term'), ('official_position'), ('event_category')) as categories(category)
left join public.master_data_values options on options.category = categories.category
group by categories.category
order by categories.category;
