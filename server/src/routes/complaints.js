import express from "express";
import { requireSupabase } from "../lib/supabase.js";
import { requireAuth, requireCurrentUser, requireRole } from "../middleware/auth.js";
import { attachCaseHistories } from "../lib/caseHistory.js";
import { complaintSubmissionError } from "../lib/concernLimits.js";
import { randomUUID } from "node:crypto";

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
    res.json({ complaints: await attachCaseHistories(db, "complaint", data || [], { residentVisible: true }) });
  } catch (error) {
    next(error);
  }
});

// Advisory information only; the submission RPC rechecks under a database lock.
router.get("/eligibility", async (req, res, next) => {
  try {
    const { data, error } = await requireSupabase().rpc("bgy_phase8_concern_eligibility", {
      p_resident_id: req.currentUser.id,
    });
    if (error) throw complaintSubmissionError(error);
    res.json(data);
  } catch (error) { next(error); }
});

router.post("/", async (req, res, next) => {
  try {
    const complaintType = String(req.body?.complaint_type || "").trim();
    const details = String(req.body?.details || "").trim();
    if (!complaintType || complaintType.length > 100 || details.length < 10 || details.length > 1500) {
      throw Object.assign(new Error("Select a concern type and describe the issue in 10–1,500 characters."), { status: 400 });
    }
    const operationId = req.body?.operationId || randomUUID();
    if (typeof operationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
      throw Object.assign(new Error("Invalid submission reference. Start a new concern report."), { status: 400 });
    }
    // p_resident_id comes from verified server-side authentication, never the client.
    // Atomic SQL handles eligibility, active category, row insert and Phase 1/6 triggers.
    const { data, error } = await requireSupabase().rpc("bgy_phase8_submit_concern", {
      p_resident_id: req.currentUser.id,
      p_type: complaintType,
      p_details: details,
      p_operation_id: operationId,
    });
    if (error) throw complaintSubmissionError(error);
    res.status(data?.replayed ? 200 : 201).json({ complaint: data.complaint, replayed: Boolean(data.replayed) });
  } catch (error) { next(error); }
});

export default router;
