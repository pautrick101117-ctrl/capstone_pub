-- Add/update the requested administrator account without resetting the database.
-- Login: pautrick101117@gmail.com / Password123

create extension if not exists pgcrypto;

insert into public.users (
  first_name, last_name, full_name, email, username, password_hash,
  role, status, email_verified, email_verified_at, must_change_password, is_active
) values (
  'Pautrick', 'Administrator', 'Pautrick Administrator', 'pautrick101117@gmail.com', 'pautrick101117', crypt('Password123', gen_salt('bf', 12)),
  'admin', 'approved', true, now(), false, true
)
on conflict (email) do update set
  username = excluded.username,
  password_hash = excluded.password_hash,
  role = 'admin',
  status = 'approved',
  email_verified = true,
  email_verified_at = coalesce(public.users.email_verified_at, now()),
  must_change_password = false,
  is_active = true,
  updated_at = now();
