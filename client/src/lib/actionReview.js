const OMITTED = new Set(["id", "password", "passwordHash", "password_hash", "temporaryPassword", "token", "secret", "preview"]);
const present = (value) => {
  if (value === null || value === undefined || value === "") return "Not set";
  if (typeof File !== "undefined" && value instanceof File) return `Selected file (${value.name})`;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return `${value}`;
};

const matchingKey = (record, key) => {
  if (!record) return undefined;
  if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  const snake = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  if (Object.prototype.hasOwnProperty.call(record, snake)) return record[snake];
  return undefined;
};

export const reviewChanges = (before = {}, after = {}) => Object.entries(after || {})
  .filter(([key]) => !OMITTED.has(key) && !/password|secret|token|verification|code|credential|api.?key|authorization|cookie|session/i.test(key))
  .filter(([key, value]) => present(matchingKey(before, key)) !== present(value))
  .map(([key, value]) => ({
    field: key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " "),
    before: present(matchingKey(before, key)), after: present(value),
  }));
