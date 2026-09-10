import test from "node:test";
import assert from "node:assert/strict";
import { createCode, createTemporaryPassword, ensureAdult, normalizePhoneNumber, normalizeRole, roleMatches } from "../src/utils/helpers.js";

test("verification code is six numeric digits", () => {
  const code = createCode();
  assert.match(code, /^\d{6}$/);
});

test("temporary passwords use requested length and avoid ambiguous characters", () => {
  const password = createTemporaryPassword(14);
  assert.equal(password.length, 14);
  assert.doesNotMatch(password, /[0O1Il]/);
});

test("roles normalize and super admin inherits admin access only", () => {
  assert.equal(normalizeRole("super-admin"), "super_admin");
  assert.equal(roleMatches("super_admin", ["admin"]), true);
  assert.equal(roleMatches("admin", ["resident"]), false);
});

test("phone normalization keeps Philippine local format", () => {
  assert.equal(normalizePhoneNumber("+63 917-123-4567"), "09171234567");
});

test("adult validation rejects underage resident", () => {
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() - 17);
  assert.throws(() => ensureAdult(nextYear.toISOString().slice(0, 10)), /at least 18/i);
});
