import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { announcementEventDate, publicationDate } from "../src/lib/publication.js";

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");

test("announcements accept future activity dates without changing publication dates", () => {
  assert.equal(announcementEventDate("2026-12-25T09:30:00+08:00"), "2026-12-25T01:30:00.000Z");
  assert.equal(announcementEventDate("2026-11-03T01:00:00Z"), "2026-11-03T01:00:00.000Z");
  assert.equal(announcementEventDate(""), null);
  assert.equal(announcementEventDate(undefined), null);
  assert.throws(() => announcementEventDate("2026-02-30T12:00:00+08:00"), /valid activity date/);
  assert.throws(() => announcementEventDate("2026-12-25T09:30"), /time zone/);
  assert.throws(() => publicationDate("2026-12-25T09:30:00+08:00", new Date("2026-11-03T00:00:00Z")), /past or present/);
});

test("API separates when a notice is posted from when its activity occurs", async () => {
  const admin = await read("../src/routes/admin.js");
  const publicApi = await read("../src/routes/public.js");
  const migration = await read("../supabase-v4-announcement-activity-date.sql");
  assert.match(admin, /payload\.event_at = announcementEventDate\(body\.eventAt\)/);
  assert.match(admin, /payload\.published_at = new Date\(\)\.toISOString\(\)/);
  assert.match(publicApi, /eventAt: item\.type === "announcement"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS event_at timestamptz/i);
});

test("admin lets upcoming activities be announced while news publication stays bounded", async () => {
  const editor = await read("../../client/src/pages/admin/AdminContentPage.jsx");
  const home = await read("../../client/src/pages/client/Home.jsx");
  const feed = await read("../../client/src/pages/client/PublicFeedPage.jsx");
  assert.match(editor, /Activity Date & Time/);
  assert.match(editor, /type === "announcement"/);
  assert.match(editor, /type === "news" && form\.date/);
  assert.match(editor, /formData\.append\("eventAt"/);
  assert.match(home, /item\.eventAt/);
  assert.match(feed, /item\.eventAt/);
});
