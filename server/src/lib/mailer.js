import { env, validateResendConfig } from "./env.js";
import { buildResidentCredentialEmail } from "./residentCredentialEmail.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

const parseResendError = async (response) => {
  try {
    const payload = await response.json();
    return payload?.message || payload?.name || `Resend returned HTTP ${response.status}.`;
  } catch {
    return `Resend returned HTTP ${response.status}.`;
  }
};

export const sendSystemEmail = async ({ to, subject, text, html }) => {
  if (!to) return { delivered: false, reason: "missing_email" };

  // Never log message bodies because account emails may contain temporary credentials.
  validateResendConfig();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.emailSendTimeoutMs);

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.resendFromEmail,
        to: [to],
        subject,
        text: text || undefined,
        html: html || undefined,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = new Error(await parseResendError(response));
      error.code = "RESEND_API_ERROR";
      error.providerStatus = response.status;
      error.status = 502;
      throw error;
    }

    const data = await response.json();
    console.log(`[EMAIL ACCEPTED] Provider: Resend | To: ${to} | Subject: ${subject} | ID: ${data?.id || "unknown"}`);
    return { delivered: true, provider: "resend", id: data?.id || null };
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(`Email delivery timed out after ${env.emailSendTimeoutMs}ms.`);
      timeoutError.code = "EMAIL_SEND_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const sendVerificationEmail = async ({ email, code, fullName }) =>
  sendSystemEmail({
    to: email,
    subject: "Your Barangay Iba verification code",
    text: `Hello ${fullName || "resident"}, your verification code is ${code}. It expires in 10 minutes.`,
  });

export const sendAccountCreatedEmail = async ({ email, fullName, username, temporaryPassword, role = "resident" }) => {
  const body = buildResidentCredentialEmail({ fullName, username, temporaryPassword, reset: false, clientUrl: env.clientUrl });
  return sendSystemEmail({
    to: email,
    subject: "Welcome to Barangay Iba Portal",
    ...body,
  });
};

export const sendPasswordResetEmail = async ({ email, fullName, username, temporaryPassword, role = "resident" }) => {
  const body = buildResidentCredentialEmail({ fullName, username, temporaryPassword, reset: true, clientUrl: env.clientUrl });
  return sendSystemEmail({
    to: email,
    subject: "Your Barangay Iba password reset instructions",
    ...body,
  });
};

