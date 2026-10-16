import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_CONCERN_LIMITS, complaintSubmissionError, validateConcernLimits } from "../src/lib/concernLimits.js";
import { publicContentOnly } from "../src/lib/publicContent.js";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const policy = () => JSON.parse(JSON.stringify(DEFAULT_CONCERN_LIMITS));

test("Phase 8 installs suggested values but enforcement is OFF by default", () => {
  assert.deepEqual(validateConcernLimits(policy()), {
    enabled: false,
    rolling_window: { max_submissions: 3, period_days: 7 },
    unresolved_limit: { enabled: true, max_concerns: 5 },
  });
  assert.match(source("supabase-v4-phase8-concern-limits.sql"), /'\{\"enabled\":false/);
});

test("Phase 8 strictly validates settings with independent switches and bounded integers", () => {
  for (const changed of [
    { enabled: "true" }, { enabled: 0 }, { foo: 123 },
    { rolling_window: { max_submissions: 0, period_days: 7 } },
    { rolling_window: { max_submissions: 101, period_days: 7 } },
    { rolling_window: { max_submissions: 1.1, period_days: 7 } },
    { rolling_window: { max_submissions: 3, period_days: 0 } },
    { rolling_window: { max_submissions: 3, period_days: 366 } },
    { unresolved_limit: { enabled: true, max_concerns: 0 } },
    { unresolved_limit: { enabled: "false", max_concerns: 5 } },
    { unresolved_limit: { enabled: true, max_concerns: 5, unknown: true } },
  ]) {
    const input = { ...policy(), ...changed };
    assert.throws(() => validateConcernLimits(input), /invalid|must be|settings/i);
  }
  const custom = policy(); custom.enabled = true; custom.unresolved_limit.enabled = false;
  custom.rolling_window = { max_submissions: 100, period_days: 365 };
  assert.deepEqual(validateConcernLimits(custom), custom);
});

test("Phase 8 maps policy-denied and operation errors to useful status and error codes", () => {
  for (const [prefix, status, code] of [
    ["BGY_CONCERN_WINDOW_LIMIT", 429, "CONCERN_WINDOW_LIMIT_REACHED"],
    ["BGY_CONCERN_OPEN_LIMIT", 409, "CONCERN_OPEN_LIMIT_REACHED"],
    ["BGY_CONCERN_OPERATION_REUSED", 409, "CONCERN_OPERATION_REUSED"],
  ]) {
    const result = complaintSubmissionError({ code: "P0001", message: prefix });
    assert.equal(result.status, status);
    assert.equal(result.code, code);
  }
  assert.equal(complaintSubmissionError({ message: "BGY_CONCERN_UNAUTHORIZED" }).status, 403);
  assert.equal(complaintSubmissionError({ code: "22023", message: "wrong category" }).status, 400);
  assert.equal(complaintSubmissionError({ message: "DB unavailable" }).message, "DB unavailable");
});

test("Phase 8 removes internal setup data from all unauthenticated content", () => {
  const only = publicContentOnly({
    hero: { title: "Hello" }, contact: { phone: "123" }, hotlines: { hotlines: [] },
    concern_submission_limits: { enabled: true }, secrets: { api_key: "nope" },
  });
  assert.deepEqual(Object.keys(only), ["hero", "contact", "hotlines"]);
  assert.equal(only.concern_submission_limits, undefined);
  assert.equal(only.secrets, undefined);
  assert.match(source("src/index.js"), /publicContentOnly\(content\)/);
  assert.match(source("src/routes/public.js"), /publicContentOnly\(Object\.fromEntries/);
});

test("Phase 8 SQL uses policy and resident locks in consistent order", () => {
  const sql = source("supabase-v4-phase8-concern-limits.sql");
  const submit = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.bgy_phase8_submit_concern"));
  assert.match(submit, /landing_content WHERE key_name='concern_submission_limits' FOR SHARE/);
  assert.match(submit, /WHERE id=p_resident_id AND role='resident' AND is_active=true FOR UPDATE/);
  assert.ok(submit.indexOf("FOR SHARE") < submit.indexOf("FOR UPDATE"));
  assert.match(submit, /bgy_phase8_concern_eligibility\(p_resident_id\)/);
  assert.match(submit, /submission_operation_id=p_operation_id/);
  assert.match(submit, /v_existing\.complaint_type<>v_type OR v_existing\.details<>v_details/);
  assert.match(submit, /IF v_eligibility->>'allowed'='false'/);
  assert.match(submit, /GRANT EXECUTE ON FUNCTION public\.bgy_phase8_submit_concern.*TO service_role/);
  assert.match(submit, /REVOKE INSERT ON public\.complaints FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(submit, /bgy_case_created_trg/);
  assert.match(submit, /bgy_audit_row_change_trg/);
  assert.doesNotMatch(sql, /\b(?:TRUNCATE TABLE|DROP TABLE|DELETE FROM public\.)\b/i);
});

test("Phase 8 rolling quota counts resolved submissions but excludes them from unresolved total", () => {
  const sql = source("supabase-v4-phase8-concern-limits.sql");
  assert.match(sql, /created_at > v_now - make_interval\(days=>v_period\)/);
  assert.match(sql, /status IN \('pending','in_review'\)/);
  assert.match(sql, /ORDER BY c\.created_at DESC, c\.id DESC OFFSET \(v_max - 1\)/);
  assert.match(sql, /ON CONFLICT \(key_name\) DO NOTHING/);
  assert.match(sql, /p_expected_updated_at/);
  assert.match(sql, /p_policy IS DISTINCT FROM jsonb_build_object/);
});

test("Phase 8 resident API uses verified session identity and one atomic insertion RPC", () => {
  const resident = source("src/routes/complaints.js");
  assert.match(resident, /requireAuth, requireCurrentUser\(\), requireRole\("resident"\)/);
  assert.match(resident, /router\.get\("\/eligibility"/);
  assert.match(resident, /p_resident_id: req\.currentUser\.id/);
  assert.match(resident, /bgy_phase8_submit_concern/);
  assert.match(resident, /p_operation_id: operationId/);
  assert.doesNotMatch(resident, /\.from\("complaints"\)\.insert\(/);
  assert.match(source("src/index.js"), /bgy_phase8_ready/);
});

test("Phase 8 settings are role-protected, isolated and conflict-aware", () => {
  const admin = source("src/routes/admin.js");
  assert.match(admin, /router\.use\(requireAuth, requireCurrentUser\(\), requireRole\("admin"\)\)/);
  assert.match(admin, /router\.put\("\/system-setup\/concern-limits"/);
  assert.match(admin, /validateConcernLimits\(req\.body\?\.policy\)/);
  assert.match(admin, /bgy_phase8_save_concern_limits/);
  assert.match(admin, /CONCERN_POLICY_STALE/);
  const settings = source("../client/src/pages/admin/Admin_Settings.jsx");
  assert.match(settings, /saveConcernLimits/);
  assert.match(settings, /expectedUpdatedAt: concernLimitsVersion/);
  assert.match(settings, /concernLimitsGuard\.dirty/);
  assert.match(settings, /reviewAction\(\{ title: "Update Concern Submission Limits\?/);
  assert.match(settings, /onSubmit=\{saveHotlines\}/);
});

test("Phase 8 resident UI keeps Phase 3 review, Phase 6 history and Phase 7 hotlines", () => {
  const ui = source("../client/src/pages/client/Complaints.jsx");
  assert.match(ui, /useRef\(null\)/);
  assert.match(ui, /crypto\.randomUUID\(\)/);
  assert.match(ui, /operationId: operationIdRef\.current/);
  assert.match(ui, /reviewAction\(\{ title: "Submit Community Concern\?/);
  assert.match(ui, /CaseHistory/);
  assert.match(ui, /HotlineContacts/);
  assert.match(ui, /eligibility\?\.blockedReasons/);
  assert.match(ui, /disabled=\{!eligibility \|\| quotaBlocked\}/);
});
