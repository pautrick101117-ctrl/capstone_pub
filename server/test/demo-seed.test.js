import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const seed = await readFile(new URL("../supabase-demo-seed.sql", import.meta.url), "utf8");
const fullReset = await readFile(new URL("../supabase-full-reset.sql", import.meta.url), "utf8");

test("demo seed creates exactly 50 resident accounts", () => {
  assert.match(seed, /generate_series\(1, 50\)/i);
  assert.match(seed, /'resident'\s*,\s*'approved'/i);
  assert.match(seed, /crypt\('Resident123'/i);
});

test("demo seed covers major portal features", () => {
  for (const table of [
    "master_data_values", "census_households", "officials", "announcements", "events",
    "fund_sources", "fund_projects", "complaints", "requests", "request_timeline",
    "id_pickup_slots", "id_requests", "project_suggestions", "elections", "election_options",
    "votes", "borrowable_assets", "borrowing_requests", "notifications", "audit_logs",
  ]) {
    assert.ok(seed.includes(`public.${table}`), `seed should populate ${table}`);
  }
});

test("full reset includes election option metadata required by voting API", () => {
  assert.match(fullReset, /create table public\.election_options[\s\S]*source_suggestion_id uuid/i);
  assert.match(fullReset, /create table public\.election_options[\s\S]*image_url text/i);
});
