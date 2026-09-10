import express from "express";
import { requireSupabase } from "../lib/supabase.js";
import { requireAuth, requireCurrentUser, requireRole } from "../middleware/auth.js";
import { logAudit } from "../utils/audit.js";
import { normalizeRole } from "../utils/helpers.js";
import {
  BLOCKING_BORROWING_STATUSES,
  BORROWING_STATUSES,
  calculateAvailableQuantity,
  canTransitionBorrowing,
  isLateBorrowing,
  validateBorrowingWindow,
} from "../lib/borrowing.js";

const router = express.Router();
router.use(requireAuth, requireCurrentUser());

const ensureResident = (req, _res, next) => requireRole("resident")(req, _res, next);
const ensureAdmin = (req, _res, next) => requireRole("admin")(req, _res, next);

const getBlockingReservations = async (db, { startAt, dueAt, assetId, excludeId } = {}) => {
  let query = db
    .from("borrowing_requests")
    .select("id, asset_id, quantity, start_at, due_at, status")
    .in("status", BLOCKING_BORROWING_STATUSES);
  if (assetId) query = query.eq("asset_id", assetId);
  if (startAt && dueAt) query = query.lt("start_at", dueAt).gt("due_at", startAt);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
};

const mapRequest = (row, assetsById = new Map(), usersById = new Map()) => ({
  ...row,
  asset: assetsById.get(row.asset_id) || null,
  resident: usersById.get(row.user_id) || null,
  isLate: isLateBorrowing(row),
});

const loadRequestLookups = async (db, rows = []) => {
  const assetIds = [...new Set(rows.map((row) => row.asset_id).filter(Boolean))];
  const userIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];
  const [assetsResult, usersResult] = await Promise.all([
    assetIds.length ? db.from("borrowable_assets").select("*").in("id", assetIds) : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? db.from("users").select("id, full_name, first_name, last_name, email, contact_number, purok").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (assetsResult.error) throw assetsResult.error;
  if (usersResult.error) throw usersResult.error;
  return {
    assetsById: new Map((assetsResult.data || []).map((item) => [item.id, item])),
    usersById: new Map((usersResult.data || []).map((item) => [item.id, item])),
  };
};

const notifyResident = async (db, userId, title, body, kind = "info") => {
  const { error } = await db.from("notifications").insert({ user_id: userId, title, body, kind, broadcast: false });
  if (error) console.warn(`[BORROWING NOTIFICATION ERROR] ${error.message}`);
};

router.get("/assets", ensureResident, async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: assets, error } = await db.from("borrowable_assets").select("*").eq("is_active", true).order("category").order("name");
    if (error) throw error;

    let window = null;
    let reservations = [];
    if (req.query.startAt && req.query.dueAt) {
      window = validateBorrowingWindow({ startAt: req.query.startAt, dueAt: req.query.dueAt });
      reservations = await getBlockingReservations(db, window);
    }

    const result = (assets || []).map((asset) => {
      const matching = reservations.filter((reservation) => reservation.asset_id === asset.id);
      const availableQuantity = window ? calculateAvailableQuantity(asset.total_quantity, matching) : Number(asset.total_quantity || 0);
      return { ...asset, availableQuantity, isAvailable: asset.is_active && availableQuantity > 0 };
    });
    res.json({ assets: result, window });
  } catch (error) {
    next(error);
  }
});

router.get("/mine", ensureResident, async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db.from("borrowing_requests").select("*").eq("user_id", req.currentUser.id).order("created_at", { ascending: false });
    if (error) throw error;
    const lookups = await loadRequestLookups(db, data || []);
    res.json({ requests: (data || []).map((row) => mapRequest(row, lookups.assetsById, lookups.usersById)) });
  } catch (error) {
    next(error);
  }
});

router.post("/requests", ensureResident, async (req, res, next) => {
  try {
    const db = requireSupabase();
    const assetId = `${req.body.assetId || ""}`.trim();
    const quantity = Number(req.body.quantity || 1);
    const purpose = `${req.body.purpose || ""}`.trim();
    if (!assetId || !Number.isInteger(quantity) || quantity < 1 || !purpose) {
      throw Object.assign(new Error("Asset, quantity, and purpose are required."), { status: 400 });
    }
    const window = validateBorrowingWindow({ startAt: req.body.startAt, dueAt: req.body.dueAt });
    const { data: asset, error: assetError } = await db.from("borrowable_assets").select("*").eq("id", assetId).eq("is_active", true).maybeSingle();
    if (assetError) throw assetError;
    if (!asset) throw Object.assign(new Error("This facility or item is not available for borrowing."), { status: 404 });

    const reservations = await getBlockingReservations(db, { ...window, assetId });
    const availableQuantity = calculateAvailableQuantity(asset.total_quantity, reservations);
    if (quantity > availableQuantity) {
      throw Object.assign(new Error(`Only ${availableQuantity} ${asset.name} available for the selected schedule.`), { status: 409 });
    }

    const payload = {
      user_id: req.currentUser.id,
      asset_id: assetId,
      quantity,
      purpose,
      start_at: window.startAt,
      due_at: window.dueAt,
      status: "pending",
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await db.from("borrowing_requests").insert(payload).select("*").single();
    if (error) throw error;
    await logAudit({ actorId: req.currentUser.id, actorRole: "resident", action: "create_borrowing_request", entityType: "borrowing_request", entityId: data.id, details: payload });
    res.status(201).json({ request: { ...data, asset, isLate: false }, message: "Borrowing request submitted for admin approval." });
  } catch (error) {
    next(error);
  }
});

router.post("/requests/:id/cancel", ensureResident, async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: existing, error: findError } = await db.from("borrowing_requests").select("*").eq("id", req.params.id).eq("user_id", req.currentUser.id).maybeSingle();
    if (findError) throw findError;
    if (!existing) throw Object.assign(new Error("Borrowing request not found."), { status: 404 });
    if (!canTransitionBorrowing(existing.status, "cancelled")) throw Object.assign(new Error("Only pending or approved requests can be cancelled."), { status: 409 });
    const { data, error } = await db.from("borrowing_requests").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", existing.id).select("*").single();
    if (error) throw error;
    res.json({ request: data, message: "Borrowing request cancelled." });
  } catch (error) {
    next(error);
  }
});

router.get("/admin/assets", ensureAdmin, async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db.from("borrowable_assets").select("*").order("category").order("name");
    if (error) throw error;
    res.json({ assets: data || [] });
  } catch (error) { next(error); }
});

router.post("/admin/assets", ensureAdmin, async (req, res, next) => {
  try {
    const db = requireSupabase();
    const name = `${req.body.name || ""}`.trim();
    const category = `${req.body.category || "item"}`.trim().toLowerCase();
    const totalQuantity = Number(req.body.totalQuantity || 1);
    if (!name || !["facility", "item"].includes(category) || !Number.isInteger(totalQuantity) || totalQuantity < 1) {
      throw Object.assign(new Error("Valid name, category, and total quantity are required."), { status: 400 });
    }
    const { data, error } = await db.from("borrowable_assets").insert({ name, category, description: `${req.body.description || ""}`.trim(), total_quantity: totalQuantity, is_active: req.body.isActive !== false, updated_at: new Date().toISOString() }).select("*").single();
    if (error) throw error;
    res.status(201).json({ asset: data, message: "Borrowable asset created." });
  } catch (error) { next(error); }
});

router.patch("/admin/assets/:id", ensureAdmin, async (req, res, next) => {
  try {
    const db = requireSupabase();
    const updates = { updated_at: new Date().toISOString() };
    if (req.body.name !== undefined) updates.name = `${req.body.name}`.trim();
    if (req.body.category !== undefined) {
      const category = `${req.body.category}`.trim().toLowerCase();
      if (!["facility", "item"].includes(category)) throw Object.assign(new Error("Category must be facility or item."), { status: 400 });
      updates.category = category;
    }
    if (req.body.description !== undefined) updates.description = `${req.body.description}`.trim();
    if (req.body.totalQuantity !== undefined) {
      const totalQuantity = Number(req.body.totalQuantity);
      if (!Number.isInteger(totalQuantity) || totalQuantity < 1) throw Object.assign(new Error("Total quantity must be at least 1."), { status: 400 });
      updates.total_quantity = totalQuantity;
    }
    if (req.body.isActive !== undefined) updates.is_active = Boolean(req.body.isActive);
    const { data, error } = await db.from("borrowable_assets").update(updates).eq("id", req.params.id).select("*").single();
    if (error) throw error;
    res.json({ asset: data, message: "Borrowable asset updated." });
  } catch (error) { next(error); }
});

router.get("/admin/requests", ensureAdmin, async (req, res, next) => {
  try {
    const db = requireSupabase();
    let query = db.from("borrowing_requests").select("*").order("created_at", { ascending: false });
    if (req.query.status && req.query.status !== "all") query = query.eq("status", req.query.status);
    const { data, error } = await query;
    if (error) throw error;
    const lookups = await loadRequestLookups(db, data || []);
    res.json({ requests: (data || []).map((row) => mapRequest(row, lookups.assetsById, lookups.usersById)) });
  } catch (error) { next(error); }
});

router.patch("/admin/requests/:id", ensureAdmin, async (req, res, next) => {
  try {
    const db = requireSupabase();
    const status = `${req.body.status || ""}`.trim().toLowerCase();
    if (!BORROWING_STATUSES.includes(status)) throw Object.assign(new Error("Invalid borrowing status."), { status: 400 });
    const { data: existing, error: findError } = await db.from("borrowing_requests").select("*").eq("id", req.params.id).maybeSingle();
    if (findError) throw findError;
    if (!existing) throw Object.assign(new Error("Borrowing request not found."), { status: 404 });
    if (!canTransitionBorrowing(existing.status, status)) throw Object.assign(new Error(`Cannot change status from ${existing.status} to ${status}.`), { status: 409 });

    if (status === "approved") {
      const { data: asset, error: assetError } = await db.from("borrowable_assets").select("*").eq("id", existing.asset_id).single();
      if (assetError) throw assetError;
      const reservations = await getBlockingReservations(db, { startAt: existing.start_at, dueAt: existing.due_at, assetId: existing.asset_id, excludeId: existing.id });
      const availableQuantity = calculateAvailableQuantity(asset.total_quantity, reservations);
      if (Number(existing.quantity) > availableQuantity) throw Object.assign(new Error(`Cannot approve. Only ${availableQuantity} ${asset.name} available for that schedule.`), { status: 409 });
    }

    const now = new Date().toISOString();
    const updates = { status, admin_note: `${req.body.adminNote || ""}`.trim(), updated_at: now };
    if (status === "approved") Object.assign(updates, { approved_by: req.currentUser.id, approved_at: now });
    if (status === "borrowed") updates.borrowed_at = now;
    if (status === "returned") updates.returned_at = now;

    const { data, error } = await db.from("borrowing_requests").update(updates).eq("id", existing.id).select("*").single();
    if (error) throw error;
    await notifyResident(db, data.user_id, "Borrowing request updated", `Your borrowing request is now ${status}.${updates.admin_note ? ` ${updates.admin_note}` : ""}`, status === "rejected" ? "warning" : "info");
    await logAudit({ actorId: req.currentUser.id, actorRole: normalizeRole(req.currentUser.role), action: "update_borrowing_request", entityType: "borrowing_request", entityId: existing.id, details: updates });
    res.json({ request: { ...data, isLate: isLateBorrowing(data) }, message: `Borrowing request marked ${status}.` });
  } catch (error) { next(error); }
});

export default router;
