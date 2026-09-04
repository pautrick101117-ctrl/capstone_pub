import { normalizePhoneNumber } from "../utils/helpers.js";

export const sendSms = async ({ to, message }) => {
  const phone = normalizePhoneNumber(to);
  if (!phone) return;

  console.log(`[SMS LOG] To: ${phone} | Message: ${message}`);
};

export const broadcastSms = async (recipients, messageBuilder) => {
  for (const recipient of recipients || []) {
    const message = typeof messageBuilder === "function" ? messageBuilder(recipient) : messageBuilder;
    await sendSms({
      to: recipient.contact_number || recipient.phone || recipient.contactNumber,
      message,
    });
  }
};
