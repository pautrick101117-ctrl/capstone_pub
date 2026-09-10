import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile(new URL("../supabase-schema.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase-feature-upgrade.sql", import.meta.url), "utf8");
const borrowingUxMigration = await readFile(new URL("../supabase-borrowing-experience-upgrade.sql", import.meta.url), "utf8");

test("schema supports resident first-login and deactivation", () => {
  assert.match(schema, /must_change_password boolean/i);
  assert.match(schema, /is_active boolean/i);
});

test("schema supports complaint admin notes and editable hotline", () => {
  assert.match(migration, /alter table complaints add column if not exists admin_note/i);
  assert.match(migration, /'hotline'/i);
});

test("schema contains borrowing inventory and lifecycle fields", () => {
  assert.match(migration, /create table if not exists borrowable_assets/i);
  assert.match(migration, /create table if not exists borrowing_requests/i);
  assert.match(migration, /approved_at timestamptz/i);
  assert.match(migration, /returned_at timestamptz/i);
  assert.match(migration, /Covered Court/i);
});

test("borrowing experience migration stores use location, terms acceptance, and return inspection", () => {
  assert.match(borrowingUxMigration, /event_location text/i);
  assert.match(borrowingUxMigration, /terms_accepted_at timestamptz/i);
  assert.match(borrowingUxMigration, /returned_quantity integer/i);
  assert.match(borrowingUxMigration, /return_condition text/i);
  assert.match(borrowingUxMigration, /return_note text/i);
  assert.match(borrowingUxMigration, /missing_items/i);
});
