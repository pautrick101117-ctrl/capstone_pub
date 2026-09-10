begin;

-- Optional demo seed after running the reset script.
-- Uses frontend-served images so the UI has meaningful sample content immediately.

insert into project_suggestions (id, user_id, title, description, status, created_at)
select
  '67de0b15-cbb0-4d1f-bb10-1095eefde001'::uuid,
  users.id,
  'Covered court roof repair and drainage line clearing',
  'Repair worn roofing panels above the covered court and clear the nearby drainage line to prevent flooding during barangay events.',
  'approved',
  now() - interval '7 day'
from users
where role = 'admin'
order by created_at asc
limit 1
on conflict (id) do nothing;

insert into elections (id, title, description, status, starts_at, ends_at, image_url, source_suggestion_id, created_at)
values (
  '7bb78d80-c63f-4e9f-adf7-ef8445d8d001'::uuid,
  'Covered Court Roof and Drainage Improvement',
  'Residents choose the next practical barangay project focused on safer gatherings and better flood prevention.',
  'live',
  now() - interval '1 day',
  now() + interval '5 day',
  '/images/image2.png',
  '67de0b15-cbb0-4d1f-bb10-1095eefde001'::uuid,
  now() - interval '1 day'
)
on conflict (id) do nothing;

insert into election_options (id, election_id, name, description, votes_count, created_at)
values
  (
    '7bb78d80-c63f-4e9f-adf7-ef8445d8d101'::uuid,
    '7bb78d80-c63f-4e9f-adf7-ef8445d8d001'::uuid,
    'Roof Repair with Drainage Clearing',
    'Stop leaks in the covered court and reduce water buildup after heavy rain.',
    0,
    now() - interval '1 day'
  ),
  (
    '7bb78d80-c63f-4e9f-adf7-ef8445d8d102'::uuid,
    '7bb78d80-c63f-4e9f-adf7-ef8445d8d001'::uuid,
    'Perimeter Solar Lighting',
    'Improve night visibility around the barangay hall and covered court.',
    0,
    now() - interval '1 day'
  ),
  (
    '7bb78d80-c63f-4e9f-adf7-ef8445d8d103'::uuid,
    '7bb78d80-c63f-4e9f-adf7-ef8445d8d001'::uuid,
    'Health Center Waiting Area Upgrade',
    'Add shaded seating and better queue flow for consultations.',
    0,
    now() - interval '1 day'
  )
on conflict (id) do nothing;

insert into announcements (id, title, body, image_url, type, created_at)
values
  (
    'f0eb1ca8-c291-4978-9043-cf5be55a2001'::uuid,
    'Drainage rehabilitation in Purok 3 reaches final stage',
    'The barangay drainage rehabilitation project is now in its final stage, with finishing work focused on flood-prone areas near the market road.',
    '/images/image1.png',
    'news',
    now() - interval '2 day'
  ),
  (
    'f0eb1ca8-c291-4978-9043-cf5be55a3001'::uuid,
    'Barangay hall transactions closed on Labor Day',
    'In-person transactions at the barangay hall will resume the next working day after the holiday.',
    '/images/image4.png',
    'announcement',
    now() - interval '1 day'
  )
on conflict (id) do nothing;

insert into events (id, title, date, time, location, description, type, created_at)
values
  (
    '09f98de2-bbaf-4f39-b1d9-7fd962dba011'::uuid,
    'Free Medical Mission',
    current_date + 3,
    '08:30',
    'Barangay Covered Court',
    'General checkups, blood pressure screening, and medicine distribution for residents.',
    'medical mission',
    now()
  ),
  (
    '09f98de2-bbaf-4f39-b1d9-7fd962dba012'::uuid,
    'Purok 2 Clean-Up Drive',
    current_date + 7,
    '07:00',
    'Purok 2 Assembly Area',
    'Community clean-up focused on drainage clearing and waste segregation.',
    'clean-up',
    now()
  )
on conflict (id) do nothing;

commit;
