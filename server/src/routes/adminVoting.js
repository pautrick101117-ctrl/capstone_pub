import express from "express";
import multer from "multer";
import { requireSupabase } from "../lib/supabase.js";
import { uploadAsset } from "../lib/storage.js";
import { logAudit } from "../utils/audit.js";
import { normalizeRole } from "../utils/helpers.js";
import {
  activateElection,
  closeElection,
  createCommunityProjectFromElection,
  createRunoffElection,
  finalizeElection,
  getCommunityProjects,
  getElectionMetrics,
  getElectionMonitoring,
  snapshotEligibleVoters,
  synchronizeElectionStatuses,
} from "../services/electionService.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const ELECTION_EDITABLE_STATUSES = new Set(["draft", "scheduled", "live", "cancelled"]);
const SUGGESTION_REVIEW_STATUSES = new Set(["submitted", "under_review", "needs_revision", "approved", "rejected"]);
const PUROK_OPTIONS = new Set(["Purok 1", "Purok 2", "Purok 3", "Purok 4", "Purok 5", "Purok 6"]);

const requireValue = (value, message) => {
  if (!value) throw Object.assign(new Error(message), { status: 400 });
};

const normalizeElectionDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw Object.assign(new Error("Voting dates must be valid date and time values."), { status: 400 });
  }
  return date.toISOString();
};

const normalizeElectionOptions = (items = []) =>
  (items || [])
    .map((option) => ({
      name: `${option.name || ""}`.trim(),
      description: `${option.description || ""}`.trim(),
      sourceSuggestionId: option.sourceSuggestionId || option.source_suggestion_id || null,
      imageUrl: option.imageUrl || option.image_url || null,
    }))
    .filter((option) => option.name);

const sameElectionOptions = (left = [], right = []) => {
  const normalize = (items) =>
    items.map((item) => [item.name || "", item.description || "", item.sourceSuggestionId || item.source_suggestion_id || ""].join("\n"));
  const a = normalize(left);
  const b = normalize(right);
  return a.length === b.length && a.every((item, index) => item === b[index]);
};

const validateSuggestions = async (db, options) => {
  const ids = [...new Set(options.map((option) => option.sourceSuggestionId).filter(Boolean))];
  if (!ids.length) return;

  const { data, error } = await db.from("project_suggestions").select("id, status").in("id", ids);
  if (error) throw error;
  if ((data || []).length !== ids.length) {
    throw Object.assign(new Error("One or more selected project suggestions no longer exist."), { status: 400 });
  }
  const invalid = (data || []).find((suggestion) => !["approved", "included_in_voting"].includes(suggestion.status));
  if (invalid) {
    throw Object.assign(new Error("Only approved project suggestions can be used as voting options."), { status: 400 });
  }
};

router.get("/suggestions", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db
      .from("project_suggestions")
      .select("*, users!project_suggestions_user_id_fkey(full_name, first_name, last_name, purok)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ suggestions: data || [] });
  } catch (error) {
    next(error);
  }
});

router.patch("/suggestions/:id", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const status = `${req.body.status || ""}`.trim();
    const adminFeedback = `${req.body.adminFeedback || req.body.admin_feedback || ""}`.trim();
    requireValue(status, "Status is required.");
    if (!SUGGESTION_REVIEW_STATUSES.has(status)) {
      throw Object.assign(new Error("Invalid suggestion review status."), { status: 400 });
    }
    if (["needs_revision", "rejected"].includes(status) && !adminFeedback) {
      throw Object.assign(new Error("Provide feedback so the resident knows what needs to change."), { status: 400 });
    }

    const now = new Date().toISOString();
    const { data, error } = await db
      .from("project_suggestions")
      .update({
        status,
        admin_feedback: adminFeedback,
        reviewed_by: req.currentUser.id,
        reviewed_at: now,
        updated_at: now,
      })
      .eq("id", req.params.id)
      .select("*")
      .single();
    if (error) throw error;

    if (data.user_id) {
      await db.from("notifications").insert({
        user_id: data.user_id,
        title: "Project suggestion reviewed",
        body: `Your suggestion “${data.title}” is now ${status.replaceAll("_", " ")}.${adminFeedback ? ` Feedback: ${adminFeedback}` : ""}`,
        kind: status === "approved" ? "success" : status === "rejected" ? "warning" : "info",
        broadcast: false,
      });
    }

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "review_project_suggestion",
      entityType: "project_suggestion",
      entityId: req.params.id,
      details: { status, adminFeedback },
    });

    res.json({ suggestion: data });
  } catch (error) {
    next(error);
  }
});

router.get("/elections", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    await synchronizeElectionStatuses(db);
    const { data, error } = await db.from("elections").select("id").order("created_at", { ascending: false });
    if (error) throw error;
    const elections = [];
    for (const row of data || []) elections.push(await getElectionMetrics(db, row.id));
    res.json({ elections });
  } catch (error) {
    next(error);
  }
});

// Compatibility endpoint used by older UI code.
router.get("/election", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    await synchronizeElectionStatuses(db);
    const { data: election, error } = await db.from("elections").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!election) return res.json({ election: null, options: [] });
    const { data: options, error: optionError } = await db.from("election_options").select("*").eq("election_id", election.id).order("created_at");
    if (optionError) throw optionError;
    res.json({ election, options: options || [] });
  } catch (error) {
    next(error);
  }
});

router.put("/election", upload.single("image"), async (req, res, next) => {
  try {
    const db = requireSupabase();
    const rawElection = req.body.election ? JSON.parse(req.body.election) : req.body;
    const rawOptions = req.body.options ? JSON.parse(req.body.options) : [];
    requireValue(rawElection?.title, "Voting title is required.");

    const status = rawElection.status || "draft";
    if (!ELECTION_EDITABLE_STATUSES.has(status)) {
      throw Object.assign(new Error("Use the dedicated close/finalize/archive actions for completed elections."), { status: 400 });
    }

    const options = normalizeElectionOptions(rawOptions);
    if (["scheduled", "live"].includes(status) && options.length < 2) {
      throw Object.assign(new Error("At least two approved project suggestions are required before publishing voting."), { status: 400 });
    }
    await validateSuggestions(db, options);

    const startsAt = normalizeElectionDate(rawElection.startsAt || rawElection.starts_at);
    const endsAt = normalizeElectionDate(rawElection.endsAt || rawElection.ends_at);
    if (["scheduled", "live"].includes(status)) {
      requireValue(startsAt, "Voting open date and time are required.");
      requireValue(endsAt, "Voting close date and time are required.");
      if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
        throw Object.assign(new Error("Voting close time must be after the opening time."), { status: 400 });
      }
      if (new Date(endsAt).getTime() <= Date.now()) {
        throw Object.assign(new Error("Voting close time must be in the future."), { status: 400 });
      }
      if (status === "scheduled" && new Date(startsAt).getTime() <= Date.now()) {
        throw Object.assign(new Error("Scheduled voting must start in the future. Use Start Now to open it immediately."), { status: 400 });
      }
      if (status === "live" && new Date(startsAt).getTime() > Date.now()) {
        throw Object.assign(new Error("Live voting cannot have a future opening time. Use Scheduled instead."), { status: 400 });
      }
    }

    const imageUrl = req.file
      ? await uploadAsset({ file: req.file, folder: "elections", prefix: rawElection.title })
      : rawElection.imageUrl || rawElection.image_url || null;

    let existing = null;
    let existingOptions = [];
    let voteCount = 0;
    if (rawElection.id) {
      const [previousResult, optionsResult, votesResult] = await Promise.all([
        db.from("elections").select("*").eq("id", rawElection.id).maybeSingle(),
        db.from("election_options").select("name, description, source_suggestion_id, image_url").eq("election_id", rawElection.id).order("created_at"),
        db.from("votes").select("id", { count: "exact", head: true }).eq("election_id", rawElection.id),
      ]);
      if (previousResult.error) throw previousResult.error;
      if (optionsResult.error) throw optionsResult.error;
      if (votesResult.error) throw votesResult.error;
      existing = previousResult.data;
      existingOptions = normalizeElectionOptions(optionsResult.data || []);
      voteCount = votesResult.count || 0;
    }

    if (existing && ["closed", "finalized", "archived"].includes(existing.status)) {
      throw Object.assign(new Error("Closed or finalized elections are locked from editing."), { status: 409 });
    }

    if (voteCount > 0) {
      if (!sameElectionOptions(existingOptions, options)) {
        throw Object.assign(new Error("Voting options cannot be changed after votes have been recorded."), { status: 409 });
      }
      const materiallyChanged =
        `${existing.title || ""}` !== `${rawElection.title || ""}`.trim() ||
        `${existing.description || ""}` !== `${rawElection.description || ""}` ||
        new Date(existing.starts_at || 0).getTime() !== new Date(startsAt || 0).getTime();
      if (materiallyChanged) {
        throw Object.assign(new Error("Title, description, opening time, and options are locked after voting begins."), { status: 409 });
      }
      if (existing.ends_at && endsAt && new Date(endsAt).getTime() < new Date(existing.ends_at).getTime()) {
        throw Object.assign(new Error("Closing time cannot be shortened after votes have been recorded."), { status: 409 });
      }
    }

    const now = new Date().toISOString();
    const payload = {
      title: `${rawElection.title || ""}`.trim(),
      description: `${rawElection.description || ""}`.trim(),
      status,
      starts_at: startsAt,
      ends_at: endsAt,
      image_url: imageUrl,
      source_suggestion_id: rawElection.sourceSuggestionId || options[0]?.sourceSuggestionId || null,
      results_visibility: rawElection.resultsVisibility || rawElection.results_visibility || "after_close",
      updated_at: now,
    };

    let saved;
    if (rawElection.id) {
      const { data, error } = await db.from("elections").update(payload).eq("id", rawElection.id).select("*").single();
      if (error) throw error;
      saved = data;
    } else {
      const { data, error } = await db.from("elections").insert(payload).select("*").single();
      if (error) throw error;
      saved = data;
    }

    if (voteCount === 0) {
      const { error: deleteError } = await db.from("election_options").delete().eq("election_id", saved.id);
      if (deleteError) throw deleteError;
      if (options.length) {
        const { error: insertError } = await db.from("election_options").insert(
          options.map((option) => ({
            election_id: saved.id,
            name: option.name,
            description: option.description,
            source_suggestion_id: option.sourceSuggestionId || null,
            image_url: option.imageUrl || null,
            votes_count: 0,
          }))
        );
        if (insertError) throw insertError;
      }
    }

    if (["scheduled", "live"].includes(status)) {
      await snapshotEligibleVoters(db, saved.id);
      const selectedSuggestionIds = options.map((option) => option.sourceSuggestionId).filter(Boolean);
      if (selectedSuggestionIds.length) {
        await db
          .from("project_suggestions")
          .update({ status: "included_in_voting", updated_at: now })
          .in("id", selectedSuggestionIds)
          .eq("status", "approved");
      }
    }

    if (status === "live" && existing?.status !== "live") {
      saved = await activateElection(db, saved, {
        id: req.currentUser.id,
        role: normalizeRole(req.currentUser.role),
      });
    }

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: rawElection.id ? "update_election" : "create_election",
      entityType: "election",
      entityId: saved.id,
      details: { status, startsAt, endsAt, resultsVisibility: payload.results_visibility },
    });

    res.json({ election: saved });
  } catch (error) {
    next(error);
  }
});


router.delete("/elections/:id", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: election, error } = await db.from("elections").select("id, status").eq("id", req.params.id).single();
    if (error) throw error;
    if (election.status !== "draft") {
      throw Object.assign(new Error("Only draft elections can be deleted."), { status: 400 });
    }
    const { count, error: voteError } = await db.from("votes").select("id", { count: "exact", head: true }).eq("election_id", req.params.id);
    if (voteError) throw voteError;
    if ((count || 0) > 0) throw Object.assign(new Error("An election with recorded votes cannot be deleted."), { status: 409 });
    const { error: deleteError } = await db.from("elections").delete().eq("id", req.params.id);
    if (deleteError) throw deleteError;
    await logAudit({ actorId: req.currentUser.id, actorRole: normalizeRole(req.currentUser.role), action: "delete_draft_election", entityType: "election", entityId: req.params.id, details: {} });
    res.json({ message: "Draft election deleted." });
  } catch (error) { next(error); }
});

router.post("/elections/:id/archive", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: election, error } = await db.from("elections").select("*").eq("id", req.params.id).single();
    if (error) throw error;
    if (election.status !== "finalized") throw Object.assign(new Error("Only finalized elections can be archived."), { status: 400 });
    const { data, error: updateError } = await db.from("elections").update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", req.params.id).select("*").single();
    if (updateError) throw updateError;
    await logAudit({ actorId: req.currentUser.id, actorRole: normalizeRole(req.currentUser.role), action: "archive_election", entityType: "election", entityId: req.params.id, details: {} });
    res.json({ election: data });
  } catch (error) { next(error); }
});
router.post("/elections/:id/start", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: election, error } = await db.from("elections").select("*").eq("id", req.params.id).single();
    if (error) throw error;
    if (!["draft", "scheduled"].includes(election.status)) {
      throw Object.assign(new Error("Only a draft or scheduled election can be started."), { status: 400 });
    }
    const { count, error: optionError } = await db.from("election_options").select("id", { count: "exact", head: true }).eq("election_id", election.id);
    if (optionError) throw optionError;
    if ((count || 0) < 2) throw Object.assign(new Error("Add at least two voting options before starting."), { status: 400 });

    const now = new Date().toISOString();
    const end = req.body.endsAt ? normalizeElectionDate(req.body.endsAt) : election.ends_at;
    requireValue(end, "Set a closing date and time before starting voting.");
    const normalized = { ...election, starts_at: now, ends_at: end };
    await db.from("elections").update({ starts_at: now, ends_at: end }).eq("id", election.id);
    const started = await activateElection(db, normalized, { id: req.currentUser.id, role: normalizeRole(req.currentUser.role) });
    res.json({ election: started });
  } catch (error) {
    next(error);
  }
});

router.post("/elections/:id/close", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const election = await closeElection(
      db,
      req.params.id,
      { id: req.currentUser.id, role: normalizeRole(req.currentUser.role) },
      `${req.body.reason || ""}`.trim()
    );
    res.json({ election });
  } catch (error) {
    next(error);
  }
});

router.post("/elections/:id/finalize", async (req, res, next) => {
  try {
    const db = requireSupabase();
    res.json(await finalizeElection(db, req.params.id, { id: req.currentUser.id, role: normalizeRole(req.currentUser.role) }));
  } catch (error) {
    next(error);
  }
});

router.post("/elections/:id/runoff", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const election = await createRunoffElection(db, req.params.id, { id: req.currentUser.id, role: normalizeRole(req.currentUser.role) });
    res.status(201).json({ election });
  } catch (error) {
    next(error);
  }
});

router.post("/elections/:id/project", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const project = await createCommunityProjectFromElection(db, req.params.id, {
      id: req.currentUser.id,
      role: normalizeRole(req.currentUser.role),
    });
    res.status(201).json({ project });
  } catch (error) {
    next(error);
  }
});

router.get("/elections/:id/voters", async (req, res, next) => {
  try {
    const db = requireSupabase();
    await snapshotEligibleVoters(db, req.params.id);
    const { data, error } = await db
      .from("election_voters")
      .select("user_id, eligible, voted_at, users!election_voters_user_id_fkey(full_name, first_name, last_name, purok)")
      .eq("election_id", req.params.id)
      .eq("eligible", true)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.json({
      voters: (data || []).map((row) => ({
        userId: row.user_id,
        name: row.users?.full_name || [row.users?.first_name, row.users?.last_name].filter(Boolean).join(" ") || "Resident",
        purok: row.users?.purok || "",
        voted: Boolean(row.voted_at),
        votedAt: row.voted_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/elections/:id/monitor", async (req, res, next) => {
  try {
    const db = requireSupabase();
    res.json({ monitoring: await getElectionMonitoring(db, req.params.id) });
  } catch (error) {
    next(error);
  }
});

router.get("/election-results", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    await synchronizeElectionStatuses(db);
    const { data, error } = await db.from("elections").select("id").order("created_at", { ascending: false });
    if (error) throw error;
    const elections = [];
    for (const row of data || []) elections.push(await getElectionMetrics(db, row.id));
    res.json({ elections });
  } catch (error) {
    next(error);
  }
});

router.get("/community-projects", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    res.json({ projects: await getCommunityProjects(db) });
  } catch (error) {
    next(error);
  }
});

router.patch("/community-projects/:id", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const allowed = new Set(["planned", "preparation", "in_progress", "completed", "cancelled"]);
    const status = req.body.status;
    if (status && !allowed.has(status)) throw Object.assign(new Error("Invalid project status."), { status: 400 });

    const updates = {
      updated_at: new Date().toISOString(),
    };
    if (req.body.purok !== undefined && req.body.purok !== "" && !PUROK_OPTIONS.has(`${req.body.purok}`.trim())) {
      throw Object.assign(new Error("Purok must be Purok 1 through Purok 6, or left blank for barangay-wide projects."), { status: 400 });
    }
    if (status) updates.status = status;
    if (req.body.progressPercentage !== undefined) updates.progress_percentage = Math.max(0, Math.min(100, Number(req.body.progressPercentage)));
    for (const [incoming, column] of [
      ["location", "location"],
      ["purok", "purok"],
      ["plannedStartDate", "planned_start_date"],
      ["actualStartDate", "actual_start_date"],
      ["targetCompletionDate", "target_completion_date"],
      ["actualCompletionDate", "actual_completion_date"],
      ["allocatedBudget", "allocated_budget"],
      ["actualCost", "actual_cost"],
      ["description", "description"],
    ]) {
      if (req.body[incoming] !== undefined) updates[column] = req.body[incoming] === "" ? null : req.body[incoming];
    }
    if (status === "completed" && !updates.actual_completion_date) updates.actual_completion_date = new Date().toISOString().slice(0, 10);

    const { data, error } = await db.from("community_projects").update(updates).eq("id", req.params.id).select("*").single();
    if (error) throw error;
    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "update_community_project",
      entityType: "community_project",
      entityId: req.params.id,
      details: updates,
    });
    res.json({ project: data });
  } catch (error) {
    next(error);
  }
});

router.post("/community-projects/:id/updates", upload.single("image"), async (req, res, next) => {
  try {
    const db = requireSupabase();
    const title = `${req.body.title || ""}`.trim();
    requireValue(title, "Update title is required.");
    const imageUrl = req.file
      ? await uploadAsset({ file: req.file, folder: "project-updates", prefix: title })
      : null;
    const progress = req.body.progressPercentage === undefined || req.body.progressPercentage === ""
      ? null
      : Math.max(0, Math.min(100, Number(req.body.progressPercentage)));

    const { data, error } = await db
      .from("project_updates")
      .insert({
        project_id: req.params.id,
        title,
        description: `${req.body.description || ""}`.trim(),
        progress_percentage: progress,
        image_url: imageUrl,
        created_by: req.currentUser.id,
      })
      .select("*")
      .single();
    if (error) throw error;
    if (progress !== null) {
      await db.from("community_projects").update({ progress_percentage: progress, updated_at: new Date().toISOString() }).eq("id", req.params.id);
    }
    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "create_project_update",
      entityType: "community_project",
      entityId: req.params.id,
      details: { updateId: data.id, progress },
    });
    res.status(201).json({ update: data });
  } catch (error) {
    next(error);
  }
});

router.get("/voting-audit", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db
      .from("audit_logs")
      .select("*")
      .in("entity_type", ["election", "community_project", "project_suggestion"])
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    // Participation logs intentionally do not expose selected options.
    res.json({ logs: data || [] });
  } catch (error) {
    next(error);
  }
});

export default router;
