export const formatDate = (value, options = {}) => {
  if (!value) return "Not set";
  if (!Number.isFinite(new Date(value).getTime())) return "Invalid date";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
    ...options,
  }).format(new Date(value));
};

export const formatDateTime = (value) => {
  if (!value) return "Not set";
  if (!Number.isFinite(new Date(value).getTime())) return "Invalid date";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
};

export const toManilaDateTimeInput = (value) => {
  if (!value) return "";
  if (!Number.isFinite(new Date(value).getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value)).map(({ type, value: part }) => [type, part]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

export const fromManilaDateTimeInput = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value || '')) return '';
  const date=new Date(`${value.length===16?`${value}:00`:value}+08:00`);
  return Number.isFinite(date.getTime()) && toManilaDateTimeInput(date)===value.slice(0,16) ? date.toISOString() : '';
};

export const formatCurrency = (value) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

export const countdownText = (endDate) => {
  if (!endDate) return "No deadline";
  const diff = new Date(endDate).getTime() - Date.now();
  if (!Number.isFinite(diff)) return "No deadline";
  if (diff <= 0) return "Closed";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"} left`;
  return `${hours} hour${hours === 1 ? "" : "s"} left`;
};



