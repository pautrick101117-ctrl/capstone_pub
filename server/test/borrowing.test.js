import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateAvailableQuantity,
  canTransitionBorrowing,
  isLateBorrowing,
  normalizeBorrowingQuantity,
  rangesOverlap,
  validateBorrowingWindow,
  validateReturnInspection,
} from "../src/lib/borrowing.js";

test("overlap detection handles intersecting and adjacent reservations", () => {
  assert.equal(rangesOverlap("2026-09-20T08:00:00Z", "2026-09-20T12:00:00Z", "2026-09-20T10:00:00Z", "2026-09-20T14:00:00Z"), true);
  assert.equal(rangesOverlap("2026-09-20T08:00:00Z", "2026-09-20T12:00:00Z", "2026-09-20T12:00:00Z", "2026-09-20T14:00:00Z"), false);
});

test("availability subtracts only approved or borrowed quantities", () => {
  assert.equal(calculateAvailableQuantity(20, [
    { status: "approved", quantity: 5 },
    { status: "borrowed", quantity: 3 },
    { status: "pending", quantity: 10 },
  ]), 12);
});

test("borrowing window requires return after start", () => {
  assert.throws(() => validateBorrowingWindow({ startAt: "2026-09-20T10:00:00Z", dueAt: "2026-09-20T09:00:00Z", now: new Date("2026-09-10T00:00:00Z").getTime() }), /Return date/i);
});

test("late flag applies only to physically borrowed requests past due", () => {
  const now = new Date("2026-09-21T00:00:00Z").getTime();
  assert.equal(isLateBorrowing({ status: "borrowed", due_at: "2026-09-20T00:00:00Z" }, now), true);
  assert.equal(isLateBorrowing({ status: "returned", due_at: "2026-09-20T00:00:00Z" }, now), false);
});

test("borrowing status workflow blocks invalid jumps", () => {
  assert.equal(canTransitionBorrowing("pending", "approved"), true);
  assert.equal(canTransitionBorrowing("approved", "borrowed"), true);
  assert.equal(canTransitionBorrowing("borrowed", "returned"), true);
  assert.equal(canTransitionBorrowing("pending", "returned"), false);
});

test("facilities always reserve one whole resource while items require a positive whole quantity", () => {
  assert.equal(normalizeBorrowingQuantity({ category: "facility" }, 99), 1);
  assert.equal(normalizeBorrowingQuantity({ category: "item" }, 12), 12);
  assert.throws(() => normalizeBorrowingQuantity({ category: "item" }, 1.5), /positive whole number/i);
  assert.throws(() => normalizeBorrowingQuantity({ category: "item" }, 0), /positive whole number/i);
});

test("return inspection accepts good complete returns", () => {
  assert.deepEqual(
    validateReturnInspection({ requestedQuantity: 30, returnedQuantity: 30, returnCondition: "good", returnNote: "" }),
    { returnedQuantity: 30, returnCondition: "good", returnNote: "" }
  );
});

test("return inspection requires missing-items status and a note for shortages", () => {
  assert.throws(
    () => validateReturnInspection({ requestedQuantity: 30, returnedQuantity: 28, returnCondition: "good", returnNote: "" }),
    /Missing item/i
  );
  assert.throws(
    () => validateReturnInspection({ requestedQuantity: 30, returnedQuantity: 28, returnCondition: "missing_items", returnNote: "" }),
    /inspection note/i
  );
  assert.deepEqual(
    validateReturnInspection({ requestedQuantity: 30, returnedQuantity: 28, returnCondition: "missing_items", returnNote: "Two chairs were not returned." }),
    { returnedQuantity: 28, returnCondition: "missing_items", returnNote: "Two chairs were not returned." }
  );
});

