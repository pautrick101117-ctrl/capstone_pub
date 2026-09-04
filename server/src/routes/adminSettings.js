import express from "express";
import { requireSupabase } from "../lib/supabase.js";
import { logAudit } from "../utils/audit.js";
import { normalizeRole } from "../utils/helpers.js";

const router = express.Router();

const DEFAULTS = {
  resident_login_enabled: true,
  maintenance_mode: false,
  timezone: "Asia/Manila",
  date_format: "MM-DD-YYYY",
  complaint_email_alerts: true,
  notification_email: "barangayiba@gmail.com",
};

const normalizeValue = (key, value) => {
  if (["resident_login_enabled", "maintenance_mode", "complaint_email_alerts"].includes(key)) return Boolean(value);
  return value == null ? DEFAULTS[key] : `${value}`;
};

router.get("/", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db.from("portal_settings").select("key_name, value, updated_at").order("key_name");
    if (error) throw error;
    const settings = { ...DEFAULTS };
    for (const row of data || []) settings[row.key_name] = row.value;
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});

router.put("/", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const allowed = new Set(Object.keys(DEFAULTS));
    const entries = Object.entries(req.body || {}).filter(([key]) => allowed.has(key));
    if (!entries.length) return res.json({ settings: DEFAULTS });

    const now = new Date().toISOString();
    const rows = entries.map(([key, value]) => ({
      key_name: key,
      value: normalizeValue(key, value),
      updated_by: req.currentUser.id,
      updated_at: now,
    }));
    const { error } = await db.from("portal_settings").upsert(rows, { onConflict: "key_name" });
    if (error) throw error;

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "update_portal_settings",
      entityType: "portal_settings",
      entityId: "portal_settings",
      details: Object.fromEntries(entries),
    });

    const { data, error: readError } = await db.from("portal_settings").select("key_name, value");
    if (readError) throw readError;
    const settings = { ...DEFAULTS };
    for (const row of data || []) settings[row.key_name] = row.value;
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});

export default router;
