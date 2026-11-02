import { createHmac } from 'node:crypto';
import { requireSupabase } from '../lib/supabase.js';
import { env } from '../lib/env.js';

// Never retain identifiers/IPs in rate_limit_counters: use keyed hashes.
export const rateKey = (scope, value) => createHmac('sha256', env.jwtSecret || process.env.JWT_SECRET || 'development-only')
  .update(`${scope}:${String(value || '').trim().toLowerCase()}`).digest('hex');

export const checkRate = async (scope, identity, { max, windowSeconds, increment = true }) => {
  const db = requireSupabase();
  const startedAt = performance.now();
  try {
    const { data, error } = await db.rpc('bgy_p105_rate_check', {
      p_key: rateKey(scope, identity), p_limit: max, p_window_seconds: windowSeconds, p_increment: increment,
    });
    if (error) throw Object.assign(new Error('Request protection is temporarily unavailable. Try again later.'), {
      code: 'RATE_LIMIT_SERVICE_UNAVAILABLE', status: 503, cause: error,
    });
    return Array.isArray(data) ? data[0] : data;
  } finally {
    // Log stage duration only, never the login identifier or rate-limit key.
    if (scope === 'login-ip' || scope === 'login-failures' || scope.startsWith('submission:post:/api/auth/login')) {
      console.info('[AUTH RATE LIMIT]', scope, `${Math.round(performance.now() - startedAt)}ms`);
    }
  }
};

export const persistentLimit = (scope, { max = 10, windowSeconds = 600, identity = (req) => req.currentUser?.id || req.ip } = {}) =>
  async (req, res, next) => {
    try {
      const key = identity(req);
      if (!key) return next(Object.assign(new Error('Sign in to continue.'), { status: 401 }));
      const result = await checkRate(scope, key, { max, windowSeconds });
      if (!result?.allowed) {
        res.setHeader('Retry-After', String(Math.max(1, result?.retry_after || windowSeconds)));
        return next(Object.assign(new Error('Too many attempts. Please wait before trying again.'), {
          status: 429, code: 'RATE_LIMITED',
        }));
      }
      next();
    } catch (error) { next(error); }
  };

export const clearRate = async (scope, identity) => {
  const { error } = await requireSupabase().rpc('bgy_p105_rate_clear', { p_key: rateKey(scope, identity) });
  if (error) throw error;
};

// Count attempts per operation, including rejected submissions. IDs must not
// create fresh buckets, and nested routers must not count the same request twice.
export const submissionScope = (req) => `${req.method}:${req.baseUrl || ''}${req.path || '/'}`
  .toLowerCase().replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/g, '/:id')
  .replace(/\/[0-9]+(?=\/|$)/g, '/:id').replace(/\/+$/, '');

export const submissionLimiter = (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || req.submissionLimitChecked
      || req.path === '/audit/page-view') return next();
  const staff = ['admin', 'super_admin'].includes(req.currentUser?.role);
  // A staff member processing many confirmations is not a resident spamming requests.
  // High-risk auth and ID operations retain their own stricter endpoint limiters.
  return persistentLimit(`submission:${submissionScope(req)}`, { max: staff ? 60 : 10, windowSeconds: 600 })(req, res, (error) => {
    if (!error) req.submissionLimitChecked = true;
    next(error);
  });
};

export const residentWriteLimiter = submissionLimiter;

