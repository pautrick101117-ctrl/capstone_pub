import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { PGlite } from "@electric-sql/pglite";

// Run the real HTTP handlers, authorization and project SQL without contacting
// a connected database, storage bucket, or notification recipient.
Object.assign(process.env, {
  NODE_ENV: "test", SUPABASE_URL: "https://supabase.example.test",
  SUPABASE_SERVICE_ROLE_KEY: "isolated-project-tests", JWT_SECRET: "isolated-project-test-secret",
});
const { supabase } = await import("../src/lib/supabase.js");
const { signToken } = await import("../src/lib/jwt.js");
const { createApp } = await import("../src/index.js");
const projectId = "20000000-0000-4000-8000-000000000001";
const actors = ["admin", "resident"].map((role, index) => ({ id: `10000000-0000-4000-8000-00000000000${index + 1}`, role, is_active: true, must_change_password: false, full_name: "Synthetic User" }));
const original = { from: supabase.from, rpc: supabase.rpc, fetch: globalThis.fetch };
let db, server, base, audit;

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE community_projects (
      id uuid PRIMARY KEY, title text, description text, status text, progress_percentage integer DEFAULT 0,
      planned_start_date date, actual_start_date date, expected_completion_date date, completed_at timestamptz,
      cover_image_url text, election_id uuid, updated_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now()
    );
    CREATE TABLE project_updates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid, title text, description text, image_url text,
      progress_percentage integer, project_status text, update_date date, created_by uuid,
      updated_at timestamptz, published_at timestamptz, created_at timestamptz DEFAULT now(), corrected_at timestamptz
    );
    CREATE TABLE bgy_phase10_notification_outbox (event_key text UNIQUE, title text, body text, kind text, destination text);
    CREATE FUNCTION bgy_phase10_is_admin(actor uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT actor='${actors[0].id}'::uuid $$;
  `);
  const migration = await readFile(new URL("../supabase-v4-phase10-project-lifecycle.sql", import.meta.url), "utf8");
  for (const name of ["update_project", "publish_project_update", "correct_project_update"]) {
    const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.bgy_phase10_${name}(`);
    await db.exec(migration.slice(start, migration.indexOf("END $$;", start) + "END $$;".length));
  }
  supabase.from = (table) => {
    const filters = [], sorts = [];
    let first = 0, last = Infinity, insert;
    const execute = async () => {
      if (insert) { audit.push(...[].concat(insert)); return { data: insert, error: null }; }
      let rows = table === "users" ? actors : ["community_projects", "project_updates"].includes(table) ? (await db.query(`SELECT * FROM ${table}`)).rows : [];
      rows = rows.filter((row) => filters.every((filter) => filter(row)));
      const count = rows.length;
      rows = [...rows].sort((a, b) => {
        for (const [key, ascending] of sorts) {
          if (a[key] < b[key]) return ascending ? -1 : 1;
          if (a[key] > b[key]) return ascending ? 1 : -1;
        }
        return 0;
      });
      return { data: structuredClone(rows.slice(first, last + 1)), count, error: null };
    };
    return {
      select() { return this; },
      insert(value) { insert = value; return this; },
      eq(key, value) { filters.push((row) => row[key] === value); return this; },
      neq(key, value) { filters.push((row) => row[key] !== value); return this; },
      gt() { return this; }, gte() { return this; },
      limit(value) { last = value - 1; return this; },
      range(start, end) { first = start; last = end; return this; },
      order(key, options = {}) { sorts.push([key, options.ascending !== false]); return this; },
      async single() { const result = await execute(); return { ...result, data: result.data[0] || null }; },
      async maybeSingle() { return this.single(); },
      then(resolve, reject) { return execute().then(resolve, reject); },
    };
  };
  supabase.rpc = async (name, args) => {
    if (name === "bgy_p105_rate_check") return { data: { allowed: true }, error: null };
    const signatures = {
      bgy_phase10_update_project: ["p_actor", "p_project", "p_changes", "p_reason"],
      bgy_phase10_publish_project_update: ["p_actor", "p_project", "p_title", "p_description", "p_image_url", "p_progress", "p_status", "p_update_date", "p_reason"],
      bgy_phase10_correct_project_update: ["p_actor", "p_project", "p_update", "p_title", "p_description", "p_image_url", "p_progress", "p_status", "p_update_date"],
    };
    assert.ok(signatures[name], `Unexpected RPC: ${name}`);
    const keys = signatures[name];
    try {
      const result = await db.query(`SELECT to_jsonb(${name}(${keys.map((_, index) => `$${index + 1}`).join(",")})) AS value`, keys.map((key) => key === "p_changes" ? JSON.stringify(args[key]) : args[key]));
      return { data: result.rows[0].value, error: null };
    } catch (error) { return { data: null, error }; }
  };
  globalThis.fetch = (url, options) => {
    assert.equal(new URL(url).hostname, "127.0.0.1", "Project tests must never contact external services");
    return original.fetch(url, options);
  };
  server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}/api`;
});

beforeEach(async () => {
  audit = [];
  await db.exec("TRUNCATE community_projects, project_updates, bgy_phase10_notification_outbox");
  await db.query("INSERT INTO community_projects(id,title,description,status) VALUES($1,'Court Improvements','Replace the basketball ring.','planned')", [projectId]);
});

after(async () => {
  supabase.from = original.from; supabase.rpc = original.rpc; globalThis.fetch = original.fetch;
  if (server) await new Promise((resolve) => server.close(resolve));
  await db?.close();
});

const call = async (path, { method = "GET", body, actor = actors[0] } = {}) => {
  const response = await fetch(`${base}${path}`, { method,
    headers: { ...(actor ? { Authorization: `Bearer ${signToken({ sub: actor.id, role: actor.role })}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
};
const patch = (status, reason = "") => call(`/admin/projects/${projectId}`, { method: "PATCH", body: { status, reason } });

test("official project status follows planning, implementation, hold, resumption and completion with public history", async () => {
  for (const [status, reason] of [["ongoing", ""], ["on_hold", "Waiting for equipment delivery."], ["ongoing", ""], ["completed", "Installation and inspection are complete."]]) {
    const result = await patch(status, reason);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.project.status, status);
    assert.ok(result.data.project.actual_start_date);
    assert.equal(Boolean(result.data.project.completed_at), status === "completed");
    const publicResult = await call(`/public/projects/${projectId}`, { actor: null });
    assert.equal(publicResult.data.project.status, status);
  }
  const history = (await call(`/public/projects/${projectId}`, { actor: null })).data.updates;
  assert.equal(history.length, 4);
  assert.ok(history.some((item) => item.description === "Project status changed to Ongoing."));
  assert.ok(history.every((item) => !/\d+%/.test(item.description)));
  assert.equal((await db.query("SELECT count(*)::int AS count FROM bgy_phase10_notification_outbox")).rows[0].count, 4);
  assert.equal(audit.filter((item) => item.action === "update_community_project").length, 4);
  assert.equal((await patch("ongoing")).status, 400);
  const reopened = await patch("ongoing", "Reopened for an additional safety inspection.");
  assert.equal(reopened.status, 200);
  assert.equal(reopened.data.project.completed_at, null);
  assert.ok(reopened.data.project.actual_start_date);
});

test("cancelled projects remain in All, Cancelled, landing data and direct public records", async () => {
  assert.equal((await patch("cancelled", "The project site is no longer available.")).status, 200);
  for (const path of ["/public/projects", "/public/projects?status=all", "/public/projects?status=cancelled"]) {
    const result = await call(path, { actor: null });
    assert.equal(result.status, 200);
    assert.equal(result.data.items[0]?.status, "cancelled", path);
  }
  assert.equal((await call("/public/projects?status=ongoing", { actor: null })).data.items.length, 0);
  assert.equal((await call("/public/landing", { actor: null })).data.communityProjects[0].status, "cancelled");
  assert.equal((await patch("ongoing")).status, 400);
  assert.equal((await patch("ongoing", "The project site is available again.")).status, 200);
});

test("important status changes require explanations and reject unauthorized or invalid edits", async () => {
  for (const status of ["on_hold", "completed", "cancelled", "unknown"]) assert.equal((await patch(status)).status, 400);
  assert.equal((await call(`/admin/projects/${projectId}`, { method: "PATCH", body: { title: "   " } })).status, 400);
  assert.equal((await call(`/admin/projects/${projectId}`, { method: "PATCH", body: { description: "   " } })).status, 400);
  assert.equal((await call(`/admin/projects/${projectId}`, { method: "PATCH", body: { status: "ongoing" }, actor: null })).status, 401);
  assert.equal((await call(`/admin/projects/${projectId}`, { method: "PATCH", body: { status: "ongoing" }, actor: actors[1] })).status, 403);
  assert.equal((await call(`/public/projects/${projectId}`, { actor: null })).data.project.status, "planned");
  assert.equal((await db.query("SELECT count(*)::int AS count FROM project_updates")).rows[0].count, 0);
});

test("status-only updates publish reasons and historical corrections preserve the current official status", async () => {
  const published = await call(`/admin/projects/${projectId}/updates`, { method: "POST", body: {
    title: "Equipment Delivery Delayed", description: "The supplier has rescheduled delivery.", projectStatus: "on_hold", reason: "Replacement equipment is awaiting shipment.", updateDate: "2026-11-20",
  } });
  assert.equal(published.status, 201, JSON.stringify(published.data));
  assert.equal(published.data.update.progress_percentage, null);
  assert.match(published.data.update.description, /Status explanation: Replacement equipment is awaiting shipment\./);
  assert.equal(published.data.project.status, "on_hold");
  assert.equal((await patch("ongoing")).status, 200);
  const corrected = await call(`/admin/projects/${projectId}/updates/${published.data.update.id}`, { method: "PATCH", body: { title: "Delivery Schedule Revised", projectStatus: "planned" } });
  assert.equal(corrected.status, 200, JSON.stringify(corrected.data));
  assert.equal(corrected.data.project.status, "ongoing");
  assert.equal(corrected.data.update.project_status, "planned");
  assert.ok(corrected.data.update.corrected_at);
  const withoutStatus = await call(`/admin/projects/${projectId}/updates/${published.data.update.id}`, { method: "PATCH", body: { projectStatus: "" } });
  assert.equal(withoutStatus.status, 200);
  assert.equal(withoutStatus.data.update.project_status, null);
  assert.equal(withoutStatus.data.project.status, "ongoing");
  assert.equal((await db.query("SELECT count(*)::int AS count FROM project_updates")).rows[0].count, 2);
});
