import { documentError, textValue } from "./documentRules.js";
import { sendSystemEmail } from "./mailer.js";

// Automatic request-status emails are queued transactionally; these notices
// contain only public-safe status summaries, never staff verification notes.
export const AUTOMATIC_STATUS_MESSAGES = Object.freeze({
  received: "Your document request has been received.",
  reviewing: "Barangay staff are reviewing your document request.",
  revision: "Your document request needs additional information. Sign in to view the instructions.",
  rejected: "Your document request was declined. Sign in to read the explanation.",
  approved: "Your document request has been approved. Please wait for the pickup notice.",
  ready: "Your document is ready for pickup at the barangay office.",
  collected: "Your document has been recorded as collected. Thank you.",
});

export const NOTIFICATION_TYPES = [
  "received",
  "revision",
  "rejected",
  "approved",
  "ready",
  "reminder",
  "custom",
];
export const buildDocumentNotification = ({
  request,
  resident,
  template,
  type,
  customMessage = "",
}) => {
  if (!NOTIFICATION_TYPES.includes(type))
    throw documentError("Choose a valid notification type.");
  const required = {
    received: ["submitted", "under_review", "acknowledged", "processing"],
    revision: ["needs_revision"],
    rejected: ["rejected"],
    approved: ["approved", "document_prepared"],
    ready: ["ready_for_pickup"],
    reminder: ["ready_for_pickup"],
  };
  if (required[type] && !required[type].includes(request.status))
    throw documentError(
      "This notification does not match the current request status.",
    );
  const config = template?.config || {};
  const intro = {
    received: "Your request has been received.",
    revision:
      "Your request requires additional information. Please sign in to review the instructions.",
    rejected:
      "Your request has been rejected. Please sign in to read the explanation.",
    approved:
      "Your request details have been approved. Please wait for the pickup notification.",
    ready: "Your document is ready for pickup.",
    reminder: "This is a reminder that your document is ready for pickup.",
    custom: textValue(customMessage, 1500),
  }[type];
  if (!intro) throw documentError("Enter an administrative message.");
  const subject = `Barangay Iba: ${type === "ready" || type === "reminder" ? "Document pickup" : "Document request update"}`;
  const text = [
    `Hello ${resident.full_name || resident.first_name || "resident"},`,
    intro,
    `Document: ${request.request_type}`,
    `Request reference: ${request.id}`,
    `Current status: ${request.status.replace(/_/g, " ")}`,
    ...(["ready","reminder"].includes(type) && request.pickup_scheduled_for ? [
      `Scheduled pickup: ${new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'long',timeStyle:'short'}).format(new Date(request.pickup_scheduled_for))} (Philippine time)`,
      request.pickup_instructions || ''
    ] : []),
    ...(["ready", "reminder"].includes(type)
      ? [config.pickupInstructions, config.officeContact]
      : []),
    "View your request in the Barangay Iba portal.",
  ]
    .filter(Boolean)
    .join("\n\n");
  if (
    ["ready", "reminder"].includes(type) &&
    (!config.pickupInstructions || !config.officeContact)
  )
    throw documentError(
      "Configure official pickup instructions and office contact in an approved template first.",
    );
  return { to: resident.email || "", subject, text };
};

export const sendDocumentNotification = async (
  db,
  {
    request,
    resident,
    template,
    type,
    customMessage,
    actorId,
    idempotencyKey,
    previewHash,
  },
  send = sendSystemEmail,
) => {
  const { createHash } = await import("node:crypto");
  const message = buildDocumentNotification({
    request,
    resident,
    template,
    type,
    customMessage,
  });
  const hash = createHash("sha256")
    .update(JSON.stringify(message))
    .digest("hex");
  if (hash !== previewHash)
    throw documentError(
      "Notification changed. Review a fresh preview before sending.",
      409,
    );
  const { data: previous, error: lookupError } = await db
    .from("notification_logs")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (previous) {
    if (
      previous.request_id !== request.id ||
      ["to", "subject", "text"].some(
        (key) => previous.message_snapshot[key] !== message[key],
      )
    )
      throw documentError("Notification key has already been used.", 409);
    return previous; // Repeated clicks never send again. Explicit retries use the failed attempt endpoint.
  }
  const { data: log, error } = await db
    .from("notification_logs")
    .insert({
      request_id: request.id,
      resident_id: request.user_id,
      notification_type: type,
      recipient: message.to,
      initiated_by: actorId,
      idempotency_key: idempotencyKey,
      attempt_status: "sending",
      message_snapshot: message,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505")
      throw documentError(
        "Notification is already being sent. Refresh its history.",
        409,
      );
    throw error;
  }
  return performSend(db, log, send);
};
export const performSend = async (db, log, send = sendSystemEmail) => {
  let update;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(log.recipient || ""))
    update = {
      attempt_status: "skipped",
      error_code: log.recipient ? "INVALID_EMAIL" : "MISSING_EMAIL",
    };
  else {
    try {
      const result = await send({
        ...log.message_snapshot,
        idempotencyKey: log.idempotency_key,
      });
      update = {
        attempt_status:
          result.accepted || result.delivered ? "accepted" : "failed",
        provider_message_id: result.id || null,
        error_code:
          result.accepted || result.delivered
            ? null
            : result.reason || "PROVIDER_REJECTED",
      };
    } catch (error) {
      update = {
        attempt_status: "failed",
        error_code: error.code || "EMAIL_SEND_FAILED",
      };
    }
  }
  const { data, error } = await db
    .from("notification_logs")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", log.id)
    .select("*")
    .single();
  if (error)
    throw documentError(
      "Email attempt could not be confirmed. Check its history before retrying.",
      503,
    );
  return data;
};

