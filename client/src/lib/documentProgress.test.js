import test from "node:test";
import assert from "node:assert/strict";
import { documentProgress } from "./documentProgress.js";

test("every request maps to exactly three resident-facing stages", () => {
  for (const status of ["submitted", "under_review", "approved", "document_prepared", "ready_for_pickup", "claimed", "needs_revision", "rejected", "cancelled"]) {
    const view = documentProgress(status);
    assert.equal(view.stages.length, 3);
    assert.ok(view.step >= 0 && view.step <= 2);
    assert.ok(view.message);
  }
});
test("staff review statuses map to one stage", () => {
  for (const status of ["under_review", "approved", "document_prepared"]) {
    assert.equal(documentProgress(status).step, 1);
  }
});
test("attention and closed requests do not incorrectly display pickup", () => {
  assert.equal(documentProgress("needs_revision").tone, "warning");
  assert.equal(documentProgress("rejected").stopped, true);
  assert.equal(documentProgress("cancelled").stopped, true);
  assert.equal(documentProgress("ready_for_pickup").step, 2);
  assert.equal(documentProgress("claimed").completed, true);
});

