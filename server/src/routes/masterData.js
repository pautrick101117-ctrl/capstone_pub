import express from "express";
import { requireSupabase } from "../lib/supabase.js";
import { requireAuth, requireCurrentUser, requireRole } from "../middleware/auth.js";
import { logAudit } from "../utils/audit.js";
import { MASTER_DATA_CATEGORIES, normalizeMasterCategory } from "../lib/masterData.js";

const router = express.Router();

const normalizeValue = (value = "") => `${value}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const ensureCategory = (value) => {
  const category = normalizeMasterCategory(value);
  if (!MASTER_DATA_CATEGORIES.includes(category)) {
    throw Object.assign(new Error("Invalid master-data category."), { status: 400 });
  }
  return category;
};

router.get("/", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const category = req.query.category ? ensureCategory(req.query.category) : null;
    let query = db
      .from("master_data_values")
      .select("id, category, value, label, sort_order, is_active")
      .eq("is_active", true)
      .order("category")
      .order("sort_order")
      .order("label");
    if (category) query = query.eq("category", category);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ items: data || [] });
  } catch (error) {
    next(error);
  }
});

router.get("/admin", requireAuth, requireCurrentUser(), requireRole("admin"), async (req, res, next) => {
  try {
    const db = requireSupabase();
    const category = req.query.category ? ensureCategory(req.query.category) : null;
    let query = db.from("master_data_values").select("*").order("category").order("sort_order").order("label");
    if (category) query = query.eq("category", category);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ items: data || [] });
  } catch (error) {
    next(error);
  }
});

router.post("/admin", requireAuth, requireCurrentUser(), requireRole("admin"), async (req, res, next) => {
  try {
    const db = requireSupabase();
    const category = ensureCategory(req.body.category);
    const label = `${req.body.label || ""}`.trim();
    if (!label) throw Object.assign(new Error("Label is required."), { status: 400 });
    const value = normalizeValue(req.body.value || label);
    if (!value) throw Object.assign(new Error("Value is required."), { status: 400 });
    const sortOrder = Number.isFinite(Number(req.body.sortOrder)) ? Number(req.body.sortOrder) : 0;
    const { data, error } = await db
      .from("master_data_values")
      .insert({ category, label, value, sort_order: sortOrder, is_active: req.body.isActive !== false })
      .select("*")
      .single();
    if (error?.code === "23505") throw Object.assign(new Error("That option already exists in this category."), { status: 409 });
    if (error) throw error;
    await logAudit({ actorId: req.currentUser.id, actorRole: req.currentUser.role, action: "create_master_data", entityType: "master_data", entityId: data.id, details: { category, value, label } });
    res.status(201).json({ item: data, message: "Option added." });
  } catch (error) {
    next(error);
  }
});

router.patch("/admin/:id", requireAuth, requireCurrentUser(), requireRole("admin"), async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: existing, error: findError } = await db.from("master_data_values").select("*").eq("id", req.params.id).maybeSingle();
    if (findError) throw findError;
    if (!existing) throw Object.assign(new Error("Master-data option not found."), { status: 404 });

    const updates = { updated_at: new Date().toISOString() };
    if (req.body.label !== undefined) {
      const label = `${req.body.label || ""}`.trim();
      if (!label) throw Object.assign(new Error("Label is required."), { status: 400 });
      updates.label = label;
    }
    if (req.body.value !== undefined) {
      const value = normalizeValue(req.body.value);
      if (!value) throw Object.assign(new Error("Value is required."), { status: 400 });
      updates.value = value;
    }
    if (req.body.sortOrder !== undefined) updates.sort_order = Number(req.body.sortOrder) || 0;
    if (req.body.isActive !== undefined) updates.is_active = Boolean(req.body.isActive);

    const { data, error } = await db.from("master_data_values").update(updates).eq("id", req.params.id).select("*").single();
    if (error?.code === "23505") throw Object.assign(new Error("That option already exists in this category."), { status: 409 });
    if (error) throw error;
    await logAudit({ actorId: req.currentUser.id, actorRole: req.currentUser.role, action: "update_master_data", entityType: "master_data", entityId: data.id, details: updates });
    res.json({ item: data, message: "Option updated." });
  } catch (error) {
    next(error);
  }
});

export default router;

