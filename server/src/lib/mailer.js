import nodemailer from "nodemailer";
import { env, hasGmailAppConfig } from "./env.js";

let transporter = null;

if (hasGmailAppConfig) {
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: env.gmailAppEmail,
      pass: env.gmailAppPassword,
    },
  });
}

const getFromAddress = () => `"${env.gmailFromName}" <${env.gmailAppEmail}>`;

export const sendSystemEmail = async ({ to, subject, text, html }) => {
  if (!to) {
    return { delivered: false, reason: "missing_email" };
  }

  if (!transporter) {
    console.log(`[EMAIL LOG] To: ${to} | Subject: ${subject} | Message: ${text || html || ""}`);
    return { delivered: false, preview: text || html || "" };
  }

  await transporter.sendMail({
    from: getFromAddress(),
    to,
    subject,
    text,
    html,
  });

  console.log(`[EMAIL SENT] To: ${to} | Subject: ${subject}`);

  return { delivered: true, provider: "gmail_app_password" };
};

export const sendVerificationEmail = async ({ email, code, fullName }) => {
  return sendSystemEmail({
    to: email,
    subject: "Your Barangay Iba verification code",
    text: `Hello ${fullName || "resident"}, your verification code is ${code}. It expires in 10 minutes.`,
  });
};

export const sendAccountCreatedEmail = async ({ email, fullName, username, temporaryPassword, role = "resident" }) => {
  return sendSystemEmail({
    to: email,
    subject: "Your Barangay Iba portal account",
    text: `Hello ${fullName || role.replace(/_/g, " ")}, your Barangay Iba ${role.replace(/_/g, " ")} account is ready. Username: ${username}. Temporary password: ${temporaryPassword}. Please change your password after your first login.`,
  });
};
