// Phase 8: centrally validated resident concern quota policy.
// Enforcement is performed in PostgreSQL, never from an advisory UI count.
export const DEFAULT_CONCERN_LIMITS = Object.freeze({
  enabled: false,
  rolling_window: { max_submissions: 3, period_days: 7 },
  unresolved_limit: { enabled: true, max_concerns: 5 },
});

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const exactKeys = (object, keys) => object && typeof object === "object" && !Array.isArray(object)
  && Object.keys(object).length === keys.length
  && Object.keys(object).every((key) => keys.includes(key));
const boundedInteger = (value, name, max) => {
  if (!Number.isInteger(value) || value < 1 || value > max) throw badRequest(`${name} must be a whole number between 1 and ${max}.`);
  return value;
};

export const validateConcernLimits = (input) => {
  if (!exactKeys(input, ["enabled", "rolling_window", "unresolved_limit"]) || typeof input.enabled !== "boolean") {
    throw badRequest("Invalid community concern submission settings.");
  }
  if (!exactKeys(input.rolling_window, ["max_submissions", "period_days"])
    || !exactKeys(input.unresolved_limit, ["enabled", "max_concerns"])
    || typeof input.unresolved_limit.enabled !== "boolean") {
    throw badRequest("Invalid community concern quota settings.");
  }
  return {
    enabled: input.enabled,
    rolling_window: {
      max_submissions: boundedInteger(input.rolling_window.max_submissions, "Maximum submissions", 100),
      period_days: boundedInteger(input.rolling_window.period_days, "Rolling period (days)", 365),
    },
    unresolved_limit: {
      enabled: input.unresolved_limit.enabled,
      max_concerns: boundedInteger(input.unresolved_limit.max_concerns, "Maximum unresolved concerns", 100),
    },
  };
};

export const complaintSubmissionError = (error) => {
  const message = error?.message || "";
  if (message.includes("BGY_CONCERN_WINDOW_LIMIT")) return Object.assign(
    new Error("You've reached the concern submission limit for the current rolling period. View your existing concerns or try again when your allowance renews."),
    { status: 429, code: "CONCERN_WINDOW_LIMIT_REACHED" }
  );
  if (message.includes("BGY_CONCERN_OPEN_LIMIT")) return Object.assign(
    new Error("You've reached the maximum number of unresolved concerns. Please track your existing concerns or contact the barangay hotline for urgent assistance."),
    { status: 409, code: "CONCERN_OPEN_LIMIT_REACHED" }
  );
  if (message.includes("BGY_CONCERN_OPERATION_REUSED")) return Object.assign(
    new Error("This submission reference was already used for different concern details. Please start a new submission."),
    { status: 409, code: "CONCERN_OPERATION_REUSED" }
  );
  if (message.includes("BGY_CONCERN_UNAUTHORIZED")) return Object.assign(new Error("Your resident account is not authorized to submit concerns."), { status: 403 });
  if (error?.code === "22023" || /BGY_CONCERN_INVALID/.test(message)) return Object.assign(
    new Error("Please select an active concern type and enter 10–1,500 characters of details."), { status: 400 }
  );
  return error;
};
