import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// No React/Vite runtime is needed to verify the shared API helper.
const source = (await readFile(new URL('../src/lib/api.js', import.meta.url), 'utf8'))
  .replace('import.meta.env.VITE_API_URL', '"https://example.test/api"');
const { api, ApiError } = await import(`data:text/javascript,${encodeURIComponent(source)}`);

const installFetch = fn => {
  const previous = globalThis.fetch;
  globalThis.fetch = fn;
  return () => { globalThis.fetch = previous; };
};

test('a stalled API call times out and reports a useful error', async () => {
  const restore = installFetch((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {once:true});
  }));
  try {
    await assert.rejects(api('/auth/login',{method:'POST',body:{usernameOrEmail:'test@example.org',password:'secret'},timeoutMs:30}),
      e => e instanceof ApiError && e.code === 'API_TIMEOUT' && /too long/i.test(e.message));
  } finally { restore(); }
});

test('HTTP error provides status, reference, and a readable message', async () => {
  const restore = installFetch(async () => new Response(JSON.stringify({message:'Too many attempts.',code:'RATE_LIMITED',reference:'UI-123'}),
    {status:429,headers:{'Content-Type':'application/json','Retry-After':'60'}}));
  try {
    await assert.rejects(api('/auth/login'), e => e.status === 429 && e.code === 'RATE_LIMITED' &&
      e.reference === 'UI-123' && e.retryAfter === '60' && /Too many attempts/i.test(e.message));
  } finally {restore();}
});

test('opaque server HTML errors are not shown as HTML to the user', async () => {
  const restore = installFetch(async () => new Response('<html>upstream gateway</html>',{status:502,headers:{'Content-Type':'text/html'}}));
  try {
    await assert.rejects(api('/auth/login'), e => e.status===502 && /service is currently unavailable/i.test(e.message));
  } finally {restore();}
});

test('network failures use a helpful message without exposing browser details', async () => {
  const restore = installFetch(async () => {throw new TypeError('Failed to fetch');});
  try {
    await assert.rejects(api('/auth/login'), e => e.code === 'API_NETWORK_ERROR' && /Could not contact/i.test(e.message));
  } finally {restore();}
});

test('successful request retains authorization and JSON serialization', async () => {
  let seen;
  const restore = installFetch(async (url, options) => {
    seen={url,method:options.method,headers:options.headers,body:options.body};
    return new Response(JSON.stringify({ok:true}), {status:200,headers:{'Content-Type':'application/json'}});
  });
  try {
    assert.deepEqual(await api('/auth/me',{method:'POST',token:'test-token',body:{value:1}}), {ok:true});
    assert.equal(seen.url,'https://example.test/api/auth/me');
    assert.equal(seen.headers.Authorization,'Bearer test-token');
    assert.deepEqual(JSON.parse(seen.body),{value:1});
  } finally {restore();}
});

test('caller initiated abort is not mislabeled as server outage', async () => {
  const controller = new AbortController();
  const restore = installFetch((_url,options) => new Promise((_resolve,reject) =>
    options.signal.addEventListener('abort', () => reject(new DOMException('cancelled','AbortError')), {once:true})));
  const p = api('/auth/me',{signal:controller.signal,timeoutMs:300});
  controller.abort();
  try {
    await assert.rejects(p,e=>e.name==='AbortError' && !(e instanceof ApiError));
  } finally {restore();}
});

