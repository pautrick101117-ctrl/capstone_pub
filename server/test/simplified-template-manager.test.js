import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [ui, requestUI, routes, migration] = await Promise.all([
  read('../../client/src/components/TemplateManager.jsx'),
  read('../../client/src/components/DocumentRequestDetail.jsx'),
  read('../src/routes/documents.js'),
  read('../supabase-v4-simplified-document-templates.sql'),
]);

test('Super Admin sees a single Save Changes action with only current document types', () => {
  assert.match(ui, /currentByType\(templates\)/);
  assert.match(ui, /label="Select document"/);
  assert.match(ui, />Save Changes<\/Button>/);
  assert.doesNotMatch(ui, /Approve new version|Save new draft|Select a version/);
});

test('new saves validate fields and preview current edits before submitting', () => {
  assert.match(ui, /requiredMissing\.length/);
  assert.match(ui, /!isCurrentPreview/);
  assert.match(ui, /expectedTemplateId: selected\.id/);
  assert.match(ui, /method: "PUT"/);
  assert.match(routes, /requireRole\("super_admin"\)/);
  assert.match(routes, /validateTemplateConfig\(req\.body\.config\)/);
});

test('request verification automatically offers latest saved document', () => {
  assert.match(requestUI, /approval_state === "approved"/);
  assert.match(requestUI, /\.sort\(\(a, b\) => b\.version - a\.version\)\.slice\(0, 1\)/);
  assert.doesNotMatch(requestUI, /Ask the superadmin to review and approve its template/);
});

test('database saves original draft in place and later creates immutable snapshots', () => {
  assert.match(migration, /IF v_current\.approval_state = 'draft' THEN/);
  assert.match(migration, /UPDATE public\.document_templates SET/);
  assert.match(migration, /IF v_current\.approval_state = 'approved' AND v_current\.config = p_config THEN/);
  assert.match(migration, /INSERT INTO public\.document_templates/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /p_expected_id IS DISTINCT FROM v_current\.id/);
  assert.match(migration, /v_current\.version \+ 1/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.bgy_template_save_current/);
  assert.match(migration, /TO service_role/);
});
