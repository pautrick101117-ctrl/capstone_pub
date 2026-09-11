export const BLOCKING_BORROWING_STATUSES = ["approved", "borrowed"];
export const BORROWING_STATUSES = ["pending", "approved", "rejected", "borrowed", "returned", "cancelled"];
export const RETURN_CONDITIONS = ["good", "minor_damage", "damaged", "missing_items"];

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

export const normalizeBorrowingQuantity = (asset, quantity) => {
  if (asset?.category === "facility") return 1;
  const parsed = Number(quantity);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw Object.assign(new Error("Quantity must be a positive whole number."), { status: 400 });
  }
  return parsed;
};

export const validateReturnInspection = ({ requestedQuantity, returnedQuantity, returnCondition, returnNote = "" }) => {
  const requested = Number(requestedQuantity);
  const returned = Number(returnedQuantity);
  const condition = `${returnCondition || ""}`.trim().toLowerCase();
  const note = `${returnNote || ""}`.trim();

  if (!Number.isInteger(requested) || requested < 1) {
    throw Object.assign(new Error("The original released quantity is invalid."), { status: 400 });
  }
  if (!Number.isInteger(returned) || returned < 0 || returned > requested) {
    throw Object.assign(new Error(`Returned quantity must be between 0 and ${requested}.`), { status: 400 });
  }
  if (!RETURN_CONDITIONS.includes(condition)) {
    throw Object.assign(new Error("Select a valid return condition."), { status: 400 });
  }
  if (returned < requested && condition !== "missing_items") {
    throw Object.assign(new Error("Use the Missing item(s) condition when fewer items are returned than were released."), { status: 400 });
  }
  if ((condition !== "good" || returned < requested) && note.length < 3) {
    throw Object.assign(new Error("Add a return inspection note when items are missing or damaged."), { status: 400 });
  }

  return { returnedQuantity: returned, returnCondition: condition, returnNote: note };
};

