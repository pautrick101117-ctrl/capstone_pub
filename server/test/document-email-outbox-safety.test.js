import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");

test("actual worker is wired to submission, status update, maintenance and staff history", async () => {
  const [requests, documents, maintenance] = await Promise.all([
    read("../src/routes/requests.js"), read("../src/routes/documents.js"), read("../src/lib/scheduler.js"),
  ]);
  assert.match(requests, /void processDocumentEmailOutbox\(db\)\.catch/);
  assert.match(documents, /void processDocumentEmailOutbox\(db\)\.catch/);
  assert.match(documents, /emailQueue: emailQueue \|\| \[\]/);
  assert.match(documents, /"\/email-queue\/:id\/retry"/);
  assert.match(maintenance, /await processDocumentEmailOutbox\(db/);
  assert.match(maintenance, /catch \(error\)/);
});

test("PostgreSQL trigger is transactional and service-only; delivery uses lease fencing", async () => {
  const sql = await read("../supabase-v4-phase12-document-emails.sql");
  assert.match(sql, /AFTER INSERT OR UPDATE OF status ON public\.requests/);
  assert.match(sql, /ON CONFLICT \(request_id,status_version,notification_type\) DO NOTHING/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /lease_token=gen_random_uuid\(\)/);
  assert.match(sql, /WHERE id=p_id AND lease_token=p_lease_token/);
  assert.match(sql, /REVOKE ALL ON public\.document_email_outbox FROM PUBLIC,anon,authenticated/);
  assert.doesNotMatch(sql, /DELETE FROM public\.requests|TRUNCATE /i);
});

test("provider failure and stale messages cannot silently register a successful email", async () => {
  const worker = await read("../src/lib/documentEmailOutbox.js");
  assert.match(worker, /event\.status_snapshot/);
  assert.match(worker, /SUPERSEDED_STATUS/);
  assert.match(worker, /MISSING_OR_INVALID_EMAIL/);
  assert.match(worker, /idempotencyKey: event\.id/);
  assert.match(worker, /result\?\.accepted \|\| result\?\.delivered/);
  assert.match(worker, /"bgy_doc_email_finish"/);
  assert.match(worker, /"unconfirmed"/);
});
