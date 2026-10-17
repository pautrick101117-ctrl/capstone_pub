import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateIdFiles } from '../src/lib/residentIdValidation.js';

const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=(p)=>fs.readFileSync(path.resolve(base,p),'utf8');
const JPG=Buffer.concat([Buffer.from([255,216,255,224]),Buffer.alloc(200)]);
const PNG=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(200)]);
const types=[{id:'ab',label:'Student ID',is_active:true},{id:'inactive',label:'Other',is_active:false}];
const file=(buffer,mimetype='image/jpeg')=>({buffer,mimetype,size:buffer.length,originalname:'id.jpg'});

test('1–5 ID images with known and custom labels; trusted signatures required',()=>{
 const out=validateIdFiles([file(JPG),file(PNG,'image/png')],JSON.stringify([{typeId:'ab'},{typeId:'custom',customLabel:'Company ID'}]),types);
 assert.deepEqual(out.map(x=>x.document_label),['Student ID','Company ID']);
 assert.deepEqual(out.map(x=>x.ext),['jpg','png']);
});
test('no ID and more than five images rejected',()=>{
 assert.throws(()=>validateIdFiles([],'[]',types),/between 1 and 5/);
 assert.throws(()=>validateIdFiles(Array(6).fill(file(JPG)),'[]',types),/between 1 and 5/);
});
test('malicious and mismatched ID file types rejected',()=>{
 assert.throws(()=>validateIdFiles([file(Buffer.alloc(200))],JSON.stringify([{typeId:'ab'}]),types),/real JPG/);
 assert.throws(()=>validateIdFiles([file(JPG,'image/png')],JSON.stringify([{typeId:'ab'}]),types),/real JPG/);
 assert.throws(()=>validateIdFiles([file(JPG)],JSON.stringify([{typeId:'inactive'}]),types),/valid ID type/);
});
test('ID file size limit and custom ID labels validated',()=>{
 assert.throws(()=>validateIdFiles([file(Buffer.concat([JPG,Buffer.alloc(5*1024*1024)]))],JSON.stringify([{typeId:'ab'}]),types),/up to 5 MB/);
 assert.throws(()=>validateIdFiles([file(JPG)],JSON.stringify([{typeId:'custom',customLabel:'x'}]),types),/custom document name/);
 assert.throws(()=>validateIdFiles([file(JPG)],JSON.stringify([{typeId:'custom',customLabel:'<script>'}]),types),/custom document name/);
});
test('ID evidence private storage and staff-only access cannot return public URLs',()=>{
 const lib=source('src/lib/residentIds.js');const admin=source('src/routes/admin.js');
 assert.match(lib,/barangay-resident-ids/);
 assert.doesNotMatch(lib,/getPublicUrl|base64/);
 assert.match(admin,/router\.use\(requireAuth, requireCurrentUser\(\), requireRole\("admin"\)\)/);
 assert.match(admin,/createSignedUrl\(data\.storage_path,60\)/);
 assert.match(admin,/idUpload\.array\("idImages", 5\)/);
 assert.match(admin,/validateIdFiles\(req\.files/);
});
test('Persistent limiter is keyed and atomic in SQL, only server executes',()=>{
 const sql=source('supabase-v4-phase10-5-data-security.sql');const rate=source('src/middleware/persistentLimit.js');
 assert.match(rate,/createHmac\('sha256'/); assert.match(rate,/bgy_p105_rate_check/);
 assert.match(rate,/Retry-After/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.bgy_p105_rate_check.*TO service_role/);
 assert.match(sql,/REVOKE ALL ON public\.bgy_rate_limit_counters FROM PUBLIC, anon, authenticated/);
});
test('Census does not allow destructive replace_all and supports actual members',()=>{
 const admin=source('src/routes/admin.js');const sql=source('supabase-v4-phase10-5-data-security.sql');
 assert.match(admin,/CENSUS_REPLACE_DISABLED/);
 assert.match(sql,/REFERENCES public\.census_households\(id\) ON DELETE RESTRICT/);
 assert.match(sql,/UNIQUE INDEX IF NOT EXISTS bgy_p105_one_household_head/);
 assert.match(sql,/bgy_p105_sync_household_members/);
 assert.match(sql,/REVOKE EXECUTE ON FUNCTION public\.replace_census_households/);
});
test('Documents, ID and suggestions have non-bypassable duplicate and quota limits',()=>{
 const sql=source('supabase-v4-phase10-5-data-security.sql');
 assert.match(sql,/bgy_p105_guard_duplicate_request/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/bgy_p105_suggestion_cap/);
 assert.match(sql,/BEFORE INSERT ON public\.project_suggestions/);
});
test('Concern RPC keeps Phase8 submission atomic while appending structured fields',()=>{
 const sql=source('supabase-v4-phase10-5-data-security.sql');const route=source('src/routes/complaints.js');
 assert.match(sql,/v_result:=public\.bgy_phase8_submit_concern/);
 assert.match(sql,/incident_location=NULLIF/);
 assert.match(route,/bgy_p105_submit_concern/);
 assert.match(route,/p_resident_id: req\.currentUser\.id/);
});
test('Phase11 postponed: generic clearance cannot masquerade as official document',()=>{
 const requests=source('src/routes/requests.js');
 assert.match(requests,/OFFICIAL_DOCUMENT_TEMPLATE_REQUIRED/);
 assert.doesNotMatch(requests,/new PDFDocument/);
});
test('Server fails readiness if data security migration is not installed',()=>{
 assert.match(source('src/index.js'),/bgy_p105_ready/);
});

test('Concern photo evidence uses a separate private bucket and ownership checks',()=>{
 const sql=source('supabase-v4-phase10-5-data-security.sql');
 const resident=source('src/routes/complaints.js'); const admin=source('src/routes/admin.js');
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public.concern_evidence/);
 assert.match(sql,/barangay-concern-evidence/);
 assert.match(resident,/\.eq\('user_id',req\.currentUser\.id\)/);
 assert.match(resident,/saveConcernPhoto/);
 assert.match(admin,/getConcernPhotoUrl/);
 assert.doesNotMatch(source('src/lib/concernEvidence.js'),/getPublicUrl/);
});
