import test, {before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import bcrypt from 'bcryptjs';

// Tests use an in-memory API stub; no connected Supabase project is contacted.
process.env.NODE_ENV='test';
process.env.SUPABASE_URL='https://supabase.example.test';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-role';
process.env.JWT_SECRET='isolated-test-secret-at-least-32-characters';
const {supabase}=await import('../src/lib/supabase.js');
const {default:authRoutes}=await import('../src/routes/auth.js');
const {submissionLimiter,submissionScope,rateKey}=await import('../src/middleware/persistentLimit.js');
const originalRpc=supabase.rpc;
const originalFrom=supabase.from;
const counters=new Map();
let user,server,baseUrl,unavailable=false;
const password='Correct123';
const passwordHash=await bcrypt.hash(password,4);

before(async()=>{
  supabase.rpc=async(name,params)=>{
    if(unavailable)return {error:{message:'Unavailable'}};
    if(name==='bgy_p105_rate_clear'){counters.delete(params.p_key);return {data:null,error:null};}
    assert.equal(name,'bgy_p105_rate_check');
    const used=counters.get(params.p_key)||0;
    const allowed=used<params.p_limit;
    const count=used+(allowed&&params.p_increment?1:0);
    if(allowed&&params.p_increment)counters.set(params.p_key,count);
    return {data:[{allowed,retry_after:allowed?0:params.p_window_seconds,used:count}],error:null};
  };
  supabase.from=(table)=>{
    const query={select(){return query;},or(){return query;},eq(){return query;},
      async maybeSingle(){return {data:user,error:null};},async single(){return {data:user,error:null};},
      async insert(){assert.equal(table,'audit_logs');return {data:null,error:null};}};
    return query;
  };
  const app=express();app.set('trust proxy',true);app.use(express.json());app.use('/auth',authRoutes);
  app.use((error,_req,res,_next)=>res.status(error.status||500).json({message:error.message,code:error.code}));
  server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
  baseUrl=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{supabase.rpc=originalRpc;supabase.from=originalFrom;await new Promise(resolve=>server.close(resolve));});
beforeEach(()=>{
  counters.clear();unavailable=false;
  user={id:'11111111-1111-4111-8111-111111111111',username:'ana',email:'ana@example.test',role:'resident',password_hash:passwordHash,
    is_active:true,status:'approved',full_name:'Ana Cruz'};
});
const login=(identifier,secret,portal,ip)=>fetch(`${baseUrl}/auth/login`,{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':ip},
  body:JSON.stringify({usernameOrEmail:identifier,password:secret,portal,adminOnly:portal==='admin'})});

for(const role of ['resident','admin','super_admin'])test(`${role} login allows ten failed attempts, then locks the account across identifiers and portals`,async()=>{
  user.role=role;
  for(let attempt=0;attempt<10;attempt++){
    const response=await login(attempt%2?'ana@example.test':'ana','Wrong123',attempt%2?'admin':'resident',`192.0.2.${attempt+1}`);
    assert.equal(response.status,401);
  }
  const blocked=await login('09170000000','Wrong123','admin','192.0.2.100');
  assert.equal(blocked.status,429);assert.equal((await blocked.json()).code,'LOGIN_TEMPORARILY_LOCKED');
  assert.ok(Number(blocked.headers.get('retry-after'))>0);
});

test('successful login clears account failure history',async()=>{
  for(let attempt=0;attempt<3;attempt++)assert.equal((await login('ana','Wrong123','resident',`192.0.2.${attempt+1}`)).status,401);
  const success=await login('ana@example.test',password,'resident','192.0.2.50');
  assert.equal(success.status,200);
  assert.equal(counters.has(rateKey('login-failures',user.id)),false);
});

test('rotating unknown usernames cannot bypass the ten-attempt IP limit',async()=>{
  user=null;
  for(let attempt=0;attempt<10;attempt++)assert.equal((await login(`unknown${attempt}`,'Wrong123','resident','198.51.100.1')).status,401);
  const blocked=await login('another','Wrong123','admin','198.51.100.1');
  assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('retry-after'))>0);
});

test('all submission operations cap attempts at ten without counting reads or nested checks',async()=>{
  const headers={};
  const invoke=req=>new Promise(resolve=>submissionLimiter(req,{setHeader:(key,value)=>{headers[key]=value;}},error=>resolve(error)));
  for(let attempt=0;attempt<10;attempt++){
    const req={method:'POST',baseUrl:'/api/admin',path:`/projects/00000000-0000-4000-8000-${String(attempt).padStart(12,'0')}/updates`,currentUser:{id:'admin'},ip:'ip'};
    assert.equal(await invoke(req),undefined);
    assert.equal(await invoke(req),undefined);
  }
  const blocked=await invoke({method:'POST',baseUrl:'/api/admin',path:'/projects/00000000-0000-4000-8000-999999999999/updates',currentUser:{id:'admin'},ip:'ip'});
  assert.equal(blocked.status,429);assert.equal(headers['Retry-After'],'600');
  assert.equal(await invoke({method:'GET',baseUrl:'/api/admin',path:'/projects',currentUser:{id:'admin'}}),undefined);
});

test('submission protection fails closed if persistent counters are unavailable',async()=>{
  unavailable=true;
  const response=await login('ana','Wrong123','resident','203.0.113.1');
  assert.equal(response.status,503);assert.equal((await response.json()).code,'RATE_LIMIT_SERVICE_UNAVAILABLE');
});

const invokeSubmission = req => new Promise(resolve => submissionLimiter(req, {setHeader() {}}, resolve));
const staffRequest = (path, role = 'admin') => ({
  method: 'POST', baseUrl: '/api/admin', path, ip: '192.0.2.1',
  auth: {sub: 'staff'}, currentUser: {id: 'staff', role},
});

for (const role of ['admin', 'super_admin']) test(`${role} registration bypasses only the four exact POST routes`, async () => {
  for (const path of ['/users', '/census_households', '/census_households/batch',
    '/census_households/11111111-1111-4111-8111-111111111111/members', '/census_households/123/members',
    '/users/', '/CENSUS_HOUSEHOLDS/BATCH/']) {
    for (let i = 0; i < 100; i++) assert.equal(await invokeSubmission(staffRequest(path, role)), undefined);
  }
  assert.equal(counters.size, 0, 'exempt registrations must not read or increment counters');
});

test('registration exemptions do not cover neighboring paths, other methods, mounts, or unverified identities', async () => {
  const requests = [
    ...['/users/123', '/users/batch', '/users/reset-password', '/users-extra', '/users//',
      '/census_households/123', '/census_households/123/restore', '/census_households/batch/extra',
      '/census_households/123/members/456', '/census_households/123/members/456/head',
      '/census_households/123/members/extra', '/census_households//members', '/resident-id-types']
      .map(path => staffRequest(path)),
    ...['PUT', 'PATCH', 'DELETE'].map(method => ({...staffRequest('/users'), method})),
    {...staffRequest('/users'), baseUrl: '/api/super-admin'},
    {...staffRequest('/users'), baseUrl: '/api/auth'},
    {...staffRequest('/users'), baseUrl: '/api/admin/other'},
    {...staffRequest('/users'), auth: undefined},
    {...staffRequest('/users'), auth: {sub: 'different-user'}},
    {...staffRequest('/users'), currentUser: undefined},
    {...staffRequest('/users'), currentUser: {role: 'admin'}},
    staffRequest('/users', 'resident'),
    staffRequest('/users', 'staff'),
  ];
  for (const req of requests) {
    counters.clear();
    counters.set(rateKey(`submission:${submissionScope(req)}`, req.currentUser?.id || req.ip), 60);
    const error = await invokeSubmission(req);
    assert.equal(error?.status, 429, JSON.stringify(req));
    assert.equal(error.code, 'RATE_LIMITED');
  }
});

test('an exempt registration does not mark unrelated nested limiter checks as completed', async () => {
  const req = staffRequest('/users');
  assert.equal(await invokeSubmission(req), undefined);
  assert.equal(req.submissionLimitChecked, undefined);
  req.baseUrl = '/api/admin/other';
  unavailable = true;
  assert.equal((await invokeSubmission(req)).code, 'RATE_LIMIT_SERVICE_UNAVAILABLE');
});

for (const endpoint of ['request-code', 'reset']) test(`password ${endpoint} retains its five-attempt account limit`, async () => {
  // Rejected submissions count too, with no email or database mutation needed.
  for (let i = 0; i < 5; i++) {
    const response = await fetch(`${baseUrl}/auth/forgot-password/${endpoint}`, {
      method: 'POST', headers: {'content-type': 'application/json', 'x-forwarded-for': '203.0.113.22'}, body: '{}',
    });
    assert.equal(response.status, 400);
    await response.json();
  }
  const response = await fetch(`${baseUrl}/auth/forgot-password/${endpoint}`, {
    method: 'POST', headers: {'content-type': 'application/json', 'x-forwarded-for': '203.0.113.22'}, body: '{}',
  });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).code, 'RATE_LIMITED');
  assert.equal(response.headers.get('retry-after'), '600');
});

