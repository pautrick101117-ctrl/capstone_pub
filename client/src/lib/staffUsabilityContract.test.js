import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = async path => readFile(new URL(path, import.meta.url), "utf8");

test("staff reviewer explains blockers and offers template setup link", async () => {
  const page = await read("../components/DocumentRequestDetail.jsx");
  assert.match(page, /Before you can approve:/);
  assert.match(page, /templates=1/);
  assert.match(page, /blockers\.map/);
  assert.match(page, /approvedTemplates\[0\]/);
});
test("start review is reversible and skips the confirmation modal", async () => {
  const page = await read("../components/DocumentRequestDetail.jsx");
  assert.match(page, /confirm: next !== "under_review"/);
  assert.match(page, /Start review/);
});
test("Word preparation uses latest draft with acknowledgement", async () => {
  const page = await read("../components/DocumentRequestDetail.jsx");
  assert.match(page, /preferredWordFile\(files, selectedFile\)/);
  assert.match(page, /I reviewed the selected Word document/);
  assert.match(page, /physicalCopyReady/);
});
test("preview editor offers retry and warns on unsaved changes", async () => {
  const editor = await read("../components/TemplateManager.jsx");
  assert.match(editor, /Try preview again/);
  assert.match(editor, /You have unsaved template changes/);
  assert.match(editor, /beforeunload/);
  assert.match(editor, /previewRetry/);
});
test("old and new email log rows are consolidated and shown without manual send", async () => {
  const page = await read("../components/DocumentRequestDetail.jsx");
  assert.match(page, /staffEmailItems/);
  assert.match(page, /Latest resident email:/);
  assert.doesNotMatch(page, /Preview email|Send reviewed email/);
});
