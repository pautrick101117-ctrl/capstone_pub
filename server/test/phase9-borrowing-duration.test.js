import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { normalizeMaxBorrowMinutes, validateAssetDuration, validateBorrowingWindow, mapBorrowingDatabaseError } from "../src/lib/borrowing.js";
const base = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(resolve(base, "supabase-v4-phase9-borrowing-duration.sql"), "utf8");
const api = readFileSync(resolve(base, "src/routes/borrowing.js"), "utf8");
const page = readFileSync(resolve(base, "../client/src/pages/client/BorrowingPage.jsx"), "utf8");
const admin = readFileSync(resolve(base, "../client/src/pages/admin/Admin_Borrowing.jsx"), "utf8");
const clientLib = readFileSync(resolve(base, "../client/src/lib/borrowing.js"), "utf8");
const futureWindow = (minutes) => ({startAt: "2026-11-20T08:00:00.000Z",dueAt: new Date(Date.parse("2026-11-20T08:00:00.000Z") + minutes*60000).toISOString()});

test("borrow maximum accepts exactly 1h to 90d and rejects malformed or out-of-range values", () => {
  for(const x of [60, 480, 1440, 2880, 129600]) assert.equal(normalizeMaxBorrowMinutes(x),x);
  for(const x of [null, undefined, 0, 59, 129601, -2, 60.1, 'x', '', Infinity])
    assert.throws(()=>normalizeMaxBorrowMinutes(x),/whole-number maximum/i);
});
test("duration validation accepts exact boundary and rejects one minute beyond", () => {
  const asset = {name:"Hall",max_borrow_minutes:480};
  assert.equal(validateAssetDuration(asset,futureWindow(480)).durationMinutes,480);
  assert.throws(()=>validateAssetDuration(asset,futureWindow(481)), /at most 8 hour/i);
});
test("missing duration blocks new borrowing but existing date-window helper remains backward compatible", () => {
  assert.throws(()=>validateAssetDuration({name:"Chairs",max_borrow_minutes:null},futureWindow(60)), /maximum borrowing duration/i);
  const w=futureWindow(60);
  assert.deepEqual(validateBorrowingWindow({startAt:w.startAt,dueAt:w.dueAt,now:Date.parse("2026-11-01T00:00:00Z")}),w);
});
test("database duration and overbooking errors map to safe client responses", () => {
  for(const [msg,code,status] of [
    ['BGY_BORROW_DURATION_EXCEEDED','BORROW_DURATION_EXCEEDED',400],
    ['BGY_BORROW_OVERBOOKED','BORROW_OVERBOOKED',409],
    ['BGY_BORROW_DURATION_NOT_CONFIGURED','BORROW_DURATION_NOT_CONFIGURED',409],
    ['BGY_BORROW_WINDOW_EXPIRED','BORROW_WINDOW_EXPIRED',409],
  ]) { const result=mapBorrowingDatabaseError(new Error(msg));assert.equal(result.code,code);assert.equal(result.status,status); }
});
test("migration preserves historical rows and protects new insert plus approved reservation status", () => {
  assert.match(sql,/ADD COLUMN IF NOT EXISTS max_borrow_minutes/);
  assert.match(sql,/ADD COLUMN IF NOT EXISTS max_duration_minutes_at_submission/);
  assert.match(sql,/BEFORE INSERT OR UPDATE OF status ON public\.borrowing_requests/);
  assert.match(sql,/FOR UPDATE/);
  assert.match(sql,/status IN \('approved','borrowed'\)/);
  assert.match(sql,/v_reserved \+ NEW\.quantity > v_asset\.total_quantity/);
  assert.match(sql,/NEW\.max_duration_minutes_at_submission := v_asset\.max_borrow_minutes/);
  assert.doesNotMatch(sql,/\bTRUNCATE\b|\bDELETE FROM\b|\bDROP TABLE\b/i);
});
test("server enforces duration on every new request and never revalidates legacy request duration at approval", () => {
  assert.match(api,/validateAssetDuration\(asset, window\)/);
  assert.match(api,/max_duration_minutes_at_submission/);
  assert.match(api,/BORROW_DURATION_EXCEEDED/);
  assert.match(api,/expectedUpdatedAt/);
  assert.match(sql,/Do not apply a newer maximum retroactively/);
});
test("admin and resident forms expose configured duration and resource-first schedule", () => {
  assert.match(admin,/Maximum Borrowing Duration/);
  assert.match(admin,/maxBorrowMinutes/);
  assert.match(admin,/formatBorrowDuration/);
  assert.ok(page.indexOf('1. Select a facility or item') < page.indexOf('2. Choose your borrowing schedule'));
  assert.match(page,/max=\{selected && fromManilaInput/);
  assert.match(page,/selected\.max_borrow_minutes \* 60_000/);
  assert.match(clientLib,/\+08:00/);
  assert.match(clientLib,/Asia\/Manila/);
});

test("Philippine date-input interpretation remains identical outside Asia/Manila", async () => {
  const {fromManilaInput, toManilaInput, formatBorrowDuration,formatBorrowDateTime} = await import("../../client/src/lib/borrowing.js");
  const converted=fromManilaInput("2026-10-20T08:00");
  assert.equal(converted.toISOString(), "2026-10-20T00:00:00.000Z");
  assert.equal(toManilaInput(converted), "2026-10-20T08:00");
  assert.equal(formatBorrowDuration(2880),"2 days");
  assert.equal(formatBorrowDuration(90),"1h 30m");
  assert.equal(formatBorrowDuration(30),"30 minutes");
  assert.match(formatBorrowDateTime(converted),/Oct 20, 2026/);
  assert.equal(fromManilaInput("2026-02-30T08:00"),null);
});
