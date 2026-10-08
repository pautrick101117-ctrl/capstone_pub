import { normalizePhoneNumber } from "../utils/helpers.js";

// SMS is NOT integrated. Return a truthful result until a real SMS provider is
// configured. Do not log recipient phone numbers or private message bodies.
let warned = false;

export const sendSms = async ({ to }) => {
  if (!normalizePhoneNumber(to)) return { delivered: false, reason: "missing_phone" };
  if (!warned) {
    console.warn("[SMS DISABLED] No SMS provider configured. SMS reminders are not being sent.");
    warned = true;
  }
  return { delivered: false, reason: "provider_not_configured" };
};

export const broadcastSms = async (recipients, messageBuilder) => {
  let delivered = 0;
  for (const recipient of recipients || []) {
    const message = typeof messageBuilder === "function" ? messageBuilder(recipient) : messageBuilder;
    const result = await sendSms({
      to: recipient.contact_number || recipient.phone || recipient.contactNumber,
      message,
    });
    if (result.delivered) delivered += 1;
  }
  return { delivered, attempted: (recipients || []).length };
};
