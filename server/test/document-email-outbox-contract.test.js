import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = async (path) => readFile(new URL(path, import.meta.url), "utf8");
test("a status trigger queues email events inside the database transaction", async () => {
  const sql = await read("../supabase-v4-phase12-document-emails.sql");
  assert.match(sql, /AFTER INSERT OR UPDATE OF status ON public\.requests/);
  assert.match(sql, /ON CONFLICT \(request_id,status_version,notification_type\) DO NOTHING/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /REVOKE ALL ON public\.document_email_outbox FROM PUBLIC,anon,authenticated/);
});
test("worker uses immutable idempotency keys and never blocks a status change", async () => {
  const worker=await read("../src/lib/documentEmailOutbox.js");
  const routes=await read("../src/routes/documents.js");
  assert.match(worker,/idempotencyKey: event\.id/);
  assert.match(routes,/res\.json\(\{ request: result \}\);\s*\/\/ Durable SQL trigger/);
  assert.match(routes,/void processDocumentEmailOutbox\(db\)\.catch/);
});
test("all automatic request stages have matching messages", async () => {
  const mail=await read("../src/lib/documentNotifications.js");
  for(const status of ["received","reviewing","revision","rejected","approved","ready","collected"])
    assert.match(mail,new RegExp(`${status}:`));
});
test("the admin view hides manual email preview and still offers failed email retries", async () => {
  const ui=await read("../../client/src/components/DocumentRequestDetail.jsx");
  assert.doesNotMatch(ui,/Preview email|Send reviewed email/);
  assert.match(ui,/email-queue\/\$\{item\.id\}\/retry/);
  assert.match(ui,/notificationLogs/);
});
