-- Barangay Iba one-year realistic demo seed
-- Run AFTER server/supabase-security-voting-migration.sql and AFTER the reset script.
-- Demo credentials:
--   Admin: admin@gmail.com / Password123
--   Residents: resident001@example.com ... resident100@example.com / Password123
-- All names, contact details and IDs below are fictional demo data.

begin;

create extension if not exists "pgcrypto";

-- =========================================================
-- 1) ADMIN + 100 RESIDENT ACCOUNTS
-- =========================================================

with password as (
  select crypt('Password123', gen_salt('bf', 10)) as hash
)
insert into public.users (
  id, first_name, middle_name, last_name, full_name, email, password_hash,
  address, contact_number, valid_id_url, role, status, email_verified,
  email_verified_at, verification_provider, has_voted, purok, birthdate,
  username, must_change_password, is_active, created_at, updated_at
)
select
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001'::uuid,
  'System', '', 'Administrator', 'System Administrator', 'admin@gmail.com', hash,
  'Barangay Iba Hall, Silang, Cavite', '09170000000', null,
  'super_admin', 'approved', true, now() - interval '1 year', 'demo_seed', false,
  'Barangay Hall', date '1988-05-14', 'admin', false, true,
  now() - interval '1 year', now()
from password;

with
password as (
  select crypt('Password123', gen_salt('bf', 10)) as hash
),
names as (
  select
    array['Juan','Maria','Jose','Ana','Mark','Angela','Carlo','Liza','Miguel','Camille','Paolo','Jasmine','Rafael','Bianca','Daniel','Kristine','Joshua','Nicole','Gabriel','Patricia']::text[] as first_names,
    array['Santos','Dela Cruz','Reyes','Garcia','Mendoza','Bautista','Flores','Ramos','Aquino','Castillo','Navarro','Torres','Villanueva','Gonzales','Mercado','Domingo','Pascual','Rivera','Soriano','Valdez']::text[] as last_names
)
insert into public.users (
  id, first_name, middle_name, last_name, full_name, email, password_hash,
  address, contact_number, valid_id_url, role, status, email_verified,
  email_verified_at, verification_provider, has_voted, purok, birthdate,
  username, must_change_password, is_active, created_at, updated_at
)
select
  ('00000000-0000-4000-8001-' || lpad(g::text, 12, '0'))::uuid,
  first_names[1 + ((g - 1) % array_length(first_names, 1))],
  chr(65 + (((g - 1) + ((g - 1) / 20)::int * 5) % 20)),
  last_names[1 + (((((g - 1) % 20) * 7) + (((g - 1) / 20)::int * 3)) % array_length(last_names, 1))],
  first_names[1 + ((g - 1) % array_length(first_names, 1))] || ' ' ||
    chr(65 + (((g - 1) + ((g - 1) / 20)::int * 5) % 20)) || '. ' ||
    last_names[1 + (((((g - 1) % 20) * 7) + (((g - 1) / 20)::int * 3)) % array_length(last_names, 1))],
  'resident' || lpad(g::text, 3, '0') || '@example.com',
  hash,
  'House ' || (100 + g) || ', Purok ' || (1 + ((g - 1) % 6)) || ', Barangay Iba, Silang, Cavite',
  '09' || lpad((100000000 + g)::text, 9, '0'),
  'https://placehold.co/1000x650/png?text=SAMPLE+VALID+ID+' || lpad(g::text, 3, '0'),
  'resident', 'approved', true,
  now() - (((g * 13) % 350) || ' days')::interval,
  'demo_seed', false,
  'Purok ' || (1 + ((g - 1) % 6)),
  (current_date - interval '22 years' - ((g * 71) || ' days')::interval)::date,
  'resident' || lpad(g::text, 3, '0'),
  false, true,
  now() - (((g * 13) % 350) || ' days')::interval,
  now() - (((g * 3) % 45) || ' days')::interval
from generate_series(1, 100) g
cross join password
cross join names;

-- =========================================================
-- 2) PORTAL CONTENT + SETTINGS
-- =========================================================

insert into public.portal_settings (key_name, value, updated_by, updated_at) values
  ('resident_login_enabled', 'true'::jsonb, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001', now()),
  ('maintenance_mode', 'false'::jsonb, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001', now()),
  ('timezone', '"Asia/Manila"'::jsonb, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001', now()),
  ('date_format', '"MM-DD-YYYY"'::jsonb, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001', now()),
  ('complaint_email_alerts', 'false'::jsonb, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001', now()),
  ('notification_email', '"admin@gmail.com"'::jsonb, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001', now());

insert into public.landing_content (key_name, value, updated_at) values
  ('hero', jsonb_build_object(
    'title', 'Welcome to Barangay Iba',
    'description', 'Access barangay services, community updates, public transparency, events, and resident participation in one portal.'
  ), now()),
  ('contact', jsonb_build_object(
    'phone', '0917-000-0000',
    'email', 'admin@gmail.com',
    'facebook', 'Barangay Iba Official',
    'address', 'Barangay Iba, Silang, Cavite'
  ), now()),
  ('fund_projects', jsonb_build_array(
    'Drainage Rehabilitation Program',
    'Solar Street Lighting',
    'Community Health Support',
    'Covered Court Improvements'
  ), now());

-- =========================================================
-- 3) OFFICIALS + CENSUS HOUSEHOLDS
-- =========================================================

insert into public.officials (name, position, term, contact, status, photo_url, is_active, created_at) values
  ('Hon. Roberto M. Villanueva', 'Barangay Captain', '2025-2028', '09171000001', 'active', 'https://i.pravatar.cc/400?img=12', true, now() - interval '11 months'),
  ('Hon. Marites A. Santos', 'Barangay Kagawad - Peace and Order', '2025-2028', '09171000002', 'active', 'https://i.pravatar.cc/400?img=47', true, now() - interval '11 months'),
  ('Hon. Joel P. Reyes', 'Barangay Kagawad - Infrastructure', '2025-2028', '09171000003', 'active', 'https://i.pravatar.cc/400?img=15', true, now() - interval '11 months'),
  ('Hon. Lorna C. Mendoza', 'Barangay Kagawad - Health', '2025-2028', '09171000004', 'active', 'https://i.pravatar.cc/400?img=44', true, now() - interval '11 months'),
  ('Hon. Ramon D. Garcia', 'Barangay Kagawad - Environment', '2025-2028', '09171000005', 'active', 'https://i.pravatar.cc/400?img=11', true, now() - interval '11 months'),
  ('Hon. Evelyn R. Flores', 'Barangay Kagawad - Education', '2025-2028', '09171000006', 'active', 'https://i.pravatar.cc/400?img=45', true, now() - interval '11 months'),
  ('Hon. Dennis B. Ramos', 'Barangay Kagawad - Livelihood', '2025-2028', '09171000007', 'active', 'https://i.pravatar.cc/400?img=13', true, now() - interval '11 months'),
  ('Hon. April N. Bautista', 'SK Chairperson', '2025-2028', '09171000008', 'active', 'https://i.pravatar.cc/400?img=49', true, now() - interval '11 months');

insert into public.census_households (household_name, purok, members, house_number, status, updated_at, created_at)
select
  'Household ' || lpad(g::text, 3, '0'),
  'Purok ' || (1 + ((g - 1) % 6)),
  2 + ((g * 3) % 6),
  '#' || (200 + g),
  case when g % 13 = 0 then 'for update' else 'active' end,
  now() - (((g * 5) % 80) || ' days')::interval,
  now() - (((g * 11) % 360) || ' days')::interval
from generate_series(1, 72) g;

-- =========================================================
-- 4) FUNDS: SOURCES + ONE YEAR OF PROJECT/EXPENSE DATA
-- =========================================================

insert into public.fund_sources (id, name, term, allocated_amount, created_at) values
  ('50000000-0000-4000-8000-000000000001', 'National Tax Allotment', 'FY 2025-2026', 1850000.00, now() - interval '11 months'),
  ('50000000-0000-4000-8000-000000000002', 'Municipal Development Assistance', 'FY 2025-2026', 620000.00, now() - interval '10 months'),
  ('50000000-0000-4000-8000-000000000003', 'Barangay Local Revenue', 'FY 2025-2026', 410000.00, now() - interval '9 months'),
  ('50000000-0000-4000-8000-000000000004', 'Community Program Grants', 'FY 2025-2026', 350000.00, now() - interval '8 months');

with project_names as (
  select array[
    'Drainage Canal Clearing','Solar Street Light Installation','Covered Court Roof Repair','Barangay Health Supplies',
    'Senior Citizen Wellness Program','Purok Road Patching','Waste Segregation Bins','School Supply Assistance',
    'Emergency Response Equipment','Community Garden Materials','Anti-Dengue Clean-Up','Youth Sports League',
    'Barangay Hall Network Upgrade','Day Care Learning Materials','Flood Warning Signage','Livelihood Skills Workshop',
    'Medical Mission Support','Public Address System Repair','Creek Rehabilitation','Disaster Preparedness Kits',
    'Street Name and Direction Signs','Nutrition Month Program','Community CCTV Maintenance','Tree Planting Program'
  ]::text[] names
)
insert into public.fund_projects (name, date, amount, description, receipt_url, term, status, created_at)
select
  names[g],
  current_date - ((360 - g * 13) || ' days')::interval,
  18000 + ((g * 17350) % 135000),
  'Recorded barangay expenditure for ' || lower(names[g]) || ', including materials, logistics, labor, and implementation support.',
  'https://placehold.co/1000x700/png?text=Sample+Receipt+' || lpad(g::text, 2, '0'),
  'FY 2025-2026',
  case when g <= 19 then 'completed' when g <= 22 then 'ongoing' else 'cancelled' end,
  now() - ((360 - g * 13) || ' days')::interval
from generate_series(1, 24) g
cross join project_names;

-- =========================================================
-- 5) NEWS + ANNOUNCEMENTS ACROSS THE YEAR
-- =========================================================

with titles as (
  select
    array[
      'Drainage rehabilitation completed in flood-prone area','Barangay medical mission serves local families','New solar street lights activated','Community clean-up drive removes roadside waste',
      'Covered court repair reaches completion','Senior wellness day held at barangay hall','Youth sports league opens with six teams','Emergency response volunteers complete training',
      'Nutrition program supports children and parents','Barangay launches updated resident service portal','Purok road patching completed before rainy season','Tree planting activity adds native seedlings',
      'Health center receives new basic equipment','Community garden begins first harvest','Disaster drill conducted with resident volunteers','School supply assistance distributed to learners',
      'Waste segregation campaign expands to all puroks','Creek clearing project reduces blocked waterways','Livelihood workshop trains home-based entrepreneurs','Barangay CCTV maintenance completed'
    ]::text[] news_titles,
    array[
      'Scheduled water interruption advisory','Barangay hall holiday schedule','Resident ID pickup schedule updated','Community assembly notice',
      'Free blood pressure screening this weekend','Road clearing activity advisory','Deadline for project suggestions','Voting period opens for community projects',
      'Voting closes Friday at 5:00 PM','Monthly clean-up drive reminder','Senior citizen registration desk schedule','Medical mission registration reminder',
      'Covered court unavailable for maintenance','Purok meeting schedule posted','Fire safety seminar registration','Barangay census update reminder',
      'Public transparency report now available','Rainy season preparedness reminder','Youth sports registration opens','Barangay office service hours update'
    ]::text[] announcement_titles
)
insert into public.announcements (title, body, image_url, type, created_at)
select
  news_titles[g],
  news_titles[g] || '. Barangay Iba residents were informed through the portal as part of regular community updates and public information reporting.',
  'https://picsum.photos/seed/barangay-news-' || g || '/1200/700',
  'news',
  now() - ((365 - g * 17) || ' days')::interval
from generate_series(1, 20) g cross join titles
union all
select
  announcement_titles[g],
  announcement_titles[g] || '. Residents are encouraged to review the complete notice and follow the posted schedule or instructions.',
  'https://picsum.photos/seed/barangay-announcement-' || g || '/1200/700',
  'announcement',
  now() - ((350 - g * 16) || ' days')::interval
from generate_series(1, 20) g cross join titles;

-- =========================================================
-- 6) EVENTS: PAST + UPCOMING
-- =========================================================

with event_names as (
  select array[
    'Barangay General Assembly','Free Medical Mission','Purok Clean-Up Drive','Anti-Dengue Campaign','Youth Basketball Opening',
    'Senior Citizen Wellness Day','Disaster Preparedness Seminar','Community Tree Planting','Livelihood Skills Workshop','Blood Donation Drive',
    'Nutrition Month Activity','Fire Safety Orientation','Barangay Sports Finals','Resident Consultation Day','Community Garden Day',
    'Census Validation Schedule','Women''s Health Seminar','Road Safety Orientation','Project Transparency Forum','Christmas Community Program',
    'New Year Community Clean-Up','First Aid Training','Youth Leadership Workshop','Barangay General Assembly - Q3'
  ]::text[] names
)
insert into public.events (title, date, time, location, description, type, created_at)
select
  names[g],
  current_date - interval '300 days' + (g * interval '14 days'),
  case when g % 3 = 0 then '13:30'::time when g % 3 = 1 then '08:00'::time else '09:30'::time end,
  case when g % 4 = 0 then 'Barangay Hall' when g % 4 = 1 then 'Barangay Covered Court' when g % 4 = 2 then 'Purok ' || (1 + (g % 6)) || ' Assembly Area' else 'Barangay Health Center' end,
  'Community activity recorded in the Barangay Iba portal. Residents may check this event for schedule, location, and participation details.',
  case when g % 5 = 0 then 'health' when g % 5 = 1 then 'assembly' when g % 5 = 2 then 'clean-up' when g % 5 = 3 then 'training' else 'community' end,
  now() - interval '305 days' + (g * interval '14 days')
from generate_series(1, 24) g cross join event_names;

-- Add several clearly upcoming events regardless of the date the seed is run.
insert into public.events (title, date, time, location, description, type, created_at) values
  ('Upcoming Free Medical Mission', current_date + 5, '08:00', 'Barangay Covered Court', 'Free basic consultation, blood pressure screening, and medicine assistance for registered residents.', 'health', now()),
  ('Quarterly Barangay Assembly', current_date + 12, '14:00', 'Barangay Covered Court', 'Quarterly public assembly covering projects, funds, services, and resident concerns.', 'assembly', now()),
  ('Purok 3 Community Clean-Up', current_date + 18, '07:00', 'Purok 3 Assembly Area', 'Drainage clearing and roadside waste collection with resident volunteers.', 'clean-up', now()),
  ('Disaster Preparedness Drill', current_date + 25, '09:00', 'Barangay Hall Grounds', 'Community earthquake and evacuation drill coordinated by barangay response volunteers.', 'training', now());

-- =========================================================
-- 7) RESIDENT SERVICE REQUESTS + TIMELINES
-- =========================================================

with residents as (
  select id, full_name, row_number() over (order by email) rn
  from public.users where role = 'resident'
), generated as (
  select g, r.id user_id, r.full_name,
    case (g % 5)
      when 0 then 'Barangay Clearance'
      when 1 then 'Certificate of Residency'
      when 2 then 'Certificate of Indigency'
      when 3 then 'Barangay Certification'
      else 'Other'
    end request_type,
    case
      when g % 20 < 11 then 'completed'
      when g % 20 in (11,12) then 'ready_for_release'
      when g % 20 in (13,14,15) then 'processing'
      when g % 20 = 16 then 'acknowledged'
      when g % 20 = 17 then 'needs_information'
      when g % 20 = 18 then 'rejected'
      else 'cancelled'
    end status,
    now() - (((g * 17) % 360) || ' days')::interval created_at
  from generate_series(1, 260) g
  join residents r on r.rn = 1 + ((g - 1) % 100)
)
insert into public.requests (user_id, resident_name, request_type, status, created_at, details, admin_note, preferred_schedule_date, preferred_time_slot, updated_at)
select
  user_id, full_name, request_type, status, created_at,
  case request_type
    when 'Barangay Clearance' then 'For employment and general legal requirements.'
    when 'Certificate of Residency' then 'For proof of residence and local documentation.'
    when 'Certificate of Indigency' then 'For assistance and supporting documentation.'
    when 'Barangay Certification' then 'For school, employment, or local transaction requirement.'
    else 'Resident requested assistance with a general barangay document or service.'
  end,
  case status
    when 'needs_information' then 'Please upload or present one additional supporting document.'
    when 'ready_for_release' then 'Document is ready for release at the barangay hall.'
    when 'rejected' then 'Request could not be completed because the submitted purpose or information was incomplete.'
    when 'completed' then 'Released to resident.'
    else ''
  end,
  null, null,
  case when status = 'completed' then created_at + interval '4 days' else created_at + interval '1 day' end
from generated;

insert into public.request_timeline (request_id, status, note, created_at)
select id, 'submitted', 'Request submitted through the resident portal.', created_at from public.requests;
insert into public.request_timeline (request_id, status, note, created_at)
select id, 'acknowledged', 'Barangay staff acknowledged the request.', created_at + interval '8 hours'
from public.requests where status in ('acknowledged','processing','needs_information','ready_for_release','completed');
insert into public.request_timeline (request_id, status, note, created_at)
select id, 'processing', 'Request is being processed by barangay staff.', created_at + interval '1 day'
from public.requests where status in ('processing','needs_information','ready_for_release','completed');
insert into public.request_timeline (request_id, status, note, created_at)
select id, 'ready_for_release', 'Document is ready for release.', created_at + interval '3 days'
from public.requests where status in ('ready_for_release','completed');
insert into public.request_timeline (request_id, status, note, created_at)
select id, 'completed', 'Document released and request completed.', created_at + interval '4 days'
from public.requests where status = 'completed';
insert into public.request_timeline (request_id, status, note, created_at)
select id, status, case status when 'needs_information' then 'Additional information is required from the resident.' when 'rejected' then 'Request was rejected after review.' when 'cancelled' then 'Request was cancelled.' end, created_at + interval '2 days'
from public.requests where status in ('needs_information','rejected','cancelled');

-- Legacy clearance records retained for the older clearance view.
insert into public.clearances (resident_name, type, request_date, issued_date, status, notes, created_at)
select
  u.full_name,
  case when g % 3 = 0 then 'Barangay Clearance' when g % 3 = 1 then 'Certificate of Residency' else 'Certificate of Indigency' end,
  current_date - ((g * 8) % 330),
  case when g % 5 <> 0 then current_date - ((g * 8) % 330) + 2 else null end,
  case when g % 5 <> 0 then 'approved' else 'pending' end,
  'Demo historical document record.',
  now() - (((g * 8) % 330) || ' days')::interval
from generate_series(1, 48) g
join public.users u on u.email = 'resident' || lpad((1 + ((g - 1) % 100))::text, 3, '0') || '@example.com';

-- =========================================================
-- 8) BARANGAY ID PICKUP SLOTS + REQUEST HISTORY
-- =========================================================

insert into public.id_pickup_slots (slot_date, time_slot, capacity, is_active, created_at)
select d::date, t.slot, 8 + ((extract(day from d)::int + t.n) % 5), true, now()
from generate_series(current_date + 1, current_date + 35, interval '1 day') d
cross join (values (1,'09:00 AM - 10:00 AM'),(2,'10:30 AM - 11:30 AM'),(3,'01:30 PM - 02:30 PM')) t(n, slot)
where extract(isodow from d) between 1 and 6;

with residents as (
  select id, row_number() over (order by email) rn from public.users where role='resident'
)
insert into public.id_requests (user_id, purpose, preferred_date, time_slot, status, admin_note, pickup_reminder_sent_at, created_at)
select
  r.id,
  case when g % 3 = 0 then 'First Barangay ID application' when g % 3 = 1 then 'Barangay ID renewal' else 'Replacement of damaged Barangay ID' end,
  case when g > 68 then current_date + (1 + (g % 24)) else current_date - (20 + ((g * 7) % 300)) end,
  case when g % 3 = 0 then '09:00 AM - 10:00 AM' when g % 3 = 1 then '10:30 AM - 11:30 AM' else '01:30 PM - 02:30 PM' end,
  case
    when g <= 50 then 'completed'
    when g <= 60 then 'cancelled'
    when g <= 68 then 'rescheduled'
    when g <= 74 then 'ready_for_pickup'
    when g <= 80 then 'confirmed'
    else 'submitted'
  end,
  case when g <= 50 then 'ID released to resident.' when g between 61 and 68 then 'Pickup schedule was adjusted after resident coordination.' when g between 69 and 74 then 'Barangay ID is ready for pickup.' else '' end,
  case when g between 69 and 80 then now() - interval '1 day' else null end,
  now() - (((g * 9) % 340) || ' days')::interval
from generate_series(1, 86) g
join residents r on r.rn = 1 + ((g - 1) % 100);

-- =========================================================
-- 9) COMPLAINTS ACROSS THE YEAR
-- =========================================================

with residents as (
  select id, full_name, row_number() over (order by email) rn from public.users where role='resident'
), types as (
  select array['Noise Concern','Blocked Drainage','Street Lighting','Waste Collection','Stray Animals','Road Obstruction','Public Safety','Neighbor Dispute']::text[] vals
)
insert into public.complaints (user_id, resident_name, complaint_type, details, status, created_at, reference_code, priority, admin_note, updated_at, resolved_at)
select
  r.id, r.full_name,
  vals[1 + ((g - 1) % array_length(vals,1))],
  'Resident report #' || g || ' describing an issue observed in Purok ' || (1 + ((g - 1) % 6)) || '. This demo record includes enough detail for barangay staff review and follow-up.',
  case when g % 10 <= 4 then 'resolved' when g % 10 = 5 then 'closed' when g % 10 in (6,7) then 'in_progress' when g % 10 = 8 then 'under_review' else 'submitted' end,
  now() - (((g * 11) % 360) || ' days')::interval,
  'CMP-' || lpad(g::text, 6, '0'),
  case when g % 17 = 0 then 'urgent' when g % 5 = 0 then 'high' when g % 4 = 0 then 'low' else 'normal' end,
  case when g % 10 <= 5 then 'Barangay staff coordinated the concern and recorded the latest action.' when g % 10 in (6,7) then 'Assigned for field verification and follow-up.' else '' end,
  now() - (((g * 11) % 360) || ' days')::interval + interval '2 days',
  case when g % 10 <= 5 then now() - (((g * 11) % 360) || ' days')::interval + interval '3 days' else null end
from generate_series(1, 125) g
join residents r on r.rn = 1 + ((g - 1) % 100)
cross join types;

-- =========================================================
-- 10) RESIDENT PROJECT SUGGESTIONS
-- =========================================================

with residents as (
  select id, row_number() over (order by email) rn from public.users where role='resident'
), suggestion_names as (
  select array[
    'Drainage Improvement','Solar Street Lights','Health Center Waiting Area','Covered Court Roof Repair','Community CCTV Expansion',
    'Purok Road Repair','Waste Segregation Stations','Community Garden','Senior Exercise Area','Youth Study Hub',
    'Flood Warning Signage','Creek Rehabilitation','Barangay Reading Corner','Emergency Water Storage','Pedestrian Safety Markings',
    'Tree Planting Corridor','First Aid Equipment','Public Wi-Fi Zone','Day Care Improvement','Livelihood Training Area'
  ]::text[] vals
)
insert into public.project_suggestions (
  id, user_id, title, description, image_url, status, created_at,
  admin_feedback, reviewed_by, reviewed_at, updated_at, purok, category
)
select
  ('10000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid,
  r.id,
  vals[1 + ((g - 1) % array_length(vals,1))] || case when g > 20 then ' - Phase ' || (1 + ((g - 1) / 20)) else '' end,
  'Resident proposal to improve community services and shared facilities. The suggestion includes a practical local need, expected resident benefit, and proposed area for implementation.',
  'https://picsum.photos/seed/barangay-project-' || lpad(g::text,3,'0') || '/1200/700',
  case
    when g <= 39 then 'approved'
    when g <= 45 then 'approved'
    when g <= 49 then 'under_review'
    when g <= 53 then 'needs_revision'
    when g <= 56 then 'rejected'
    else 'submitted'
  end,
  now() - (((g * 6) % 345) || ' days')::interval,
  case when g between 50 and 53 then 'Please add a more specific location and explain the number of residents expected to benefit.' when g between 54 and 56 then 'A similar project is already covered by an existing barangay program.' else '' end,
  case when g <= 56 then 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001'::uuid else null end,
  case when g <= 56 then now() - (((g * 6) % 345) || ' days')::interval + interval '2 days' else null end,
  now() - (((g * 5) % 300) || ' days')::interval,
  'Purok ' || (1 + ((g - 1) % 6)),
  case when g % 5 = 0 then 'health' when g % 5 = 1 then 'infrastructure' when g % 5 = 2 then 'environment' when g % 5 = 3 then 'safety' else 'community' end
from generate_series(1, 60) g
join residents r on r.rn = 1 + ((g - 1) % 100)
cross join suggestion_names;

-- =========================================================
-- 11) ELECTION HISTORY, CURRENT VOTING, UPCOMING + DRAFT
-- =========================================================

insert into public.elections (
  id, title, description, status, starts_at, ends_at, created_at, image_url,
  source_suggestion_id, closing_soon_notified_at, results_visibility,
  finalized_at, finalized_by, result_status, winning_option_id,
  runoff_of_election_id, opened_notified_at, closed_notified_at, updated_at
) values
  ('20000000-0000-4000-8000-000000000001','Covered Court Improvement Vote','Residents selected the priority improvement for the covered court area.','archived',now()-interval '330 days',now()-interval '327 days',now()-interval '335 days','https://picsum.photos/seed/election-1/1400/800','10000000-0000-4000-8000-000000000001',null,'after_close',now()-interval '326 days','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001','winner',null,null,now()-interval '330 days',now()-interval '327 days',now()-interval '326 days'),
  ('20000000-0000-4000-8000-000000000002','Drainage Priority Vote','Residents ranked drainage and flood-mitigation projects.','archived',now()-interval '290 days',now()-interval '287 days',now()-interval '295 days','https://picsum.photos/seed/election-2/1400/800','10000000-0000-4000-8000-000000000004',null,'after_close',now()-interval '286 days','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001','winner',null,null,now()-interval '290 days',now()-interval '287 days',now()-interval '286 days'),
  ('20000000-0000-4000-8000-000000000003','Community Health Project Vote','Residents chose among health and wellness improvements.','archived',now()-interval '250 days',now()-interval '247 days',now()-interval '255 days','https://picsum.photos/seed/election-3/1400/800','10000000-0000-4000-8000-000000000007',null,'after_close',now()-interval '246 days','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001','winner',null,null,now()-interval '250 days',now()-interval '247 days',now()-interval '246 days'),
  ('20000000-0000-4000-8000-000000000004','Community Safety Priority Vote','A community vote that ended in a tie and required a runoff.','archived',now()-interval '210 days',now()-interval '207 days',now()-interval '215 days','https://picsum.photos/seed/election-4/1400/800','10000000-0000-4000-8000-000000000010',null,'after_close',now()-interval '206 days','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001','tie',null,null,now()-interval '210 days',now()-interval '207 days',now()-interval '206 days'),
  ('20000000-0000-4000-8000-000000000005','Community Safety Runoff','Runoff between the two tied community safety proposals.','archived',now()-interval '190 days',now()-interval '187 days',now()-interval '193 days','https://picsum.photos/seed/election-5/1400/800','10000000-0000-4000-8000-000000000010',null,'after_close',now()-interval '186 days','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001','winner',null,'20000000-0000-4000-8000-000000000004',now()-interval '190 days',now()-interval '187 days',now()-interval '186 days'),
  ('20000000-0000-4000-8000-000000000006','Environment Project Vote','Residents selected the next environment-focused community project.','archived',now()-interval '150 days',now()-interval '147 days',now()-interval '155 days','https://picsum.photos/seed/election-6/1400/800','10000000-0000-4000-8000-000000000016',null,'after_close',now()-interval '146 days','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001','winner',null,null,now()-interval '150 days',now()-interval '147 days',now()-interval '146 days'),
  ('20000000-0000-4000-8000-000000000007','Youth and Learning Project Vote','Residents voted on youth and education priorities.','archived',now()-interval '110 days',now()-interval '107 days',now()-interval '115 days','https://picsum.photos/seed/election-7/1400/800','10000000-0000-4000-8000-000000000019',null,'after_close',now()-interval '106 days','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001','winner',null,null,now()-interval '110 days',now()-interval '107 days',now()-interval '106 days'),
  ('20000000-0000-4000-8000-000000000008','Disaster Preparedness Priority Vote','Residents selected the next disaster-preparedness investment.','finalized',now()-interval '70 days',now()-interval '67 days',now()-interval '75 days','https://picsum.photos/seed/election-8/1400/800','10000000-0000-4000-8000-000000000022',null,'after_close',now()-interval '66 days','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001','winner',null,null,now()-interval '70 days',now()-interval '67 days',now()-interval '66 days'),
  ('20000000-0000-4000-8000-000000000009','Purok Access Improvement Vote','Recently closed election awaiting formal result finalization.','closed',now()-interval '25 days',now()-interval '22 days',now()-interval '30 days','https://picsum.photos/seed/election-9/1400/800','10000000-0000-4000-8000-000000000025',null,'after_close',null,null,null,null,null,now()-interval '25 days',now()-interval '22 days',now()-interval '22 days'),
  ('20000000-0000-4000-8000-000000000010','Current Community Project Voting','Choose the next community improvement priority for Barangay Iba.','live',now()-interval '2 days',now()+interval '3 days',now()-interval '5 days','https://picsum.photos/seed/election-current/1400/800','10000000-0000-4000-8000-000000000028',null,'after_close',null,null,null,null,null,now()-interval '2 days',null,now()),
  ('20000000-0000-4000-8000-000000000011','Upcoming Health and Safety Vote','Scheduled resident vote for the next health and safety initiative.','scheduled',now()+interval '10 days',now()+interval '13 days',now()-interval '2 days','https://picsum.photos/seed/election-upcoming/1400/800','10000000-0000-4000-8000-000000000031',null,'after_close',null,null,null,null,null,null,null,now()),
  ('20000000-0000-4000-8000-000000000012','2027 Community Facilities Draft','Draft election being prepared by the barangay administration.','draft',null,null,now()-interval '1 day','https://picsum.photos/seed/election-draft/1400/800','10000000-0000-4000-8000-000000000034',null,'after_close',null,null,null,null,null,null,null,now()),
  ('20000000-0000-4000-8000-000000000013','Cancelled Special Consultation Vote','Sample cancelled election retained for administrative history.','cancelled',now()-interval '45 days',now()-interval '42 days',now()-interval '50 days','https://picsum.photos/seed/election-cancelled/1400/800','10000000-0000-4000-8000-000000000037',null,'after_close',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001','cancelled',null,null,null,null,now()-interval '44 days');

-- Three options per election, except the runoff which has two.
insert into public.election_options (id, election_id, name, description, votes_count, created_at, source_suggestion_id, image_url)
select
  ('30000000-0000-4000-8000-' || lpad((e * 10 + o)::text,12,'0'))::uuid,
  ('20000000-0000-4000-8000-' || lpad(e::text,12,'0'))::uuid,
  s.title,
  s.description,
  0,
  coalesce(el.starts_at, el.created_at) - interval '1 day',
  s.id,
  s.image_url
from generate_series(1,13) e
cross join generate_series(1,3) o
join public.elections el on el.id = ('20000000-0000-4000-8000-' || lpad(e::text,12,'0'))::uuid
join public.project_suggestions s on s.id = ('10000000-0000-4000-8000-' || lpad((((e-1)*3+o))::text,12,'0'))::uuid
where e <> 5;

-- Runoff reuses the top two options from election 4.
insert into public.election_options (id, election_id, name, description, votes_count, created_at, source_suggestion_id, image_url)
select
  ('30000000-0000-4000-8000-' || lpad((50 + o)::text,12,'0'))::uuid,
  '20000000-0000-4000-8000-000000000005'::uuid,
  s.title,
  s.description,
  0,
  now()-interval '191 days',
  s.id,
  s.image_url
from generate_series(1,2) o
join public.project_suggestions s on s.id = ('10000000-0000-4000-8000-' || lpad((9+o)::text,12,'0'))::uuid;

-- Mark source suggestions as already used in voting.
update public.project_suggestions
set status='included_in_voting', updated_at=now()
where id in (
  select distinct eo.source_suggestion_id
  from public.election_options eo
  join public.elections e on e.id = eo.election_id
  where eo.source_suggestion_id is not null
    and e.status <> 'draft'
);

-- Freeze 100 eligible residents for every real/scheduled election.
with residents as (
  select id from public.users where role='resident' order by email
)
insert into public.election_voters (election_id, user_id, eligible, voted_at, created_at)
select e.id, r.id, true, null, coalesce(e.starts_at, e.created_at) - interval '1 day'
from public.elections e
cross join residents r
where e.status in ('archived','finalized','closed','live','scheduled');

-- Vote counts by election. Election 4 intentionally ties; election 5 is the runoff.
with residents as (
  select id, row_number() over(order by email) rn from public.users where role='resident'
), targets(election_no,total_votes) as (
  values (1,72),(2,68),(3,81),(4,60),(5,61),(6,64),(7,78),(8,70),(9,62),(10,48)
), base as (
  select t.election_no, t.total_votes, r.id user_id, r.rn,
    case
      when t.election_no = 4 then case when r.rn <= 30 then 1 else 2 end
      when t.election_no = 5 then case when r.rn <= 35 then 1 else 2 end
      when r.rn <= ceil(t.total_votes * 0.52) then 1
      when r.rn <= ceil(t.total_votes * 0.82) then 2
      else 3
    end option_no
  from targets t
  join residents r on r.rn <= t.total_votes
)
insert into public.votes (election_id, option_id, user_id, created_at, receipt_code)
select
  ('20000000-0000-4000-8000-' || lpad(election_no::text,12,'0'))::uuid,
  ('30000000-0000-4000-8000-' || lpad((election_no*10+option_no)::text,12,'0'))::uuid,
  user_id,
  e.starts_at + ((rn % 48) || ' hours')::interval,
  'VOTE-' || lpad(election_no::text,2,'0') || lpad(rn::text,4,'0')
from base
join public.elections e on e.id=('20000000-0000-4000-8000-' || lpad(election_no::text,12,'0'))::uuid;

-- Keep resident001 available for hands-on testing of the currently live vote.
delete from public.votes
where election_id = '20000000-0000-4000-8000-000000000010'::uuid
  and user_id = '00000000-0000-4000-8001-000000000001'::uuid;

-- Keep the legacy users.has_voted flag consistent with the current live election only.
update public.users u
set has_voted = exists (
  select 1
  from public.votes v
  where v.election_id = '20000000-0000-4000-8000-000000000010'::uuid
    and v.user_id = u.id
)
where u.role = 'resident';

update public.election_voters ev
set voted_at = v.created_at
from public.votes v
where v.election_id = ev.election_id and v.user_id = ev.user_id;

update public.election_options eo
set votes_count = counts.cnt
from (
  select option_id, count(*)::int cnt from public.votes group by option_id
) counts
where eo.id = counts.option_id;

-- Set winner/result metadata for finalized/archived elections 1-8.
with ranked as (
  select eo.election_id, eo.id option_id, eo.source_suggestion_id, eo.votes_count,
         dense_rank() over(partition by eo.election_id order by eo.votes_count desc) rk,
         count(*) over(partition by eo.election_id, eo.votes_count) same_count
  from public.election_options eo
  where eo.election_id in (select id from public.elections where status in ('archived','finalized'))
), winners as (
  select election_id,
         case when max(case when rk=1 then same_count else 0 end) > 1 then null else (min(option_id::text) filter(where rk=1))::uuid end winning_option_id,
         case when max(case when rk=1 then same_count else 0 end) > 1 then 'tie' else 'winner' end result_status
  from ranked group by election_id
)
update public.elections e
set winning_option_id=w.winning_option_id, result_status=w.result_status
from winners w where e.id=w.election_id;

insert into public.election_results (election_id, result_status, winning_option_id, total_votes, eligible_voters, participation_rate, finalized_by, finalized_at, snapshot)
select
  e.id,
  e.result_status,
  e.winning_option_id,
  (select count(*) from public.votes v where v.election_id=e.id),
  (select count(*) from public.election_voters ev where ev.election_id=e.id and ev.eligible=true),
  round(((select count(*) from public.votes v where v.election_id=e.id)::numeric / nullif((select count(*) from public.election_voters ev where ev.election_id=e.id and ev.eligible=true),0)) * 100, 2),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001'::uuid,
  e.finalized_at,
  jsonb_build_object('seededDemo',true,'title',e.title,'note','Official result snapshot generated for the one-year demo dataset')
from public.elections e
where e.status in ('archived','finalized');

update public.project_suggestions ps
set status='selected', updated_at=now()
where ps.id in (
  select eo.source_suggestion_id
  from public.elections e
  join public.election_options eo on eo.id=e.winning_option_id
  where e.result_status='winner' and e.status in ('archived','finalized')
);

-- =========================================================
-- 12) COMMUNITY PROJECTS + PROGRESS UPDATES + CONFIRMATIONS
-- =========================================================

insert into public.community_projects (
  id, source_election_id, winning_option_id, source_suggestion_id,
  title, description, location, purok, status, progress_percentage,
  planned_start_date, actual_start_date, target_completion_date, actual_completion_date,
  allocated_budget, actual_cost, created_by, created_at, updated_at
)
select
  ('40000000-0000-4000-8000-' || lpad(row_number() over(order by e.starts_at)::text,12,'0'))::uuid,
  e.id, e.winning_option_id, eo.source_suggestion_id,
  eo.name,
  eo.description,
  case when row_number() over(order by e.starts_at) % 2 = 0 then 'Barangay Hall / Covered Court Area' else 'Purok ' || (1 + (row_number() over(order by e.starts_at)::int % 6)) end,
  'Purok ' || (1 + (row_number() over(order by e.starts_at)::int % 6)),
  case row_number() over(order by e.starts_at)
    when 1 then 'completed' when 2 then 'completed' when 3 then 'completed'
    when 4 then 'in_progress' when 5 then 'completed' when 6 then 'preparation' else 'planned' end,
  case row_number() over(order by e.starts_at)
    when 1 then 100 when 2 then 100 when 3 then 100 when 4 then 72 when 5 then 100 when 6 then 25 else 10 end,
  e.ends_at::date + 14,
  case when row_number() over(order by e.starts_at) <= 6 then e.ends_at::date + 20 else null end,
  e.ends_at::date + 100,
  case when row_number() over(order by e.starts_at) in (1,2,3,5) then e.ends_at::date + 80 else null end,
  120000 + row_number() over(order by e.starts_at) * 45000,
  case when row_number() over(order by e.starts_at) in (1,2,3,5) then 108000 + row_number() over(order by e.starts_at) * 41000 else null end,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001'::uuid,
  e.finalized_at,
  case when row_number() over(order by e.starts_at) in (1,2,3,5) then e.finalized_at + interval '80 days' else now() - interval '3 days' end
from public.elections e
join public.election_options eo on eo.id=e.winning_option_id
where e.id in (
  '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000008'
);

with projects as (
  select id, status, progress_percentage, row_number() over(order by created_at) rn from public.community_projects
)
insert into public.project_updates (project_id, title, description, progress_percentage, image_url, created_by, created_at)
select p.id,
  case u when 1 then 'Project mobilization' when 2 then 'Mid-project progress' else 'Latest implementation update' end,
  case u when 1 then 'Initial coordination, materials preparation, and site verification completed.' when 2 then 'Implementation work progressed according to the approved community project plan.' else 'Latest progress was documented for resident transparency and project monitoring.' end,
  least(p.progress_percentage, case u when 1 then 20 when 2 then 55 else p.progress_percentage end),
  'https://picsum.photos/seed/project-progress-' || p.rn || '-' || u || '/1200/700',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001'::uuid,
  x.then_now
from projects p
cross join generate_series(1,3) u
cross join lateral (select now() - ((90 - p.rn*7 - u*12) || ' days')::interval as then_now) x;

-- Resident confirmations only for projects actually marked completed.
with residents as (
  select id, row_number() over(order by email) rn from public.users where role='resident'
), completed_projects as (
  select id, row_number() over(order by created_at) pn from public.community_projects where status='completed'
)
insert into public.project_completion_confirmations (project_id, user_id, created_at)
select p.id, r.id, now() - (((p.pn * 7 + r.rn) % 45) || ' days')::interval
from completed_projects p
join residents r on r.rn <= 30 + p.pn * 3;

-- Legacy completion data for backwards-compatible dashboard metrics.
with residents as (
  select id, row_number() over(order by email) rn from public.users where role='resident'
), completed_projects as (
  select source_election_id, row_number() over(order by created_at) pn from public.community_projects where status='completed' and source_election_id is not null
)
insert into public.project_completions (election_id, user_id, created_at)
select p.source_election_id, r.id, now() - (((p.pn * 9 + r.rn) % 50) || ' days')::interval
from completed_projects p
join residents r on r.rn <= 20 + p.pn * 2;

-- =========================================================
-- 13) NOTIFICATIONS + AUDIT HISTORY
-- =========================================================

with residents as (
  select id, row_number() over(order by email) rn from public.users where role='resident'
)
insert into public.notifications (user_id, title, body, kind, broadcast, created_at, is_read, read_at)
select r.id,
  case n
    when 1 then 'Request status updated'
    when 2 then 'Community voting update'
    when 3 then 'Barangay announcement'
    else 'Project progress update'
  end,
  case n
    when 1 then 'One of your resident service requests has a new status. Open My Requests for details.'
    when 2 then 'A barangay community project vote or result is available in the Voting section.'
    when 3 then 'A new barangay notice was posted for residents.'
    else 'A winning community project has a new implementation update.'
  end,
  case n when 1 then 'info' when 2 then 'success' when 3 then 'info' else 'info' end,
  false,
  now() - (((r.rn * 7 + n * 19) % 180) || ' days')::interval,
  ((r.rn + n) % 3 <> 0),
  case when ((r.rn+n)%3<>0) then now() - (((r.rn*7+n*19)%180) || ' days')::interval + interval '1 day' else null end
from residents r cross join generate_series(1,4) n;

insert into public.notifications (user_id, title, body, kind, broadcast, created_at, is_read, read_at)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001'::uuid,
  'Administrative activity #' || g,
  'Demo administrative notification covering resident requests, complaints, voting, funds, or content management.',
  case when g % 7 = 0 then 'warning' else 'info' end,
  false,
  now() - ((g * 4) || ' days')::interval,
  g % 4 <> 0,
  case when g % 4 <> 0 then now() - ((g * 4 - 1) || ' days')::interval else null end
from generate_series(1,28) g;

-- General system audit activity over roughly one year.
insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, details, created_at)
select
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001'::uuid,
  'super_admin',
  (array['update_request','review_complaint','post_announcement','create_event','update_fund_project','update_resident','review_project_suggestion'])[1+((g-1)%7)],
  (array['request','complaint','announcement','event','fund_project','user','project_suggestion'])[1+((g-1)%7)],
  'DEMO-' || lpad(g::text,5,'0'),
  jsonb_build_object('seededDemo',true,'sequence',g),
  now() - (((g * 13) % 360) || ' days')::interval
from generate_series(1,260) g;

-- Voting-focused audit entries for the Voting Audit submodule.
insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, details, created_at)
select
  case when g % 4 = 0 then ('00000000-0000-4000-8001-' || lpad((1+((g-1)%100))::text,12,'0'))::uuid else 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001'::uuid end,
  case when g % 4 = 0 then 'resident' else 'super_admin' end,
  (array['vote_participation','save_election','finalize_election','create_community_project','review_project_suggestion','create_project_update'])[1+((g-1)%6)],
  (array['election','election','election','community_project','project_suggestion','community_project'])[1+((g-1)%6)],
  'VOTE-DEMO-' || lpad(g::text,4,'0'),
  jsonb_build_object('seededDemo',true,'privacyNote','No selected voting option is stored in this audit detail.'),
  now() - (((g * 17) % 350) || ' days')::interval
from generate_series(1,140) g;

commit;
