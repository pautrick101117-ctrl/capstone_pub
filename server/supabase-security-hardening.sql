-- Optional defense-in-depth for this architecture.
-- The provided React client talks only to the Render API; the Render API uses SUPABASE_SERVICE_ROLE_KEY.
-- Supabase service_role bypasses RLS. Apply this only after confirming no browser/mobile client accesses these tables directly.

begin;

alter table users enable row level security;
alter table verification_codes enable row level security;
alter table votes enable row level security;
alter table notifications enable row level security;
alter table audit_logs enable row level security;
alter table complaints enable row level security;
alter table requests enable row level security;
alter table request_timeline enable row level security;
alter table id_requests enable row level security;
alter table project_suggestions enable row level security;
alter table census_households enable row level security;
alter table clearances enable row level security;
alter table borrowing_requests enable row level security;
alter table borrowable_assets enable row level security;
alter table master_data_values enable row level security;

commit;

