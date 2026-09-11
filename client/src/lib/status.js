const STATUS_META = {
  submitted: { label: "Submitted", tone: "info" },
  acknowledged: { label: "Acknowledged", tone: "info" },
  processing: { label: "Processing", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  confirmed: { label: "Confirmed", tone: "success" },
  rescheduled: { label: "Rescheduled", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  pending: { label: "Pending Review", tone: "warning" },
  in_review: { label: "Under Review", tone: "info" },
  resolved: { label: "Resolved", tone: "success" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  draft: { label: "Draft", tone: "neutral" },
  live: { label: "Voting Open", tone: "success" },
  closed: { label: "Voting Closed", tone: "neutral" },
  borrowed: { label: "Released / In Use", tone: "info" },
  returned: { label: "Returned / Completed", tone: "success" },
  overdue: { label: "Overdue", tone: "danger" },
  planned: { label: "Planned", tone: "warning" },
  ongoing: { label: "Ongoing", tone: "info" },
  on_hold: { label: "On Hold", tone: "warning" },
  active: { label: "Active", tone: "success" },
  inactive: { label: "Inactive", tone: "neutral" },
  for_update: { label: "Needs Update", tone: "warning" },
};

const OVERRIDES = {
  id_request: {
    submitted: { label: "Awaiting Confirmation", tone: "warning" },
  },
  complaint: {
    pending: { label: "Submitted", tone: "warning" },
  },
  suggestion: {
    pending: { label: "Under Review", tone: "info" },
    approved: { label: "Approved for Consideration", tone: "success" },
    rejected: { label: "Not Approved", tone: "danger" },
  },
  borrowing: {
    pending: { label: "Pending Review", tone: "warning" },
    approved: { label: "Approved / Reserved", tone: "success" },
  },
};

export const humanizeStatus = (status = "") => `${status || "unknown"}`.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export const getStatusMeta = (status, feature = "") =>
  OVERRIDES[feature]?.[status] || STATUS_META[status] || { label: humanizeStatus(status), tone: "neutral" };

export const statusLabel = (status, feature = "") => getStatusMeta(status, feature).label;
export const statusTone = (status, feature = "") => getStatusMeta(status, feature).tone;
