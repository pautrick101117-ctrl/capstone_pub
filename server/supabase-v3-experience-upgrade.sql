begin;

-- Password-recovery codes are stored as hashes in V3.
alter table verification_codes add column if not exists code_hash text;
alter table verification_codes add column if not exists attempt_count integer not null default 0;

-- Centralized controlled values used by resident/admin forms.
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

create index if not exists master_data_values_lookup_idx
  on master_data_values (category, is_active, sort_order, label);

-- Preserve controlled values that already exist in production before adding defaults.
insert into master_data_values (category, value, label, sort_order)
select 'purok', regexp_replace(lower(trim(label)), '[^a-z0-9]+', '_', 'g'), trim(label), 0
from (
  select purok as label from users where nullif(trim(purok), '') is not null
  union
  select purok as label from census_households where nullif(trim(purok), '') is not null
) existing_puroks
on conflict (category, value) do nothing;

insert into master_data_values (category, value, label, sort_order)
select 'official_position', regexp_replace(lower(trim(position)), '[^a-z0-9]+', '_', 'g'), trim(position), 0
from officials where nullif(trim(position), '') is not null
on conflict (category, value) do nothing;

insert into master_data_values (category, value, label, sort_order)
select 'event_category', regexp_replace(lower(trim(type)), '[^a-z0-9]+', '_', 'g'), trim(type), 0
from events where nullif(trim(type), '') is not null
on conflict (category, value) do nothing;

insert into master_data_values (category, value, label, sort_order)
select 'concern_category', regexp_replace(lower(trim(complaint_type)), '[^a-z0-9]+', '_', 'g'), trim(complaint_type), 0
from complaints where nullif(trim(complaint_type), '') is not null
on conflict (category, value) do nothing;

insert into master_data_values (category, value, label, sort_order)
select 'administration_term', regexp_replace(lower(trim(term)), '[^a-z0-9]+', '_', 'g'), trim(term), 0
from (
  select term from officials where nullif(trim(term), '') is not null
  union select term from fund_sources where nullif(trim(term), '') is not null
  union select term from fund_projects where nullif(trim(term), '') is not null
) existing_terms
on conflict (category, value) do nothing;

insert into master_data_values (category, value, label, sort_order)
values
  ('purok', 'purok_1', 'Purok 1', 10),
  ('purok', 'purok_2', 'Purok 2', 20),
  ('purok', 'purok_3', 'Purok 3', 30),
  ('purok', 'purok_4', 'Purok 4', 40),
  ('purok', 'purok_5', 'Purok 5', 50),
  ('purok', 'purok_6', 'Purok 6', 60),
  ('purok', 'purok_7', 'Purok 7', 70),
  ('administration_term', '2023_2026', '2023-2026', 10),
  ('concern_category', 'road_drainage', 'Road / Drainage', 10),
  ('concern_category', 'noise_disturbance', 'Noise / Disturbance', 20),
  ('concern_category', 'waste_cleanliness', 'Waste / Cleanliness', 30),
  ('concern_category', 'street_light_public_facility', 'Street Light / Public Facility', 40),
  ('concern_category', 'safety_security', 'Safety / Security', 50),
  ('concern_category', 'other_community_concern', 'Other Community Concern', 100),
  ('event_category', 'community_meeting', 'Community Meeting', 10),
  ('event_category', 'health_medical', 'Health / Medical', 20),
  ('event_category', 'clean_up_environment', 'Clean-up / Environment', 30),
  ('event_category', 'sports_recreation', 'Sports / Recreation', 40),
  ('event_category', 'education_youth', 'Education / Youth', 50),
  ('event_category', 'general', 'General', 100),
  ('official_position', 'barangay_captain', 'Barangay Captain', 10),
  ('official_position', 'kagawad', 'Kagawad', 20),
  ('official_position', 'sk_chairperson', 'SK Chairperson', 30),
  ('official_position', 'barangay_secretary', 'Barangay Secretary', 40),
  ('official_position', 'barangay_treasurer', 'Barangay Treasurer', 50)
on conflict (category, value) do nothing;

commit;
