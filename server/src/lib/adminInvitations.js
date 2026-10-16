import { createHash, randomBytes } from "node:crypto";
import { env } from "./env.js";
import { sendSystemEmail } from "./mailer.js";

export const ADMIN_INVITATION_HOURS = 48;
export const newInvitationToken = () => randomBytes(32).toString("hex");
export const hashInvitationToken = (token) => createHash("sha256").update(token).digest("hex");
export const invitationExpiry = () => new Date(Date.now() + ADMIN_INVITATION_HOURS * 60 * 60 * 1000).toISOString();

// No URL tokens in logs, API responses, or audit events. Use the configured public frontend origin.
export const buildInvitationUrl = (token) => `${env.clientUrl.replace(/\/$/, "")}/admin/setup?token=${encodeURIComponent(token)}`;

const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;")
  .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const sendAdminInvitationEmail = async ({ email, fullName, username, token }) => {
  const url = buildInvitationUrl(token);
  return sendSystemEmail({
    to: email,
    subject: "Set up your Barangay Iba administrator account",
    text: `Hello ${fullName},\n\nYou have been invited to join the Barangay Iba administrative portal.\n\nUsername: ${username}\nSet your password: ${url}\n\nThis invitation expires in ${ADMIN_INVITATION_HOURS} hours and can be used only once. If you did not expect this invitation, ignore this email.`,
    html: `<div style="font:16px/1.65 Arial,sans-serif;max-width:580px;margin:auto;color:#142016"><h2>Barangay Iba Admin Invitation</h2><p>Hello ${escapeHtml(fullName)},</p><p>You have been invited to access the Barangay Iba administrative portal.</p><p><b>Username:</b> ${escapeHtml(username)}</p><p><a href="${escapeHtml(url)}" style="display:inline-block;background:#2d7a3a;color:white;padding:12px 20px;border-radius:8px;text-decoration:none">Set up my account</a></p><p>This one-time link expires in ${ADMIN_INVITATION_HOURS} hours. If you did not expect it, you may ignore this email.</p></div>`,
  });
};
