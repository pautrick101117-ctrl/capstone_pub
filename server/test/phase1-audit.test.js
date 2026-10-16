import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getAuditContext, auditRequestContext, withAuditHeaders } from '../src/lib/auditContext.js';
import { cleanAuditValue, auditCategoryForAction } from '../src/utils/auditValues.js';
import { createAuditWorkbook, auditReportRows } from '../src/lib/auditExcel.js';

const read = async (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('Phase 1 database migration is additive and tracks required module tables transactionally', async () => {
  const sql = await read('supabase-v4-phase1-audit-upgrade.sql');
  assert.match(sql, /AFTER INSERT OR UPDATE OR DELETE/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.bgy_audit_row_change/);
  assert.match(sql, /'users'/);
  assert.match(sql, /'borrowable_assets'/);
  assert.match(sql, /'census_households'/);
  assert.match(sql, /'community_projects'/);
  assert.match(sql, /'project_updates'/);
  assert.match(sql, /'request_timeline'/);
  assert.match(sql, /REVOKE UPDATE, DELETE, TRUNCATE ON public\.audit_logs FROM service_role/);
  assert.doesNotMatch(sql, /TRUNCATE TABLE|DROP TABLE|DELETE FROM public\.audit_logs/i);
});

test('Phase 1 audit server reads role from existing authenticated user', async () => {
  const admin = await read('src/routes/admin.js');
  const auth = await read('src/middleware/auth.js');
  const app = await read('src/index.js');
  assert.ok(admin.includes('router.get("/audit-logs"'));
  assert.ok(admin.includes('router.get("/audit-logs/export"'));
  assert.doesNotMatch(admin.slice(admin.indexOf('router.get("/audit-logs"'), admin.indexOf('router.get("/audit-logs/export"')), /Only super admins can view audit logs/);
  assert.match(auth, /req\.currentUser/);
  assert.match(app, /app\.use\(auditRequestContext\)/);
});

test('Sensitive fields are deeply masked and plain notes retained', () => {
  const val = cleanAuditValue({ admin_note: 'Request reviewed', email: 'example@test.org', nested: { temporaryPassword: 'NeverSend', code_hash: 'secret-hash', token: 'abc' } });
  assert.equal(val.admin_note, 'Request reviewed');
  assert.equal(val.email, 'example@test.org');
  assert.equal(val.nested.temporaryPassword, '[redacted]');
  assert.equal(val.nested.code_hash, '[redacted]');
  assert.equal(val.nested.token, '[redacted]');
});

test('Activity and security events are distinct', () => {
  assert.equal(auditCategoryForAction('login_failed'), 'security');
  assert.equal(auditCategoryForAction('change_password'), 'security');
  assert.equal(auditCategoryForAction('admin_page_view'), 'activity');
});

test('Supabase request headers come from verified currentUser, not the browser', async () => {
  const req = { auditRequestId: 'test-request-id', path: '/api/admin/users', method: 'PATCH', ip: '127.0.0.1',
    currentUser: { id: '11111111-1111-4111-8111-111111111111', role: 'admin', full_name: 'Test Admin' },
    get: () => 'Test Agent', };
  await new Promise((resolve) => auditRequestContext(req, {}, () => {
    assert.equal(getAuditContext().req, req);
    const result = withAuditHeaders({ headers: { 'x-bgy-audit-actor-id': 'UNTRUSTED' } });
    assert.equal(result.headers.get('x-bgy-audit-actor-id'), req.currentUser.id);
    assert.equal(result.headers.get('x-bgy-audit-request-id'), req.auditRequestId);
    assert.equal(result.headers.get('x-bgy-audit-method'), 'PATCH');
    resolve();
  }));
});

test('Excel export produces a ZIP-based XLSX with both summary and field change worksheets', () => {
  const data = [{ id:'evt1', created_at:'2026-10-16T12:00:00Z', action:'user.deactivated', event_category:'change',
    entity_type:'users', entity_id:'user1', module:'users', target_label:'Sample Resident', actor_name_snapshot:'Sample Admin',
    changed_fields: { is_active: { before:true, after:false }, role:{before:'resident',after:'=HYPERLINK("bad")'} } }];
  const { summary, changes } = auditReportRows(data);
  assert.equal(summary.length, 2);
  assert.equal(changes.length, 3);
  const file = createAuditWorkbook(data);
  assert.equal(file.readUInt32LE(0), 0x04034b50);
  assert.ok(file.includes(Buffer.from('xl/worksheets/sheet1.xml')));
  assert.ok(file.includes(Buffer.from('xl/worksheets/sheet2.xml')));
});

test('Front-end audit UI supports category tabs, date filters, export and only verified record links', async () => {
  const ui = await readFile(new URL('../../client/src/pages/admin/AdminAuditLogs.jsx', import.meta.url), 'utf8');
  assert.ok(ui.includes('label: "Changes"'));
  assert.ok(ui.includes('label: "Activity"'));
  assert.ok(ui.includes('label: "Security"'));
  assert.ok(ui.includes('label: "Legacy"'));
  assert.ok(ui.includes('recordId='));
  assert.ok(ui.includes('/audit-logs/export'));
  assert.ok(ui.includes('Asia/Manila'));
});
