import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readClient = (path) => readFile(new URL(`../../client/${path}`, import.meta.url), 'utf8');

test('Phase 2 SQL preserves existing accounts and creates invitation-only tables', async () => {
  const sql = await read('supabase-v4-phase2-admin-invitations.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.admin_invitations/i);
  assert.match(sql, /REFERENCES public\.users\(id\)/i);
  assert.match(sql, /INSERT INTO public\.users/i);
  assert.match(sql, /'admin', 'pending', false, false, false/i);
  assert.doesNotMatch(sql, /TRUNCATE\s|DELETE FROM public\.users|DROP TABLE public\.users/i);
});
test('SQL applies fixed admin-only role, pending status and atomic creation', async () => {
  const sql = await read('supabase-v4-phase2-admin-invitations.sql');
  assert.match(sql, /FUNCTION public\.bgy_create_admin_invitation/i);
  assert.match(sql, /'admin', 'pending', false/i);
  assert.match(sql, /INSERT INTO public\.admin_invitations/i);
  assert.doesNotMatch(sql, /INSERT INTO public\.users[\s\S]*?super_admin/i);
});
test('Single-use invitations are locked, expire and only activate pending admin users', async () => {
  const sql = await read('supabase-v4-phase2-admin-invitations.sql');
  const accept = sql.split('CREATE OR REPLACE FUNCTION public.bgy_accept_admin_invitation')[1].split('REVOKE ALL ON FUNCTION')[0];
  for (const fragment of ['accepted_at IS NULL', 'expires_at > now()', 'FOR UPDATE', "linked_role IS DISTINCT FROM 'admin'", "linked_status IS DISTINCT FROM 'pending'", 'linked_active IS DISTINCT FROM false', 'UPDATE public.users', 'accepted_at = now()']) assert.ok(accept.includes(fragment), fragment);
});
test('RPCs only executable by service role and invitation changes audited by Phase 1', async () => {
  const sql = await read('supabase-v4-phase2-admin-invitations.sql');
  for (const role of ['PUBLIC', 'anon', 'authenticated']) assert.match(sql, new RegExp(`FROM PUBLIC, anon, authenticated`, 'i'));
  for (const method of ['bgy_create_admin_invitation', 'bgy_refresh_admin_invitation', 'bgy_accept_admin_invitation']) assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION public.${method}`));
  assert.match(sql, /bgy_audit_row_change_trg/);
});
test('Super Admin router never accepts super admin creation, role changes or staff password resets', async () => {
  const src = await read('src/routes/superAdmin.js');
  assert.match(src, /requireRole\("super_admin"\)/);
  assert.match(src, /req\.body\.role !== undefined && req\.body\.role !== "admin"/);
  assert.match(src, /bgy_create_admin_invitation/);
  assert.match(src, /bgy_refresh_admin_invitation/);
  assert.doesNotMatch(src, /router\.patch\("\/users\/:userId"/);
  assert.doesNotMatch(src, /router\.post\("\/users\/:userId\/reset-password"/);
  assert.doesNotMatch(src, /res\.status\(201\)\.json\(\{[^}]*temporaryPassword/s);
});
test('Invite generation uses cryptographic tokens and sends through Resend only', async () => {
  const helper = await read('src/lib/adminInvitations.js');
  assert.match(helper, /randomBytes\(32\)/);
  assert.match(helper, /createHash\("sha256"\)/);
  assert.match(helper, /ADMIN_INVITATION_HOURS = 48/);
  assert.match(helper, /sendSystemEmail/);
  assert.doesNotMatch(helper, /nodemailer|smtp|gmail/i);
  assert.doesNotMatch(helper, /console\.log\(.*token/);
});
test('Admin account creation cannot activate before invitation acceptance', async () => {
  const route = await read('src/routes/superAdmin.js');
  const sql = await read('supabase-v4-phase2-admin-invitations.sql');
  assert.match(route, /deliveryStatus = "delivery_failed"/);
  assert.match(route, /p_full_name: fullName/);
  assert.match(sql, /role, status, is_active, email_verified/);
  assert.match(sql, /status = 'approved',[\s\S]*is_active = true/);
  assert.match(route, /admin_invitation_created/);
});
test('New invitation API verifies in POST body and never returns the token', async () => {
  const route = await read('src/routes/auth.js');
  const block = route.split('router.post("/admin-invitation/verify"')[1].split('router.post("/login"')[0];
  assert.match(block, /hashInvitationToken\(token\)/);
  assert.match(block, /\.is\("accepted_at", null\)/);
  assert.match(block, /\.gt\("expires_at", new Date\(\)\.toISOString\(\)\)/);
  assert.match(block, /bgy_accept_admin_invitation/);
  assert.doesNotMatch(block, /res\.json\(\{[^}]*token[^}]*\}\)/);
});
test('First-login mandatory password change applies to admins server-side', async () => {
  const middleware = await read('src/middleware/auth.js');
  const admin = await read('src/routes/admin.js');
  const maintenance = await read('src/routes/superAdmin.js');
  assert.match(middleware, /!allowPasswordChange && user\.must_change_password/);
  assert.match(admin, /requireAuth, requireCurrentUser\(\), requireRole\("admin"\)/);
  assert.match(maintenance, /requireCurrentUser\(\)/);
});
test('Admin and Super Admin share portal; only Super Admin sees admin creation', async () => {
  const app = await readClient('src/App.jsx');
  const nav = await readClient('src/components/layouts/AdminPageLayout.jsx');
  const ui = await readClient('src/pages/admin/Admin_UserMaintenance.jsx');
  assert.match(app, /ProtectedRoute roles=\{\["admin"\]\}/);
  assert.match(app, /ProtectedRoute roles=\{\["super_admin"\]\}/);
  assert.match(app, /path="admin\/setup"/);
  assert.match(nav, /if \(isSuperAdmin\)/);
  assert.match(nav, /Admin Accounts/);
  assert.match(ui, /Create Admin Invitation/);
  assert.doesNotMatch(ui, /option value="super_admin"|Reset Password|Clear Flag|Deactivate/);
});
test('Staff account setup consumes invitation then directs to shared login', async () => {
  const page = await readClient('src/pages/admin/AdminSetup.jsx');
  assert.match(page, /history\.replaceState/);
  assert.match(page, /\/auth\/admin-invitation\/verify/);
  assert.match(page, /\/auth\/admin-invitation\/accept/);
  assert.match(page, /isStrongPassword/);
  assert.match(page, /\/admin\/login/);
});
test('Admin password recovery UI uses existing code flow without privilege resetting a user', async () => {
  const login = await readClient('src/pages/admin/AdminLogin.jsx');
  const auth = await read('src/routes/auth.js');
  assert.match(login, /Forgot password\?/);
  assert.match(login, /\/auth\/forgot-password\/request-code/);
  assert.match(login, /\/auth\/forgot-password\/reset/);
  assert.match(login, /portal: "admin"/);
  assert.match(auth, /Administrator account recovery is unavailable for this account/);
});

const toDataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const loadInviteHelpers = async () => {
  const source = await read('src/lib/adminInvitations.js');
  const env = toDataUrl(`export const env={clientUrl:"https://www.barangayiba.com"}`);
  const mailer = toDataUrl(`export const sendSystemEmail=async(v)=>({ delivered:true, payload:v })`);
  return import(toDataUrl(source.replace('from "./env.js"', `from "${env}"`).replace('from "./mailer.js"', `from "${mailer}"`)));
};

test('Invitation tokens use secure random bytes with unique SHA-256 hashes', async () => {
  const m = await loadInviteHelpers();
  const tokens = Array.from({ length: 100 }, () => m.newInvitationToken());
  assert.equal(new Set(tokens).size, tokens.length);
  for (const token of tokens) {
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.match(m.hashInvitationToken(token), /^[0-9a-f]{64}$/);
  }
  assert.equal(m.hashInvitationToken(tokens[0]) === tokens[0], false);
});

test('Invitation email contains 48-hour one-time setup link and escapes HTML name', async () => {
  const m = await loadInviteHelpers();
  const token = m.newInvitationToken();
  const result = await m.sendAdminInvitationEmail({
    email: 'person@example.net', fullName: 'A <Employee>', username: 'a.employee', token,
  });
  assert.deepEqual(result.payload.to, 'person@example.net');
  assert.match(result.payload.html, /A &lt;Employee&gt;/);
  assert.doesNotMatch(result.payload.html, /A <Employee>/);
  assert.ok(result.payload.text.includes(`https://www.barangayiba.com/admin/setup?token=${token}`));
  assert.match(result.payload.text, /48 hours/);
});
