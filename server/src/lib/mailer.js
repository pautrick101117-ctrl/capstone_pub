import { env, hasResendConfig } from "./env.js";

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

  if (!hasResendConfig) {
    // Never log message bodies because account emails may contain temporary credentials.
    console.warn(`[EMAIL NOT CONFIGURED] To: ${to} | Subject: ${subject}`);
    return { delivered: false, reason: "email_not_configured" };
  }

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
      error.status = response.status;
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

const credentialEmail = ({ fullName, username, temporaryPassword, role, reset = false }) => {
  const roleLabel = role.replace(/_/g, " ");
  const intro = reset
    ? `Your Barangay Iba ${roleLabel} account password was reset by an administrator.`
    : `Your Barangay Iba ${roleLabel} portal account has been created.`;
  const text = [
    `Hello ${fullName || roleLabel},`,
    "",
    intro,
    `Username: ${username}`,
    `Temporary password: ${temporaryPassword}`,
    "",
    "For security, sign in using this temporary password and create a new password immediately. Your new password must be at least 8 characters and include at least one uppercase letter and one number. The resident portal will remain locked until the password is changed.",
    "",
    "If you did not expect this message, please contact the Barangay Iba office.",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#1f2937;line-height:1.6">
      <h2 style="color:#1f552a">Barangay Iba Portal</h2>
      <p>Hello ${fullName || roleLabel},</p>
      <p>${intro}</p>
      <div style="background:#f2f8f2;border:1px solid #beddb9;border-radius:12px;padding:16px">
        <strong>Username:</strong> ${username}<br/>
        <strong>Temporary password:</strong> ${temporaryPassword}
      </div>
      <p><strong>Required on first login:</strong> create a new password with at least 8 characters, at least one uppercase letter, and at least one number before using the resident portal.</p>
      <p style="font-size:13px;color:#64748b">If you did not expect this message, please contact the Barangay Iba office.</p>
    </div>`;
  return { text, html };
};

export const sendAccountCreatedEmail = async ({ email, fullName, username, temporaryPassword, role = "resident" }) => {
  const body = credentialEmail({ fullName, username, temporaryPassword, role, reset: false });
  return sendSystemEmail({
    to: email,
    subject: "Your Barangay Iba portal account is ready",
    ...body,
  });
};

export const sendPasswordResetEmail = async ({ email, fullName, username, temporaryPassword, role = "resident" }) => {
  const body = credentialEmail({ fullName, username, temporaryPassword, role, reset: true });
  return sendSystemEmail({
    to: email,
    subject: "Your Barangay Iba temporary password",
    ...body,
  });
};
