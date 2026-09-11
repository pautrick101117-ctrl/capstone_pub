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
  ((select id from public.users where username='resident29'), (select id from public.borrowable_assets where name='Projector'), 1, 'School presentation', 'Purok 5 learning session', now() + interval '9 days', now() + interval '9 days 6 hours', 'rejected', 'Projector is reserved for a barangay training on the same date.', now() - interval '2 days', null, null, null, null, null, null, '', now() - interval '3 days', now() - interval '2 days'),
  ((select id from public.users where username='resident33'), (select id from public.borrowable_assets where name='Multipurpose Hall'), 1, 'Homeowners meeting', 'Barangay Multipurpose Hall', now() + interval '10 days', now() + interval '10 days 4 hours', 'pending', '', now() - interval '1 day', null, null, null, null, null, null, '', now() - interval '1 day', now() - interval '1 day'),
  ((select id from public.users where username='resident36'), (select id from public.borrowable_assets where name='Event Tent'), 1, 'Birthday celebration', 'Purok 6 residence', now() + interval '12 days', now() + interval '13 days', 'cancelled', 'Cancelled by resident.', now() - interval '5 days', null, null, null, null, null, null, '', now() - interval '6 days', now() - interval '2 days'),
  ((select id from public.users where username='resident40'), (select id from public.borrowable_assets where name='Monobloc Chairs'), 80, 'Wedding reception', 'Purok 4 event area', now() + interval '15 days', now() + interval '16 days', 'approved', 'Approved. Confirm pickup details one day before.', now() - interval '5 days', (select id from public.users where email='admin@gmail.com'), now() - interval '3 days', null, null, null, null, '', now() - interval '7 days', now() - interval '3 days'),
  ((select id from public.users where username='resident46'), (select id from public.borrowable_assets where name='Folding Tables'), 10, 'Family gathering', 'Purok 4 residence', now() + interval '18 days', now() + interval '19 days', 'pending', '', now(), null, null, null, null, null, null, '', now(), now());

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

