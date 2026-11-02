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

