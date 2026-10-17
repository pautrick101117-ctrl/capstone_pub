import { createHmac } from 'node:crypto';
import { requireSupabase } from '../lib/supabase.js';
import { env } from '../lib/env.js';

// Never retain identifiers/IPs in rate_limit_counters: use keyed hashes.
export const rateKey = (scope, value) => createHmac('sha256', env.jwtSecret || process.env.JWT_SECRET || 'development-only')
  .update(`${scope}:${String(value || '').trim().toLowerCase()}`).digest('hex');

export const checkRate = async (scope, identity, { max, windowSeconds, increment = true }) => {
  const db = requireSupabase();
  const { data, error } = await db.rpc('bgy_p105_rate_check', {
    p_key: rateKey(scope, identity), p_limit: max, p_window_seconds: windowSeconds, p_increment: increment,
  });
  if (error) throw Object.assign(new Error('Request protection is temporarily unavailable. Try again later.'), {
    code: 'RATE_LIMIT_SERVICE_UNAVAILABLE', status: 503, cause: error,
  });
  return Array.isArray(data) ? data[0] : data;
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

export const residentWriteLimiter = persistentLimit('resident-writes', { max: 120, windowSeconds: 60 });
