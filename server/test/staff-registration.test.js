import test, {before, after, beforeEach, mock} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';

// Exercise the real app, JWT authentication, validation, hashing, uploads,
// mailer and audit code. Only the external service boundaries are replaced.
// No connected Supabase database, storage bucket or email recipient is used.
Object.assign(process.env, {
  NODE_ENV: 'test', SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
  JWT_SECRET: 'staff-registration-isolated-test-secret',
  RESEND_API_KEY: 're_isolated_test', RESEND_FROM_EMAIL: 'Barangay Iba <office@example.test>',
  CLIENT_URL: 'http://localhost:5173', CLIENT_URLS: 'http://localhost:5173',
});
const {supabase} = await import('../src/lib/supabase.js');
const {signToken} = await import('../src/lib/jwt.js');
const {createApp} = await import('../src/index.js');
const {rateKey} = await import('../src/middleware/persistentLimit.js');
const {ID_BUCKET} = await import('../src/lib/residentIds.js');
const original = {from: supabase.from, rpc: supabase.rpc, storageFrom: supabase.storage.from, fetch: globalThis.fetch};
const actors = Object.fromEntries(['admin', 'super_admin', 'resident'].map(role => [role, {
  id: randomUUID(), username: role, full_name: role, role, is_active: true,
  status: 'approved', must_change_password: false,
}]));
const tokens = Object.fromEntries(Object.entries(actors).map(([role, actor]) => [role, signToken({sub: actor.id, role})]));
const head = {firstName: 'Ana', lastName: 'Cruz', relationship: 'Head', birthdate: '1990-01-01', sex: 'female', isHead: true};
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
// The current validator requires at least 100 bytes; trailing bytes are valid for PNG uploads.
const png = Buffer.concat([image, Buffer.alloc(100)]);
let tables, objects, counters, rateCalls, emails, emailStatus, storageFailure, databaseFailure, server, baseUrl;
const normalize = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const failure = (code, message) => ({data: null, error: {code, message}});
const householdDuplicate = row => tables.census_households.some(existing =>
  normalize(existing.household_ref) === normalize(row.household_ref) ||
  ['purok', 'household_name', 'address'].every(key => normalize(existing[key]) === normalize(row[key])));

// A small stateful PostgREST stub: filters, inserts, deletes, FK and unique
// conflicts behave like the production operations used by these handlers.
// The separate registration-sql suite verifies the actual SQL constraints/RPC.
const from = table => {
  assert.ok(Object.hasOwn(tables, table), `Unexpected table: ${table}`);
  let operation = 'select', payload, limit = Infinity;
  const filters = [];
  const execute = async () => {
    if (table === 'users' && operation === 'insert' && databaseFailure) return failure('08006', 'Database unavailable');
    const matches = row => filters.every(filter => filter(row));
    if (operation === 'delete') {
      const deleted = tables[table].filter(matches);
      tables[table] = tables[table].filter(row => !matches(row));
      if (table === 'users') tables.resident_id_evidence = tables.resident_id_evidence.filter(row => !deleted.some(user => user.id === row.user_id));
      return {data: deleted, error: null};
    }
    if (operation === 'insert') {
      const rows = (Array.isArray(payload) ? payload : [payload]).map(row => ({id: randomUUID(), ...row}));
      for (const row of rows) {
        if (table === 'users' && tables.users.some(user => normalize(user.email) === normalize(row.email) || normalize(user.username) === normalize(row.username))) {
          return failure('23505', 'Duplicate email or username');
        }
        if (table === 'census_households' && householdDuplicate(row)) return failure('23505', 'Duplicate household');
        if (table === 'household_members') {
          if (!tables.census_households.some(household => household.id === row.household_id)) return failure('23503', 'Household does not exist');
          if (row.is_head && tables.household_members.some(member => member.household_id === row.household_id && member.is_head)) {
            return failure('23505', 'A head of household already exists');
          }
        }
      }
      tables[table].push(...rows);
      return {data: rows, error: null};
    }
    return {data: tables[table].filter(matches).slice(0, limit), error: null};
  };
  const query = {
    select() { return query; },
    eq(key, value) { filters.push(row => row[key] === value); return query; },
    neq(key, value) { filters.push(row => row[key] !== value); return query; },
    ilike(key, value) { filters.push(row => normalize(row[key]) === normalize(value)); return query; },
    limit(value) { limit = value; return query; },
    insert(value) { operation = 'insert'; payload = value; return query; },
    delete() { operation = 'delete'; return query; },
    async single() {
      const result = await execute();
      return result.error ? result : {...result, data: result.data[0] || null};
    },
    maybeSingle() { return query.single(); },
    then(resolve, reject) { return execute().then(resolve, reject); },
  };
  return query;
};

before(async () => {
  supabase.from = from;
  supabase.rpc = async (name, params) => {
    if (name === 'bgy_p105_rate_check') {
      rateCalls.push(params);
      const used = counters.get(params.p_key) || 0;
      const allowed = used < params.p_limit;
      if (allowed && params.p_increment) counters.set(params.p_key, used + 1);
      return {data: [{allowed, retry_after: allowed ? 0 : params.p_window_seconds}], error: null};
    }
    assert.equal(name, 'bgy_register_census_household', `Unexpected RPC: ${name}`);
    if (householdDuplicate(params.p_household)) return failure('23505', 'Duplicate household');
    const household = {id: randomUUID(), ...params.p_household, members: params.p_members.length, membership_verified: true};
    tables.census_households.push(household);
    tables.household_members.push(...params.p_members.map(member => ({id: randomUUID(), ...member, household_id: household.id})));
    return {data: household, error: null};
  };
  supabase.storage.from = bucket => {
    assert.equal(bucket, ID_BUCKET, 'IDs must use the private ID bucket');
    return {
      async upload(path, bytes, options) {
        assert.equal(options.upsert, false);
        assert.equal(options.contentType, 'image/png');
        if (storageFailure) return failure('STORAGE_ERROR', 'Storage unavailable');
        objects.set(path, bytes);
        return {data: {path}, error: null};
      },
      async remove(paths) { paths.forEach(path => objects.delete(path)); return {error: null}; },
    };
  };
  globalThis.fetch = async (url, options) => {
    if (String(url) === 'https://api.resend.com/emails') {
      emails.push(JSON.parse(options.body));
      return new Response(JSON.stringify(emailStatus === 200 ? {id: `email-${emails.length}`} : {message: 'Simulated provider rejection'}), {
        status: emailStatus, headers: {'content-type': 'application/json'},
      });
    }
    assert.ok(baseUrl && String(url).startsWith(`${baseUrl}/`), `Unexpected network request: ${url}`);
    return original.fetch(url, options);
  };
  // Expected validation/provider errors and 200 mocked email accepts need not
  // flood TAP output; test assertions still report unexpected responses.
  for (const method of ['log', 'warn', 'error']) mock.method(console, method, () => {});
  server = await new Promise(resolve => { const listener = createApp().listen(0, '127.0.0.1', () => resolve(listener)); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  tables = {
    users: Object.values(actors).map(actor => ({...actor})),
    resident_id_types: [{id: 'national-id', label: 'National ID', is_active: true}],
    master_data_values: [{id: 'purok-1', category: 'purok', label: 'Purok 1', is_active: true}],
    resident_id_evidence: [], census_households: [], household_members: [], audit_logs: [],
  };
  objects = new Map(); counters = new Map(); rateCalls = []; emails = [];
  emailStatus = 200; storageFailure = false; databaseFailure = false;
});
after(async () => {
  supabase.from = original.from; supabase.rpc = original.rpc; supabase.storage.from = original.storageFrom;
  globalThis.fetch = original.fetch;
  await new Promise(resolve => server.close(resolve));
  mock.restoreAll();
});

const request = (path, {role = 'admin', token = tokens[role], body, method = 'POST', headers = {}} = {}) => fetch(`${baseUrl}/api${path}`, {
  method, headers: {...(token ? {Authorization: `Bearer ${token}`} : {}),
    ...(body instanceof FormData ? {} : {'Content-Type': 'application/json'}), ...headers},
  body: body instanceof FormData ? body : JSON.stringify(body || {}),
});
const residentForm = (index, {fields = {}, files = [png], mime = 'image/png', metadata} = {}) => {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    firstName: 'Ana', lastName: `Resident${index}`, address: `${index} Main Street`, purok: 'Purok 1',
    phoneNumber: '09171234567', email: `resident${index}@example.test`, birthdate: '1990-01-01',
    sex: 'female', civilStatus: 'Single', citizenship: 'Filipino', placeOfBirth: 'Iba', occupation: 'Teacher', ...fields,
  })) form.append(key, value);
  form.append('idMetadata', metadata ?? JSON.stringify(files.map(() => ({typeId: 'national-id'}))));
  files.forEach(bytes => form.append('idImages', new Blob([bytes], {type: mime}), 'national-id.png'));
  return form;
};
const householdBody = index => ({
  householdRef: `HH-${index}`, householdName: `Household ${index}`, address: `${index} Main Street`, purok: 'Purok 1',
  householdMembers: [head, {...head, firstName: 'Ben', birthdate: '2015-01-01', relationship: 'Child', isHead: false}],
});
const batchForm = (csv, mode = 'append') => {
  const form = new FormData(); form.append('mode', mode);
  form.append('file', new Blob([csv], {type: 'text/csv'}), 'households.csv'); return form;
};
const csv = index => `household_ref,household_name,purok,members,address,status\nHH-B${index},Imported ${index},Purok 1,2,${index} Import Street,active`;
const assertResponse = async (response, status, code) => {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  if (code) assert.equal(body.code, code);
  if (status !== 429) assert.equal(response.headers.get('retry-after'), null);
  return body;
};

for (const role of ['admin', 'super_admin']) test(`${role} creates 100 residents through the real HTTP handler with private IDs and audit events`, async () => {
  counters.set(rateKey('admin-create-resident', actors[role].id), 10);
  counters.set(rateKey('submission:post:/api/admin/users', actors[role].id), 60);
  const ids = new Set();
  for (let index = 0; index < 100; index++) {
    const body = await assertResponse(await request('/admin/users', {role, body: residentForm(index)}), 201);
    ids.add(body.user.id);
    assert.equal(body.emailDelivery.accepted, true);
    assert.equal(body.user.role, 'resident');
    assert.equal(body.user.mustChangePassword, true);
    assert.equal(body.user.password_hash, undefined);
    assert.equal(body.temporaryPassword, undefined);
  }
  assert.equal(ids.size, 100);
  const residents = tables.users.filter(user => ids.has(user.id));
  assert.equal(residents.length, 100);
  assert.equal(new Set(residents.map(user => user.username)).size, 100);
  assert.ok(residents.every(user => /^\$2[aby]\$12\$/.test(user.password_hash)));
  const temporaryPassword = emails[0].text.match(/Temporary password: (.+)/)?.[1];
  assert.ok(temporaryPassword);
  assert.equal(await bcrypt.compare(temporaryPassword, residents[0].password_hash), true);
  assert.equal(objects.size, 100); assert.equal(tables.resident_id_evidence.length, 100); assert.equal(emails.length, 100);
  assert.ok(tables.resident_id_evidence.every(row => row.uploaded_by === actors[role].id && objects.has(row.storage_path)));
  const audit = tables.audit_logs.filter(row => row.action === 'create_resident_user');
  assert.equal(audit.length, 100);
  assert.ok(audit.every(row => row.actor_id === actors[role].id && row.actor_role === role && ids.has(row.entity_id)));
  assert.ok(!JSON.stringify(audit).includes(temporaryPassword), 'temporary credentials must stay out of audit logs');
  assert.equal(rateCalls.length, 0, 'neither the shared nor the removed endpoint limiter may run');
});

for (const role of ['admin', 'super_admin']) test(`${role} registers 100 households and 100 additional members with relationships and audits`, async () => {
  counters.set(rateKey('submission:post:/api/admin/census_households', actors[role].id), 60);
  counters.set(rateKey('submission:post:/api/admin/census_households/:id/members', actors[role].id), 60);
  for (let index = 0; index < 100; index++) {
    const {item} = await assertResponse(await request('/admin/census_households', {role, body: householdBody(index)}), 201);
    assert.equal(item.members, 2);
    const {member} = await assertResponse(await request(`/admin/census_households/${item.id}/members`, {
      role, body: {...head, firstName: 'Carla', relationship: 'Spouse', isHead: false, userId: actors.resident.id},
    }), 201);
    assert.equal(member.household_id, item.id); assert.equal(member.relationship, 'Spouse'); assert.equal(member.user_id, actors.resident.id);
  }
  assert.equal(tables.census_households.length, 100); assert.equal(tables.household_members.length, 300);
  for (const action of ['create_census_household', 'add_household_member']) {
    const audit = tables.audit_logs.filter(row => row.action === action);
    assert.equal(audit.length, 100); assert.ok(audit.every(row => row.actor_id === actors[role].id && row.actor_role === role));
  }
  assert.equal(rateCalls.length, 0);
});

for (const role of ['admin', 'super_admin']) test(`${role} imports 100 Census batches, preserving preview, duplicate skipping and audit history`, async () => {
  counters.set(rateKey('submission:post:/api/admin/census_households/batch', actors[role].id), 60);
  for (let index = 0; index < 100; index++) {
    const result = await assertResponse(await request('/admin/census_households/batch', {role, body: batchForm(csv(index))}), 201);
    assert.equal(result.inserted, 1); assert.equal(result.skipped, 0);
  }
  const duplicate = await assertResponse(await request('/admin/census_households/batch', {role, body: batchForm(csv(0))}), 201);
  assert.equal(duplicate.inserted, 0); assert.equal(duplicate.skipped, 1);
  const preview = await assertResponse(await request('/admin/census_households/batch?validateOnly=true', {role, body: batchForm(csv(101))}), 200);
  assert.equal(preview.valid, true); assert.equal(preview.validCount, 1);
  assert.equal(tables.census_households.length, 100); assert.equal(rateCalls.length, 0);
  assert.equal(tables.audit_logs.filter(row => row.action === 'append_census_households' && row.actor_id === actors[role].id).length, 101);
});

test('all registration routes reject unauthenticated, forged, resident, inactive and password-change-required sessions', async () => {
  const paths = ['/admin/users', '/admin/census_households', `/admin/census_households/${randomUUID()}/members`, '/admin/census_households/batch'];
  for (const path of paths) {
    await assertResponse(await request(path, {token: null}), 401);
    await assertResponse(await request(path, {token: 'forged'}), 401);
    await assertResponse(await request(path, {role: 'resident'}), 403);
    // A stale staff role in a signed JWT cannot override the live resident role.
    await assertResponse(await request(path, {token: signToken({sub: actors.resident.id, role: 'admin'})}), 403);
    tables.users.find(user => user.id === actors.admin.id).is_active = false;
    await assertResponse(await request(path), 403);
    tables.users.find(user => user.id === actors.admin.id).is_active = true;
    tables.users.find(user => user.id === actors.admin.id).must_change_password = true;
    await assertResponse(await request(path), 403);
    tables.users.find(user => user.id === actors.admin.id).must_change_password = false;
  }
  assert.equal(tables.users.length, 3); assert.equal(tables.census_households.length, 0); assert.equal(emails.length, 0);
});

test('resident required fields, age, role and ID validation still reject bad submissions beyond the former limits', async () => {
  const invalid = [
    {fields: {firstName: ''}}, {fields: {email: ''}}, {fields: {occupation: ''}}, {fields: {purok: 'Inactive Purok'}},
    {fields: {birthdate: '2020-01-01'}}, {fields: {sex: 'invalid'}}, {files: []}, {files: [Buffer.alloc(200)]},
    {files: [png], mime: 'image/jpeg'}, {metadata: 'not-json'}, {metadata: '[]'},
    {metadata: JSON.stringify([{typeId: 'inactive'}])},
  ];
  for (let index = 0; index < 72; index++) await assertResponse(await request('/admin/users', {body: residentForm(index, invalid[index % invalid.length])}), 400);
  await assertResponse(await request('/admin/users', {body: residentForm(0, {fields: {role: 'admin'}})}), 403);
  await assertResponse(await request('/admin/users', {body: residentForm(0, {files: Array(6).fill(png)})}), 400, 'LIMIT_FILE_COUNT');
  await assertResponse(await request('/admin/users', {body: residentForm(0, {files: [Buffer.alloc(5 * 1024 * 1024 + 1)]})}), 413, 'LIMIT_FILE_SIZE');
  assert.equal(tables.users.length, 3); assert.equal(objects.size, 0); assert.equal(emails.length, 0);
  assert.equal(rateCalls.length, 0);
});

test('duplicate email is rejected, username collisions get unique names, and five valid ID uploads remain supported', async () => {
  const first = await assertResponse(await request('/admin/users', {body: residentForm(1, {files: Array(5).fill(png)})}), 201);
  await assertResponse(await request('/admin/users', {body: residentForm(2, {fields: {email: 'resident1@example.test'}})}), 500, '23505');
  const second = await assertResponse(await request('/admin/users', {body: residentForm(1, {fields: {email: 'other@example.test'}})}), 201);
  assert.notEqual(first.user.username, second.user.username);
  assert.equal(tables.users.length, 5); assert.equal(objects.size, 6); assert.equal(emails.length, 2);
});

test('database, storage and Resend failures keep distinct codes and failed creations clean up their accounts and IDs', async () => {
  databaseFailure = true;
  await assertResponse(await request('/admin/users', {body: residentForm(0)}), 500, '08006');
  databaseFailure = false; storageFailure = true;
  await assertResponse(await request('/admin/users', {body: residentForm(1)}), 502, 'ID_UPLOAD_FAILED');
  storageFailure = false; emailStatus = 429;
  await assertResponse(await request('/admin/users', {body: residentForm(2)}), 502, 'ACCOUNT_EMAIL_DELIVERY_FAILED');
  assert.equal(tables.users.length, 3); assert.equal(objects.size, 0); assert.equal(tables.resident_id_evidence.length, 0);
  assert.equal(tables.audit_logs.filter(row => row.action === 'create_resident_user').length, 0);
});

test('Census duplicate checks, head rules, member links, import validation and destructive-import rejection remain active', async () => {
  const {item} = await assertResponse(await request('/admin/census_households', {body: householdBody(1)}), 201);
  await assertResponse(await request('/admin/census_households', {body: householdBody(1)}), 409);
  await assertResponse(await request('/admin/census_households', {body: {...householdBody(2), householdName: 'Household 1', address: '1 MAIN Street'}}), 409);
  for (const householdMembers of [[], [{...head, isHead: false}], [head, head], [{...head, relationship: ''}]]) {
    await assertResponse(await request('/admin/census_households', {body: {...householdBody(2), householdMembers}}), 400);
  }
  await assertResponse(await request(`/admin/census_households/${item.id}/members`, {body: {...head, isHead: false, userId: actors.admin.id}}), 400);
  await assertResponse(await request(`/admin/census_households/${item.id}/members`, {body: {...head, relationship: ''}}), 400);
  await assertResponse(await request(`/admin/census_households/${item.id}/members`, {body: head}), 500, '23505');
  const invalidCsv = csv(2).replace('Purok 1', 'Inactive Purok');
  const preview = await assertResponse(await request('/admin/census_households/batch?validateOnly=true', {body: batchForm(invalidCsv)}), 200);
  assert.equal(preview.valid, false);
  await assertResponse(await request('/admin/census_households/batch', {body: batchForm(invalidCsv)}), 400);
  await assertResponse(await request('/admin/census_households/batch', {body: batchForm(csv(2), 'replace_all')}), 409, 'CENSUS_REPLACE_DISABLED');
  assert.equal(tables.census_households.length, 1); assert.equal(tables.household_members.length, 2);
});

test('staff security operations and other writes still return rate limits with retry headers exposed to the frontend', async () => {
  counters.set(rateKey('admin-id-catalog', actors.admin.id), 10);
  const response = await request('/admin/resident-id-types', {body: {label: 'Other ID'}, headers: {Origin: 'http://localhost:5173'}});
  await assertResponse(response, 429, 'RATE_LIMITED');
  assert.equal(response.headers.get('retry-after'), '3600');
  assert.match(response.headers.get('access-control-expose-headers'), /Retry-After/i);
  for (let index = 0; index < 60; index++) {
    const result = await request('/admin/unrelated-write');
    assert.equal(result.status, 404); await result.text();
  }
  const blocked = await request('/admin/unrelated-write');
  await assertResponse(blocked, 429, 'RATE_LIMITED');
  assert.equal(blocked.headers.get('retry-after'), '600');
  // Existing exhausted counters must not stop a newly exempt registration.
  counters.set(rateKey('submission:post:/api/admin/census_households', actors.admin.id), 60);
  await assertResponse(await request('/admin/census_households', {body: householdBody(1)}), 201);
});
