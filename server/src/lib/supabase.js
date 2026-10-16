import { createClient } from "@supabase/supabase-js";
import { env, hasSupabaseConfig } from "./env.js";
import { withAuditHeaders } from "./auditContext.js";

export const supabase = hasSupabaseConfig
  ? createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (url, options) => fetch(url, withAuditHeaders(options)) },
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


