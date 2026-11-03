export const publicationDate = (value, now = new Date()) => {
  if (!value) return now.toISOString();
  const raw = String(value).trim();
  const datePart = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart) || Number.isNaN(Date.parse(datePart))
      || new Date(`${datePart}T00:00:00Z`).toISOString().slice(0, 10) !== datePart) {
    throw Object.assign(new Error('Enter a valid publication date and time.'), { status: 400 });
  }
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00+08:00` : raw;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(dated) || Number.isNaN(Date.parse(dated))) {
    throw Object.assign(new Error('Publication time must include its time zone.'), { status: 400 });
  }
  const date = new Date(dated);
  if (date > now) throw Object.assign(new Error('Use a past or present publication date and time.'), { status: 400 });
  return date.toISOString();
};


// Announcements are published now; their optional activity date can be in the future.
// The date must include an explicit timezone, as the editor sends Philippine time in UTC.
export const announcementEventDate = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const raw = String(value).trim();
  const day = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) ||
      new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day ||
      !/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    throw Object.assign(new Error("Enter a valid activity date and time with a time zone."), { status: 400 });
  }
  const instant = new Date(raw);
  if (!Number.isFinite(instant.getTime())) {
    throw Object.assign(new Error("Enter a valid activity date and time."), { status: 400 });
  }
  return instant.toISOString();
};
