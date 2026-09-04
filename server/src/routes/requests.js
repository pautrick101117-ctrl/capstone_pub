import express from "express";
import PDFDocument from "pdfkit";
import { requireSupabase } from "../lib/supabase.js";
import { requireAuth, requireCurrentUser } from "../middleware/auth.js";
import { logAudit } from "../utils/audit.js";
import { normalizeRole } from "../utils/helpers.js";

const router = express.Router();

router.use(requireAuth, requireCurrentUser());

router.get("/mine", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db
      .from("requests")
      .select("*, request_timeline(*)")
      .eq("user_id", req.currentUser.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ requests: data || [] });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    if (normalizeRole(req.currentUser.role) !== "resident") {
      throw Object.assign(new Error("Only resident accounts can submit requests."), { status: 403 });
    }

    const requestType = `${req.body.requestType || ""}`.trim();
    const details = `${req.body.details || ""}`.trim();
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
      status: "submitted",
      preferred_schedule_date: req.body.preferredScheduleDate || null,
      preferred_time_slot: req.body.preferredTimeSlot || null,
      admin_note: "",
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await db.from("requests").insert(payload).select("*").single();
    if (error) throw error;

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
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: slots, error: slotError }, { data: bookings, error: bookingError }] = await Promise.all([
      db.from("id_pickup_slots").select("*").eq("is_active", true).gte("slot_date", today).order("slot_date").order("time_slot"),
      db.from("id_requests").select("preferred_date, time_slot, status").gte("preferred_date", today).neq("status", "cancelled"),
    ]);
    if (slotError) throw slotError;
    if (bookingError) throw bookingError;

    const counts = new Map();
    for (const booking of bookings || []) {
      const key = `${booking.preferred_date}::${booking.time_slot || ""}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const mapped = (slots || []).map((slot) => {
      const booked = counts.get(`${slot.slot_date}::${slot.time_slot}`) || 0;
      return { ...slot, booked_count: booked, remaining: Math.max(Number(slot.capacity || 1) - booked, 0), is_full: booked >= Number(slot.capacity || 1) };
    });
    res.json({ slots: mapped });
  } catch (error) { next(error); }
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
    res.json({ requests: data || [] });
  } catch (error) {
    next(error);
  }
});

router.post("/id", async (req, res, next) => {
  try {
    const purpose = `${req.body.purpose || ""}`.trim();
    const preferredDate = req.body.preferredDate || null;
    const timeSlot = `${req.body.timeSlot || ""}`.trim() || null;
    if (!purpose) {
      throw Object.assign(new Error("Purpose is required."), { status: 400 });
    }

    const db = requireSupabase();

    const { data: existingActive, error: existingError } = await db
      .from("id_requests")
      .select("id, status")
      .eq("user_id", req.currentUser.id)
      .in("status", ["submitted", "confirmed", "rescheduled", "ready_for_pickup"])
      .limit(1);
    if (existingError) throw existingError;
    if ((existingActive || []).length) {
      throw Object.assign(new Error("You already have an active Barangay ID request. Complete or cancel it before creating another."), { status: 409 });
    }

    if (preferredDate && timeSlot) {
      const { data: slot, error: slotError } = await db
        .from("id_pickup_slots")
        .select("*")
        .eq("slot_date", preferredDate)
        .eq("time_slot", timeSlot)
        .eq("is_active", true)
        .maybeSingle();
      if (slotError) throw slotError;
      if (!slot) throw Object.assign(new Error("The selected pickup slot is no longer available."), { status: 409 });

      const { count, error: countError } = await db
        .from("id_requests")
        .select("id", { count: "exact", head: true })
        .eq("preferred_date", preferredDate)
        .eq("time_slot", timeSlot)
        .neq("status", "cancelled");
      if (countError) throw countError;
      if ((count || 0) >= Number(slot.capacity || 1)) {
        throw Object.assign(new Error("That pickup slot is already full. Please choose another time."), { status: 409 });
      }
    }

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
    if (error) throw error;

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

const documentKinds = {
  clearance: { requestType: "Barangay Clearance", title: "Barangay Clearance" },
  residency: { requestType: "Certificate of Residency", title: "Certificate of Residency" },
  indigency: { requestType: "Certificate of Indigency", title: "Certificate of Indigency" },
};

router.get("/document/:requestId/:kind", async (req, res, next) => {
  try {
    const config = documentKinds[req.params.kind];
    if (!config) throw Object.assign(new Error("Unsupported document type."), { status: 404 });

    const db = requireSupabase();
    const { data: requestRow, error } = await db
      .from("requests")
      .select("*")
      .eq("id", req.params.requestId)
      .eq("user_id", req.currentUser.id)
      .single();
    if (error) throw error;

    if (requestRow.status !== "completed" || requestRow.request_type !== config.requestType) {
      throw Object.assign(new Error(`This ${config.title.toLowerCase()} is not ready for download yet.`), { status: 400 });
    }

    const doc = new PDFDocument({ margin: 48 });
    const safeName = config.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${safeName}-${requestRow.id}.pdf`);
    doc.pipe(res);

    doc.fontSize(18).text("BARANGAY IBA", { align: "center" });
    doc.fontSize(11).text("Silang, Cavite", { align: "center" });
    doc.moveDown(1.5);
    doc.fontSize(16).text(config.title, { align: "center" });
    doc.moveDown();
    doc.fontSize(11).text(`Resident: ${requestRow.resident_name}`);
    doc.text(`Purpose: ${requestRow.details}`);
    doc.text(`Date Issued: ${new Date().toLocaleDateString()}`);
    doc.moveDown();

    const bodyByKind = {
      clearance: "This certifies that the resident named above is a bona fide resident of Barangay Iba and is hereby granted this clearance for the stated purpose.",
      residency: "This certifies that the resident named above is a bona fide resident of Barangay Iba, Silang, Cavite, based on the barangay records available at the time of issuance.",
      indigency: "This certifies, based on the barangay records and the stated purpose of the request, that the resident named above requested a Certificate of Indigency from Barangay Iba.",
    };
    doc.text(bodyByKind[req.params.kind], { align: "justify" });
    doc.moveDown(3);
    doc.text("______________________________", { align: "right" });
    doc.text("Authorized Barangay Official", { align: "right" });
    doc.end();
  } catch (error) {
    next(error);
  }
});

export default router;
