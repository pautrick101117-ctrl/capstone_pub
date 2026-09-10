begin;

-- V3.3 transactional-email provider metadata update.
-- Safe to run on an existing V3.2.x database. Historical provider values are preserved.
alter table public.users
  alter column verification_provider set default 'resend';

alter table public.verification_codes
  alter column provider set default 'resend';

commit;
