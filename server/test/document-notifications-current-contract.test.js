import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = async (path) => readFile(new URL(path, import.meta.url), "utf8");

// The source provided for this release implements staff-reviewed, idempotent
// notification logs. The Phase 12 automatic-email outbox/worker is NOT part
// of this source release and must not be asserted to exist.
test("Phase 11 stores staff-reviewed email attempts with unique idempotency keys", async () => {
  const sql = await read("../supabase-v4-phase11-documents.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.notification_logs/);
  assert.match(sql, /idempotency_key uuid NOT NULL UNIQUE/);
  assert.match(sql, /message_snapshot jsonb NOT NULL/);
  assert.match(sql, /attempt_status text NOT NULL/);
});

test("staff sends only a freshly reviewed notification; duplicate keys cannot send twice", async () => {
  const service = await read("../src/lib/documentNotifications.js");
  const routes = await read("../src/routes/documents.js");
  assert.match(service, /if \(hash !== previewHash\)/);
  assert.match(service, /\.eq\("idempotency_key", idempotencyKey\)/);
  assert.match(service, /if \(previous\)/);
  assert.match(service, /return previous; \/\/ Repeated clicks never send again/);
  assert.match(service, /idempotencyKey: log\.idempotency_key/);
  assert.match(routes, /"\/requests\/:id\/notification-preview"/);
  assert.match(routes, /"\/requests\/:id\/notify"/);
  assert.match(routes, /previewHash: req\.body\.previewHash/);
});

test("notification types correspond to currently supported request statuses", async () => {
  const service = await read("../src/lib/documentNotifications.js");
  for (const type of ["received", "revision", "rejected", "approved", "ready", "reminder", "custom"])
    assert.match(service, new RegExp(`\\"${type}\\"`));
  assert.match(service, /received: \["submitted", "under_review", "acknowledged", "processing"\]/);
  assert.match(service, /ready: \["ready_for_pickup"\]/);
});

test("staff can retry failed email attempts, but cannot expose admin email logs to residents", async () => {
  const route = await read("../src/routes/documents.js");
  assert.match(route, /"\/notifications\/:id\/retry"/);
  assert.match(route, /\["failed", "sending"\]/);
  assert.match(route, /notificationLogs: logs/);
  assert.match(route, /if \(!isAdmin\(req\)\)/);
  const ui = await read("../../client/src/components/DocumentRequestDetail.jsx");
  assert.match(ui, /notificationLogs/);
});
