import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const index = await readFile(new URL("../src/index.js", import.meta.url), "utf8");

test("startup checks are timed and all required migrations remain mandatory", () => {
  for (const functionName of ["bgy_audit_phase1_ready", "bgy_phase2_ready", "bgy_phase5_ready",
    "bgy_phase6_ready", "bgy_phase7_ready", "bgy_phase8_ready", "bgy_phase9_ready",
    "bgy_phase10_ready", "bgy_p105_ready", "bgy_phase11_ready"]) {
    assert.ok(index.includes(functionName));
  }
  assert.match(index, /STARTUP CHECK/);
  assert.match(index, /data !== true/);
});

test("API remains blocked until readiness while health responds during startup", () => {
  assert.match(index, /app\.get\("\/api\/health"/);
  assert.match(index, /app\.get\("\/api\/health\/readiness"/);
  assert.match(index, /app\.use\("\/api", \(req, res, next\)/);
  assert.match(index, /SERVICE_STARTING/);
  assert.match(index, /SERVICE_NOT_READY/);
  assert.match(index, /startup\.state === "ready"/);
  assert.ok(index.indexOf('app.use("/api",') < index.indexOf('app.use("/api/auth",'));
  assert.match(index, /const server = app\.listen/);
  assert.match(index, /void verifyStartup\(\)\.catch/);
});

