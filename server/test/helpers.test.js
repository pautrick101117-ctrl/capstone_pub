import test from "node:test";
import assert from "node:assert/strict";
import { createCode, createTemporaryPassword, ensureAdult, ensureStrongPassword, isStrongPassword, normalizePhoneNumber, normalizeRole, roleMatches } from "../src/utils/helpers.js";

test("verification code is six numeric digits", () => {
  const code = createCode();
  assert.match(code, /^\d{6}$/);
});

test("temporary passwords meet the resident password policy and avoid ambiguous characters", () => {
  for (let index = 0; index < 25; index += 1) {
    const password = createTemporaryPassword(14);
    assert.equal(password.length, 14);
    assert.doesNotMatch(password, /[0O1Il]/);
    assert.equal(isStrongPassword(password), true);
  }
});

test("resident password policy requires 8+ characters, an uppercase letter, and a number", () => {
  assert.equal(isStrongPassword("Password123"), true);
  assert.equal(isStrongPassword("password123"), false);
  assert.equal(isStrongPassword("PasswordOnly"), false);
  assert.equal(isStrongPassword("Pass1"), false);
  assert.throws(() => ensureStrongPassword("password123"), /uppercase letter and one number/i);
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

