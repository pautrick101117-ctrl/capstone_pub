import { createClient } from "@supabase/supabase-js";
import { env, hasSupabaseConfig } from "./env.js";
import { withAuditHeaders } from "./auditContext.js";

// Supabase calls must not wait without a deadline. Preserve all audit headers
// and any cancellation already provided by the SDK or caller.
export const fetchSupabase = async (url, options = {}) => {
  // Storage uploads can legitimately take longer than small database queries.
  const path = new URL(typeof url === "string" ? url : url.url).pathname;
  const deadlineMs = path.includes("/storage/v1/") ? env.supabaseStorageTimeoutMs : env.supabaseRequestTimeoutMs;
  const timeout = AbortSignal.timeout(deadlineMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  return fetch(url, { ...withAuditHeaders(options), signal });
};

export const supabase = hasSupabaseConfig
  ? createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchSupabase },
    })
  : null;

export const requireSupabase = () => {
  if (!supabase) {
    const error = new Error("Supabase is not configured. Add server environment variables first.");
    error.status = 500;
    throw error;
  }
  return supabase;
};

