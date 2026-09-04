import express from "express";
import { requireSupabase } from "../lib/supabase.js";
import { logAudit } from "../utils/audit.js";
import { normalizeRole } from "../utils/helpers.js";
import { sendSystemEmail } from "../lib/mailer.js";

const router = express.Router();
const STATUSES = new Set(["submitted", "under_review", "in_progress", "resolved", "closed"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

router.get("/", async (req, res, next) => {
  try {
    const db = requireSupabase();
    let query = db.from("complaints").select("*").order("updated_at", { ascending: false }).order("created_at", { ascending: false });
    if (req.query.status && req.query.status !== "all") query = query.eq("status", req.query.status);
    if (req.query.priority && req.query.priority !== "all") query = query.eq("priority", req.query.priority);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ complaints: data || [] });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const status = req.body.status;
    const priority = req.body.priority;
    if (status && !STATUSES.has(status)) throw Object.assign(new Error("Invalid complaint status."), { status: 400 });
    if (priority && !PRIORITIES.has(priority)) throw Object.assign(new Error("Invalid complaint priority."), { status: 400 });

    const updates = { updated_at: new Date().toISOString() };
    if (status) updates.status = status;
    if (priority) updates.priority = priority;
    if (req.body.adminNote !== undefined || req.body.admin_note !== undefined) {
      updates.admin_note = `${req.body.adminNote ?? req.body.admin_note ?? ""}`.trim();
    }
    if (["resolved", "closed"].includes(status)) updates.resolved_at = new Date().toISOString();
    else if (status) updates.resolved_at = null;

    const { data, error } = await db.from("complaints").update(updates).eq("id", req.params.id).select("*").single();
    if (error) throw error;

    if (data.user_id) {
      const body = `Complaint ${data.reference_code || ""} is now ${data.status.replaceAll("_", " ")}.${data.admin_note ? ` Note: ${data.admin_note}` : ""}`.trim();
      await db.from("notifications").insert({
        user_id: data.user_id,
        title: "Complaint status updated",
        body,
        kind: ["resolved", "closed"].includes(data.status) ? "success" : "info",
        broadcast: false,
      });
      const { data: resident } = await db.from("users").select("email").eq("id", data.user_id).maybeSingle();
      if (resident?.email) {
        await sendSystemEmail({ to: resident.email, subject: "Complaint status updated", text: body }).catch((emailError) => {
          console.warn(`[EMAIL NOTIFICATION ERROR] ${resident.email}: ${emailError.message}`);
        });
      }
    }

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "update_complaint",
      entityType: "complaint",
      entityId: req.params.id,
      details: updates,
    });
    res.json({ complaint: data });
  } catch (error) {
    next(error);
  }
});

export default router;
