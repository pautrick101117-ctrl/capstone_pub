export const STATUS_META = {
  submitted: { label: "Submitted", tone: "info", description: "Received and waiting for staff review." },
  acknowledged: { label: "Acknowledged", tone: "info", description: "Barangay staff have reviewed the submission." },
  processing: { label: "Processing", tone: "warning", description: "Barangay staff are currently processing this request." },
  needs_information: { label: "Needs Information", tone: "warning", description: "Additional resident information is required before processing can continue." },
  ready_for_release: { label: "Ready for Release", tone: "success", description: "The document is ready for release or final completion." },
  ready_for_pickup: { label: "Ready for Pickup", tone: "success", description: "The Barangay ID is ready to be picked up." },
  confirmed: { label: "Confirmed", tone: "success", description: "The schedule or request has been confirmed." },
  rescheduled: { label: "Rescheduled", tone: "warning", description: "A new schedule has been assigned." },
  completed: { label: "Completed", tone: "success", description: "This item has been completed." },
  rejected: { label: "Rejected", tone: "danger", description: "This submission was not approved." },
  cancelled: { label: "Cancelled", tone: "danger", description: "This item has been cancelled." },

  under_review: { label: "Under Review", tone: "info", description: "Staff are reviewing the submitted information." },
  in_progress: { label: "In Progress", tone: "warning", description: "Work is currently in progress." },
  resolved: { label: "Resolved", tone: "success", description: "The reported concern has been resolved." },
  closed: { label: "Closed", tone: "neutral", description: "This item is closed and retained for history." },

  draft: { label: "Draft", tone: "neutral", description: "Not yet visible as an active voting period." },
  scheduled: { label: "Scheduled", tone: "info", description: "Published and scheduled to open automatically." },
  live: { label: "Live", tone: "warning", description: "Voting is currently open." },
  finalized: { label: "Finalized", tone: "success", description: "Results have been formally finalized." },
  archived: { label: "Archived", tone: "neutral", description: "Historical record." },

  needs_revision: { label: "Needs Revision", tone: "warning", description: "Resident changes are requested before another review." },
  approved: { label: "Approved", tone: "success", description: "Approved for the next applicable workflow." },
  included_in_voting: { label: "Included in Voting", tone: "info", description: "This suggestion is included in a voting post." },
  selected: { label: "Selected", tone: "success", description: "This suggestion became a selected community project." },

  planned: { label: "Planned", tone: "info", description: "Approved and being prepared for implementation." },
  preparation: { label: "Preparation", tone: "warning", description: "Preparation or procurement work is underway." },

  active: { label: "Active", tone: "success", description: "Active record." },
  inactive: { label: "Inactive", tone: "neutral", description: "Inactive record." },
  "for update": { label: "For Update", tone: "warning", description: "This household record needs information to be reviewed or refreshed." },
  pending: { label: "Pending", tone: "warning", description: "Waiting for review or action." },
};

export const getStatusMeta = (status = "") => {
  const key = `${status || ""}`.trim().toLowerCase();
  return STATUS_META[key] || {
    label: key ? key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Unknown",
    tone: "neutral",
    description: "",
  };
};
