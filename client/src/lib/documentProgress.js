// Resident-facing stages. Server request statuses are unchanged.
export const documentProgress = (status) => {
  const stages = [
    { label: "Request sent", detail: "Your application has been received." },
    { label: "Barangay review", detail: "Staff will check your information and prepare the document." },
    { label: "Pickup", detail: "Visit the barangay when your document is ready." },
  ];
  const reviewStatuses = ["under_review", "acknowledged", "processing", "approved", "document_prepared"];
  const completed = status === "claimed";
  let step = status === "submitted" ? 0 : reviewStatuses.includes(status) ? 1 : 2;
  let message = "We'll update you when barangay staff review your request.";
  let tone = "info";
  if (status === "under_review" || status === "acknowledged" || status === "processing") message = "Barangay staff are reviewing your application. No action is needed right now.";
  if (status === "approved" || status === "document_prepared") message = "Your request is approved. Staff are preparing the document; please wait for a pickup notice.";
  if (status === "ready_for_pickup") { message = "Your document is ready. Follow the pickup instructions sent by the barangay."; tone = "success"; }
  if (completed) { message = "Your document has been collected."; tone = "success"; }
  if (status === "needs_revision") { step = 1; message = "Please correct the information requested by barangay staff to continue."; tone = "warning"; }
  if (status === "rejected") { step = 1; message = "This request was not approved. See the reason below."; tone = "danger"; }
  if (status === "completed") { step = 1; message = "This is an older completed request. Contact the barangay to confirm collection if needed."; tone = "neutral"; }
  if (status === "cancelled") { step = 0; message = "You cancelled this request. You can submit a new one if needed."; tone = "neutral"; }
  return { stages, step, message, tone, completed, stopped: ["rejected", "cancelled"].includes(status) };
};

