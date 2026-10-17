import multer from "multer";
import { saveConcernPhoto,getConcernPhotoUrl } from "../lib/concernEvidence.js";
import { residentWriteLimiter, persistentLimit } from "../middleware/persistentLimit.js";
import express from "express";
import { requireSupabase } from "../lib/supabase.js";
import { requireAuth, requireCurrentUser, requireRole } from "../middleware/auth.js";
import { attachCaseHistories } from "../lib/caseHistory.js";
import { logAudit } from "../utils/audit.js";
import { complaintSubmissionError } from "../lib/concernLimits.js";
import { randomUUID } from "node:crypto";

const router = express.Router();
const evidenceUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1}});

router.use(requireAuth, requireCurrentUser(), requireRole("resident"));
router.use((req,res,next)=> ['POST','PATCH','PUT','DELETE'].includes(req.method) && req.currentUser?.role === 'resident' ? residentWriteLimiter(req,res,next) : next());

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
    const rawIncidentAt=String(req.body?.incidentAt||'').trim();
    const incidentAt=rawIncidentAt ? new Date(`${rawIncidentAt.slice(0,16)}:00+08:00`):null;
    if(rawIncidentAt && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(rawIncidentAt)||Number.isNaN(incidentAt.getTime())))
      throw Object.assign(new Error('Invalid incident date/time.'),{status:400});
    // p_resident_id comes from verified server-side authentication, never the client.
    // Atomic SQL handles eligibility, active category, row insert and Phase 1/6 triggers.
    const { data, error } = await requireSupabase().rpc("bgy_p105_submit_concern", {
      p_resident_id: req.currentUser.id,
      p_type: complaintType,
      p_details: details,
      p_operation_id: operationId,
      p_incident_purok:`${req.body?.incidentPurok||''}`.trim()||null,
      p_incident_location:`${req.body?.incidentLocation||''}`.trim()||null,
      p_incident_at:incidentAt?.toISOString()||null,
      p_respondent_name:`${req.body?.respondentName||''}`.trim()||null,
    });
    if (error) throw complaintSubmissionError(error);
    res.status(data?.replayed ? 200 : 201).json({ complaint: data.complaint, replayed: Boolean(data.replayed) });
  } catch (error) { next(error); }
});

router.post('/:complaintId/evidence', persistentLimit('resident-concern-photo',{max:5,windowSeconds:3600}), evidenceUpload.single('image'), async(req,res,next)=>{
 try {
  const db=requireSupabase();
  const {data:complaint,error}=await db.from('complaints').select('id,user_id,status').eq('id',req.params.complaintId).eq('user_id',req.currentUser.id).maybeSingle();
  if(error)throw error;
  if(!complaint)return res.status(404).json({message:'Concern not found.'});
  if(!req.file)return res.status(400).json({message:'Choose an incident photo.'});
  const document=await saveConcernPhoto({complaintId:complaint.id,uploaderId:req.currentUser.id,file:req.file});
  await logAudit({actorId:req.currentUser.id,actorRole:'resident',action:'add_concern_evidence',entityType:'complaint',entityId:complaint.id,details:{hasPhoto:true},req});
  res.status(201).json({evidence:document});
 }catch(error){next(error);}
});
router.get('/:complaintId/evidence',persistentLimit('resident-concern-evidence-view',{max:30,windowSeconds:3600}),async(req,res,next)=>{
 try{
  const db=requireSupabase();
  const {data:complaint,error}=await db.from('complaints').select('id').eq('id',req.params.complaintId).eq('user_id',req.currentUser.id).maybeSingle();
  if(error)throw error;
  if(!complaint)return res.status(404).json({message:'Concern not found.'});
  res.json({evidence:await getConcernPhotoUrl(complaint.id)});
 }catch(error){next(error);}
});

export default router;
