import { residentWriteLimiter, persistentLimit } from "../middleware/persistentLimit.js";
import express from "express";
import { requireSupabase } from "../lib/supabase.js";
import { requireAuth, requireCurrentUser } from "../middleware/auth.js";
import { logAudit } from "../utils/audit.js";
import { normalizeRole } from "../utils/helpers.js";
import { attachCaseHistories } from "../lib/caseHistory.js";
import { getOperationId } from "../lib/caseHistory.js";
import { validateApplication, documentError } from "../lib/documentRules.js";
import { rpcResult, ownedDocumentRequest } from "./documents.js";
import { downloadPrivateDocument, DOCX_MIME } from '../lib/documentStorage.js';

const router = express.Router();

router.use(requireAuth, requireCurrentUser());
router.use(residentWriteLimiter);

router.get("/mine", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db
      .from("requests")
      .select("*, request_timeline(*)")
      .eq("user_id", req.currentUser.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const visible=(data||[]).map(({verified_snapshot,review_checks,generated_document_id,...row})=>{
      void verified_snapshot; void review_checks; void generated_document_id; return row;
    });
    res.json({ requests: await attachCaseHistories(db, "request", visible, { residentVisible: true }) });
  } catch (error) {
    next(error);
  }
});

router.post("/", persistentLimit("resident-document-request", {max:3,windowSeconds:3600}), async (req, res, next) => {
  try {
    if (normalizeRole(req.currentUser.role) !== "resident") {
      throw Object.assign(new Error("Only resident accounts can submit requests."), { status: 403 });
    }

    const db = requireSupabase();
    const {data: templates,error: templateError}=await db.from('document_templates').select('config').eq('document_type',req.body.requestType).eq('approval_state','approved').order('version',{ascending:false}).limit(1);
    if(templateError)throw templateError;
    const application = validateApplication(req.body,templates?.[0]?.config);
    const requestType = application.request_type;
    const details = `${req.body.details || ""}`.trim();
    const copiesRequested=Number(req.body.copiesRequested||1);
    if(!Number.isInteger(copiesRequested)||copiesRequested<1||copiesRequested>10)throw Object.assign(new Error('Copies must be between 1 and 10.'),{status:400});
    const purposeCategory=`${req.body.purposeCategory||'Other'}`.trim();
    if(!['Employment','School','Loan','Government','Personal','Other'].includes(purposeCategory))throw Object.assign(new Error('Invalid request purpose.'),{status:400});
    if (!requestType || !details) {
      throw Object.assign(new Error("Request type and details are required."), { status: 400 });
    }

    const residentName =
      req.currentUser.full_name ||
      [req.currentUser.first_name, req.currentUser.middle_name, req.currentUser.last_name].filter(Boolean).join(" ");

    const payload = {
      user_id: req.currentUser.id,
      resident_name: residentName,
      request_type: requestType,
      document_data: application.document_data,
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

    const { error: timelineError } = await db.from("request_timeline").insert({
      request_id: data.id,
      status: "submitted",
      note: "Request submitted.",
    });
    if (timelineError) console.error('[REQUEST TIMELINE]', timelineError.code);

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
    if (normalizeRole(req.currentUser.role) !== 'resident') throw documentError('Only residents can submit appointments.',403);
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

router.patch('/:id', async(req,res,next)=>{try {
 const db=requireSupabase();const current=await ownedDocumentRequest(db,req,req.params.id);
 if(normalizeRole(req.currentUser.role)!=='resident')throw documentError('Use the administrative processing action.',403);
 const {data:templates,error:templateError}=await db.from('document_templates').select('config').eq('document_type',current.request_type).eq('approval_state','approved').order('version',{ascending:false}).limit(1);
 if(templateError)throw templateError;
 const extra=req.body.status==='cancelled'?{}:validateApplication({...req.body,requestType:current.request_type},templates?.[0]?.config);
 const request=rpcResult(await db.rpc('bgy_document_transition',{p_id:current.id,p_actor:req.currentUser.id,p_version:req.body.expectedVersion,p_status:req.body.status==='cancelled'?'cancelled':'submitted',p_note:'Resident updated the application.',p_extra:extra,p_operation:getOperationId(req.body.operationId)}));
 res.json({request});
}catch(e){next(e);}});

// Legacy download URL remains guarded. Internal Word files are available only through the staff endpoint.
router.get('/document/:requestId/clearance', async(req,res,next)=>{try {
 const db=requireSupabase();const request=await ownedDocumentRequest(db,req,req.params.requestId);
 if(!['admin','super_admin'].includes(normalizeRole(req.currentUser.role)))throw documentError('Official Word files are restricted to authorized staff.',403);
 if(request.request_type!=='Barangay Clearance')throw documentError('Clearance request not found.',404);
 if(!['document_prepared','ready_for_pickup','claimed'].includes(request.status)||!request.generated_document_id)throw documentError('An approved and prepared official document is required.',409,'OFFICIAL_DOCUMENT_TEMPLATE_REQUIRED');
 const {data:file,error}=await db.from('generated_documents').select('*').eq('id',request.generated_document_id).eq('request_id',request.id).maybeSingle();
 if(error)throw error;if(!file?.finalized_at)throw documentError('Prepared Word document not found.',409,'OFFICIAL_DOCUMENT_TEMPLATE_REQUIRED');
 const buffer=await downloadPrivateDocument(db,file.storage_path);
 await logAudit({actorId:req.currentUser.id,actorRole:normalizeRole(req.currentUser.role),action:'download_final_clearance',entityType:'request',entityId:request.id,details:{documentId:file.id}});
 res.set({'Content-Type':DOCX_MIME,'Content-Disposition':`attachment; filename="barangay-clearance-${request.id}-v${file.version_number}.docx"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(buffer);
}catch(e){next(e);}});

export default router;


