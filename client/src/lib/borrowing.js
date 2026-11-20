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



// Philippine time is UTC+08:00 year-round. datetime-local has no timezone data.
export const fromManilaInput = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || "")) return null;
  const date = new Date(`${value}:00+08:00`);
  if (Number.isNaN(date.getTime())) return null;
  // Reject rolled-over calendar values (e.g. February 30) rather than silently correcting them.
  return toManilaInput(date) === value ? date : null;
};
export const toManilaInput = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() + 8 * 60 * 60_000).toISOString().slice(0,16);
};
export const formatBorrowDuration = (minutes) => {
  if (!Number.isInteger(Number(minutes)) || Number(minutes) <= 0) return "Duration setup required";
  if (Number(minutes) < 60) return `${minutes} minute${Number(minutes) === 1 ? "" : "s"}`;
  const m = Number(minutes);
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? "" : "s"}`;
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? "" : "s"}`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

export const formatBorrowDateTime = (value) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
};

// datetime-local values are interpreted in Philippine time, independently of
// the browser's timezone. The resource limit is an elapsed duration in minutes.
export const getBorrowingSchedule = ({ startAt, dueAt, asset, now = Date.now() }) => {
  const start = fromManilaInput(startAt);
  const due = fromManilaInput(dueAt);
  const maximum = Number(asset?.max_borrow_minutes);
  const configured = asset?.max_borrow_minutes != null && Number.isInteger(maximum) && maximum >= 60 && maximum <= 129600;
  const durationMinutes = start && due && due > start ? (due - start) / 60_000 : null;
  const latestReturnAt = start && configured ? toManilaInput(new Date(start.getTime() + maximum * 60_000)) : "";
  const errors = { startAt: "", dueAt: "", resource: "" };

  if (!start) errors.startAt = startAt ? "Enter a valid borrowing date and time." : "Select a borrowing date and time.";
  else if (start.getTime() < Math.ceil(now / 60_000) * 60_000) errors.startAt = "Borrow From must be a future date and time.";
  if (!due) errors.dueAt = dueAt ? "Enter a valid return date and time." : "Select a return date and time.";
  else if (start && due <= start) errors.dueAt = "Return By must be later than Borrow From.";

  if (!asset) errors.resource = "Select a facility or item to check your schedule.";
  else if (!configured) errors.resource = "The barangay must set a maximum borrowing duration for this resource before it can be requested.";
  else if (durationMinutes > maximum) {
    errors.dueAt = `The selected duration is ${formatBorrowDuration(durationMinutes)}. ${asset.name || "This resource"} may be borrowed for a maximum of ${formatBorrowDuration(maximum)}. Choose a return time on or before ${formatBorrowDateTime(fromManilaInput(latestReturnAt))}.`;
  }

  return { start, due, durationMinutes, latestReturnAt, errors, isValid: !Object.values(errors).some(Boolean) };
};

