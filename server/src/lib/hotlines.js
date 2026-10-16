// Phase 7: one source of truth for hotline validation and public serialization.
// These defaults are used only until the canonical DB row has been provisioned.
export const DEFAULT_HOTLINES = Object.freeze([
  { id: "hotline_1", label: "Barangay Iba Hotline 1", phone: "09165222147", hours: "", note: "", is_active: true },
  { id: "hotline_2", label: "Barangay Iba Hotline 2", phone: "09912678875", hours: "", note: "", is_active: true },
]);

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

export const normalizeHotlinePhone = (input) => {
  const value = String(input ?? "").trim().replace(/[\s()-]/g, "");
  if (/^09\d{9}$/.test(value)) return value;
  if (/^\+639\d{9}$/.test(value)) return `0${value.slice(3)}`;
  throw badRequest("Enter a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).");
};

export const validateHotlines = (input) => {
  if (!Array.isArray(input) || input.length !== 2) throw badRequest("Configure exactly two hotline slots.");
  const seen = new Set();
  let active = 0;
  return input.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw badRequest("Invalid hotline entry.");
    const id = `hotline_${index + 1}`;
    if (raw.id !== id) throw badRequest(`Expected ${id} at position ${index + 1}.`);
    if (typeof raw.is_active !== "boolean") throw badRequest("Hotline active setting must be a boolean.");
    for (const name of ["label", "phone", "hours", "note"]) {
      if (raw[name] != null && typeof raw[name] !== "string") throw badRequest(`Invalid ${name} value.`);
    }
    const label = (raw.label || "").trim();
    const hours = (raw.hours || "").trim();
    const note = (raw.note || "").trim();
    if (!label || label.length > 80) throw badRequest("Hotline name is required (maximum 80 characters).");
    if (hours.length > 100 || note.length > 300) throw badRequest("Hotline hours or instructions are too long.");
    const inputPhone = (raw.phone || "").trim();
    const phone = inputPhone ? normalizeHotlinePhone(inputPhone) : "";
    if (raw.is_active) {
      if (!phone) throw badRequest(`${label} must have a phone number while active.`);
      active += 1;
    }
    if (phone) {
      if (seen.has(phone)) throw badRequest("Hotline numbers must be different.");
      seen.add(phone);
    }
    return { id, label, phone, hours, note, is_active: raw.is_active };
  }).map((item, index, all) => {
    if (index === all.length - 1 && active === 0) throw badRequest("At least one hotline must remain active.");
    return item;
  });
};

export const configuredHotlines = (content) => {
  // No automatic migration from the old, possibly fictitious hotline number.
  // The Phase 7 SQL creates a canonical row using the two official numbers.
  if (!content?.hotlines) return validateHotlines(DEFAULT_HOTLINES);
  return validateHotlines(content.hotlines.hotlines);
};

export const publicHotlineSupport = (content = {}) => {
  const hotlines = configuredHotlines(content).filter((item) => item.is_active);
  const first = hotlines[0] || null;
  return {
    contact: content.contact || null,
    hotlines,
    // One-release compatibility for older deployed clients.
    hotline: first ? { title: first.label, phone: first.phone, hours: first.hours, note: first.note } : null,
  };
};
