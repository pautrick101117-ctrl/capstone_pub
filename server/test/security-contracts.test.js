import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(`../../${relative}`, import.meta.url), "utf8");

test("resident routes are role protected and first login has change-password route", async () => {
  const app = await read("client/src/App.jsx");
  assert.match(app, /ProtectedRoute roles=\{\["resident"\]\}/);
  assert.match(app, /path="change-password"/);
  assert.match(app, /path="portal\/borrowing"/);
  assert.match(app, /path="portal\/complaints"/);
});

test("resident login declares resident portal intent", async () => {
  const authContext = await read("client/src/context/AuthContext.jsx");
  const authRoute = await read("server/src/routes/auth.js");
  assert.match(authContext, /portal: adminOnly \? "admin" : "resident"/);
  assert.match(authRoute, /portal === "resident"/);
  assert.match(authRoute, /administrator account\. Please use the Admin Login page/i);
});

test("temporary credentials are not written to email fallback logs", async () => {
  const mailer = await read("server/src/lib/mailer.js");
  assert.match(mailer, /Never log message bodies/);
  assert.doesNotMatch(mailer, /EMAIL LOG.*Message/);
  assert.match(mailer, /Temporary password:/);
});


test("resident creation never exposes the generated temporary password to the admin UI", async () => {
  const admin = await read("server/src/routes/admin.js");
  const residents = await read("client/src/pages/admin/Admin_Residents.jsx");
  const createStart = admin.indexOf('router.post("/users"');
  const createEnd = admin.indexOf('router.patch("/users/:userId"', createStart);
  const createBlock = admin.slice(createStart, createEnd);
  assert.match(createBlock, /sendAccountCreatedEmail/);
  assert.doesNotMatch(createBlock, /res\.status\(201\)\.json\(\{[^}]*temporaryPassword/s);
  assert.match(createBlock, /ACCOUNT_EMAIL_DELIVERY_FAILED/);
  assert.match(residents, /credentialResult\.action === "reset" && credentialResult\.temporaryPassword/);
});
test("reset endpoint validates email before replacing resident password", async () => {
  const admin = await read("server/src/routes/admin.js");
  const resetStart = admin.indexOf('router.post("/users/:userId/reset-password"');
  const resetEnd = admin.indexOf('router.get("/complaints"', resetStart);
  const block = admin.slice(resetStart, resetEnd);
  assert.ok(block.indexOf("if (!targetUser.email)") < block.indexOf("bcrypt.hash(tempPassword"));
});


test("email delivery uses Resend HTTPS API with a bounded timeout", async () => {
  const env = await read("server/src/lib/env.js");
  const mailer = await read("server/src/lib/mailer.js");
  const packageJson = await read("server/package.json");
  assert.match(env, /resendApiKey/);
  assert.match(env, /resendFromEmail/);
  assert.match(env, /emailSendTimeoutMs/);
  assert.match(mailer, /https:\/\/api\.resend\.com\/emails/);
  assert.match(mailer, /Authorization: `Bearer \${env\.resendApiKey}`/);
  assert.match(mailer, /AbortController/);
  assert.match(mailer, /EMAIL_SEND_TIMEOUT/);
  assert.doesNotMatch(packageJson, /nodemailer/);
});

test("V3 resident and census forms use master-data Purok dropdowns", async () => {
  const residents = await read("client/src/pages/admin/Admin_Residents.jsx");
  const census = await read("client/src/pages/admin/Admin_Census.jsx");
  assert.match(residents, /useMasterData\("purok"\)/);
  assert.match(residents, /<SelectInput label="Purok"/);
  assert.match(census, /useMasterData\("purok"\)/);
  assert.match(census, /<SelectInput label="Purok"/);
});

test("V3 voting explains the complete resident voting process", async () => {
  const voting = await read("client/src/pages/client/VotingCenter.jsx");
  assert.match(voting, /How community project voting works/i);
  assert.match(voting, /Submit Final Vote/);
  assert.match(voting, /Live vote totals are not shown here while voting is open/i);
});

test("temporary password email can be retried without generating a new password", async () => {
  const admin = await read("server/src/routes/admin.js");
  const residents = await read("client/src/pages/admin/Admin_Residents.jsx");
  assert.match(admin, /resend-temporary-password/);
  assert.match(admin, /bcrypt\.compare\(temporaryPassword/);
  assert.match(residents, /Retry Same Email/);
});

test("forgot-password verification codes are hashed before storage", async () => {
  const auth = await read("server/src/routes/auth.js");
  assert.match(auth, /hashVerificationCode/);
  assert.match(auth, /code_hash/);
  assert.match(auth, /attempt_count/);
  assert.match(auth, /timingSafeEqual/);
});


test("public navigation does not expose the admin login route", async () => {
  const landing = await read("client/src/components/layouts/LandingPageLayout.jsx");
  const app = await read("client/src/App.jsx");
  assert.doesNotMatch(landing, /\/admin\/login/);
  assert.match(app, /path="admin\/login"/);
});

test("password changes enforce uppercase and numeric password policy on the server", async () => {
  const auth = await read("server/src/routes/auth.js");
  const helpers = await read("server/src/utils/helpers.js");
  assert.match(auth, /ensureStrongPassword\(newPassword\)/);
  assert.match(helpers, /\/\[A-Z\]\//);
  assert.match(helpers, /\/\[0-9\]\//);
});
