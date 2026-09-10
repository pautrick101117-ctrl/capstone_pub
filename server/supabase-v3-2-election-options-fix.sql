begin;

-- V3.2 compatibility fix: Admin voting API stores proposal/image metadata on election options.
alter table public.election_options
  add column if not exists source_suggestion_id uuid references public.project_suggestions(id) on delete set null;

alter table public.election_options
  add column if not exists image_url text;

commit;
