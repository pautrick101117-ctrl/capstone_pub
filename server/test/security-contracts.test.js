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

test("reset endpoint validates email before replacing resident password", async () => {
  const admin = await read("server/src/routes/admin.js");
  const resetStart = admin.indexOf('router.post("/users/:userId/reset-password"');
  const resetEnd = admin.indexOf('router.get("/complaints"', resetStart);
  const block = admin.slice(resetStart, resetEnd);
  assert.ok(block.indexOf("if (!targetUser.email)") < block.indexOf("bcrypt.hash(tempPassword"));
});
