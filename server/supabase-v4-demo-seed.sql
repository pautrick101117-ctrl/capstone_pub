-- Barangay Iba Portal - V4 DEMO EXTENSIONS
-- Run AFTER: supabase-demo-seed.sql AND supabase-v4-upgrade.sql.
-- Adds V4 project lifecycle, project updates, review notes, address-style census data,
-- deep-linked notifications, and richer audit examples.
-- Demo/reference imagery below points to real recent Philippine photographs on Wikimedia Commons.
-- They are illustrative references only and are NOT claimed to depict Barangay Iba itself.

begin;

-- =========================================================
-- 1) CENSUS: REALISTIC ADDRESS-STYLE DEMO DATA
-- =========================================================
with ordered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.census_households
)
update public.census_households c
set household_ref = 'HH-2026-' || lpad(o.rn::text, 4, '0'),
    address = (10 + o.rn * 3)::text || ' ' ||
      (array['Rizal Street','Mabini Street','Bonifacio Road','Aguinaldo Street','Del Pilar Street','Quezon Avenue'])[((o.rn - 1) % 6) + 1] ||
      ', ' || c.purok || ', Barangay Iba, Silang, Cavite',
    house_number = (10 + o.rn * 3)::text || ' ' ||
      (array['Rizal Street','Mabini Street','Bonifacio Road','Aguinaldo Street','Del Pilar Street','Quezon Avenue'])[((o.rn - 1) % 6) + 1] ||
      ', ' || c.purok || ', Barangay Iba, Silang, Cavite',
    updated_at = timestamptz '2026-09-01 08:00:00+08' + (o.rn || ' hours')::interval
from ordered o
where c.id = o.id;

-- =========================================================
-- 2) PROJECT SUGGESTION REVIEW NOTES + RECENT PHILIPPINE REFERENCE IMAGERY
-- =========================================================
update public.project_suggestions
set review_note = 'Approved for consideration because the proposal addresses a documented community need and can be evaluated through community voting.',
    reviewed_by = (select id from public.users where lower(email)='admin@gmail.com' limit 1),
    reviewed_at = greatest(created_at + interval '3 days', timestamptz '2025-01-01 09:00:00+08')
where status = 'approved';

update public.project_suggestions
set review_note = case
      when title = 'Private Street Gate' then 'The proposal primarily benefits a private access road and is outside the scope of a barangay-wide community project vote.'
      when title = 'Personal Parking Shed' then 'The proposed structure would primarily benefit one private residence rather than the wider community.'
      else 'The proposal did not meet the current community-project eligibility criteria.'
    end,
    reviewed_by = (select id from public.users where lower(email)='admin@gmail.com' limit 1),
    reviewed_at = created_at + interval '4 days'
where status = 'rejected';

-- Use real recent Philippine imagery as representative demo visuals.
update public.project_suggestions set image_url = 'https://commons.wikimedia.org/wiki/Special:Redirect/file/2025-11-25%20%E2%80%93%20PBBM%20vows%20stronger%20support%20for%20innovative%20renewable%20energy%20projects%20during%20Cavite%20solar%20rooftop%20facility%20visit%20%2805%29.jpg'
where title = 'Solar Streetlights for Purok 5';

update public.project_suggestions set image_url = 'https://commons.wikimedia.org/wiki/Special:Redirect/file/2025-08-14%20%E2%80%93%20PBBM%20inspects%20unfinished%20flyover%2C%20ongoing%20flood%20control%20project%20in%20Iloilo%20%2801%29.jpg'
where title = 'Drainage Improvement at Purok 2';

update public.project_suggestions set image_url = 'https://commons.wikimedia.org/wiki/Special:Redirect/file/USNS%20Charles%20Drew%20Visits%20Aeta%20School%20during%20Community%20Outreach%20%288791120%29.jpg'
where title = 'Covered Court Ventilation Upgrade';

update public.project_suggestions set image_url = 'https://commons.wikimedia.org/wiki/Special:Redirect/file/USNS%20Charles%20Drew%20Visits%20Aeta%20School%20during%20Community%20Outreach%20%288791119%29.jpg'
where title = 'Community Reading Corner';

-- =========================================================
-- 3) HISTORICAL COMMUNITY VOTING: OCTOBER 2024 + NOVEMBER 2025
-- =========================================================
insert into public.elections (title, description, status, starts_at, ends_at, source_suggestion_id, created_at)
select 'Community Project Voting - October 2024',
       'Historical demo election showing a completed winning project.',
       'closed',
       timestamptz '2024-10-14 08:00:00+08',
       timestamptz '2024-10-24 20:00:00+08',
       s.id,
       timestamptz '2024-10-10 09:00:00+08'
from public.project_suggestions s
where s.title = 'Covered Court Ventilation Upgrade'
and not exists (select 1 from public.elections where title='Community Project Voting - October 2024');

insert into public.election_options (election_id, name, description, source_suggestion_id, image_url, votes_count)
select e.id, s.title, s.description, s.id, s.image_url, 0
from public.elections e
join public.project_suggestions s on s.title in ('Covered Court Ventilation Upgrade','Community Reading Corner','Additional CCTV Cameras')
where e.title='Community Project Voting - October 2024'
and not exists (select 1 from public.election_options eo where eo.election_id=e.id);

insert into public.elections (title, description, status, starts_at, ends_at, source_suggestion_id, created_at)
select 'Community Project Voting - November 2025',
       'Historical demo election showing an ongoing winning project.',
       'closed',
       timestamptz '2025-11-10 08:00:00+08',
       timestamptz '2025-11-20 20:00:00+08',
       s.id,
       timestamptz '2025-11-05 09:00:00+08'
from public.project_suggestions s
where s.title='Solar Streetlights for Purok 5'
and not exists (select 1 from public.elections where title='Community Project Voting - November 2025');

insert into public.election_options (election_id, name, description, source_suggestion_id, image_url, votes_count)
select e.id, s.title, s.description, s.id, s.image_url, 0
from public.elections e
join public.project_suggestions s on s.title in ('Solar Streetlights for Purok 5','Public Water Refill Station','Drainage Improvement at Purok 2')
where e.title='Community Project Voting - November 2025'
and not exists (select 1 from public.election_options eo where eo.election_id=e.id);

-- Historical 2024 votes: Covered Court 18, Reading Corner 8, CCTV 4.
with election_row as (select id from public.elections where title='Community Project Voting - October 2024'),
voters as (
  select n, (select id from public.users where username='resident' || lpad(n::text,2,'0')) user_id
  from generate_series(1,30) n
)
insert into public.votes (election_id, option_id, user_id, created_at)
select e.id,
       case when v.n <= 18 then (select id from public.election_options where election_id=e.id and name='Covered Court Ventilation Upgrade')
            when v.n <= 26 then (select id from public.election_options where election_id=e.id and name='Community Reading Corner')
            else (select id from public.election_options where election_id=e.id and name='Additional CCTV Cameras') end,
       v.user_id,
       timestamptz '2024-10-20 10:00:00+08' + (v.n || ' minutes')::interval
from election_row e cross join voters v
where not exists (select 1 from public.votes existing where existing.election_id=e.id);

-- Historical 2025 votes: Solar 24, Water 10, Drainage 6.
with election_row as (select id from public.elections where title='Community Project Voting - November 2025'),
voters as (
  select n, (select id from public.users where username='resident' || lpad(n::text,2,'0')) user_id
  from generate_series(1,40) n
)
insert into public.votes (election_id, option_id, user_id, created_at)
select e.id,
       case when v.n <= 24 then (select id from public.election_options where election_id=e.id and name='Solar Streetlights for Purok 5')
            when v.n <= 34 then (select id from public.election_options where election_id=e.id and name='Public Water Refill Station')
            else (select id from public.election_options where election_id=e.id and name='Drainage Improvement at Purok 2') end,
       v.user_id,
       timestamptz '2025-11-15 10:00:00+08' + (v.n || ' minutes')::interval
from election_row e cross join voters v
where not exists (select 1 from public.votes existing where existing.election_id=e.id);

update public.election_options eo
set votes_count = (select count(*) from public.votes v where v.option_id=eo.id);

-- =========================================================
-- 4) WINNING COMMUNITY PROJECTS: COMPLETED, ONGOING, PLANNED
-- =========================================================
insert into public.community_projects (
  election_id, election_option_id, source_suggestion_id, title, description, cover_image_url,
  status, progress_percentage, planned_start_date, actual_start_date, expected_completion_date, completed_at,
  created_by, created_at, updated_at
)
select e.id, eo.id, eo.source_suggestion_id, eo.name, eo.description, eo.image_url,
       'completed', 100, date '2024-11-15', date '2024-11-18', date '2025-02-28', timestamptz '2025-02-21 16:30:00+08',
       (select id from public.users where lower(email)='admin@gmail.com' limit 1),
       timestamptz '2024-10-25 09:00:00+08', timestamptz '2025-02-21 16:30:00+08'
from public.elections e
join public.election_options eo on eo.election_id=e.id and eo.name='Covered Court Ventilation Upgrade'
where e.title='Community Project Voting - October 2024'
on conflict (election_id) do nothing;

insert into public.community_projects (
  election_id, election_option_id, source_suggestion_id, title, description, cover_image_url,
  status, progress_percentage, planned_start_date, actual_start_date, expected_completion_date,
  created_by, created_at, updated_at
)
select e.id, eo.id, eo.source_suggestion_id, eo.name, eo.description, eo.image_url,
       'ongoing', 68, date '2026-01-12', date '2026-01-15', date '2026-10-30',
       (select id from public.users where lower(email)='admin@gmail.com' limit 1),
       timestamptz '2025-11-21 09:00:00+08', timestamptz '2026-08-25 14:00:00+08'
from public.elections e
join public.election_options eo on eo.election_id=e.id and eo.name='Solar Streetlights for Purok 5'
where e.title='Community Project Voting - November 2025'
on conflict (election_id) do nothing;

-- Current V3 seed's closed previous round becomes a Planned project.
insert into public.community_projects (
  election_id, election_option_id, source_suggestion_id, title, description, cover_image_url,
  status, progress_percentage, planned_start_date, expected_completion_date,
  created_by, created_at, updated_at
)
select e.id, eo.id, eo.source_suggestion_id, eo.name, eo.description, eo.image_url,
       'planned', 10, date '2026-10-15', date '2027-03-31',
       (select id from public.users where lower(email)='admin@gmail.com' limit 1),
       timestamptz '2026-08-18 09:00:00+08', timestamptz '2026-09-05 10:00:00+08'
from public.elections e
join public.election_options eo on eo.election_id=e.id and eo.name='Drainage Improvement at Purok 2'
where e.title='Community Project Voting - Previous Round'
on conflict (election_id) do nothing;

-- =========================================================
-- 5) IMPLEMENTATION TIMELINES WITH REAL PHILIPPINE REFERENCE PHOTOS
-- =========================================================
insert into public.project_updates (project_id, title, description, image_url, progress_percentage, project_status, update_date, created_by, created_at)
select p.id, v.title, v.description, v.image_url, v.progress, v.status, v.update_date,
       (select id from public.users where lower(email)='admin@gmail.com' limit 1), v.created_at
from public.community_projects p
join (values
  ('Covered Court Ventilation Upgrade','Project mobilization completed','Barangay staff completed the site assessment, work plan and procurement preparation for the covered court improvement.','https://commons.wikimedia.org/wiki/Special:Redirect/file/USNS%20Charles%20Drew%20Visits%20Aeta%20School%20during%20Community%20Outreach%20%288791120%29.jpg',25,'ongoing'::text,date '2024-11-20',timestamptz '2024-11-20 15:00:00+08'),
  ('Covered Court Ventilation Upgrade','Installation work completed','Ventilation and facility improvements were installed and inspected. The area was reopened for community use.','https://commons.wikimedia.org/wiki/Special:Redirect/file/USNS%20Charles%20Drew%20Visits%20Aeta%20School%20during%20Community%20Outreach%20%288791120%29.jpg',100,'completed'::text,date '2025-02-21',timestamptz '2025-02-21 16:30:00+08'),
  ('Solar Streetlights for Purok 5','Procurement and site marking completed','Locations for the first solar lighting units were confirmed and procurement was completed.','https://commons.wikimedia.org/wiki/Special:Redirect/file/2025-11-25%20%E2%80%93%20PBBM%20vows%20stronger%20support%20for%20innovative%20renewable%20energy%20projects%20during%20Cavite%20solar%20rooftop%20facility%20visit%20%2805%29.jpg',30,'ongoing'::text,date '2026-05-20',timestamptz '2026-05-20 10:30:00+08'),
  ('Solar Streetlights for Purok 5','Materials delivered','Solar lighting materials and poles for the next installation phase were delivered for inspection.','https://commons.wikimedia.org/wiki/Special:Redirect/file/2025-11-25%20%E2%80%93%20PBBM%20vows%20stronger%20support%20for%20innovative%20renewable%20energy%20projects%20during%20Cavite%20solar%20rooftop%20facility%20visit%20%2805%29.jpg',48,'ongoing'::text,date '2026-07-08',timestamptz '2026-07-08 11:00:00+08'),
  ('Solar Streetlights for Purok 5','Installation phase progressing','Most priority locations now have installed units. Remaining locations are scheduled for the final phase.','https://commons.wikimedia.org/wiki/Special:Redirect/file/2025-11-25%20%E2%80%93%20PBBM%20vows%20stronger%20support%20for%20innovative%20renewable%20energy%20projects%20during%20Cavite%20solar%20rooftop%20facility%20visit%20%2805%29.jpg',68,'ongoing'::text,date '2026-08-25',timestamptz '2026-08-25 14:00:00+08'),
  ('Drainage Improvement at Purok 2','Pre-implementation site validation','The winning drainage project entered pre-implementation planning. Site measurements and the initial work scope are being validated.','https://commons.wikimedia.org/wiki/Special:Redirect/file/2025-08-14%20%E2%80%93%20PBBM%20inspects%20unfinished%20flyover%2C%20ongoing%20flood%20control%20project%20in%20Iloilo%20%2801%29.jpg',10,'planned'::text,date '2026-09-05',timestamptz '2026-09-05 10:00:00+08')
) as v(project_title,title,description,image_url,progress,status,update_date,created_at)
  on p.title=v.project_title
where not exists (
  select 1 from public.project_updates u where u.project_id=p.id and u.title=v.title
);

-- =========================================================
-- 6) NEWS IMAGES + PROJECT-DEEP-LINK NOTIFICATIONS
-- =========================================================
update public.announcements
set image_url='https://commons.wikimedia.org/wiki/Special:Redirect/file/2025-08-14%20%E2%80%93%20PBBM%20inspects%20unfinished%20flyover%2C%20ongoing%20flood%20control%20project%20in%20Iloilo%20%2801%29.jpg'
where title='Road Drainage Maintenance Completed';

update public.announcements
set image_url='https://commons.wikimedia.org/wiki/Special:Redirect/file/USNS%20Charles%20Drew%20Visits%20Aeta%20School%20during%20Community%20Outreach%20%288791119%29.jpg'
where title='Community Garden Program Starts';

update public.announcements
set image_url='https://commons.wikimedia.org/wiki/Special:Redirect/file/USNS%20Charles%20Drew%20Visits%20Aeta%20School%20during%20Community%20Outreach%20%288791120%29.jpg'
where title='Youth Basketball League Opens';

insert into public.notifications (user_id, title, body, kind, broadcast, is_read, entity_type, entity_id, destination, created_at)
select u.id, 'Project Update: Solar Streetlights for Purok 5',
       'Installation is now approximately 68% complete. View the latest implementation update and photos.',
       'info', false, false, 'community_project', p.id::text, '/project-updates/' || p.id::text,
       timestamptz '2026-08-25 14:05:00+08'
from public.users u
cross join public.community_projects p
where u.role='resident' and u.is_active=true and p.title='Solar Streetlights for Purok 5'
and not exists (
  select 1 from public.notifications n where n.user_id=u.id and n.entity_id=p.id::text and n.title like 'Project Update:%'
);

-- =========================================================
-- 7) RICHER V4 AUDIT EXAMPLES
-- =========================================================
insert into public.audit_logs (
  actor_id, actor_role, actor_name_snapshot, action, entity_type, entity_id, module,
  http_method, route, before_data, after_data, details, outcome, created_at
)
select a.id, a.role, coalesce(a.full_name,a.username), v.action, v.entity_type, v.entity_id, v.module,
       v.http_method, v.route, v.before_data, v.after_data, v.details, v.outcome, v.created_at
from public.users a
cross join (values
  ('review_project_suggestion','project_suggestion','demo-approved-suggestion','project_suggestions','PATCH','/api/admin-voting/suggestions/demo','{"status":"pending"}'::jsonb,'{"status":"approved"}'::jsonb,'{"note":"Approved for community voting consideration"}'::jsonb,'success',timestamptz '2026-08-10 09:15:00+08'),
  ('publish_project_update','project_update','demo-solar-update','projects','POST','/api/admin/projects/demo/updates','{}'::jsonb,'{"progress_percentage":68}'::jsonb,'{"title":"Installation phase progressing"}'::jsonb,'success',timestamptz '2026-08-25 14:00:00+08'),
  ('export_census_backup','census_households','all','census','GET','/api/admin/census_households/export','{}'::jsonb,'{}'::jsonb,'{"format":"xlsx"}'::jsonb,'success',timestamptz '2026-09-01 11:00:00+08'),
  ('admin_page_view','admin_page','/admin/projects','projects','POST','/api/admin/audit/page-view','{}'::jsonb,'{}'::jsonb,'{"page":"/admin/projects"}'::jsonb,'success',timestamptz '2026-09-05 09:00:00+08')
) as v(action,entity_type,entity_id,module,http_method,route,before_data,after_data,details,outcome,created_at)
where lower(a.email)='admin@gmail.com';

commit;
