import express from "express";
import { requireSupabase } from "../lib/supabase.js";
import { requireAuth, requireCurrentUser, requireRole } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { adminActivityMiddleware, logAudit } from "../utils/audit.js";
import { normalizeRole } from "../utils/helpers.js";
import { attachCaseHistories, getOperationId, parseNewCaseResponse, updateCaseWithHistory } from "../lib/caseHistory.js";
import {
  BLOCKING_BORROWING_STATUSES,
  BORROWING_STATUSES,
  calculateAvailableQuantity,
  canTransitionBorrowing,
  isLateBorrowing,
  normalizeBorrowingQuantity,
  normalizeMaxBorrowMinutes,
  validateAssetDuration,
  mapBorrowingDatabaseError,
  validateBorrowingWindow,
  validateReturnInspection,
} from "../lib/borrowing.js";

const router = express.Router();
router.use(requireAuth, requireCurrentUser());
router.use(adminActivityMiddleware("borrowing"));

const ensureResident = (req, res, next) => requireRole("resident")(req, res, next);
const ensureAdmin = (req, res, next) => requireRole("admin")(req, res, next);

const STATUS_LABELS = {
  pending: "Pending Review",
  approved: "Approved",
  rejected: "Rejected",
  borrowed: "Released / In Use",
  returned: "Returned / Completed",
  cancelled: "Cancelled",
};

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

const notifyAdmins = async (db, title, body, kind = "info") => {
  const { data: admins, error: adminError } = await db
    .from("users")
    .select("id")
    .in("role", ["admin", "super_admin"])
    .eq("is_active", true);
  if (adminError) {
    console.warn(`[BORROWING ADMIN LOOKUP ERROR] ${adminError.message}`);
    return;
  }
  if (!(admins || []).length) return;
  const { error } = await db.from("notifications").insert(
    admins.map((admin) => ({ user_id: admin.id, title, body, kind, broadcast: false }))
  );
  if (error) console.warn(`[BORROWING ADMIN NOTIFICATION ERROR] ${error.message}`);
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
      const durationConfigured = Number.isInteger(asset.max_borrow_minutes) && asset.max_borrow_minutes >= 60;
      const withinDurationLimit = durationConfigured && (!window ||
        ((Date.parse(window.dueAt) - Date.parse(window.startAt)) / 60_000 <= asset.max_borrow_minutes));
      const unavailableReason = !durationConfigured ? "BORROW_DURATION_NOT_CONFIGURED"
        : !withinDurationLimit ? "BORROW_DURATION_EXCEEDED" : availableQuantity <= 0 ? "BORROW_RESOURCE_UNAVAILABLE" : null;
      return { ...asset, availableQuantity, durationConfigured, withinDurationLimit, unavailableReason,
        isAvailable: Boolean(asset.is_active && availableQuantity > 0 && withinDurationLimit) };
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
    res.json({ requests: await attachCaseHistories(db, "borrowing_request", (data || []).map((row) => mapRequest(row, lookups.assetsById, lookups.usersById)), { residentVisible: true }) });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/requests",
  ensureResident,
  rateLimit({ key: "borrowing-request", max: 10, windowMs: 10 * 60_000 }),
  async (req, res, next) => {
    try {
      const db = requireSupabase();
      const assetId = `${req.body.assetId || ""}`.trim();
      const purpose = `${req.body.purpose || ""}`.trim();
      const eventLocation = `${req.body.eventLocation || ""}`.trim();
      const termsAccepted = req.body.termsAccepted === true;

      if (!assetId) throw Object.assign(new Error("Choose a facility or item to borrow."), { status: 400 });
      if (purpose.length < 5 || purpose.length > 500) throw Object.assign(new Error("Purpose must be between 5 and 500 characters."), { status: 400 });
      if (eventLocation.length < 3 || eventLocation.length > 180) throw Object.assign(new Error("Event or use location must be between 3 and 180 characters."), { status: 400 });
      if (!termsAccepted) throw Object.assign(new Error("You must accept the borrowing and return responsibility before submitting."), { status: 400 });

      const window = validateBorrowingWindow({ startAt: req.body.startAt, dueAt: req.body.dueAt });
      const { data: asset, error: assetError } = await db.from("borrowable_assets").select("*").eq("id", assetId).eq("is_active", true).maybeSingle();
      if (assetError) throw assetError;
      if (!asset) throw Object.assign(new Error("This facility or item is not available for borrowing."), { status: 404 });

      const { durationMinutes } = validateAssetDuration(asset, window);
      const quantity = normalizeBorrowingQuantity(asset, req.body.quantity || 1);
      const reservations = await getBlockingReservations(db, { ...window, assetId });
      const availableQuantity = calculateAvailableQuantity(asset.total_quantity, reservations);
      if (quantity > availableQuantity) {
        throw Object.assign(new Error(`Only ${availableQuantity} ${asset.name} available for the selected schedule.`), { status: 409 });
      }

      const now = new Date().toISOString();
      const payload = {
        user_id: req.currentUser.id,
        asset_id: assetId,
        quantity,
        purpose,
        event_location: eventLocation,
        start_at: window.startAt,
        due_at: window.dueAt,
        status: "pending",
        terms_accepted_at: now,
        max_duration_minutes_at_submission: asset.max_borrow_minutes,
        updated_at: now,
      };
      const { data, error } = await db.from("borrowing_requests").insert(payload).select("*").single();
      if (error) throw mapBorrowingDatabaseError(error);

      await Promise.all([
        logAudit({ actorId: req.currentUser.id, actorRole: "resident", action: "create_borrowing_request", entityType: "borrowing_request", entityId: data.id, details: { assetId, quantity, startAt: window.startAt, dueAt: window.dueAt, durationMinutes, maxBorrowMinutes: asset.max_borrow_minutes, eventLocation } }),
        notifyAdmins(db, "New borrowing request", `${req.currentUser.full_name || req.currentUser.username || "A resident"} requested ${asset.name}${asset.category === "item" ? ` × ${quantity}` : ""}.`, "info"),
      ]);

      res.status(201).json({
        request: { ...data, asset, isLate: false },
        message: "Borrowing request submitted. It will be reserved only after barangay approval.",
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post("/requests/:id/cancel", ensureResident, async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: existing, error: findError } = await db.from("borrowing_requests").select("*").eq("id", req.params.id).eq("user_id", req.currentUser.id).maybeSingle();
    if (findError) throw findError;
    if (!existing) throw Object.assign(new Error("Borrowing request not found."), { status: 404 });
    if (!canTransitionBorrowing(existing.status, "cancelled")) throw Object.assign(new Error("Only pending or approved requests can be cancelled."), { status: 409 });
    const { data, error } = await db.rpc("bgy_case_resident_cancel_borrowing", {
      p_entity_id: existing.id, p_actor_id: req.currentUser.id,
      p_expected_status: existing.status, p_operation_id: getOperationId(req.body?.operationId),
    });
    if (error) throw Object.assign(new Error(error.message), { status: /changed|cancelled/i.test(error.message) ? 409 : 400 });
    await Promise.all([
      logAudit({ actorId: req.currentUser.id, actorRole: "resident", action: "cancel_borrowing_request", entityType: "borrowing_request", entityId: existing.id, details: { previousStatus: existing.status } }),
      notifyAdmins(db, "Borrowing request cancelled", `${req.currentUser.full_name || req.currentUser.username || "A resident"} cancelled a borrowing request.`, "info"),
    ]);
    res.json({ request: data, message: "Borrowing request cancelled. Any approved reservation has been released." });
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
  } catch (error) {
    next(error);
  }
});

router.post("/admin/assets", ensureAdmin, async (req, res, next) => {
  try {
    const db = requireSupabase();
    const name = `${req.body.name || ""}`.trim();
    const category = `${req.body.category || "item"}`.trim().toLowerCase();
    if (!name || name.length > 120 || !["facility", "item"].includes(category)) {
      throw Object.assign(new Error("Valid resource name and category are required."), { status: 400 });
    }
    const totalQuantity = category === "facility" ? 1 : Number(req.body.totalQuantity || 1);
    if (!Number.isInteger(totalQuantity) || totalQuantity < 1) {
      throw Object.assign(new Error("Total quantity must be a positive whole number."), { status: 400 });
    }
    const maxBorrowMinutes = normalizeMaxBorrowMinutes(req.body.maxBorrowMinutes);
    const description = `${req.body.description || ""}`.trim();
    if (description.length > 500) throw Object.assign(new Error("Description cannot exceed 500 characters."), { status: 400 });

    const { data, error } = await db.from("borrowable_assets").insert({
      name,
      category,
      description,
      total_quantity: totalQuantity,
      max_borrow_minutes: maxBorrowMinutes,
      is_active: req.body.isActive !== false,
      updated_at: new Date().toISOString(),
    }).select("*").single();
    if (error) throw error;
    await logAudit({ actorId: req.currentUser.id, actorRole: normalizeRole(req.currentUser.role), action: "create_borrowable_resource", entityType: "borrowable_asset", entityId: data.id, details: { name, category, totalQuantity, maxBorrowMinutes } });
    res.status(201).json({ asset: data, message: "Borrowable resource created." });
  } catch (error) {
    next(error);
  }
});

router.patch("/admin/assets/:id", ensureAdmin, async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: current, error: currentError } = await db.from("borrowable_assets").select("*").eq("id", req.params.id).maybeSingle();
    if (currentError) throw currentError;
    if (!current) throw Object.assign(new Error("Borrowable resource not found."), { status: 404 });

    const updates = { updated_at: new Date().toISOString() };
    if (req.body.name !== undefined) {
      const name = `${req.body.name}`.trim();
      if (!name || name.length > 120) throw Object.assign(new Error("Resource name is required and cannot exceed 120 characters."), { status: 400 });
      updates.name = name;
    }
    const nextCategory = req.body.category !== undefined ? `${req.body.category}`.trim().toLowerCase() : current.category;
    if (!["facility", "item"].includes(nextCategory)) throw Object.assign(new Error("Category must be facility or item."), { status: 400 });
    if (req.body.category !== undefined) updates.category = nextCategory;

    if (req.body.description !== undefined) {
      const description = `${req.body.description}`.trim();
      if (description.length > 500) throw Object.assign(new Error("Description cannot exceed 500 characters."), { status: 400 });
      updates.description = description;
    }

    if (nextCategory === "facility") {
      updates.total_quantity = 1;
    } else if (req.body.totalQuantity !== undefined) {
      const totalQuantity = Number(req.body.totalQuantity);
      if (!Number.isInteger(totalQuantity) || totalQuantity < 1) throw Object.assign(new Error("Total quantity must be at least 1."), { status: 400 });
      updates.total_quantity = totalQuantity;
    }
    if (req.body.maxBorrowMinutes !== undefined) updates.max_borrow_minutes = normalizeMaxBorrowMinutes(req.body.maxBorrowMinutes);
    // Previously configured records retain their current duration unless explicitly changed.
    if (req.body.isActive !== undefined) updates.is_active = Boolean(req.body.isActive);
    if (updates.is_active === true && (updates.max_borrow_minutes ?? current.max_borrow_minutes) == null) {
      throw Object.assign(new Error("Set the resource maximum duration before activating it."), { status: 400 });
    }

    if (req.body.expectedUpdatedAt === undefined) throw Object.assign(new Error("Refresh this resource before saving changes."), { status: 409 });
    const { data, error } = await db.from("borrowable_assets").update(updates).eq("id", req.params.id)
      .eq("updated_at", req.body.expectedUpdatedAt).select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw Object.assign(new Error("This resource was changed by another administrator. Refresh and try again."), { status: 409 });
    await logAudit({ actorId: req.currentUser.id, actorRole: normalizeRole(req.currentUser.role), action: "update_borrowable_resource", entityType: "borrowable_asset", entityId: data.id, details: updates });
    res.json({ asset: data, message: "Borrowable resource updated." });
  } catch (error) {
    next(error);
  }
});

router.get("/admin/requests", ensureAdmin, async (req, res, next) => {
  try {
    const db = requireSupabase();
    let query = db.from("borrowing_requests").select("*").order("created_at", { ascending: false });
    if (req.query.status && req.query.status !== "all") query = query.eq("status", req.query.status);
    const { data, error } = await query;
    if (error) throw error;
    const lookups = await loadRequestLookups(db, data || []);
    res.json({ requests: await attachCaseHistories(db, "borrowing_request", (data || []).map((row) => mapRequest(row, lookups.assetsById, lookups.usersById))) });
  } catch (error) {
    next(error);
  }
});

router.patch("/admin/requests/:id", ensureAdmin, async (req, res, next) => {
  try {
    const db = requireSupabase();
    const status = `${req.body.status || ""}`.trim().toLowerCase();
    if (!BORROWING_STATUSES.includes(status)) throw Object.assign(new Error("Invalid borrowing status."), { status: 400 });

    const { data: existing, error: findError } = await db.from("borrowing_requests").select("*").eq("id", req.params.id).maybeSingle();
    if (findError) throw findError;
    if (!existing) throw Object.assign(new Error("Borrowing request not found."), { status: 404 });
    if (existing.status !== status && !canTransitionBorrowing(existing.status, status)) throw Object.assign(new Error(`Cannot change status from ${existing.status} to ${status}.`), { status: 409 });

    const { data: asset, error: assetError } = await db.from("borrowable_assets").select("*").eq("id", existing.asset_id).maybeSingle();
    if (assetError) throw assetError;
    if (!asset) throw Object.assign(new Error("The resource linked to this request no longer exists."), { status: 409 });

    const response = parseNewCaseResponse(req.body, { maxLength: 500 });
    const adminNote = response.message;
    if (adminNote.length > 500) throw Object.assign(new Error("Admin note cannot exceed 500 characters."), { status: 400 });
    if (status === "rejected" && status !== existing.status && adminNote.length < 3) throw Object.assign(new Error("A rejection reason is required so the resident understands the decision."), { status: 400 });

    if (status === "approved" && status !== existing.status) {
      if (Date.parse(existing.due_at) <= Date.now()) throw Object.assign(new Error("This borrowing period has already ended. It can no longer be approved."), { status: 409 });
      if (!asset.is_active) throw Object.assign(new Error("This resource is inactive and cannot be approved for new borrowing."), { status: 409 });
      // This read is advisory. Phase 9 BEFORE UPDATE trigger rechecks while locking the asset.
      const reservations = await getBlockingReservations(db, { startAt: existing.start_at, dueAt: existing.due_at, assetId: existing.asset_id, excludeId: existing.id });
      const availableQuantity = calculateAvailableQuantity(asset.total_quantity, reservations);
      if (Number(existing.quantity) > availableQuantity) {
        throw Object.assign(new Error(`Cannot approve. Only ${availableQuantity} ${asset.name} available for that schedule.`), { status: 409 });
      }
    }

    const now = new Date().toISOString();
    const updates = { status, admin_note: adminNote, updated_at: now };
    if (status === "approved") Object.assign(updates, { approved_by: req.currentUser.id, approved_at: now });
    if (status === "borrowed") updates.borrowed_at = now;
    if (status === "returned" && status !== existing.status) {
      updates.returned_at = now;
      if (asset.category === "item") {
        const inspection = validateReturnInspection({
          requestedQuantity: existing.quantity,
          returnedQuantity: req.body.returnedQuantity,
          returnCondition: req.body.returnCondition,
          returnNote: req.body.returnNote,
        });
        updates.returned_quantity = inspection.returnedQuantity;
        updates.return_condition = inspection.returnCondition;
        updates.return_note = inspection.returnNote;
      } else {
        updates.returned_quantity = 1;
        updates.return_condition = null;
        updates.return_note = `${req.body.returnNote || ""}`.trim();
      }
    }

    const data = await updateCaseWithHistory(db, { entityType: "borrowing_request", id: existing.id,
      currentStatus: req.body.expectedStatus || existing.status, status, response, actorId: req.currentUser.id, operationId: req.body.operationId,
      extra: status === "returned" && status !== existing.status ? {
        returned_quantity: updates.returned_quantity, return_condition: updates.return_condition,
        return_note: updates.return_note,
      } : {} }).catch((error) => { throw mapBorrowingDatabaseError(error); });

    const label = STATUS_LABELS[status] || status;
    const residentBody = status === "approved"
      ? `Your ${asset.name} borrowing request was approved and is now reserved for the selected schedule.${response.visibility === "resident" && adminNote ? ` ${adminNote}` : ""}`
      : status === "borrowed"
        ? `${asset.name} has been marked ${asset.category === "facility" ? "in use" : "released to you"}. Return/complete it by the approved due time.${response.visibility === "resident" && adminNote ? ` ${adminNote}` : ""}`
        : status === "returned"
          ? `Your ${asset.name} borrowing transaction has been completed.${response.visibility === "resident" && adminNote ? ` ${adminNote}` : ""}`
          : `Your ${asset.name} borrowing request is now ${label}.${response.visibility === "resident" && adminNote ? ` ${adminNote}` : ""}`;

    await Promise.all([
      (status !== existing.status || (response.visibility === "resident" && adminNote))
        ? notifyResident(db, data.user_id, status === existing.status ? "New response about your borrowing" : `Borrowing: ${label}`, residentBody, status === "rejected" ? "warning" : status === "returned" ? "success" : "info") : Promise.resolve(),
      logAudit({ actorId: req.currentUser.id, actorRole: normalizeRole(req.currentUser.role), action: "update_borrowing_request", entityType: "borrowing_request", entityId: existing.id, details: updates }),
    ]);

    res.json({
      request: { ...data, asset, isLate: isLateBorrowing(data) },
      message: status === "returned" && asset.category === "item" ? "Return inspection saved and borrowing marked completed." : `Borrowing request marked ${label}.`,
    });
  } catch (error) {
    next(error);
  }
});

export default router;


