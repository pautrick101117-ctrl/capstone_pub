import { createClient } from "@supabase/supabase-js";
import { env, hasSupabaseConfig } from "./env.js";

export const supabase = hasSupabaseConfig
  ? createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
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
