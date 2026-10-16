import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_HOTLINES, configuredHotlines, normalizeHotlinePhone, publicHotlineSupport, validateHotlines } from "../src/lib/hotlines.js";

const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const copy = () => DEFAULT_HOTLINES.map((item) => ({ ...item }));

test("Phase 7 official hotlines have exact initial numbers and no invented operating hours", () => {
  assert.deepEqual(copy().map((v) => v.phone), ["09165222147", "09912678875"]);
  assert.deepEqual(copy().map((v) => v.hours), ["", ""]);
});

test("Phase 7 canonicalizes 09 and +63 forms before saving", () => {
  assert.equal(normalizeHotlinePhone("+639165222147"), "09165222147");
  assert.equal(normalizeHotlinePhone("0916 522 2147"), "09165222147");
  assert.equal(validateHotlines([{ ...copy()[0], phone: "+639165222147" }, copy()[1]])[0].phone, "09165222147");
  for (const invalid of ["01234567890", "0917654321", "091765432100", "911", "123-456", "+639ABC"]) {
    assert.throws(() => normalizeHotlinePhone(invalid), /valid Philippine mobile/i, invalid);
  }
});

test("Phase 7 rejects duplicate, missing, malformed or entirely inactive hotline configurations", () => {
  const duplicate = copy(); duplicate[1].phone = "+639165222147";
  assert.throws(() => validateHotlines(duplicate), /different/i);
  const inactive = copy(); inactive.forEach((item) => { item.is_active = false; });
  assert.throws(() => validateHotlines(inactive), /at least one/i);
  const missing = copy(); missing[0].phone = "";
  assert.throws(() => validateHotlines(missing), /must have a phone/i);
  const wrongId = copy(); wrongId[0].id = "hotline_2";
  assert.throws(() => validateHotlines(wrongId), /expected/i);
  assert.throws(() => validateHotlines([copy()[0]]), /two hotline/i);
  const oversized = copy(); oversized[0].note = "x".repeat(301);
  assert.throws(() => validateHotlines(oversized), /too long/i);
});

test("Phase 7 public API returns only active hotlines and derives the legacy hotline from the same canonical row", () => {
  const source = copy(); source[0].is_active = false;
  const result = publicHotlineSupport({ hotlines: { hotlines: source }, contact: { email: "office@barangay.example" }, hotline: { phone: "0917 123 4567" } });
  assert.deepEqual(result.hotlines.map((v) => v.phone), ["09912678875"]);
  assert.equal(result.hotline.phone, result.hotlines[0].phone);
  assert.deepEqual(result.contact, { email: "office@barangay.example" });
  assert.equal(configuredHotlines({})[0].phone, "09165222147");
});

test("Phase 7 backend has role-guarded update API and prevents general-content bypass", () => {
  const src = source("src/routes/admin.js");
  assert.match(src, /router\.use\(requireAuth, requireCurrentUser\(\), requireRole\("admin"\)\)/);
  assert.match(src, /router\.put\("\/system-setup\/hotlines"/);
  assert.match(src, /validateHotlines\(req\.body\?\.hotlines\)/);
  assert.match(src, /bgy_phase7_save_hotlines/);
  assert.match(src, /409/);
  assert.match(src, /only general office contact is allowed here/);
  assert.match(source("src/index.js"), /bgy_phase7_ready/);
});

test("Phase 7 migration seeds without deleting data and locks conflicting hotline changes", () => {
  const sql = source("supabase-v4-phase7-hotline-settings.sql");
  assert.match(sql, /ON CONFLICT \(key_name\) DO NOTHING/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /p_expected_updated_at/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.bgy_phase7_save_hotlines.*TO service_role/);
  assert.match(sql, /bgy_audit_row_change_trg/);
  assert.doesNotMatch(sql, /\b(?:TRUNCATE TABLE|DROP TABLE|DELETE FROM public\.)\b/i);
});

test("Phase 7 client uses separate general contact and two-slot system setup with existing confirmation", () => {
  const settings = source("../client/src/pages/admin/Admin_Settings.jsx");
  assert.match(settings, /label: "System Setup"/);
  assert.match(settings, /\/admin\/system-setup\/hotlines/);
  assert.match(settings, /expectedUpdatedAt: hotlinesVersion/);
  assert.match(settings, /reviewAction\(\{ title: "Save Community Hotlines\?/);
  assert.match(settings, /hotlinesGuard\.dirty/);
  assert.match(settings, /body: \{ contact \}/);
  for (const name of ["Complaints.jsx", "HelpCenter.jsx"]) assert.match(source(`../client/src/pages/client/${name}`), /HotlineContacts/);
  assert.match(source("../client/src/components/layouts/LandingPageLayout.jsx"), /HotlineContacts/);
});
