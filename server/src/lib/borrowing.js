export const BLOCKING_BORROWING_STATUSES = ["approved", "borrowed"];
export const BORROWING_STATUSES = ["pending", "approved", "rejected", "borrowed", "returned", "cancelled"];

export const rangesOverlap = (startA, endA, startB, endB) => {
  const aStart = new Date(startA).getTime();
  const aEnd = new Date(endA).getTime();
  const bStart = new Date(startB).getTime();
  const bEnd = new Date(endB).getTime();
  if ([aStart, aEnd, bStart, bEnd].some(Number.isNaN)) return false;
  return aStart < bEnd && aEnd > bStart;
};

export const validateBorrowingWindow = ({ startAt, dueAt, now = Date.now() }) => {
  const start = new Date(startAt).getTime();
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(due)) {
    throw Object.assign(new Error("Valid start and return dates are required."), { status: 400 });
  }
  if (due <= start) {
    throw Object.assign(new Error("Return date must be after the borrowing start date."), { status: 400 });
  }
  // Allow a small clock difference while rejecting clearly historical reservations.
  if (start < now - 5 * 60 * 1000) {
    throw Object.assign(new Error("Borrowing start date cannot be in the past."), { status: 400 });
  }
  return { startAt: new Date(start).toISOString(), dueAt: new Date(due).toISOString() };
};

export const calculateAvailableQuantity = (totalQuantity, reservations = []) => {
  const reserved = reservations
    .filter((item) => BLOCKING_BORROWING_STATUSES.includes(item.status))
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  return Math.max(0, Number(totalQuantity || 0) - reserved);
};

export const isLateBorrowing = (request, now = Date.now()) =>
  request?.status === "borrowed" && new Date(request?.due_at || request?.dueAt).getTime() < now;

export const canTransitionBorrowing = (from, to) => {
  const transitions = {
    pending: ["approved", "rejected", "cancelled"],
    approved: ["borrowed", "cancelled"],
    borrowed: ["returned"],
    rejected: [],
    returned: [],
    cancelled: [],
  };
  return (transitions[from] || []).includes(to);
};
