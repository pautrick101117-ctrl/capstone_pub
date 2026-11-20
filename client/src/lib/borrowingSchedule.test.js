import test from "node:test";
import assert from "node:assert/strict";
import { getBorrowingSchedule } from "./borrowing.js";

const asset = { id: "chairs", name: "Chairs", max_borrow_minutes: 1440 };
const now = Date.parse("2030-05-01T00:00:00Z");
const schedule = (changes = {}) => getBorrowingSchedule({ asset, startAt: "2030-05-02T10:00", dueAt: "2030-05-03T10:00", now, ...changes });

test("a one-day limit permits exactly 24 hours across calendar dates", () => {
  const result = schedule();
  assert.equal(result.isValid, true);
  assert.equal(result.durationMinutes, 1440);
  assert.equal(result.latestReturnAt, "2030-05-03T10:00");
  assert.equal(result.start.toISOString(), "2030-05-02T02:00:00.000Z");
  assert.equal(result.due.toISOString(), "2030-05-03T02:00:00.000Z");
});

test("one minute over the limit explains the requested duration, resource limit and deadline", () => {
  const result = schedule({ dueAt: "2030-05-03T10:01" });
  assert.equal(result.isValid, false);
  assert.equal(result.durationMinutes, 1441);
  assert.match(result.errors.dueAt, /selected duration is 24h 1m/);
  assert.match(result.errors.dueAt, /Chairs may be borrowed for a maximum of 1 day/);
  assert.match(result.errors.dueAt, /May 3, 2030.*10:00/i);
});

test("equal or reversed times require a later return and do not produce a misleading duration", () => {
  for (const dueAt of ["2030-05-02T10:00", "2030-05-02T09:59"]) {
    const result = schedule({ dueAt });
    assert.equal(result.isValid, false);
    assert.equal(result.durationMinutes, null);
    assert.equal(result.errors.dueAt, "Return By must be later than Borrow From.");
  }
});

test("short facility bookings may span midnight within the configured limit", () => {
  const result = schedule({ asset: { name: "Barangay Hall", max_borrow_minutes: 480 }, startAt: "2030-05-02T22:00", dueAt: "2030-05-03T06:00" });
  assert.equal(result.isValid, true);
  assert.equal(result.durationMinutes, 480);
  assert.equal(result.latestReturnAt, "2030-05-03T06:00");
  assert.equal(schedule({ asset: { name: "Barangay Hall", max_borrow_minutes: 480 } }).isValid, false);
});

test("missing, malformed and rolled-over dates have field-specific errors", () => {
  for (const startAt of ["", "invalid", "2030-02-30T10:00"]) {
    const result = schedule({ startAt });
    assert.equal(result.isValid, false);
    assert.ok(result.errors.startAt);
    assert.equal(result.latestReturnAt, "");
  }
  for (const dueAt of ["", "invalid", "2030-02-30T10:00"]) {
    assert.ok(schedule({ dueAt }).errors.dueAt);
  }
});

test("past start times and current minutes already underway are rejected", () => {
  assert.match(schedule({ startAt: "2030-05-01T07:59" }).errors.startAt, /future date and time/);
  assert.match(schedule({ startAt: "2030-05-01T08:00", now: now + 1 }).errors.startAt, /future date and time/);
  assert.equal(schedule({ startAt: "2030-05-01T08:01", dueAt: "2030-05-01T09:01", now: now + 1 }).isValid, true);
});

test("a resource and a valid configured duration are required", () => {
  assert.ok(schedule({ asset: null }).errors.resource);
  for (const maximum of [null, undefined, 0, 59, 60.5, "invalid", 129601]) {
    const result = schedule({ asset: { ...asset, max_borrow_minutes: maximum } });
    assert.equal(result.isValid, false);
    assert.match(result.errors.resource, /maximum borrowing duration/);
  }
});
