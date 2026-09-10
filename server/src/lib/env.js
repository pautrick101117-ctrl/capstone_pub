import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT || 4000),
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  clientUrls: (process.env.CLIENT_URLS || process.env.CLIENT_URL || "http://localhost:5173")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  nodeEnv: process.env.NODE_ENV || "development",
  jwtSecret: process.env.JWT_SECRET || "change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "2h",
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET || "resident-valid-ids",
  resendApiKey: process.env.RESEND_API_KEY || "",
  resendFromEmail: process.env.RESEND_FROM_EMAIL || "Barangay Iba <onboarding@resend.dev>",
  emailSendTimeoutMs: Math.max(3000, Number(process.env.EMAIL_SEND_TIMEOUT_MS || 12000)),
};

export const hasSupabaseConfig = Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
export const hasResendConfig = Boolean(env.resendApiKey && env.resendFromEmail);

export const validateProductionEnv = () => {
  if (env.nodeEnv !== "production") return;
  if (!process.env.JWT_SECRET || env.jwtSecret === "change-me") {
    throw new Error("JWT_SECRET must be set to a strong non-default value in production.");
  }
  if (!hasSupabaseConfig) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production.");
  }
};
