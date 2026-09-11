import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readServer = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const readClient = (path) => readFile(new URL(`../../client/${path}`, import.meta.url), "utf8");

test("V4 schema adds address-based census and implementation project lifecycle", async () => {
  const sql = await readServer("supabase-v4-upgrade.sql");
  assert.match(sql, /add column if not exists household_ref text/i);
  assert.match(sql, /add column if not exists address text/i);
  assert.match(sql, /create table if not exists public\.community_projects/i);
  assert.match(sql, /create table if not exists public\.project_updates/i);
  for (const status of ["planned", "ongoing", "on_hold", "completed", "cancelled"]) assert.ok(sql.includes(`'${status}'`));
});

test("V4 census replacement is transactional at the database function boundary", async () => {
  const sql = await readServer("supabase-v4-upgrade.sql");
  assert.match(sql, /create or replace function public\.replace_census_households\(rows jsonb\)/i);
  assert.match(sql, /delete from public\.census_households;[\s\S]*insert into public\.census_households/i);
});

test("V4 full demo query contains the migration and recent project demo extension", async () => {
  const sql = await readServer("supabase-v4-full-reset-with-demo.sql");
  assert.match(sql, /BARANGAY IBA PORTAL V4 - FULL RESET \+ DEMO DATA/i);
  assert.match(sql, /Solar Streetlights for Purok 5/i);
  assert.match(sql, /Drainage Improvement at Purok 2/i);
  assert.match(sql, /project_updates/i);
  assert.match(sql, /2025-11-25/i);
  assert.match(sql, /2025-08-14/i);
});

test("V4 census admin route exposes import-ready XLSX sample, backup, edit and delete", async () => {
  const source = await readServer("src/routes/admin.js");
  assert.ok(source.includes('router.get("/census_households/sample"'));
  assert.ok(source.includes('router.get("/census_households/export"'));
  assert.ok(source.includes('router.patch("/census_households/:id"'));
  assert.ok(source.includes('router.delete("/census_households/:id"'));
  assert.ok(source.includes('router.post("/census_households/batch"'));
  assert.match(source, /replace_all/);
});

test("V4 client separates project suggestions, voting, community projects and public project updates", async () => {
  const app = await readClient("src/App.jsx");
  assert.ok(app.includes('path="project-updates"'));
  assert.ok(app.includes('path="admin/project-suggestions"') || app.includes('path="project-suggestions"'));
  assert.ok(app.includes('path="projects"'));
  const adminNav = await readClient("src/components/layouts/AdminPageLayout.jsx");
  assert.ok(adminNav.includes("Project Suggestions"));
  assert.ok(adminNav.includes("Project Voting"));
  assert.ok(adminNav.includes("Community Projects"));
});

test("V4 admin auditing captures page views and API activity with secret redaction", async () => {
  const audit = await readServer("src/utils/audit.js");
  assert.match(audit, /adminActivityMiddleware/);
  assert.match(audit, /before_data/);
  assert.match(audit, /after_data/);
  assert.match(audit, /\[redacted\]/);
  const admin = await readServer("src/routes/admin.js");
  assert.ok(admin.includes('router.post("/audit/page-view"'));
  assert.ok(admin.includes('router.get("/audit-logs"'));
});
