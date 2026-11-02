-- Barangay Iba Portal - V4 DEMO EXTENSIONS
-- Run AFTER: supabase-demo-seed.sql AND supabase-v4-upgrade.sql.
-- Adds V4 project lifecycle, project updates, review notes, address-style census data,
-- deep-linked notifications, and richer audit examples.
-- Demo/reference imagery below points to real recent Philippine photographs on Wikimedia Commons.
-- They are illustrative references only and are NOT claimed to depict Barangay Iba itself.

begin;

-- Repair V4.0 partial unique index from the initial release.
-- PostgreSQL cannot infer a partial unique index for ON CONFLICT (election_id)
-- unless the same predicate is supplied. A normal UNIQUE index already permits
-- multiple NULL election_id values, so the partial predicate is unnecessary.
drop index if exists public.community_projects_election_uidx;
create unique index community_projects_election_uidx
  on public.community_projects (election_id);

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


# Barangay Iba document system — implementation and verification

Prepared 31 October 2026, Asia/Manila. All changes are local to this repository. No production migration was applied, no resident data was changed remotely, and no real notification was sent.

## A. Existing system findings

The application uses React 19, Vite and React Router's data router, with a separate Express API. Authentication uses the existing JWT/session system and live user roles from Supabase. The backend uses a private service-role Supabase client and existing audit context. Resend is called through the existing mailer. Resident registration remains administrator controlled; no public signup system was introduced.

The working repository was inspected before editing. A read-only check of the connected database confirmed the existing identity fields (`suffix`, `sex`, `civil_status`, `citizenship`, `residency_since`, etc.) and the request fields. That check returned column names, not resident records. The three requested document-related tables were absent. Database function bodies, policies and full constraints were inspected from repository migrations, rather than represented as a complete live schema export.

Existing `users`, `requests`, `request_timeline`, `id_requests`, `notifications`, `case_history_events`, and `audit_logs` are reused. Historical `clearances` records are preserved. ID pickup appointments remain separate from ID document applications.

Confirmed initial defects included missing `SelectInput` imports in `AdminEvents.jsx` and `SuggestionsPage.jsx`; no custom router error screen; invalid use of Effect Events as event handlers in authentication; ref writes during modal rendering; menu state resets in effects; unsafe date formatting; and an unhandled initial resident-registry loading failure. The previous clearance URL always returned an unavailable-template error. The earlier duplicate-ID guard omitted confirmed and rescheduled appointments.

After the import correction, the baseline production build and 190 backend tests passed. Baseline lint reported 25 errors and 36 warnings. A successful build alone did not detect the missing JSX component imports.

## B. Implementation summary

### Resident application and profile

- Five document types: Barangay Identification Card, Certificate of Indigency, Barangay Clearance, Barangay Business Clearance, and Certificate of Residency/general certification.
- Conditional business and indigency forms, purpose, copies, inline validation, review confirmation, request references, tracking, cancellation before review, and corrections after a revision request.
- Prefilled resident details remain controlled by staff. Residents can upload, replace, preview or remove their own profile photograph. Staff can edit verified profile details and manage a request-specific photograph.
- Supporting images can be uploaded and removed before approval, including when correcting an application.
- JPEG, PNG and WebP uploads are checked by signature and decoded with Sharp. Limits are 5 MB, one frame, 160–6000 pixels per side and 16 megapixels. Images are re-encoded as PNG at up to 1200 pixels per side, stripping metadata.
- Replaced profile images are removed when unreferenced. Images used by historical approved snapshots are retained privately.

### Request processing

The new flow is `submitted → under_review → approved → document_prepared → ready_for_pickup → claimed`, with explicit revision, rejection and permitted cancellation paths. Revisions return to submitted. Legacy acknowledged/processing requests enter under review through an explicit staff action. Legacy completed records retain that value and are never assumed to have been physically claimed.

The administrative queue includes status totals, resident/reference search, document/status/date filters, profile and supporting-image views, verification checks, resident-facing responses and history. Rejection requires a reason; revision requires instructions. Approval requires the appropriate staff verification and an approved template.

Status updates, numbering, version registration and history use database transactions with row locks and expected request versions. A new portrait or supporting image also changes the request version where appropriate. Conflicting updates fail and require refresh.

Approval freezes a versioned resident snapshot, document-specific values, selected photo, verified wording, issue date and expiration. Subsequent profile changes do not alter that issuance. Names include suffixes; age is calculated at the chosen issue date.

### Editable Word files

`docx` generates actual editable paragraphs, tables, graphics and signature lines. Certificates use A4 portrait; ID pages use 85.6 × 54 mm dimensions. Separate copies use explicit section breaks. Both supplied logos are retained in the header, without a center watermark. No handwritten signature or physical seal is synthesized.

Approved requests can generate a draft, download Word files, upload an edited `.docx`, preview a selected version, and explicitly mark a reviewed version prepared. All versions are retained. A generated draft is rebuilt without its draft notice when prepared. For an uploaded revision, staff must review its numbering, dates, wording and draft notice before confirming preparation. Downloaded edits never update the database automatically.

Word uploads are limited to 10 MB and checked for ZIP/OOXML structure, valid XML, expanded content size, unsafe paths, macros, embedded executables and external relationships. The preview renders the actual saved Word file inside a sandboxed frame. Finalized versions are immutable.

The legacy `/api/requests/document/:requestId/clearance` URL now serves a prepared final `.docx` to authorized staff only. Residents cannot download internal Word files. General version downloads use `/api/documents/files/:id` with the same live role protection.

### Templates, numbering and notifications

Five proposed version-one templates are seeded as drafts, with no official's name, approval or invented validity period. A super administrator can create and approve a new template version through the template editor. Approved wording is immutable; future changes require another version.

The supported numbering stage is request approval. The approved configuration supplies an uppercase prefix; the format is `PREFIXYYYY-0001`, with a minimum four-digit sequence. Counters are serialized by prefix/year, including when two document types share a prefix. A unique request index provides an additional duplicate-number check. This reserves a number; signing, sealing, pickup and claiming are separate actions.

Before the first approval, reconcile the prefix/year counter with the barangay's manual issuance ledger. Existing paper numbers cannot be inferred from these database tables. Staff must seed the last-used value (without decreasing any existing counter), or approve a distinct new prefix. Database uniqueness alone cannot prevent a collision with a paper issuance that was never recorded in the portal.

The Notify Resident action supports received, revision, rejection, approval, pickup, reminder and custom messages. Staff see the recipient and message before sending. Each attempt is logged with actor, request, recipient, provider ID, status and a safe error code. Portal status changes do not depend on email success. Standard messages omit tax identifiers and confidential documents.

Both database and provider idempotency keys protect repeated sends. Explicit retries use the original reviewed message and key, a version check on the attempt, a 15-second cooldown and a 23-hour eligibility window. Older or stale-status messages require a new preview. Resend documents a 24-hour key lifetime. Provider acceptance is displayed as accepted, never as delivery confirmation. Existing email consumers were updated to use `accepted`; SMS retains its separate existing delivery contract. [Resend idempotency documentation](https://resend.com/changelog/idempotency-keys).

### Principal files and dependencies

Core backend files are `server/src/routes/documents.js`, `documentRules.js`, `documentStorage.js`, `documentNotifications.js`, and `wordDocuments.js`. Existing request/admin routes, startup readiness, safe error handling and mailer consumers were extended.

Core frontend files are `DocumentApplication.jsx`, `DocumentQueue.jsx`, `DocumentRequestDetail.jsx`, `ResidentPhoto.jsx`, `WordPreview.jsx`, `RouteError.jsx`, and the existing resident/admin request and settings pages. Shared auth/review/toast hooks were separated from provider components, and affected consumers updated. Loading callbacks now declare their dependencies. JSX reference checks are enabled without disabling lint rules.

Added runtime dependencies: `docx`, `sharp`, `jszip`, `fast-xml-parser`, and client `docx-preview`. Added development tooling: Playwright and the React JSX lint plugin. Compatible dependency updates were applied through the lockfiles to address audit findings. Server Node minimum is now 20.9 because the patched Sharp release requires it; the work was tested on Node 22.15.0. Do not deploy the new server on Node 18. [Sharp installation requirements](https://sharp.pixelplumbing.com/install/), [docx documentation](https://docx.js.org/).

## C. Error fixes and verification

| Problem | Correction | Evidence |
| --- | --- | --- |
| Undefined `SelectInput` | Imported the existing shared export in both affected pages; enabled JSX reference linting | Lint and browser route sweep |
| Unhandled route rendering failures | Added a root router error element with retry, dashboard link and safe reference; diagnostics stay in development logs | Browser route sweep and code inspection |
| Invalid auth hook usage | Replaced Effect Events exposed to handlers with callbacks; boot profile request has cleanup | Lint and browser login |
| Modal/render and menu effect defects | Moved callback ref updates into effects; made menu state follow the active path | Lint and browser navigation |
| Invalid historical date crashes | Added safe date checks and Manila input validation | Executable date regression test |
| Resident registry API rejection | Added a recoverable error state and retry | Code inspection, lint and route rendering |
| Admin dialog closed during refresh | Queue reload no longer unmounts the document dialog | Complete browser request-processing scenario |
| Old duplicate-ID guard | Added confirmed/rescheduled appointment states | Executed PostgreSQL test |
| Closed requests counted as active | Updated resident/admin dashboard active counts | Code inspection and regression checks |
| Internal server error exposure | Return a generic server-error message and reference; retain diagnostics server-side | Backend regression suite |
| Preview merged identical copy sections | Used explicit Word section breaks and corrected preview section handling | All five browser Word preview checks |

The new SQL tests also caught a shared-trigger field-access error during implementation. It was fixed, and the migration now installs twice and passes the transaction tests. Intermediate browser failures and test-selector corrections were resolved before the final run; no failing checks were disabled.

## D. Database deployment and recovery

1. Back up the database and private storage. Confirm the existing migration chain through `supabase-v4-phase10-5-data-security.sql` is already installed.
2. Review and apply **only** `server/supabase-v4-phase11-documents.sql` for this upgrade. It is transactional and additive; it does not reset tables or rewrite historical request statuses. It replaces the known legacy request-status enum check and extends the existing duplicate guard.
3. Run `server/verify-phase11-documents.sql`. Check readiness, private bucket settings, service-only RPC access, unique control numbers, template states and legacy anomalies. Status and copy constraints are initially `NOT VALID` to preserve anomalous historical rows; review those rows before separately validating the constraints.
   Reconcile `document_number_counters` with the official ledger before approving any template for issuance. The counter's `document_type` key stores the approved prefix; `issue_year` stores the year and `last_value` the last-used sequence.
4. Deploy the corresponding API and client together. Startup now requires `bgy_phase11_ready()`; new code intentionally refuses to start on an old schema.
5. Approve official template versions only after staff confirm wording and policies. Test a synthetic resident in staging before accepting real applications.

The migration adds five tables: `document_templates`, `document_number_counters`, `generated_documents`, `request_attachments`, and `notification_logs`. It extends `users` and `requests`, adds foreign keys/indexes and service-only RPC grants, and provisions the private `barangay-documents` bucket. Existing resident identity fields are reused.

If migration execution fails before commit, PostgreSQL rolls it back. If a release must be withdrawn after commit, stop document writes and retain the additive schema, files, counters, snapshots and history. Restore a tested application release that understands the new statuses, or keep the document workflow in maintenance while repairing forward. Do not restore the old four-state API over new active requests or drop document tables/counters as a shortcut. Database/storage restoration must be coordinated from the same backup point to avoid broken file references or reissued numbers.

No destructive down-migration is supplied because reverting after issuance must preserve historical records. No production migration was executed in this session.

## E. Test results and limits

Final checks passed: `npm run lint` (zero errors and warnings), `npm run build`, all **199 backend tests**, and all **six Playwright scenarios**. There are no remaining failing automated tests. The retained local backend log is `current-tests.txt`; Playwright writes `artifacts/browser-report/index.html` and test results locally.

Backend coverage includes existing authentication, resident access, census/registration SQL, admin invitations, audit contracts, concern limits/history, voting/projects, borrowing, reporting and route contracts, plus new document tests. The new HTTP tests execute real JWT verification, live-role middleware, ownership checks, photo decoding/upload/replacement/removal, staff-only downloads and rejected forged sessions against an injected synthetic database. External network calls are explicitly blocked in that test.

The entire forward migration executes against PostgreSQL through PGlite, twice, with controlled prerequisite fixtures. Tests exercise revision/resubmission, rejection requirements, stale versions, unique numbers, frozen snapshots, immutable files/templates, request-image removal and locked uploads. PGlite runs in-process; this is not a multi-connection concurrency stress test of the hosted Supabase instance.

All five document types are generated using synthetic data. Tests inspect the ZIP/XML, editable paragraphs/tables, exact embedded test photo, logos, control number, dates, business details, copies and absent watermark. Long names and multiline addresses are exercised structurally. Browser preview tests render each format and verify copy sections/images; the standard ID sample also fits its configured preview height. Native Microsoft Word/LibreOffice rendering and printer output were unavailable, so final pagination, page borders, long-name ID fitting and physical print calibration still need staff review in Word.

Playwright runs the actual local Vite application in installed Chrome with synthetic API responses. It sweeps 43 public/resident/admin routes, tests resident login and five conditional applications, revisions, photo validation/mobile layout, and admin review → approval → Word generation/download/revised upload/preview → preparation → pickup notification → claim. It separately renders all five generated Word samples. It does not prove a deployed browser-to-Supabase workflow. Other modules received route-rendering coverage and their existing automated tests; complete live CRUD of every module was not executed.

Notification tests cover success/acceptance, invalid/missing email, provider rejection, timeout, retry, stale previews, duplicate clicks and concurrent sends against controlled adapters. No real email recipient was contacted. Provider delivery webhooks are not implemented, so actual delivery is unverified.

Dependency checks: server full audit and client production-only audit pass with zero findings. The client development toolchain still reports seven moderate findings through Minimatch/ESLint packages with no compatible automated fix. They are not included in the production bundle. The production build retains a large-main-chunk warning (approximately 1.16 MB before gzip); Word preview is loaded separately. These warnings were not suppressed.

## F. Deployment checklist

- Use a compatible Node runtime and run `npm ci` separately in `server` and `client` using the checked-in lockfiles.
- Retain existing server-only Supabase service key/JWT configuration, allowed client origins and frontend API URL. Never place the service key or Resend key in Vite variables.
- Apply the Phase 11 migration and verify `barangay-documents` remains private. Do not add public storage policies to bypass backend retrieval.
- Verify existing Resend key, verified-domain sender and timeout settings. Test only an authorized controlled recipient in staging. Confirm portal status survives a failed email.
- Create approved template versions through the super-administrator template editor. Draft seed templates cannot issue documents.
- Review proposed business requirements, optional identifiers, selected portraits, control prefixes, validity, official contact and pickup wording.
- Run the backend suite, frontend lint/build and browser scenarios. Generate a synthetic document in staging, download/edit/upload it, review it in Word, prepare it, mark pickup and record claim.
- Confirm backup, retention and recovery procedures, especially old portraits referenced by approved snapshots and staged file cleanup failures.
- Confirm physical signing/sealing procedures separately from the portal's prepared/pickup statuses.

## G. Outstanding client decisions

Staff must approve the exact wording for every document, the authorized official and designation, the signature/dry-seal process, the supported approval-stage numbering rule, prefix formats and starting ledger counters, document validity, indigency/background verification criteria, business required fields, pickup/contact policies, and data retention. Initial seed templates intentionally remain drafts until those decisions are recorded.

The synthetic Word samples and preview screenshots under `artifacts/` are review aids, not approved official documents. The supplied document subjects, sample portraits, control numbers and official's name were not inserted into application templates.

## Changed-file inventory

See `CHANGED_FILES.txt` for the complete source/artifact inventory from this local change. Changes were not committed or deployed.

