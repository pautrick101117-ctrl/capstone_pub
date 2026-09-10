begin;

-- Borrowing UX/process upgrade. Safe to run after supabase-feature-upgrade.sql.
-- Adds resident use-location/terms acceptance and item return-inspection fields.

alter table borrowing_requests add column if not exists event_location text default '';
alter table borrowing_requests add column if not exists terms_accepted_at timestamptz;
alter table borrowing_requests add column if not exists returned_quantity integer;
alter table borrowing_requests add column if not exists return_condition text;
alter table borrowing_requests add column if not exists return_note text default '';

-- Keep existing records valid while applying stronger rules to new/updated data.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'borrowing_returned_quantity_check') then
    alter table borrowing_requests
      add constraint borrowing_returned_quantity_check
      check (returned_quantity is null or returned_quantity >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'borrowing_return_condition_check') then
    alter table borrowing_requests
      add constraint borrowing_return_condition_check
      check (return_condition is null or return_condition in ('good', 'minor_damage', 'damaged', 'missing_items'));
  end if;
end $$;

create index if not exists borrowing_requests_due_active_idx
  on borrowing_requests (due_at)
  where status = 'borrowed';

commit;
