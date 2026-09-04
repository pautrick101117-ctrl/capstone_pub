import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT || 4000),
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  jwtSecret: process.env.JWT_SECRET || "change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "2h",
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET || "resident-valid-ids",
  gmailAppEmail: process.env.GMAIL_APP_EMAIL || "",
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD || "",
  gmailFromName: process.env.GMAIL_FROM_NAME || "Barangay Iba",
};

export const hasSupabaseConfig = Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
export const hasGmailAppConfig = Boolean(env.gmailAppEmail && env.gmailAppPassword);
