import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const dataUrl = (src) => `data:text/javascript;base64,${Buffer.from(src).toString("base64")}`;

const loadMailer = async ({ key = "re_test_key", sender = "Barangay Iba <noreply@barangayiba.com>" } = {}) => {
  // Load real source code with dotenv replaced by a no-op so tests do not
  // need production secrets, the network, or installed node_modules.
  let envSrc = await read("src/lib/env.js");
  envSrc = envSrc.replace('import dotenv from "dotenv";', 'const dotenv = { config() {} };');
  envSrc = envSrc.replace('process.env.RESEND_API_KEY || ""', JSON.stringify(key));
  envSrc = envSrc.replace('(process.env.RESEND_FROM_EMAIL || "").trim()', `${JSON.stringify(sender)}.trim()`);
  const envUrl = dataUrl(envSrc);
  const mailerSrc = (await read("src/lib/mailer.js")).replace(
    'from "./env.js"', `from "${envUrl}"`
  );
  return { mailer: await import(dataUrl(mailerSrc)), env: await import(envUrl) };
};

test("only Resend configuration is accepted (no Gmail/SMTP or test-domain fallback)", async () => {
  const mailer = await read("src/lib/mailer.js");
  const env = await read("src/lib/env.js");
  const dependencies = await read("package.json");
  const example = await read(".env.example");
  assert.doesNotMatch(mailer + env + example + dependencies, /nodemailer|gmailApp|GMAIL_APP|service:\s*["']gmail["']|onboarding@resend\.dev/i);
  assert.match(example, /RESEND_FROM_EMAIL=Barangay Iba <noreply@barangayiba\.com>/);
  assert.match(env, /validateResendConfig\(\);/);
});

test("unconfigured sender or test sender fails before an API request", async () => {
  for (const options of [{ key: "" }, { sender: "onboarding@resend.dev" }]) {
    const { mailer } = await loadMailer(options);
    await assert.rejects(
      () => mailer.sendSystemEmail({ to: "test@example.com", subject: "Test", text: "Hello" }),
      (error) => error.code === (options.key === "" ? "EMAIL_NOT_CONFIGURED" : "EMAIL_SENDER_NOT_VERIFIED")
    );
  }
});

test("Resend sends to external recipients and uses verified-domain sender", async () => {
  const { mailer } = await loadMailer();
  const original = globalThis.fetch;
  const originalLog = console.log;
  let captured;
  try {
    console.log = () => {};
    globalThis.fetch = async (url, options) => {
      captured = { url, options };
      return { ok: true, status: 200, json: async () => ({ id: "email_test_123" }) };
    };
    const result = await mailer.sendAccountCreatedEmail({
      email: "resident@example.net", fullName: "Test <Resident>",
      username: "test1", temporaryPassword: "Pw123456!", role: "resident",
    });
    assert.equal(result.delivered, true);
    assert.equal(result.provider, "resend");
    assert.equal(captured.url, "https://api.resend.com/emails");
    assert.equal(captured.options.headers.Authorization, "Bearer re_test_key");
    const body = JSON.parse(captured.options.body);
    assert.equal(body.from, "Barangay Iba <noreply@barangayiba.com>");
    assert.deepEqual(body.to, ["resident@example.net"]);
    assert.match(body.html, /Test &lt;Resident&gt;/);
    assert.doesNotMatch(body.html, /Test <Resident>/);
  } finally {
    globalThis.fetch = original;
    console.log = originalLog;
  }
});

test("Resend rejection retains provider HTTP status for diagnosis", async () => {
  const { mailer } = await loadMailer();
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: false, status: 403,
      json: async () => ({ message: "Domain is not verified" }),
    });
    await assert.rejects(
      () => mailer.sendSystemEmail({ to: "test@example.org", subject: "Test", text: "Hello" }),
      (error) => error.code === "RESEND_API_ERROR" && error.providerStatus === 403 && error.status === 502
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("resident creation validates Resend before inserting and handles rollback errors", async () => {
  const admin = await read("src/routes/admin.js");
  const start = admin.indexOf('router.post("/users"');
  const end = admin.indexOf('router.patch("/users/:userId"', start);
  const createResident = admin.slice(start, end);
  assert.ok(createResident.indexOf("validateResendConfig()") < createResident.indexOf('db.from("users").insert'));
  assert.match(createResident, /ACCOUNT_CREATION_REVIEW_REQUIRED/);
  assert.match(createResident, /providerStatus === 401/);
});

test("V4 migrations revoke default PUBLIC permission for SECURITY DEFINER census import", async () => {
  const migration = await read("supabase-v4-upgrade.sql");
  const compatibility = await read("supabase-v4-postdeploy-fixes.sql");
  assert.match(migration, /revoke all on function public\.replace_census_households\(jsonb\) from PUBLIC, anon, authenticated/i);
  assert.match(compatibility, /from PUBLIC, anon, authenticated/i);
  assert.match(compatibility, /add column if not exists image_url/i);
});

test("readiness endpoint performs a real database query", async () => {
  const server = await read("src/index.js");
  assert.match(server, /\/api\/health\/readiness/);
  assert.match(server, /from\("users"\)\.select\("id"\)\.limit\(1\)/);
  assert.match(server, /res\.status\(503\)\.json\(\{ ok: false, database: "unavailable" \}\)/);
});


test("nonfunctional SMS adapter cannot mark ID pickup reminders delivered", async () => {
  const adapter = await read("src/lib/sms.js");
  const scheduler = await read("src/lib/scheduler.js");
  assert.match(adapter, /delivered: false, reason: "provider_not_configured"/);
  assert.match(scheduler, /if \(delivery\.delivered\)/);
});


test("public landing refuses to silently display zeros when a Supabase query fails", async () => {
  const publicRoute = await read("src/routes/public.js");
  assert.match(publicRoute, /for \(const result of \[/);
  assert.match(publicRoute, /if \(result\.error\) throw result\.error/);
});
