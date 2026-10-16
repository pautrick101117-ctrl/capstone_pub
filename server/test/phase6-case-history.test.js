import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { attachCaseHistories, getOperationId, parseNewCaseResponse, updateCaseWithHistory } from "../src/lib/caseHistory.js";

const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("Phase 6 validates resident and private responses without copying earlier notes", () => {
  assert.deepEqual(parseNewCaseResponse({ adminNote: " A new reply " }), { message: "A new reply", visibility: "resident" });
  assert.deepEqual(parseNewCaseResponse({ reviewNote: " Private note ", visibility: "internal" }), { message: "Private note", visibility: "internal" });
  assert.equal(parseNewCaseResponse({}).message, "");
  assert.throws(() => parseNewCaseResponse({ visibility: "secret" }), /visibility/i);
  assert.throws(() => parseNewCaseResponse({ message: "x".repeat(2001) }), /2000/);
});

test("Phase 6 validates client idempotency tokens", () => {
  const uuid = randomUUID();
  assert.equal(getOperationId(uuid), uuid);
  assert.match(getOperationId(), /^[0-9a-f-]{36}$/);
  assert.throws(() => getOperationId("../../bad-token"), /operation identifier/i);
});

test("Phase 6 sends one atomic RPC request with role, operation and expected status", async () => {
  const actorId = randomUUID(), caseId = randomUUID(), operationId = randomUUID();
  let call;
  const db = { rpc: async (name, parameters) => { call = { name, parameters }; return { data: { id: caseId, status: "resolved" }, error: null }; } };
  const data = await updateCaseWithHistory(db, { entityType: "complaint", id: caseId,
    currentStatus: "in_review", status: "resolved", actorId, operationId,
    response: parseNewCaseResponse({ adminNote: "Fixed the drain", visibility: "resident" }) });
  assert.equal(data.status, "resolved");
  assert.equal(call.name, "bgy_case_apply");
  assert.deepEqual({ entity: call.parameters.p_entity_type, previous: call.parameters.p_expected_status, next: call.parameters.p_status, id: call.parameters.p_operation_id },
    { entity: "complaint", previous: "in_review", next: "resolved", id: operationId });
  assert.equal(call.parameters.p_message, "Fixed the drain");
});

test("Phase 6 reports concurrent modifications without a false success", async () => {
  const db = { rpc: async () => ({ data: null, error: { code: "P0001", message: "This record changed since it was opened" } }) };
  await assert.rejects(updateCaseWithHistory(db, { entityType: "request", id: randomUUID(), actorId: randomUUID(),
    currentStatus: "submitted", status: "acknowledged", response: { message: "", visibility: "resident" } }),
  (error) => error.status === 409 && /updated by someone else/.test(error.message));
});

test("Phase 6 filters resident-only case events in server queries and attaches only to owned records", async () => {
  const id = randomUUID(); let visibilityFilter = null;
  const records = [{ id }, { id: randomUUID() }];
  const chain = {
    select() { return this; }, eq(column, val) { if (column === "visibility") visibilityFilter = val; return this; },
    in() { return this; }, order() { return this; }, range() { return this; },
    then(resolve) { resolve({ data: [{ id: randomUUID(), entity_id: id, visibility: "resident", message: "Hello" }], error: null }); },
  };
  const result = await attachCaseHistories({ from: () => chain }, "request", records, { residentVisible: true });
  assert.equal(visibilityFilter, "resident");
  assert.equal(result[0].case_history.length, 1);
  assert.deepEqual(result[1].case_history, []);
  await assert.rejects(attachCaseHistories(null, "unknown", []), /Unsupported/);
});

test("Phase 6 migration is non-destructive and records changes in one transaction", () => {
  const sql = source("supabase-v4-phase6-case-history.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.case_history_events/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.bgy_case_apply/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /p_expected_status/);
  assert.match(sql, /operation_id uuid UNIQUE/);
  assert.match(sql, /REVOKE ALL ON public\.case_history_events FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.bgy_case_apply.*TO service_role/);
  assert.match(sql, /bgy_audit_row_change_trg/);
  assert.match(sql, /bgy_case_resident_cancel_borrowing/);
  assert.doesNotMatch(sql, /\b(TRUNCATE TABLE|DROP TABLE|DELETE FROM public\.)\b/i);
});

test("Phase 6 links admin actions and resident histories across five case types", () => {
  const routes = ["admin.js", "adminVoting.js", "borrowing.js", "requests.js", "complaints.js", "suggestions.js"];
  for (const name of routes) assert.match(source(`src/routes/${name}`), /attachCaseHistories|updateCaseWithHistory|bgy_case_resident_cancel_borrowing/, name);
  for (const file of ["AdminRequests.jsx", "Admin_Complaints.jsx", "Admin_Borrowing.jsx", "AdminProjectSuggestions.jsx"])
    assert.match(source(`../client/src/pages/admin/${file}`), /CaseHistory/);
  for (const file of ["RequestsPage.jsx", "Complaints.jsx", "BorrowingPage.jsx", "SuggestionsPage.jsx"])
    assert.match(source(`../client/src/pages/client/${file}`), /CaseHistory/);
});
