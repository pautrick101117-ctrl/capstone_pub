import nodemailer from "nodemailer";
import { env, hasGmailAppConfig } from "./env.js";

let transporter = null;

if (hasGmailAppConfig) {
  transporter = nodemailer.createTransport({
    service: "gmail",
    connectionTimeout: env.emailSendTimeoutMs,
    greetingTimeout: env.emailSendTimeoutMs,
    socketTimeout: env.emailSendTimeoutMs,
    auth: {
      user: env.gmailAppEmail,
      pass: env.gmailAppPassword,
    },
  });
}

const getFromAddress = () => `"${env.gmailFromName}" <${env.gmailAppEmail}>`;

export const sendSystemEmail = async ({ to, subject, text, html }) => {
  if (!to) return { delivered: false, reason: "missing_email" };

  if (!transporter) {
    // Never log message bodies because account emails may contain temporary credentials.
    console.warn(`[EMAIL NOT CONFIGURED] To: ${to} | Subject: ${subject}`);
    return { delivered: false, reason: "email_not_configured" };
  }

  let timeoutId;
  try {
    await Promise.race([
      transporter.sendMail({ from: getFromAddress(), to, subject, text, html }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const error = new Error(`Email delivery timed out after ${env.emailSendTimeoutMs}ms.`);
          error.code = "EMAIL_SEND_TIMEOUT";
          reject(error);
        }, env.emailSendTimeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  console.log(`[EMAIL SENT] To: ${to} | Subject: ${subject}`);
  return { delivered: true, provider: "gmail_app_password" };
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
