import express from "express";
import multer from "multer";
import { requireSupabase } from "../lib/supabase.js";
import { uploadAsset } from "../lib/storage.js";
import { requireAuth, requireCurrentUser } from "../middleware/auth.js";
import { logAudit } from "../utils/audit.js";
import { normalizeRole } from "../utils/helpers.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(requireAuth, requireCurrentUser());

router.get("/mine", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 8)));
    const status = `${req.query.status || "all"}`.trim().toLowerCase();

    let query = db
      .from("project_suggestions")
      .select("*", { count: "exact" })
      .eq("user_id", req.currentUser.id)
      .order("created_at", { ascending: false });

    if (["pending", "approved", "rejected"].includes(status)) query = query.eq("status", status);

    // Derived "won" state lives in community_projects, so enrich before slicing that filter.
    let rows;
    let baseCount = 0;
    if (status === "won") {
      const result = await query;
      if (result.error) throw result.error;
      rows = result.data || [];
      baseCount = rows.length;
    } else {
      const from = (page - 1) * limit;
      const result = await query.range(from, from + limit - 1);
      if (result.error) throw result.error;
      rows = result.data || [];
      baseCount = result.count || 0;
    }

    const ids = rows.map((row) => row.id);
    let optionRows = [];
    let projectRows = [];

    if (ids.length) {
      const optionResult = await db
        .from("election_options")
        .select("id, election_id, source_suggestion_id, votes_count, elections!election_options_election_id_fkey(id, title, status, starts_at, ends_at)")
        .in("source_suggestion_id", ids);
      if (!optionResult.error) optionRows = optionResult.data || [];

      const projectResult = await db
        .from("community_projects")
        .select("id, source_suggestion_id, election_id, title, status, progress_percentage, updated_at")
        .in("source_suggestion_id", ids);
      if (!projectResult.error) projectRows = projectResult.data || [];
    }

    const enriched = rows.map((row) => {
      const votingOptions = optionRows.filter((option) => option.source_suggestion_id === row.id);
      const project = projectRows.find((item) => item.source_suggestion_id === row.id) || null;
      const closedOption = votingOptions.find((option) => option.elections?.status === "closed");
      const liveOption = votingOptions.find((option) => option.elections?.status === "live");
      let votingOutcome = null;
      if (project) votingOutcome = "won";
      else if (closedOption) votingOutcome = "not_selected";
      else if (liveOption) votingOutcome = "in_voting";
      else if (votingOptions.length) votingOutcome = "scheduled";
      return { ...row, votingOutcome, project, votingOptions };
    });

    let output = enriched;
    let total = baseCount;
    if (status === "won") {
      const winners = enriched.filter((row) => row.votingOutcome === "won");
      total = winners.length;
      output = winners.slice((page - 1) * limit, page * limit);
    }

    res.json({
      suggestions: output,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", upload.single("image"), async (req, res, next) => {
  try {
    if (normalizeRole(req.currentUser.role) !== "resident") {
      throw Object.assign(new Error("Only resident accounts can submit suggestions."), { status: 403 });
    }

    const title = `${req.body.title || ""}`.trim();
    const description = `${req.body.description || ""}`.trim();
    if (!title || !description) {
      throw Object.assign(new Error("Title and description are required."), { status: 400 });
    }

    if (req.file && !`${req.file.mimetype}`.startsWith("image/")) {
      throw Object.assign(new Error("Suggestion attachment must be an image file."), { status: 400 });
    }

    const imageUrl = await uploadAsset({
      file: req.file,
      folder: "project-suggestions",
      prefix: `${req.currentUser.id}-suggestion`,
    });

    const db = requireSupabase();
    const { data, error } = await db
      .from("project_suggestions")
      .insert({
        user_id: req.currentUser.id,
        title,
        description,
        image_url: imageUrl,
        status: "pending",
      })
      .select("*")
      .single();
    if (error) throw error;

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "create_project_suggestion",
      entityType: "project_suggestion",
      entityId: data.id,
      details: { title, hasImage: Boolean(imageUrl) },
    });

    res.status(201).json({ suggestion: data });
  } catch (error) {
    next(error);
  }
});

export default router;

