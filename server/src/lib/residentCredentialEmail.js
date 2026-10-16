// An easy-to-read, responsive credential email with a plain-text equivalent.
// Resend "accepted" means queued by provider, not guaranteed inbox receipt.
export const buildResidentCredentialEmail = ({ fullName, username, temporaryPassword, reset = false, clientUrl = "https://barangayiba.com" }) => {
  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const portalUrl = `${clientUrl.replace(/\/$/, "")}/login`;
  const subjectLine = reset ? "Your Barangay Iba password reset instructions" : "Welcome to Barangay Iba Portal";
  const introduction = reset
    ? "A Barangay administrator requested a password reset for your account. Your existing password will continue working until you sign in with the temporary password below."
    : "Your resident account has been created. Use the details below to sign in for the first time.";
  const steps = reset
    ? ["Open the Resident Login page.", "Enter your username and this temporary password within 48 hours.", "Create your own new password when asked."]
    : ["Open the Resident Login page.", "Enter your username and temporary password.", "Create your own new password when asked."];
  const text = [
    `Hello ${fullName || "Resident"},`, "", subjectLine, "", introduction, "",
    `Username: ${username}`, `Temporary password: ${temporaryPassword}`, "",
    ...steps.map((step, index) => `${index + 1}. ${step}`), "",
    `Resident Login: ${portalUrl}`, "",
    "IMPORTANT: The password is case-sensitive. Type it without spaces. Never share your password.",
    ...(reset ? ["If you did not request this reset, continue using your existing password and contact the barangay office."] : []),
    "If you need help, contact the Barangay Iba office.",
  ].join("\n");
  const html = `
    <div style="background:#f4f7f3;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#25332a;line-height:1.6">
      <div style="max-width:580px;margin:auto;background:white;border:1px solid #d6e7d3;border-radius:18px;padding:28px">
        <p style="margin:0;color:#266a33;font-weight:700;letter-spacing:.08em">BARANGAY IBA</p>
        <h1 style="font-size:24px;line-height:1.25;margin:12px 0;color:#1f552a">${escapeHtml(subjectLine)}</h1>
        <p>Hello ${escapeHtml(fullName || "Resident")},</p>
        <p>${escapeHtml(introduction)}</p>
        <div style="border-radius:12px;background:#f2f8f2;border:1px solid #beddb9;padding:18px">
          <div style="font-size:12px;font-weight:bold;color:#475569">USERNAME</div>
          <div style="font-size:18px;font-weight:bold;word-break:break-word;margin-bottom:12px">${escapeHtml(username)}</div>
          <div style="font-size:12px;font-weight:bold;color:#475569">TEMPORARY PASSWORD</div>
          <div style="font-size:19px;font-weight:bold;letter-spacing:.02em;word-break:break-word">${escapeHtml(temporaryPassword)}</div>
        </div>
        <h2 style="font-size:17px;color:#1f552a;margin:24px 0 8px">How to log in</h2>
        <ol style="padding-left:22px;margin-top:6px">${steps.map((step) => `<li style="margin-bottom:6px">${escapeHtml(step)}</li>`).join("")}</ol>
        <a href="${escapeHtml(portalUrl)}" style="display:inline-block;background:#266a33;color:#fff;text-decoration:none;padding:13px 22px;border-radius:9px;font-weight:bold;margin:8px 0 18px">Open Resident Portal</a>
        <p style="padding:12px;border-radius:10px;background:#f7f7f4;font-size:13px">
          <strong>Important:</strong> Passwords are case-sensitive. Enter the letters and numbers exactly as written, without spaces.
          You must choose a personal password when signing in with this temporary password.
        </p>
        ${reset ? '<p style="font-size:13px">If you did not request this reset, your current password remains usable. Contact the Barangay office if you are concerned.</p>' : ''}
        <p style="font-size:12px;color:#64748b;margin-top:20px">Need help? Contact the Barangay Iba office. Do not forward this email or share your password.</p>
      </div>
    </div>`;
  return { text, html };
};
