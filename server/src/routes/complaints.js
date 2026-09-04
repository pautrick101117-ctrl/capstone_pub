import express from "express";
import { requireSupabase } from "../lib/supabase.js";
import { requireAuth, requireCurrentUser } from "../middleware/auth.js";
import { logAudit } from "../utils/audit.js";
import { normalizeRole } from "../utils/helpers.js";
import { sendSystemEmail } from "../lib/mailer.js";

const router = express.Router();

router.use(requireAuth, requireCurrentUser());

const getSetting = async (db, key, fallback) => {
  const { data, error } = await db.from("portal_settings").select("value").eq("key_name", key).maybeSingle();
  if (error) return fallback;
  return data?.value ?? fallback;
};

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
    if (normalizeRole(req.currentUser.role) !== "resident") {
      throw Object.assign(new Error("Only resident accounts can submit complaints."), { status: 403 });
    }

    const complaintType = `${req.body.complaint_type || req.body.complaintType || ""}`.trim();
    const details = `${req.body.details || ""}`.trim();
    const priority = ["low", "normal", "high", "urgent"].includes(req.body.priority) ? req.body.priority : "normal";
    if (!complaintType || !details) {
      throw Object.assign(new Error("Complaint type and details are required."), { status: 400 });
    }

    const db = requireSupabase();
    const residentName =
      req.currentUser.full_name ||
      [req.currentUser.first_name, req.currentUser.middle_name, req.currentUser.last_name].filter(Boolean).join(" ");
    const payload = {
      user_id: req.currentUser.id,
      resident_name: residentName,
      complaint_type: complaintType,
      details,
      status: "submitted",
      priority,
      admin_note: "",
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await db.from("complaints").insert(payload).select("*").single();
    if (error) throw error;

    const { data: admins } = await db
      .from("users")
      .select("id, email")
      .in("role", ["admin", "super_admin"])
      .eq("is_active", true);
    if ((admins || []).length) {
      await db.from("notifications").insert(
        admins.map((admin) => ({
          user_id: admin.id,
          title: "New resident complaint",
          body: `${data.reference_code || "New complaint"}: ${complaintType} from ${residentName}.`,
          kind: priority === "urgent" ? "warning" : "info",
          broadcast: false,
        }))
      );
    }

    const alertEnabled = Boolean(await getSetting(db, "complaint_email_alerts", true));
    const alertEmail = `${await getSetting(db, "notification_email", "") || ""}`;
    if (alertEnabled && alertEmail) {
      await sendSystemEmail({
        to: alertEmail,
        subject: `New complaint ${data.reference_code || ""}`.trim(),
        text: `${residentName} submitted a ${priority} priority complaint: ${complaintType}\n\n${details}`,
      }).catch((emailError) => console.warn(`[COMPLAINT EMAIL ERROR] ${emailError.message}`));
    }

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "create_complaint",
      entityType: "complaint",
      entityId: data.id,
      details: { complaintType, priority },
    });

    res.status(201).json({ complaint: data });
  } catch (error) {
    next(error);
  }
});

export default router;
