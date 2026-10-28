import test from 'node:test';
import assert from 'node:assert/strict';
import {isResidentSession,residentDestination} from '../../client/src/lib/residentAccess.js';

for(const role of ['admin','super_admin'])test(`public resident links treat ${role} sessions as visitors`,()=>{
  const auth={isAuthenticated:true,user:{role}};
  assert.equal(isResidentSession(auth),false);
  assert.equal(residentDestination(auth),'/login');
  for(const path of ['/portal/requests','/portal/complaints','/portal/borrowing','/portal/voting','/portal/suggestions']) {
    assert.equal(residentDestination(auth,path),`/login?next=${encodeURIComponent(path)}`);
  }
});
test('authenticated residents retain direct portal links',()=>{
  const auth={isAuthenticated:true,user:{role:'resident'}};
  assert.equal(isResidentSession(auth),true);
  assert.equal(residentDestination(auth),'/portal');
  assert.equal(residentDestination(auth,'/portal/voting'),'/portal/voting');
});
test('guests and a resident record without an authenticated session go to resident login',()=>{
  for(const auth of [null,{}, {isAuthenticated:false,user:{role:'resident'}},{isAuthenticated:true,user:null}]) {
    assert.equal(isResidentSession(auth),false);
    assert.equal(residentDestination(auth),'/login');
  }
});
