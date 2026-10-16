import test from "node:test";
import assert from "node:assert/strict";
import { createCode, createTemporaryPassword, ensureAdult, ensureStrongPassword, isStrongPassword, normalizePhoneNumber, normalizeRole, roleMatches } from "../src/utils/helpers.js";
import { RESIDENT_PASSWORD_WORDS } from "../src/utils/residentPasswordWords.js";

test("verification code is six numeric digits", () => {
  const code = createCode();
  assert.match(code, /^\d{6}$/);
});

test("temporary passwords use three separate readable words and five easy digits", () => {
  assert.equal(RESIDENT_PASSWORD_WORDS.length, 2048);
  assert.equal(new Set(RESIDENT_PASSWORD_WORDS).size, 2048);
  const list = new Set(RESIDENT_PASSWORD_WORDS);
  const examples = new Set();
  for (let index = 0; index < 100; index += 1) {
    const password = createTemporaryPassword();
    assert.match(password, /^([A-Z][a-z]{3,7}){3}[2-9]{5}$/);
    assert.equal(isStrongPassword(password), true);
    const components = password.slice(0, -5).match(/[A-Z][a-z]+/g).map((word) => word.toLowerCase());
    assert.equal(components.length, 3);
    assert.equal(new Set(components).size, 3);
    assert.ok(components.every((word) => list.has(word)));
    examples.add(password);
  }
  assert.ok(examples.size > 99, "random generation should not repeat in a small sample");
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


