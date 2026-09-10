import express from "express";
import { requireSupabase } from "../lib/supabase.js";
import { requireAuth, requireCurrentUser, requireRole } from "../middleware/auth.js";
import { logAudit } from "../utils/audit.js";
import { normalizeRole } from "../utils/helpers.js";
import { assertActiveMasterLabel } from "../lib/masterData.js";

const router = express.Router();

router.use(requireAuth, requireCurrentUser(), requireRole("resident"));

router.get("/mine", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db
      .from("complaints")
      .select("*")
      .eq("user_id", req.currentUser.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json({ complaints: data || [] });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const complaintType = (req.body.complaint_type || "").trim();
    const details = (req.body.details || "").trim();
    if (!complaintType || !details) {
      throw Object.assign(new Error("Complaint type and details are required."), { status: 400 });
    }

    const db = requireSupabase();
    await assertActiveMasterLabel(db, "concern_category", complaintType);
    const { data: user, error: userError } = await db
      .from("users")
      .select("id, first_name, last_name")
      .eq("id", req.currentUser.id)
      .single();
    if (userError) throw userError;

    const payload = {
      user_id: user.id,
      resident_name: `${user.first_name} ${user.last_name}`.trim(),
      complaint_type: complaintType,
      details,
      status: "pending",
    };

    const { data, error } = await db.from("complaints").insert(payload).select("*").single();
    if (error) throw error;

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "create_complaint",
      entityType: "complaint",
      entityId: data.id,
      details: payload,
    });

    res.status(201).json({ complaint: data });
  } catch (error) {
    next(error);
  }
});

export default router;
