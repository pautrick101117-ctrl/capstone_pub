import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const client = (name) => readFile(new URL(`../../client/src/${name}`, import.meta.url), "utf8");

test("Phase 4: links styled as buttons remain semantic navigation links", async () => {
  const ui = await client("components/ui.jsx");
  assert.match(ui, /export const ButtonLink/);
  assert.match(ui, /<NavLink to=\{to\}/);
  for (const file of ["pages/client/Home.jsx", "pages/client/UserDashboard.jsx", "pages/client/SettingsPage.jsx"]) {
    const source = await client(file);
    assert.doesNotMatch(source, /<NavLink\b[^>]*>\s*<Button\b/, `${file} must not wrap a button in a link`);
  }
});

test("Phase 4: resident desktop logout is unique and mobile logout remains reachable", async () => {
  const ui = await client("components/layouts/UserPortalLayout.jsx");
  assert.match(ui, /border-t border-stone-100 p-4[\s\S]*?onClick=\{confirmLogout\}/);
  assert.doesNotMatch(ui, /hidden sm:inline-flex.*onClick=\{confirmLogout\}/);
  assert.match(ui, /aria-label="More resident services"/);
  assert.match(ui, /id="resident-more-menu"/);
  assert.match(ui, /onEscape/);
});

test("Phase 4: residents have one row action but retain all account controls", async () => {
  const ui = await client("pages/admin/Admin_Residents.jsx");
  const rowBlock = ui.split("{paginatedResidents.map")[1]?.split("{!paginatedResidents.length")[0];
  assert.ok(rowBlock, "residents table must exist");
  assert.match(rowBlock, /View & Manage/);
  assert.doesNotMatch(rowBlock, /<Button[^>]*>\s*<Pencil/);
  const details = ui.split('description="Resident record and account information."')[1]?.split('title="Edit Resident"')[0];
  assert.ok(details);
  for (const label of ["Edit Resident", "Reset Password", "Deactivate Account", "Activate Account"]) assert.ok(details.includes(label), `resident profile action ${label} should remain`);
});

test("Phase 4: only one Add Resource action is visible per borrowing tab", async () => {
  const ui = await client("pages/admin/Admin_Borrowing.jsx");
  assert.match(ui, /actions=\{tab !== "inventory"\s*\?/);
  assert.match(ui, /Borrowable inventory/);
  assert.match(ui, /setAssetModal\(\{ \.\.\.blankAsset \}\)/);
  assert.match(ui, /status === "due_today"/);
  assert.match(ui, /setStatus\("due_today"\)/);
});

test("Phase 4: contextual empty-state buttons do not duplicate visible page creation actions", async () => {
  for (const [file, method] of [
    ["pages/admin/AdminContentPage.jsx", "openCreate"],
    ["pages/admin/AdminEvents.jsx", "openEventCreate"],
    ["pages/admin/Admin_Officials.jsx", "openCreate"],
    ["pages/admin/Admin_VotingResult.jsx", "startNew"],
    ["pages/admin/Admin_Census.jsx", "openCreate"],
  ]) {
    const ui = await client(file);
    assert.doesNotMatch(ui, new RegExp(`action=\\{<Button onClick=\\{${method}\\}`), `${file} duplicated primary action`);
  }
});

test("Phase 4: public services and resident login safely preserve their destination", async () => {
  const landing = await client("components/layouts/LandingPageLayout.jsx");
  const home = await client("pages/client/Home.jsx");
  const login = await client("pages/client/Login.jsx");
  assert.match(landing, /destinationFor\(item\)/);
  assert.match(landing, /encodeURIComponent\(item\.residentTo\)/);
  assert.match(home, /encodeURIComponent\(to\)/);
  assert.match(login, /const allowedNext = new Set/);
  assert.match(login, /allowedNext\.has\(requestedNext\)/);
  assert.match(login, /safeDestination/);
});

test("Phase 4: mobile navigation and shared components provide accessibility controls", async () => {
  const admin = await client("components/layouts/AdminPageLayout.jsx");
  const landing = await client("components/layouts/LandingPageLayout.jsx");
  const resident = await client("components/layouts/UserPortalLayout.jsx");
  const shared = await client("components/ui.jsx");
  for (const source of [admin, landing, resident]) {
    assert.match(source, /Skip to main content/);
    assert.match(source, /id="main-content"/);
  }
  assert.match(admin, /aria-expanded=\{open\}/);
  assert.match(shared, /role="region" aria-label=\{label\} tabIndex=\{0\}/);
  assert.match(shared, /event\.key === "ArrowRight"/);
  assert.match(shared, /sm:inline-flex/);
});

test("Phase 4: unknown paths have a role-appropriate return destination", async () => {
  const app = await client("App.jsx");
  const fallback = await client("pages/client/NotFoundPage.jsx");
  assert.match(app, /<Route path="\*" element=\{<NotFoundPage \/>\}/);
  assert.match(fallback, /\["admin", "super_admin"\]/);
  assert.match(fallback, /ButtonLink to=\{destination\}/);
});
