import { sendSystemEmail } from "../src/lib/mailer.js";

const recipient = process.argv[2] || process.env.TEST_EMAIL_TO || "";

if (!recipient) {
  console.error("Usage: npm run email:test -- your-email@example.com");
  console.error("Or set TEST_EMAIL_TO in the environment.");
  process.exit(1);
}

try {
  const result = await sendSystemEmail({
    to: recipient,
    subject: "Barangay Iba Resend test",
    text: "This is a test email from the Barangay Iba Portal using the Resend HTTPS API.",
    html: "<p>This is a test email from the <strong>Barangay Iba Portal</strong> using the Resend HTTPS API.</p>",
  });

  if (!result?.delivered) {
    console.error(`Email was not sent: ${result?.reason || "unknown error"}`);
    process.exit(1);
  }

  console.log(`Resend accepted the test email. Email ID: ${result.id || "not returned"}`);
} catch (error) {
  console.error(`Resend test failed: ${error.message}`);
  if (error.code) console.error(`Code: ${error.code}`);
  process.exit(1);
}

