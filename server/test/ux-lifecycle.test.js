import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (url) => readFile(new URL(url, import.meta.url), "utf8");

test("project voting uses modal creation/editing and explicit lifecycle actions", async () => {
  const ui = await read("../../client/src/pages/admin/Admin_VotingResult.jsx");
  assert.match(ui, /title=\{form\.id \? "Edit Voting Post" : "Create Voting Post"\}/);
  assert.match(ui, /Close Voting/);
  assert.match(ui, /Delete Draft/);
  assert.doesNotMatch(ui, /Create\s*\/\s*Edit Voting/);
});

test("voting API supports exact edit target, close, draft delete and paginated results", async () => {
  const route = await read("../src/routes/adminVoting.js");
  assert.ok(route.includes('router.get("/election/:id"'));
  assert.ok(route.includes('router.post("/election/:id/close"'));
  assert.ok(route.includes('router.delete("/election/:id"'));
  assert.match(route, /pagination:\s*\{\s*page,\s*limit,\s*total:\s*count/);
});

test("community project updates are editable but intentionally retained", async () => {
  const route = await read("../src/routes/admin.js");
  const ui = await read("../../client/src/pages/admin/AdminProjects.jsx");
  assert.ok(route.includes('router.patch("/projects/:projectId/updates/:updateId"'));
  assert.match(ui, /Edit Update/);
  assert.match(ui, /retained for transparency/i);
});

test("resident pending project suggestions can be corrected before review", async () => {
  const route = await read("../src/routes/suggestions.js");
  const ui = await read("../../client/src/pages/client/SuggestionsPage.jsx");
  assert.ok(route.includes('router.patch("/:suggestionId"'));
  assert.match(route, /still under review can be edited/i);
  assert.match(ui, /Edit project suggestion/);
});

test("master data and primary dynamic admin lists expose pagination", async () => {
  const files = [
    "../../client/src/pages/admin/Admin_Settings.jsx",
    "../../client/src/pages/admin/Admin_Residents.jsx",
    "../../client/src/pages/admin/Admin_Census.jsx",
    "../../client/src/pages/admin/AdminRequests.jsx",
    "../../client/src/pages/admin/Admin_Complaints.jsx",
    "../../client/src/pages/admin/Admin_Borrowing.jsx",
    "../../client/src/pages/admin/AdminEvents.jsx",
    "../../client/src/pages/admin/Admin_UserMaintenance.jsx",
  ];
  for (const file of files) {
    const source = await read(file);
    assert.match(source, /Pagination/, `${file} should use Pagination`);
  }
});
