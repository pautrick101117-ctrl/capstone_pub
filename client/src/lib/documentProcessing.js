// These three staff-facing stages do not change the internal database states.
export const requestStage = (status) =>
  ["approved", "document_prepared"].includes(status) ? 2 :
    ["ready_for_pickup", "claimed"].includes(status) ? 3 : 1;

export const requestFieldRows = (request, resident) => {
  const fields = { familyIncomeStatement: "Family income statement", businessName: "Business name",
    businessAddress: "Business address", businessKind: "Type of business", permitYear: "Permit year",
    ctcNumber: "Community Tax Certificate", sssNumber: "SSS number", tinNumber: "Tax Identification Number" };
  return [
    ["Full name", resident.full_name], ["Address", resident.address],
    ["Residency since", resident.residency_since || "Not recorded — verify if required"],
    ["Email", resident.email || "Not provided"], ["Contact", resident.contact_number || "Not provided"],
    ["Requested document", request.request_type], ["Purpose", request.details || "Not provided"],
    ["Copies", request.copies_requested || 1],
    ...Object.entries(request.document_data || {}).filter(([, value]) => value !== null && value !== undefined && value !== "")
      .map(([key, value]) => [fields[key] || key.replace(/([A-Z])/g, " $1"), String(value)]),
  ];
};


// Return human-readable missing approval requirements. Kept independent of React
// so all document types and older records can be verified in unit tests.
export const approvalBlockers = ({ documentType, photoRequired, hasPhoto, requiredChecks = [], checks = {}, approvedTemplates = [], templateId, issueDate }) => {
  const missing = [];
  if (photoRequired && !hasPhoto) missing.push({ key: "photo", label: "Add or select a clear resident photo." });
  const instructions = {
    identityVerified: "Verify the resident's identity.",
    residencyVerified: "Verify that the resident lives in Barangay Iba.",
    backgroundVerified: "Complete the background verification.",
    indigencyVerified: "Verify the indigency information.",
    businessVerified: "Verify the business information.",
  };
  for (const [key, description] of requiredChecks) {
    if (!checks[key]) missing.push({ key, label: instructions[key] || description });
  }
  if (documentType === "Barangay Clearance" && String(checks.backgroundStatement || "").trim().length < 5)
    missing.push({ key: "backgroundStatement", label: "Enter the verified clearance statement." });
  if (documentType === "Certificate of Indigency" && String(checks.incomeStatement || "").trim().length < 5)
    missing.push({ key: "incomeStatement", label: "Enter the verified income or indigency statement." });
  if (!approvedTemplates.length)
    missing.push({ key: "template", label: "Ask Super Admin to save the document template." });
  else if (!approvedTemplates.some(t => t.id === templateId))
    missing.push({ key: "template", label: "Choose the saved document template." });
  if (documentType === "Certificate of Residency" && !checks.residencyDateVerified)
    missing.push({ key: "residencyDateVerified", label: "Add and verify the resident's residency start date under resident details." });
  if (!issueDate) missing.push({ key: "issueDate", label: "Choose the document issue date." });
  return missing;
};

// A status event owns one email-queue row. Show old notification logs only
// for notification types that the queue does not already represent.
export const staffEmailItems = (queue = [], logs = []) => {
  const queued = queue.map(item => {
    const eligibleRetry = item.queue_state === "failed"
      && Number(item.attempt_count || 0) < 6
      && Date.now() - Date.parse(item.created_at) < 23 * 3600000;
    return {
      id: item.id, kind: "queue", type: item.notification_type,
      status: item.queue_state === "done" ? "Accepted by email provider" :
        item.queue_state === "pending" ? "Queued" :
        item.queue_state === "processing" ? "Sending" :
        item.queue_state === "skipped" ? "Not sent (status changed or no email)" :
        eligibleRetry ? "Failed — retry available" : "Failed — staff review needed",
      failed: eligibleRetry, createdAt: item.created_at,
    };
  });
  const queuedTypes = new Set(queue.map(item => item.notification_type));
  const legacy = logs.filter(item => !queuedTypes.has(item.notification_type)).map(item => ({
    id: item.id, kind: "legacy", type: item.notification_type,
    status: item.attempt_status === "accepted" ? "Accepted by email provider" :
      item.attempt_status === "failed" ? "Failed — retry available" :
      item.attempt_status === "skipped" ? "Not sent" : "Sending",
    failed: item.attempt_status === "failed", createdAt: item.created_at,
  }));
  return [...queued, ...legacy].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
};


export const preferredWordFile = (files = [], id = "") => {
  const chosen = files.find(f => f.id === id);
  return chosen || [...files].sort((a, b) => (b.version_number || 0) - (a.version_number || 0))[0] || null;
};

