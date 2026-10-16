import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildResidentCredentialEmail } from "../src/lib/residentCredentialEmail.js";

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("welcome email includes three steps, correct case instructions, portal link and safe HTML", () => {
  const message = buildResidentCredentialEmail({ fullName: "A <Resident>", username: "sample.resident", temporaryPassword: "MangoRiverCedar48263" });
  assert.match(message.text, /Username: sample\.resident/);
  assert.match(message.text, /Temporary password: MangoRiverCedar48263/);
  assert.match(message.text, /case-sensitive/);
  assert.match(message.text, /without spaces/);
  assert.match(message.text, /\/login/);
  assert.match(message.html, /Open Resident Portal/);
  assert.match(message.html, /A &lt;Resident&gt;/);
  assert.doesNotMatch(message.html, /A <Resident>/);
});

test("staged reset email describes old-password continuity and 48-hour expiry", () => {
  const message = buildResidentCredentialEmail({ fullName: "Resident", username: "resident.test", temporaryPassword: "MangoRiverCedar48263", reset: true });
  assert.match(message.text, /existing password will continue working/i);
  assert.match(message.text, /48 hours/);
  assert.match(message.text, /did not request this reset/i);
});

test("non-destructive SQL stages reset, atomically promotes and protects RPC", async () => {
  const sql = await read("supabase-v4-phase5-resident-passwords.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS pending_password_hash/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.bgy_accept_resident_temporary_password/i);
  assert.match(sql, /SET password_hash = pending_password_hash/i);
  assert.match(sql, /pending_password_hash = p_expected_hash/i);
  assert.match(sql, /pending_password_expires_at > now\(\)/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.bgy_accept_resident_temporary_password\(uuid,text\) TO service_role/i);
  assert.doesNotMatch(sql, /TRUNCATE TABLE|DELETE FROM public\.users|DROP TABLE public\.users/i);
});

test("reset delivery failure restores pending state and preserves old login", async () => {
  const admin = await read("src/routes/admin.js");
  const block = admin.split('router.post("/users/:userId/reset-password"')[1].split('router.post("/users/:userId/resend-temporary-password"')[0];
  assert.match(block, /pending_password_hash: pendingHash/);
  assert.match(block, /pending_password_hash: resident\.pending_password_hash/);
  assert.match(block, /RESET_EMAIL_NOT_ACCEPTED/);
  assert.doesNotMatch(block, /\.update\(\{\s*password_hash:\s*passwordHash/);
  assert.doesNotMatch(block, /temporaryPassword:\s*temp/i);
  assert.match(block, /emailAcceptedByProvider/);
});

test("login activates temporary reset only with secure hash comparison and atomic RPC", async () => {
  const auth = await read("src/routes/auth.js");
  assert.match(auth, /comparePassword\(bcrypt, password, user\.pending_password_hash\)/);
  assert.match(auth, /bgy_accept_resident_temporary_password/);
  assert.match(auth, /new Date\(user\.pending_password_expires_at\)\.getTime\(\) > Date\.now\(\)/);
  assert.match(auth, /resident_temporary_password_activated/);
  assert.match(auth, /pending_password_hash: null/);
  assert.match(auth, /Choose a new password that is different from your temporary or current password/);
});

test("Phase 2 admin invitation flow is unchanged and Phase 5 gate is present", async () => {
  const index = await read("src/index.js");
  const admin = await read("src/routes/admin.js");
  assert.match(index, /bgy_phase5_ready/);
  assert.match(index, /bgy_phase2_ready/);
  assert.doesNotMatch(admin, /router\.post\("\/admin-invitation/);
});
