begin;

-- Resident community concerns: support admin notes and a clearer workflow.
alter table complaints add column if not exists admin_note text default '';
alter table complaints add column if not exists updated_at timestamptz not null default now();
create index if not exists complaints_user_id_idx on complaints (user_id);
create index if not exists complaints_status_idx on complaints (status);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'complaints_status_check') then
    alter table complaints add constraint complaints_status_check check (status in ('pending', 'in_review', 'resolved'));
  end if;
end $$;

-- No hotline seed data. Configure real hotline details from Admin Settings.

-- Inventory of facilities/items available for residents to borrow.
create table if not exists borrowable_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'item',
  description text default '',
  total_quantity integer not null default 1 check (total_quantity >= 1),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (category in ('facility', 'item'))
);
create unique index if not exists borrowable_assets_name_unique_idx on borrowable_assets (lower(name));
create index if not exists borrowable_assets_active_idx on borrowable_assets (is_active, category);

create table if not exists borrowing_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  asset_id uuid not null references borrowable_assets(id) on delete restrict,
  quantity integer not null default 1 check (quantity >= 1),
  purpose text not null,
  event_location text default '',
  start_at timestamptz not null,
  due_at timestamptz not null,
  status text not null default 'pending',
  admin_note text default '',
  terms_accepted_at timestamptz,
  approved_by uuid references users(id) on delete set null,
  approved_at timestamptz,
  borrowed_at timestamptz,
  returned_at timestamptz,
  returned_quantity integer,
  return_condition text,
  return_note text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_at > start_at),
  check (status in ('pending', 'approved', 'rejected', 'borrowed', 'returned', 'cancelled'))
);
create index if not exists borrowing_requests_user_idx on borrowing_requests (user_id, created_at desc);
create index if not exists borrowing_requests_asset_window_idx on borrowing_requests (asset_id, start_at, due_at);
create index if not exists borrowing_requests_status_idx on borrowing_requests (status, due_at);

alter table borrowing_requests add column if not exists event_location text default '';
alter table borrowing_requests add column if not exists terms_accepted_at timestamptz;
alter table borrowing_requests add column if not exists returned_quantity integer;
alter table borrowing_requests add column if not exists return_condition text;
alter table borrowing_requests add column if not exists return_note text default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'borrowing_returned_quantity_check') then
    alter table borrowing_requests add constraint borrowing_returned_quantity_check check (returned_quantity is null or returned_quantity >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'borrowing_return_condition_check') then
    alter table borrowing_requests add constraint borrowing_return_condition_check check (return_condition is null or return_condition in ('good', 'minor_damage', 'damaged', 'missing_items'));
  end if;
end $$;

create index if not exists borrowing_requests_due_active_idx on borrowing_requests (due_at) where status = 'borrowed';

-- No facility/item seed data. Add real inventory from Admin > Borrowing.

commit;
