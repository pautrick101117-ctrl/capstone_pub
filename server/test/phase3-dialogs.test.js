import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { reviewChanges } from "../../client/src/lib/actionReview.js";
const readClient = (path) => readFile(new URL(`../../client/src/${path}`, import.meta.url), "utf8");

test("review shows exactly modified fields, mapping database snake_case to UI camelCase", () => {
  const changes = reviewChanges({ full_name: "Example", is_active: true, contact_number: "09171234567" },
    { fullName: "Example", isActive: false, contactNumber: "09181234567" });
  assert.equal(changes.length, 2);
  assert.deepEqual(changes.map((item) => item.field), ["is Active", "contact Number"]);
  assert.deepEqual(changes.map((item) => item.before), ["Yes", "09171234567"]);
});

test("review never contains secrets and ignores identical changes", () => {
  const changes = reviewChanges({ name: "unchanged" }, { name: "unchanged", password: "Password123", temporaryPassword: "Secret", token: "xyz", description: "new" });
  assert.deepEqual(changes.map((item) => item.field), ["description"]);
  assert.equal(changes[0].after, "new");
});

test("manual logout entry points route through the shared confirmation", async () => {
  for (const layout of ["AdminPageLayout", "LandingPageLayout", "UserPortalLayout"]) {
    const source = await readClient(`components/layouts/${layout}.jsx`);
    assert.match(source, /const confirmLogout = async/);
    assert.doesNotMatch(source, /onClick=\{logout\}/);
    assert.match(source, /onClick=\{confirmLogout\}/);
  }
});

test("shared review has safe dismissal and a field-by-field comparison", async () => {
  const review = await readClient("components/ActionReviewProvider.jsx");
  const ui = await readClient("components/ui.jsx");
  assert.match(review, /useUnsavedNavigation/);
  assert.match(review, /reviewChanges\(config\.before, config\.after\)/);
  assert.match(review, /Discard Unsaved|Discard unsaved changes\?/);
  assert.match(ui, /createPortal/);
  assert.match(ui, /aria-modal="true"/);
  assert.match(ui, /event\.key === "Escape"/);
  assert.match(ui, /event\.key !== "Tab"/);
});

test("create/edit and request handlers gate mutations behind user confirmation", async () => {
  for (const page of ["Admin_Residents", "Admin_Borrowing", "Admin_Census", "AdminEvents", "AdminContentPage", "Admin_Officials", "Admin_Settings", "Admin_VotingResult", "AdminProjects", "AdminRequests"]) {
    const source = await readClient(`pages/admin/${page}.jsx`);
    assert.match(source, /await reviewAction\(/, page);
  }
  const requests = await readClient("pages/admin/AdminRequests.jsx");
  assert.doesNotMatch(requests, /setSaving\(false\);\s*setSelected\(null\);/);
});
