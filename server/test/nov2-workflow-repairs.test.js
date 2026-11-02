import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const get = path => readFile(new URL(path, import.meta.url),'utf8');

test('ID appointments require active slot capacity, serialized at the database level',async()=>{
 const sql=await get('../supabase-v4-nov2-workflow-repairs.sql');
 assert.match(sql,/FOR UPDATE/);
 assert.match(sql,/BEFORE INSERT OR UPDATE OF preferred_date,time_slot,status/);
 assert.match(sql,/busy >= s.capacity/);
 assert.match(sql,/bgy_nov2_id_slot_edit_guard/);
 const api=await get('../src/routes/requests.js');
 assert.match(api,/slots\.map\(slot =>/);
 assert.match(api,/remaining > 0/);
});
test('Document pickup is staff-controlled, future-dated, and required before ready',async()=>{
 const sql=await get('../supabase-v4-nov2-workflow-repairs.sql');
 assert.match(sql,/pickup_scheduled_for timestamptz/);
 assert.match(sql,/NEW.status='ready_for_pickup'/);
 assert.match(sql,/p_when <= now\(\)/);
 assert.match(sql,/bgy_nov2_schedule_document_pickup/);
 const api=await get('../src/routes/documents.js');
 assert.match(api,/\/requests\/:id\/pickup", requireRole\("admin"\)/);
 const ui=await get('../../client/src/components/DocumentRequestDetail.jsx');
 assert.match(ui,/Save pickup schedule/);
 assert.match(ui,/!r.pickup_scheduled_for/);
});
test('Census archives instead of deleting, with search and restore',async()=>{
 const api=await get('../src/routes/admin.js');
 assert.match(api,/action: "archive_census_household"/);
 assert.match(api,/census_households\/:id\/restore/);
 assert.doesNotMatch(api,/db\.from\("census_households"\)\.delete\(\)/);
 const ui=await get('../../client/src/pages/admin/Admin_Census.jsx');
 assert.match(ui,/Search households/);
 assert.match(ui,/Show archived/);
 assert.match(ui,/Restore<\/Button>/);
});
test('Staff submission limit is higher without removing resident protection',async()=>{
 const limiter=await get('../src/middleware/persistentLimit.js');
 assert.match(limiter,/staff \? 60 : 10/);
 assert.match(limiter,/RATE_LIMITED/);
});
test('Borrowing shows current in-use resources and prevents unavailable selection',async()=>{
 const api=await get('../src/routes/borrowing.js');
 assert.match(api,/isInUseNow/);
 assert.match(api,/currentAvailableQuantity/);
 const ui=await get('../../client/src/pages/client/BorrowingPage.jsx');
 assert.match(ui,/availabilityChecked && !asset\.isAvailable/);
 assert.match(ui,/How many hours do you need/);
});
test('No unapproved PDFs are generated for residents; template setup is explained',async()=>{
 const api=await get('../src/routes/requests.js');
 assert.match(api,/Official Word files are restricted to authorized staff/);
 const editor=await get('../../client/src/components/TemplateManager.jsx');
 assert.match(editor,/\["Pickup instructions", config\.pickupInstructions\]/);
 assert.match(editor,/\["Office contact", config\.officeContact\]/);
 assert.match(editor,/Complete these fields before saving/);
 assert.match(editor,/>Save Changes<\/Button>/);
 assert.doesNotMatch(editor,/Approve new version|Save new draft/);
});
test('Source export stray text is removed from runtime JavaScript modules',async()=>{
 const jwt=await get('../src/lib/jwt.js');
 const mail=await get('../src/lib/residentCredentialEmail.js');
 assert.doesNotMatch(jwt,/\*\*\/\.env/);
 assert.doesNotMatch(mail,/artifacts\/preview-barangay/);
});

test('overdue resources remain blocked until the barangay records a return', async () => {
  const [sql, route] = await Promise.all([get('../supabase-v4-nov2-workflow-repairs.sql'), get('../src/routes/borrowing.js')]);
  assert.match(sql, /r\.due_at\s*>\s*NEW\.start_at\s+OR\s+r\.status\s*=\s*'borrowed'/);
  assert.match(route, /status\.eq\.borrowed/);
});
