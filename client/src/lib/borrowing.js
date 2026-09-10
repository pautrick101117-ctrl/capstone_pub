export const BORROWING_STATUS_META = {
  pending: {
    label: "Pending Review",
    tone: "warning",
    description: "Your request was submitted and is waiting for barangay approval.",
  },
  approved: {
    label: "Approved",
    tone: "info",
    description: "Your requested resource is reserved for the approved schedule.",
  },
  borrowed: {
    label: "Released / In Use",
    tone: "info",
    description: "The resource has been released for use. Please return it by the due date.",
  },
  returned: {
    label: "Returned / Completed",
    tone: "success",
    description: "The borrowing transaction has been completed.",
  },
  rejected: {
    label: "Rejected",
    tone: "danger",
    description: "The barangay could not approve this request. Review the admin note for details.",
  },
  cancelled: {
    label: "Cancelled",
    tone: "neutral",
    description: "This request was cancelled and no longer reserves inventory.",
  },
};

export const RETURN_CONDITION_LABELS = {
  good: "Good condition",
  minor_damage: "Minor damage",
  damaged: "Damaged",
  missing_items: "Missing item(s)",
};

export const getBorrowingStatusMeta = (status, isLate = false) => {
  if (isLate) {
    return {
      label: "Overdue",
      tone: "danger",
      description: "The return deadline has passed. Please return the resource or contact the barangay office as soon as possible.",
    };
  }
  return BORROWING_STATUS_META[status] || {
    label: status ? `${status}`.replace(/_/g, " ") : "Unknown",
    tone: "neutral",
    description: "",
  };
};

export const isFacility = (asset) => asset?.category === "facility";
