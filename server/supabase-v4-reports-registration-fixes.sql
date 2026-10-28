-- Apply AFTER supabase-v4-phase10-5-data-security.sql.
-- Additive and repeatable. Existing duplicate households are preserved and listed
-- at the end for review; new duplicates are rejected, including concurrent writes.
begin;

alter table public.users add column if not exists occupation text;
alter table public.announcements add column if not exists published_at timestamptz;
update public.announcements set published_at = created_at where published_at is null;
alter table public.announcements alter column published_at set default now();
alter table public.announcements alter column published_at set not null;
create index if not exists announcements_published_idx on public.announcements(type, published_at desc);

create or replace function public.bgy_census_key(value text)
returns text language sql immutable parallel safe set search_path=pg_catalog as $$
  select lower(regexp_replace(btrim(coalesce(value, '')), '\s+', ' ', 'g'));
$$;

create or replace function public.bgy_registration_census_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  ref_key text := public.bgy_census_key(new.household_ref);
  address_key text := public.bgy_census_key(coalesce(nullif(new.address, ''), new.house_number));
  purok_key text := public.bgy_census_key(new.purok);
  name_key text := public.bgy_census_key(new.household_name);
  lock_key bigint;
begin
  if ref_key = '' or address_key = '' or purok_key = '' or name_key = '' then
    raise exception 'Household reference, name, purok and address are required.' using errcode='22023';
  end if;
  if tg_op = 'UPDATE' and ref_key = public.bgy_census_key(old.household_ref)
    and address_key = public.bgy_census_key(coalesce(nullif(old.address,''),old.house_number))
    and purok_key = public.bgy_census_key(old.purok) and name_key = public.bgy_census_key(old.household_name) then
    return new;
  end if;
  -- One building can contain different households. Identity includes the household
  -- name as well as its address and purok; the reference is unique independently.
  for lock_key in select distinct key from unnest(array[
    hashtextextended('census-ref:' || ref_key, 210),
    hashtextextended('census-home:' || jsonb_build_array(purok_key,address_key,name_key)::text, 210)
  ]) as keys(key) order by key loop
    perform pg_advisory_xact_lock(lock_key);
  end loop;
  if exists(select 1 from public.census_households h where h.id <> new.id and (
    public.bgy_census_key(h.household_ref) = ref_key or (
      public.bgy_census_key(h.purok) = purok_key and public.bgy_census_key(h.household_name) = name_key
      and public.bgy_census_key(coalesce(nullif(h.address,''),h.house_number)) = address_key
    )
  )) then
    raise exception 'Duplicate household reference or household record.' using errcode='23505';
  end if;
  return new;
end $$;
drop trigger if exists bgy_registration_census_guard_trg on public.census_households;
create trigger bgy_registration_census_guard_trg before insert or update of household_ref,household_name,purok,address,house_number
on public.census_households for each row execute function public.bgy_registration_census_guard();

-- Add unique indexes whenever existing records allow it. The guard still protects
-- databases containing legacy duplicates, without silently deleting those records.
do $$ begin
  if not exists(select 1 from public.census_households group by public.bgy_census_key(household_ref) having count(*)>1) then
    create unique index if not exists census_households_normalized_ref_uidx
      on public.census_households(public.bgy_census_key(household_ref));
  end if;
  if not exists(select 1 from public.census_households
    group by public.bgy_census_key(purok),public.bgy_census_key(coalesce(nullif(address,''),house_number)),public.bgy_census_key(household_name)
    having count(*)>1) then
    create unique index if not exists census_households_identity_uidx on public.census_households(
      public.bgy_census_key(purok),public.bgy_census_key(coalesce(nullif(address,''),house_number)),public.bgy_census_key(household_name)
    );
  end if;
end $$;

-- Register the household and its people atomically; a failed member never leaves
-- a partially registered household. Existing member triggers maintain the count.
create or replace function public.bgy_register_census_household(p_household jsonb,p_members jsonb)
returns public.census_households language plpgsql security definer set search_path=public as $$
declare h public.census_households; m jsonb;
begin
  if jsonb_typeof(p_members) is distinct from 'array' then
    raise exception 'Household members are required.' using errcode='22023';
  end if;
  if jsonb_array_length(p_members)<1 or (select count(*) from jsonb_array_elements(p_members) x where coalesce((x->>'is_head')::boolean,false))<>1 then
    raise exception 'Exactly one household head is required.' using errcode='22023';
  end if;
  insert into public.census_households(household_ref,household_name,purok,address,house_number,members,status,contact_number,housing_tenure,residency_since)
  values(p_household->>'household_ref',p_household->>'household_name',p_household->>'purok',p_household->>'address',p_household->>'address',0,
    coalesce(p_household->>'status','active'),coalesce(p_household->>'contact_number',''),nullif(p_household->>'housing_tenure',''),
    nullif(p_household->>'residency_since','')::date) returning * into h;
  for m in select value from jsonb_array_elements(p_members) order by coalesce((value->>'is_head')::boolean,false) desc loop
    if nullif(btrim(m->>'first_name'),'') is null or nullif(btrim(m->>'last_name'),'') is null
      or nullif(btrim(m->>'relationship'),'') is null or nullif(m->>'birthdate','') is null
      or coalesce(m->>'sex','') not in ('male','female','other','prefer_not_to_say') then
      raise exception 'Each member needs a name, relationship, birthdate and sex.' using errcode='22023';
    end if;
    if (m->>'birthdate')::date > (now() at time zone 'Asia/Manila')::date then
      raise exception 'Birthdate cannot be in the future.' using errcode='22023';
    end if;
    if nullif(m->>'user_id','') is not null and not exists(select 1 from public.users where id=(m->>'user_id')::uuid and role='resident') then
      raise exception 'Only resident accounts may be linked.' using errcode='22023';
    end if;
    insert into public.household_members(household_id,user_id,first_name,middle_name,last_name,suffix,relationship,is_head,birthdate,sex,civil_status,occupation,
      is_senior,is_pwd,is_solo_parent,is_4ps,is_registered_voter)
    values(h.id,nullif(m->>'user_id','')::uuid,btrim(m->>'first_name'),coalesce(m->>'middle_name',''),btrim(m->>'last_name'),coalesce(m->>'suffix',''),
      btrim(m->>'relationship'),coalesce((m->>'is_head')::boolean,false),(m->>'birthdate')::date,m->>'sex',nullif(m->>'civil_status',''),nullif(m->>'occupation',''),
      coalesce((m->>'is_senior')::boolean,false),coalesce((m->>'is_pwd')::boolean,false),coalesce((m->>'is_solo_parent')::boolean,false),
      coalesce((m->>'is_4ps')::boolean,false),coalesce((m->>'is_registered_voter')::boolean,false));
  end loop;
  select * into h from public.census_households where id=h.id;
  return h;
end $$;
revoke all on function public.bgy_register_census_household(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.bgy_register_census_household(jsonb,jsonb) to service_role;

commit;

-- Empty results mean there are no legacy duplicates. Review any listed IDs;
-- after resolving them, rerun this migration to add any deferred unique indexes.
select 'household_reference' as duplicate_type,public.bgy_census_key(household_ref) as duplicate_key,
  count(*) as records,array_agg(id order by created_at,id) as household_ids
from public.census_households group by public.bgy_census_key(household_ref) having count(*)>1
union all
select 'household_identity',jsonb_build_array(public.bgy_census_key(purok),public.bgy_census_key(coalesce(nullif(address,''),house_number)),public.bgy_census_key(household_name))::text,
  count(*),array_agg(id order by created_at,id)
from public.census_households group by public.bgy_census_key(purok),public.bgy_census_key(coalesce(nullif(address,''),house_number)),public.bgy_census_key(household_name)
having count(*)>1;
