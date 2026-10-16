const PRIVATE_KEY_PATTERN = /(password|secret|token|authorization|(^|_)code(_|$)|otp|api.?key|valid.?id|id.?photo|credential)/i;
export const cleanAuditValue = (value, depth = 0) => {
  if (depth > 10) return '[truncated depth]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => cleanAuditValue(v, depth + 1));
  if (typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, PRIVATE_KEY_PATTERN.test(key) ? '[redacted]' : cleanAuditValue(item, depth + 1)]));
};

export const auditCategoryForAction = (action = '') =>
  /login|logout|password|access_denied|auth_failed|credential|permission/i.test(action)
    ? 'security' : 'activity';

