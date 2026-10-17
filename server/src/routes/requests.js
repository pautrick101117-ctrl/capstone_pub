import { residentWriteLimiter, persistentLimit } from "../middleware/persistentLimit.js";
import express from "express";
import { requireSupabase } from "../lib/supabase.js";
import { requireAuth, requireCurrentUser } from "../middleware/auth.js";
import { logAudit } from "../utils/audit.js";
import { normalizeRole } from "../utils/helpers.js";
import { attachCaseHistories } from "../lib/caseHistory.js";

const router = express.Router();

router.use(requireAuth, requireCurrentUser());
router.use((req,res,next)=> ['POST','PATCH','PUT','DELETE'].includes(req.method) && req.currentUser?.role === 'resident' ? residentWriteLimiter(req,res,next) : next());

router.get("/mine", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db
      .from("requests")
      .select("*, request_timeline(*)")
      .eq("user_id", req.currentUser.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ requests: await attachCaseHistories(db, "request", data || [], { residentVisible: true }) });
  } catch (error) {
    next(error);
  }
});

router.post("/", persistentLimit("resident-document-request", {max:3,windowSeconds:3600}), async (req, res, next) => {
  try {
    if (normalizeRole(req.currentUser.role) !== "resident") {
      throw Object.assign(new Error("Only resident accounts can submit requests."), { status: 403 });
    }

    const requestType = `${req.body.requestType || ""}`.trim();
    const details = `${req.body.details || ""}`.trim();
    const copiesRequested=Number(req.body.copiesRequested||1);
    if(!Number.isInteger(copiesRequested)||copiesRequested<1||copiesRequested>10)throw Object.assign(new Error('Copies must be between 1 and 10.'),{status:400});
    const purposeCategory=`${req.body.purposeCategory||'Other'}`.trim();
    if(!['Employment','School','Loan','Government','Personal','Other'].includes(purposeCategory))throw Object.assign(new Error('Invalid request purpose.'),{status:400});
    if (!requestType || !details) {
      throw Object.assign(new Error("Request type and details are required."), { status: 400 });
    }

    const db = requireSupabase();
    const residentName =
      req.currentUser.full_name ||
      [req.currentUser.first_name, req.currentUser.middle_name, req.currentUser.last_name].filter(Boolean).join(" ");

    const payload = {
      user_id: req.currentUser.id,
      resident_name: residentName,
      request_type: requestType,
      details,
      copies_requested:copiesRequested,
      purpose_category:purposeCategory,
      status: "submitted",
      preferred_schedule_date: req.body.preferredScheduleDate || null,
      preferred_time_slot: req.body.preferredTimeSlot || null,
      admin_note: "",
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await db.from("requests").insert(payload).select("*").single();
    if (error) {
      if (error.code === 'P0001') throw Object.assign(new Error(error.message),{status:409,code:'DUPLICATE_ACTIVE_REQUEST'});
      throw error;
    }

    await db.from("request_timeline").insert({
      request_id: data.id,
      status: "submitted",
      note: "Request submitted.",
    });

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "create_request",
      entityType: "request",
      entityId: data.id,
      details: payload,
    });

    res.status(201).json({ request: data });
  } catch (error) {
    next(error);
  }
});

router.get("/id-slots", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db
      .from("id_pickup_slots")
      .select("*")
      .eq("is_active", true)
      .gte("slot_date", new Date().toISOString().slice(0, 10))
      .order("slot_date")
      .order("time_slot");
    if (error) throw error;
    res.json({ slots: data || [] });
  } catch (error) {
    next(error);
  }
});

router.get("/id-mine", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db
      .from("id_requests")
      .select("*")
      .eq("user_id", req.currentUser.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ requests: await attachCaseHistories(db, "id_request", data || [], { residentVisible: true }) });
  } catch (error) {
    next(error);
  }
});

router.post("/id", persistentLimit("resident-id-request", {max:3,windowSeconds:3600}), async (req, res, next) => {
  try {
    const purpose = `${req.body.purpose || ""}`.trim();
    const preferredDate = req.body.preferredDate || null;
    const timeSlot = `${req.body.timeSlot || ""}`.trim() || null;
    if (!purpose) {
      throw Object.assign(new Error("Purpose is required."), { status: 400 });
    }

    const db = requireSupabase();
    const { data, error } = await db
      .from("id_requests")
      .insert({
        user_id: req.currentUser.id,
        purpose,
        preferred_date: preferredDate,
        time_slot: timeSlot,
        status: "submitted",
        admin_note: "",
      })
      .select("*")
      .single();
    if (error) {
      if(error.code==='P0001')throw Object.assign(new Error(error.message),{status:409,code:'DUPLICATE_ACTIVE_ID_REQUEST'});
      throw error;
    }

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "create_id_request",
      entityType: "id_request",
      entityId: data.id,
      details: { purpose, preferredDate, timeSlot },
    });

    res.status(201).json({ request: data });
  } catch (error) {
    next(error);
  }
});

// Phase 11 is postponed. Generic text-only clearance is not an approved official certificate.
router.get('/document/:requestId/clearance', (_req,_res,next)=>next(Object.assign(
 new Error('Official document downloads are unavailable until approved templates and issuance are implemented.'),
 {status:409,code:'OFFICIAL_DOCUMENT_TEMPLATE_REQUIRED'})));

export default router;


