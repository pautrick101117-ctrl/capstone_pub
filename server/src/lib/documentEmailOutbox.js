import { AUTOMATIC_STATUS_MESSAGES } from "./documentNotifications.js";
import { sendSystemEmail } from "./mailer.js";

// Public-safe progress messages; private review notes, photos, and document
// contents are NEVER copied into outgoing emails.
export const buildAutomaticDocumentEmail = (event, resident) => {
  const intro = AUTOMATIC_STATUS_MESSAGES[event.notification_type];
  if (!intro) throw new Error("Unknown automatic document notification type.");
  const recipient = String(resident?.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return null;
  const snapshot = event.request_snapshot || {};
  const requestType = String(snapshot.requestType || "Document request").slice(0, 120);
  const name = String(resident.full_name || resident.first_name || "resident").slice(0, 150);
  const lines = [
    `Hello ${name},`, intro,
    `Document: ${requestType}`,
    `Request reference: ${event.request_id}`,
  ];
  if (event.notification_type === "ready" && snapshot.pickupAt) {
    const when = new Date(snapshot.pickupAt);
    if (Number.isFinite(when.getTime())) {
      lines.push(`Pickup: ${new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila", dateStyle: "long", timeStyle: "short",
      }).format(when)} (Philippine time)`);
    }
    if (snapshot.pickupInstructions) lines.push(String(snapshot.pickupInstructions).slice(0, 500));
  }
  lines.push("Sign in to the Barangay Iba portal to view your request.");
  return { to: recipient, subject: `Barangay Iba: ${requestType} update`, text: lines.join("\n\n") };
};

// The queue is created by PostgreSQL AFTER INSERT OR UPDATE OF status;
// a failed Resend call cannot cause the document transaction to roll back.
// Use stable event IDs for the provider's idempotency key on every retry.
export const processDocumentEmailOutbox = async (
  db, { limit = 10, onlyId = null, force = false, send = sendSystemEmail } = {},
) => {
  const { data: events, error } = await db.rpc("bgy_doc_email_claim", {
    p_limit: limit, p_only_id: onlyId, p_force: force,
  });
  if (error) throw error;
  const results = [];
  for (const event of events || []) {
    let state = "failed";
    let reason = "EMAIL_SEND_FAILED";
    let providerId = null;
    try {
      const [residentResult, requestResult] = await Promise.all([
        db.from("users").select("id,first_name,full_name,email").eq("id", event.resident_id).maybeSingle(),
        db.from("requests").select("id,status").eq("id", event.request_id).maybeSingle(),
      ]);
      if (residentResult.error || requestResult.error) {
        throw residentResult.error || requestResult.error;
      }
      if (!requestResult.data || requestResult.data.status !== event.status_snapshot) {
        state = "skipped";
        reason = "SUPERSEDED_STATUS";
      } else {
        const message = buildAutomaticDocumentEmail(event, residentResult.data);
        if (!message) {
          state = "skipped";
          reason = "MISSING_OR_INVALID_EMAIL";
        } else {
          const result = await send({ ...message, idempotencyKey: event.id });
          if (result?.accepted || result?.delivered) {
            state = "done";
            reason = null;
            providerId = result.id || null;
          } else {
            reason = result?.reason || "PROVIDER_REJECTED";
          }
        }
      }
    } catch (sendError) {
      // Avoid leaking the recipient, request text, or provider response to logs.
      reason = sendError?.code || "EMAIL_SEND_FAILED";
      console.warn("[DOCUMENT EMAIL] failed", { eventId: event.id, code: reason });
    }
    const finished = await db.rpc("bgy_doc_email_finish", {
      p_id: event.id, p_lease_token: event.lease_token,
      p_state: state, p_provider_id: providerId, p_error: reason,
    });
    if (finished.error) {
      console.error("[DOCUMENT EMAIL] state update failed", { eventId: event.id, code: finished.error.code });
      // Lease expiry permits replay using the identical provider idempotency key.
      results.push({ id: event.id, status: "unconfirmed" });
    } else {
      results.push({ id: event.id, status: finished.data ? state : "stale_claim" });
    }
  }
  return results;
};
