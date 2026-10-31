import express from "express";
import multer from "multer";
import { submissionLimiter } from "../middleware/persistentLimit.js";
import { createHash } from "node:crypto";
import {
  requireAuth,
  requireCurrentUser,
  requireRole,
} from "../middleware/auth.js";
import { requireSupabase } from "../lib/supabase.js";
import { normalizeRole } from "../utils/helpers.js";
import { logAudit } from "../utils/audit.js";
import { attachCaseHistories, getOperationId } from "../lib/caseHistory.js";
import {
  DOCUMENT_TYPES,
  documentError,
  approvalChecks,
  textValue,
  validDate,
  validateTemplateConfig,
} from "../lib/documentRules.js";
import {
  DOCUMENT_BUCKET,
  DOCX_MIME,
  normalizePhoto,
  validateWord,
  uploadPrivateDocument,
  downloadPrivateDocument,
  removeStagedFile,
} from "../lib/documentStorage.js";
import { generateWordDocument } from "../lib/wordDocuments.js";
import {
  buildDocumentNotification,
  sendDocumentNotification,
  performSend,
} from "../lib/documentNotifications.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 8, parts: 10 },
});
router.use(requireAuth, requireCurrentUser());
router.use(submissionLimiter);
const isAdmin = (req) =>
  ["admin", "super_admin"].includes(normalizeRole(req.currentUser.role));
export const rpcResult = ({ data, error }) => {
  if (error) {
    const status =
      error.code === "42501"
        ? 403
        : error.code === "P0002"
          ? 404
          : ["40001", "23505", "P0001"].includes(error.code)
            ? 409
            : 400;
    throw documentError(error.message, status, "DOCUMENT_OPERATION_FAILED");
  }
  return data;
};
export const ownedDocumentRequest = async (db, req, id) => {
  let q = db.from("requests").select("*").eq("id", id);
  if (!isAdmin(req)) q = q.eq("user_id", req.currentUser.id);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (!data) throw documentError("Document request not found.", 404);
  return data;
};
const getTemplate = async (db, id) => {
  if (!id) return null;
  const { data, error } = await db
    .from("document_templates")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
};
const residentFields =
  "id,first_name,middle_name,last_name,full_name,suffix,birthdate,sex,civil_status,citizenship,address,purok,house_number,street,barangay,municipality,province,residency_since,email,contact_number,profile_photo_path,photo_uploaded_at,photo_updated_at,updated_at";
const getResident = async (db, id) => {
  const { data, error } = await db
    .from("users")
    .select(residentFields)
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
};
const audit = async (req, action, id, details = {}) =>
  logAudit({
    actorId: req.currentUser.id,
    actorRole: normalizeRole(req.currentUser.role),
    action,
    entityType: "request",
    entityId: id,
    details,
  });
const binary = (res, buffer, mime, name) => {
  res.set({
    "Content-Type": mime,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    ...(name
      ? { "Content-Disposition": `attachment; filename="${name}"` }
      : {}),
  });
  res.send(buffer);
};
const noPaths = (record) => {
  const { storage_path, ...safe } = record;
  void storage_path;
  return safe;
};
const retireProfilePhoto = async (db, path) => {
  if (!path) return;
  const { data, error } = await db
    .from("requests")
    .select("id")
    .eq("verified_snapshot->>photoPath", path)
    .limit(1);
  if (error) {
    console.error("[PHOTO RETENTION CHECK]", error.code);
    return;
  }
  if (!data.length) await removeStagedFile(db, path);
};
const publicResident = (record) => {
  const { profile_photo_path, ...safe } = record;
  return { ...safe, hasPhoto: Boolean(profile_photo_path) };
};

router.get("/catalog", async (_req, res, next) => {
  try {
    const { data, error } = await requireSupabase()
      .from("document_templates")
      .select("*")
      .order("version", { ascending: false });
    if (error) throw error;
    res.json({
      types: DOCUMENT_TYPES.map((type) => {
        const t =
          data.find(
            (t) => t.document_type === type && t.approval_state === "approved",
          ) || data.find((t) => t.document_type === type);
        return {
          type,
          templateId: t?.id,
          approved: t?.approval_state === "approved",
          requiredBusinessFields: t?.config.requiredBusinessFields || [],
          requiresPhoto: [
            "Barangay Identification Card",
            "Certificate of Indigency",
            "Barangay Clearance",
          ].includes(type),
        };
      }),
    });
  } catch (e) {
    next(e);
  }
});
router.get("/profile", async (req, res, next) => {
  try {
    res.json({
      profile: publicResident(
        await getResident(requireSupabase(), req.currentUser.id),
      ),
    });
  } catch (e) {
    next(e);
  }
});
router.get(
  "/residents/:id/profile",
  requireRole("admin"),
  async (req, res, next) => {
    try {
      res.json({
        profile: publicResident(
          await getResident(requireSupabase(), req.params.id),
        ),
      });
    } catch (e) {
      next(e);
    }
  },
);
router.patch(
  "/residents/:id/profile",
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const db = requireSupabase();
      const current = await getResident(db, req.params.id);
      const updates = {};
      for (const key of [
        "first_name",
        "middle_name",
        "last_name",
        "suffix",
        "sex",
        "civil_status",
        "citizenship",
        "address",
        "purok",
        "house_number",
        "street",
        "barangay",
        "municipality",
        "province",
        "contact_number",
      ])
        if (Object.hasOwn(req.body, key))
          updates[key] = textValue(
            req.body[key],
            key === "address" ? 1000 : 180,
          );
      for (const key of ["birthdate", "residency_since"])
        if (Object.hasOwn(req.body, key)) {
          if (req.body[key] && !validDate(req.body[key]))
            throw documentError("Invalid profile date.");
          updates[key] = req.body[key] || null;
        }
      const merged = { ...current, ...updates };
      if (!merged.first_name || !merged.last_name || !merged.address)
        throw documentError(
          "First name, last name and complete address are required.",
        );
      updates.full_name = [
        merged.first_name,
        merged.middle_name,
        merged.last_name,
        merged.suffix,
      ]
        .filter(Boolean)
        .join(" ");
      updates.updated_at = new Date().toISOString();
      if (req.body.expectedUpdatedAt !== current.updated_at)
        throw documentError("Profile changed. Reload before editing.", 409);
      const { data, error } = await db
        .from("users")
        .update(updates)
        .eq("id", current.id)
        .eq("updated_at", current.updated_at)
        .select(residentFields)
        .maybeSingle();
      if (error) throw error;
      if (!data)
        throw documentError("Profile changed. Reload before editing.", 409);
      await audit(req, "update_document_resident_profile", current.id, {
        fields: Object.keys(updates),
      });
      res.json({ profile: publicResident(data) });
    } catch (e) {
      next(e);
    }
  },
);
const photoOwner = (req) => {
  const id = req.params.id || req.currentUser.id;
  if (id !== req.currentUser.id && !isAdmin(req))
    throw documentError("Access denied.", 403);
  return id;
};
for (const path of ["/profile/photo", "/residents/:id/photo"]) {
  router.get(path, async (req, res, next) => {
    try {
      const db = requireSupabase();
      const resident = await getResident(db, photoOwner(req));
      if (!resident.profile_photo_path)
        throw documentError("No resident photo on file.", 404);
      await audit(req, "view_resident_photo", resident.id);
      binary(
        res,
        await downloadPrivateDocument(db, resident.profile_photo_path),
        "image/png",
      );
    } catch (e) {
      next(e);
    }
  });
  router.post(path, upload.single("photo"), async (req, res, next) => {
    let storagePath;
    const db = requireSupabase();
    try {
      const id = photoOwner(req);
      const buffer = await normalizePhoto(req.file);
      const current = await getResident(db, id);
      storagePath = await uploadPrivateDocument(
        db,
        `photos/${id}`,
        buffer,
        "image/png",
      );
      const now = new Date().toISOString();
      const { data, error } = await db
        .from("users")
        .update({
          profile_photo_path: storagePath,
          photo_uploaded_at: current.photo_uploaded_at || now,
          photo_updated_at: now,
          updated_at: now,
        })
        .eq("id", id)
        .eq("updated_at", current.updated_at)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data)
        throw documentError("Photo changed during upload. Please retry.", 409);
      storagePath = null;
      // Keep portraits referenced by historical snapshots; remove other replaced objects.
      await retireProfilePhoto(db, current.profile_photo_path);
      await audit(req, "replace_resident_photo", id);
      res.status(201).json({ hasPhoto: true });
    } catch (e) {
      await removeStagedFile(db, storagePath);
      next(e);
    }
  });
  router.delete(path, async (req, res, next) => {
    try {
      const db = requireSupabase();
      const id = photoOwner(req);
      const current = await getResident(db, id);
      const { data, error } = await db
        .from("users")
        .update({
          profile_photo_path: null,
          photo_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("updated_at", current.updated_at)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw documentError("Profile changed. Retry.", 409);
      await retireProfilePhoto(db, current.profile_photo_path);
      await audit(req, "remove_resident_photo", id);
      res.json({ hasPhoto: false });
    } catch (e) {
      next(e);
    }
  });
}

router.get("/requests/:id", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const request = await ownedDocumentRequest(db, req, req.params.id);
    const [
      { data: files, error: ferror },
      { data: attachments, error: aerror },
    ] = await Promise.all([
      db
        .from("generated_documents")
        .select("*")
        .eq("request_id", request.id)
        .order("version_number", { ascending: false }),
      db
        .from("request_attachments")
        .select("*")
        .eq("request_id", request.id)
        .order("created_at"),
    ]);
    if (ferror || aerror) throw ferror || aerror;
    const [history] = await attachCaseHistories(db, "request", [request], {
      residentVisible: !isAdmin(req),
    });
    if (!isAdmin(req))
      return res.json({
        request: {
          ...history,
          verified_snapshot: undefined,
          review_checks: undefined,
        },
        attachments: attachments.map(noPaths),
      });
    const { data: logs, error } = await db
      .from("notification_logs")
      .select("*")
      .eq("request_id", request.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const resident = await getResident(db, request.user_id);
    res.json({
      request: history,
      resident: publicResident(resident),
      files: files.map(noPaths),
      attachments: attachments.map(noPaths),
      notificationLogs: logs,
    });
  } catch (e) {
    next(e);
  }
});

export const transitionDocument = async (req, res, next) => {
  try {
    const db = requireSupabase();
    const request = await ownedDocumentRequest(db, req, req.params.id);
    const extra = {};
    const status = req.body.status || request.status;
    if (status === "approved" && request.status !== "approved") {
      const resident = await getResident(db, request.user_id);
      const template = await getTemplate(db, req.body.templateId);
      let photoPath = resident.profile_photo_path;
      if (req.body.photoAttachmentId) {
        const { data, error } = await db
          .from("request_attachments")
          .select("*")
          .eq("id", req.body.photoAttachmentId)
          .eq("request_id", request.id)
          .eq("kind", "photo")
          .maybeSingle();
        if (error) throw error;
        if (!data)
          throw documentError("Select a photo attached to this request.");
        photoPath = data.storage_path;
      }
      extra.verified_snapshot = approvalChecks(
        request,
        resident,
        template,
        req.body,
        photoPath,
      );
      extra.review_checks = req.body.reviewChecks;
      extra.template_id = template.id;
      extra.issue_date = req.body.issueDate;
      extra.resident_updated_at = resident.updated_at;
      const months = template.config.validityMonths;
      if (months) {
        const date = new Date(`${req.body.issueDate}T00:00:00Z`);
        const day = date.getUTCDate();
        date.setUTCMonth(date.getUTCMonth() + months, 1);
        date.setUTCDate(
          Math.min(
            day,
            new Date(
              Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
            ).getUTCDate(),
          ),
        );
        extra.expiration_date = date.toISOString().slice(0, 10);
      }
    }
    const result = rpcResult(
      await db.rpc("bgy_document_transition", {
        p_id: request.id,
        p_actor: req.currentUser.id,
        p_version: req.body.expectedVersion,
        p_status: status,
        p_note: textValue(req.body.adminNote, 2000),
        p_extra: extra,
        p_operation: getOperationId(req.body.operationId),
      }),
    );
    await audit(req, "document_request_transition", request.id, {
      from: request.status,
      to: result.status,
    });
    res.json({ request: result });
  } catch (e) {
    next(e);
  }
};
router.patch(
  "/requests/:id/transition",
  requireRole("admin"),
  transitionDocument,
);

router.post(
  "/requests/:id/attachments",
  upload.single("image"),
  async (req, res, next) => {
    let storagePath;
    const db = requireSupabase();
    try {
      const request = await ownedDocumentRequest(db, req, req.params.id);
      const buffer = await normalizePhoto(req.file);
      if (!["photo", "supporting"].includes(req.body.kind))
        throw documentError("Choose photo or supporting image.");
      storagePath = await uploadPrivateDocument(
        db,
        `requests/${request.id}`,
        buffer,
        "image/png",
      );
      const attachment = rpcResult(
        await db.rpc("bgy_document_attach", {
          p_id: request.id,
          p_actor: req.currentUser.id,
          p_version: Number(req.body.expectedVersion),
          p_file: { storage_path: storagePath, kind: req.body.kind },
        }),
      );
      storagePath = null;
      await audit(req, "attach_request_image", request.id, {
        attachmentId: attachment.id,
      });
      res.status(201).json({ attachment: noPaths(attachment) });
    } catch (e) {
      await removeStagedFile(db, storagePath);
      next(e);
    }
  },
);
router.get("/attachments/:id", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db
      .from("request_attachments")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw documentError("Image not found.", 404);
    await ownedDocumentRequest(db, req, data.request_id);
    await audit(req, "view_request_image", data.request_id, {
      attachmentId: data.id,
    });
    binary(
      res,
      await downloadPrivateDocument(db, data.storage_path),
      "image/png",
    );
  } catch (e) {
    next(e);
  }
});
router.delete("/attachments/:id", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const item = rpcResult(
      await db.rpc("bgy_document_remove_attachment", {
        p_id: req.params.id,
        p_actor: req.currentUser.id,
        p_version: req.body.expectedVersion,
      }),
    );
    await removeStagedFile(db, item.storage_path);
    await audit(req, "remove_request_image", item.request_id, {
      attachmentId: item.id,
    });
    res.json({ removed: true });
  } catch (e) {
    next(e);
  }
});
router.get(
  "/requests/:id/photo",
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const db = requireSupabase();
      const request = await ownedDocumentRequest(db, req, req.params.id);
      const path = request.verified_snapshot?.photoPath;
      if (!path)
        throw documentError(
          "No approved photo is attached to this issuance.",
          404,
        );
      await audit(req, "view_verified_document_photo", request.id);
      binary(res, await downloadPrivateDocument(db, path), "image/png");
    } catch (e) {
      next(e);
    }
  },
);

const saveWord = async (req, res, next) => {
  let storagePath;
  const db = requireSupabase();
  try {
    const request = await ownedDocumentRequest(db, req, req.params.id);
    if (request.status !== "approved")
      throw documentError(
        "Only approved requests can generate or upload Word versions.",
        409,
      );
    const template = await getTemplate(db, request.template_id);
    if (template?.approval_state !== "approved")
      throw documentError(
        "An approved template is required.",
        409,
        "OFFICIAL_DOCUMENT_TEMPLATE_REQUIRED",
      );
    const finalize = req.body.finalize === true || req.body.finalize === "true";
    if (
      finalize &&
      req.body.confirmReviewed !== true &&
      req.body.confirmReviewed !== "true"
    )
      throw documentError(
        "Review the Word document and explicitly confirm it is prepared.",
      );
    let buffer,
      source = "generated";
    if (req.file) {
      buffer = await validateWord(req.file);
      source = "uploaded";
    } else if (req.body.sourceDocumentId) {
      const { data, error } = await db
        .from("generated_documents")
        .select("*")
        .eq("id", req.body.sourceDocumentId)
        .eq("request_id", request.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw documentError("Document version not found.", 404);
      if (data.source === "uploaded") {
        buffer = await downloadPrivateDocument(db, data.storage_path);
        source = "uploaded";
      }
    }
    if (!buffer) {
      const photo = request.verified_snapshot.photoPath
        ? await downloadPrivateDocument(db, request.verified_snapshot.photoPath)
        : null;
      buffer = await generateWordDocument({
        request,
        template,
        photo,
        final: finalize,
      });
    }
    storagePath = await uploadPrivateDocument(
      db,
      `generated/${request.id}`,
      buffer,
      DOCX_MIME,
    );
    const id = getOperationId();
    const document = rpcResult(
      await db.rpc("bgy_document_save_version", {
        p_id: request.id,
        p_actor: req.currentUser.id,
        p_version: Number(req.body.expectedVersion),
        p_file: {
          id,
          storage_path: storagePath,
          sha256: createHash("sha256").update(buffer).digest("hex"),
          source,
        },
        p_finalize: finalize,
        p_operation: getOperationId(req.body.operationId),
      }),
    );
    storagePath = null;
    await audit(
      req,
      finalize ? "prepare_document" : "save_document_version",
      request.id,
      { documentId: id, source, version: document.version_number },
    );
    res.status(201).json({ document: noPaths(document) });
  } catch (e) {
    await removeStagedFile(db, storagePath);
    next(e);
  }
};
router.post("/requests/:id/generate", requireRole("admin"), saveWord);
router.post(
  "/requests/:id/word",
  requireRole("admin"),
  upload.single("document"),
  saveWord,
);
router.get("/files/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db
      .from("generated_documents")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw documentError("Document version not found.", 404);
    const request = await ownedDocumentRequest(db, req, data.request_id);
    await audit(req, "download_document_version", request.id, {
      documentId: data.id,
      version: data.version_number,
    });
    const name = `${request.request_type.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${request.id}-v${data.version_number}.docx`;
    binary(
      res,
      await downloadPrivateDocument(db, data.storage_path),
      DOCX_MIME,
      name,
    );
  } catch (e) {
    next(e);
  }
});

const notificationContext = async (db, req) => {
  const request = await ownedDocumentRequest(db, req, req.params.id);
  return {
    request,
    resident: await getResident(db, request.user_id),
    template: await getTemplate(db, request.template_id),
    type: req.body.type,
    customMessage: req.body.customMessage,
  };
};
router.post(
  "/requests/:id/notification-preview",
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const message = buildDocumentNotification(
        await notificationContext(requireSupabase(), req),
      );
      res.json({
        message,
        previewHash: createHash("sha256")
          .update(JSON.stringify(message))
          .digest("hex"),
      });
    } catch (e) {
      next(e);
    }
  },
);
router.post(
  "/requests/:id/notify",
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const db = requireSupabase();
      const context = await notificationContext(db, req);
      const log = await sendDocumentNotification(db, {
        ...context,
        actorId: req.currentUser.id,
        idempotencyKey: getOperationId(req.body.idempotencyKey),
        previewHash: req.body.previewHash,
      });
      await audit(req, "notify_document_resident", context.request.id, {
        notificationId: log.id,
        status: log.attempt_status,
      });
      res.json({ notification: log });
    } catch (e) {
      next(e);
    }
  },
);
router.post(
  "/notifications/:id/retry",
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const db = requireSupabase();
      const { data: log, error } = await db
        .from("notification_logs")
        .select("*")
        .eq("id", req.params.id)
        .maybeSingle();
      if (error) throw error;
      if (!log) throw documentError("Notification not found.", 404);
      // Reuse the same provider idempotency key and exact reviewed message within Resend's 24-hour window.
      if (
        !["failed", "sending"].includes(log.attempt_status) ||
        Date.now() - new Date(log.created_at).getTime() > 23 * 3600000 ||
        Date.now() - new Date(log.updated_at).getTime() < 15000
      )
        throw documentError(
          "Retry is unavailable. Wait 15 seconds, or preview a new notification after 23 hours.",
          409,
        );
      const request = await ownedDocumentRequest(db, req, log.request_id);
      if (
        !log.message_snapshot.text.includes(
          `Current status: ${request.status.replace(/_/g, " ")}`,
        )
      )
        throw documentError("Status changed. Review a new notification.", 409);
      const { data: locked, error: lockError } = await db
        .from("notification_logs")
        .update({
          attempt_status: "sending",
          retry_count: log.retry_count + 1,
          updated_at: new Date().toISOString(),
          initiated_by: req.currentUser.id,
        })
        .eq("id", log.id)
        .eq("updated_at", log.updated_at)
        .select("*")
        .maybeSingle();
      if (lockError) throw lockError;
      if (!locked)
        throw documentError(
          "Another administrator is retrying this notification.",
          409,
        );
      const notification = await performSend(db, locked);
      await audit(req, "retry_document_notification", request.id, {
        notificationId: log.id,
        status: notification.attempt_status,
      });
      res.json({ notification });
    } catch (e) {
      next(e);
    }
  },
);

router.get("/templates", requireRole("admin"), async (_req, res, next) => {
  try {
    const { data, error } = await requireSupabase()
      .from("document_templates")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ templates: data });
  } catch (e) {
    next(e);
  }
});
router.post(
  "/templates",
  requireRole("super_admin"),
  async (req, res, next) => {
    try {
      if (!DOCUMENT_TYPES.includes(req.body.documentType))
        throw documentError("Unsupported document type.");
      const config = validateTemplateConfig(req.body.config);
      const db = requireSupabase();
      const { data: last, error: findError } = await db
        .from("document_templates")
        .select("version")
        .eq("document_type", req.body.documentType)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (findError) throw findError;
      const approved = req.body.approve === true;
      if (approved && (!config.pickupInstructions || !config.officeContact))
        throw documentError(
          "Approved templates require official pickup and contact information.",
        );
      const { data, error } = await db
        .from("document_templates")
        .insert({
          document_type: req.body.documentType,
          version: (last?.version || 0) + 1,
          display_name: req.body.documentType,
          config,
          approval_state: approved ? "approved" : "draft",
          created_by: req.currentUser.id,
          updated_by: req.currentUser.id,
          approved_by: approved ? req.currentUser.id : null,
          approved_at: approved ? new Date().toISOString() : null,
        })
        .select("*")
        .single();
      if (error) {
        if (error.code === "23505")
          throw documentError(
            "Another template version was saved. Refresh and retry.",
            409,
          );
        throw error;
      }
      await audit(req, "create_document_template_version", data.id, {
        type: data.document_type,
        version: data.version,
        approved,
      });
      res.status(201).json({ template: data });
    } catch (e) {
      next(e);
    }
  },
);
export default router;
