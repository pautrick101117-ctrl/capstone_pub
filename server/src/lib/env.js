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
  resendApiKey: (process.env.RESEND_API_KEY || "").trim(),
  resendFromEmail: (process.env.RESEND_FROM_EMAIL || "").trim(),
  emailSendTimeoutMs: Math.max(3000, Number(process.env.EMAIL_SEND_TIMEOUT_MS || 12000)),
};

export const hasSupabaseConfig = Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
export const hasResendConfig = Boolean(
  env.resendApiKey.trim() && env.resendFromEmail.trim()
);

// Use a verified-domain sender. Test-only onboarding addresses must never be
// the configured sender of the production barangay portal.
export const validateResendConfig = () => {
  if (!hasResendConfig) {
    const error = new Error("Resend is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL on the backend host.");
    error.code = "EMAIL_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }
  const senderMatch = env.resendFromEmail.match(/(?:<|^)([^<>\s]+@[^<>\s]+)(?:>|$)/);
  if (!senderMatch || senderMatch[1].toLowerCase().endsWith("@resend.dev")) {
    const error = new Error("RESEND_FROM_EMAIL must be a valid address on a domain verified in Resend.");
    error.code = "EMAIL_SENDER_NOT_VERIFIED";
    error.status = 503;
    throw error;
  }
};

export const validateProductionEnv = () => {
  if (env.nodeEnv !== "production") return;
  if (!process.env.JWT_SECRET || env.jwtSecret === "change-me") {
    throw new Error("JWT_SECRET must be set to a strong non-default value in production.");
  }
  if (!hasSupabaseConfig) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production.");
  }
  validateResendConfig();
};
