import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the custom Supabase fetch function without touching a live database.
const source = (await readFile(new URL('../src/lib/supabase.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '');
const prelude = `
const env = {supabaseRequestTimeoutMs: 30, supabaseStorageTimeoutMs: 100};
const hasSupabaseConfig = false;
const withAuditHeaders = options => ({...options, headers: new Headers({...options.headers, 'x-bgy-audit-request-id':'test-ref'})});
const createClient = () => null;
`;
const { fetchSupabase } = await import(`data:text/javascript,${encodeURIComponent(prelude + source)}`);

const mockFetch = fn => {
  const previous = globalThis.fetch;
  globalThis.fetch = fn;
  return () => { globalThis.fetch = previous; };
};

test('upstream Supabase fetch times out and preserves audit headers', async () => {
  let seen;
  const restore = mockFetch((_url, options) => {
    seen = options;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  });
  const keepAlive = setTimeout(() => {}, 500);
  try {
    await assert.rejects(fetchSupabase('https://supabase.example/rest/v1/users'), e => e.name === 'TimeoutError');
    assert.equal(seen.headers.get('x-bgy-audit-request-id'), 'test-ref');
  } finally { clearTimeout(keepAlive); restore(); }
});

test('caller abort signal is honored on Supabase fetch', async () => {
  const controller = new AbortController();
  const restore = mockFetch((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), {once:true});
  }));
  try {
    const pending = fetchSupabase('https://supabase.example/rest/v1/users', {signal:controller.signal});
    controller.abort(new DOMException('cancelled','AbortError'));
    await assert.rejects(pending, e=>e.name==='AbortError');
  } finally {restore();}
});
