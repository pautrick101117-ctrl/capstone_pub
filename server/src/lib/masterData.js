export const MASTER_DATA_CATEGORIES = [
  "purok",
  "administration_term",
  "concern_category",
  "event_category",
  "official_position",
];

export const normalizeMasterCategory = (value = "") => `${value}`.trim().toLowerCase().replace(/[\s-]+/g, "_");

export const assertActiveMasterLabel = async (db, category, label) => {
  const normalizedCategory = normalizeMasterCategory(category);
  const normalizedLabel = `${label || ""}`.trim();
  if (!normalizedLabel) throw Object.assign(new Error("A required controlled value is missing."), { status: 400 });
  const { data, error } = await db
    .from("master_data_values")
    .select("id, label")
    .eq("category", normalizedCategory)
    .eq("is_active", true)
    .ilike("label", normalizedLabel)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error(`${normalizedLabel} is not an active ${normalizedCategory.replace(/_/g, " ")} option.`), { status: 400 });
  return data.label;
};
