import express from "express";
import { attachCaseHistories, parseNewCaseResponse, updateCaseWithHistory } from "../lib/caseHistory.js";
import multer from "multer";
import { requireSupabase } from "../lib/supabase.js";
import { ensureCommunityProjectForElection, ensureProjectsForClosedElections } from "../lib/projects.js";
import { uploadAsset } from "../lib/storage.js";
import { sendSystemEmail } from "../lib/mailer.js";
import { logAudit } from "../utils/audit.js";
import { normalizeRole } from "../utils/helpers.js";
import { classifyElectionOutcome, phaseStatus, mapVotingRpcError } from "../lib/votingOutcome.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const ELECTION_STATUSES = new Set(["draft", "live"]);
const SUGGESTION_REVIEW_STATUSES = new Set(["approved", "rejected"]);

const requireValue = (value, message) => {
  if (!value) {
    throw Object.assign(new Error(message), { status: 400 });
  }
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
    items.map((item) =>
      [item.name || "", item.description || "", item.sourceSuggestionId || item.source_suggestion_id || ""].join("\n")
    );

  const leftItems = normalize(left);
  const rightItems = normalize(right);

  return leftItems.length === rightItems.length && leftItems.every((item, index) => item === rightItems[index]);
};

const getResidentRecipients = async (db) => {
  const { data, error } = await db
    .from("users")
    .select("id, email, full_name, first_name")
    .eq("role", "resident")
    .eq("is_active", true);

  if (error) throw error;

  return data || [];
};

const notifyResidents = async (db, residents, { title, body, kind = "info" }) => {
  if (!residents.length) return;

  const { error } = await db.from("notifications").insert(
    residents.map((resident) => ({
      user_id: resident.id,
      title,
      body,
      kind,
      broadcast: false,
    }))
  );

  if (error) throw error;

  await Promise.all(
    residents
      .filter((resident) => resident.email)
      .map((resident) =>
        sendSystemEmail({
          to: resident.email,
          subject: title,
          text: body,
        }).catch((emailError) => {
          console.warn(`[EMAIL NOTIFICATION ERROR] ${resident.email}: ${emailError.message}`);
        })
      )
  );
};

const getVoteCountsByOption = (votes = []) =>
  votes.reduce((counts, vote) => {
    const optionId = vote.option_id;
    counts[optionId] = (counts[optionId] || 0) + 1;
    return counts;
  }, {});

const getElectionMetrics = async (db, electionId) => {
  const [election, options, votes, completions, residents] = await Promise.all([
    db.from("elections").select("*").eq("id", electionId).single(),
    db.from("election_options").select("*").eq("election_id", electionId).order("created_at"),
    db.from("votes").select("id, user_id, option_id").eq("election_id", electionId),
    db.from("project_completions").select("id, user_id").eq("election_id", electionId).eq("acknowledged_after_official_completion", true),
    db.from("users").select("id", { count: "exact", head: true }).eq("role", "resident").eq("is_active", true),
  ]);

  if (election.error) throw election.error;
  if (options.error) throw options.error;
  if (votes.error) throw votes.error;
  if (completions.error) throw completions.error;

  const optionRows = options.data || [];
  const voteRows = votes.data || [];
  const voteCounts = getVoteCountsByOption(voteRows);
  const totalVotes = voteRows.length;
  const eligibleVoters = residents.count || 0;

  const mappedOptions = optionRows.map((option) => {
    const voteCount = voteCounts[option.id] || 0;

    return {
      id: option.id,
      name: option.name,
      description: option.description,
      imageUrl: option.image_url,
      sourceSuggestionId: option.source_suggestion_id,
      votes: voteCount,
      percentage: totalVotes ? Number(((voteCount / totalVotes) * 100).toFixed(1)) : 0,
    };
  });

  const outcome = classifyElectionOutcome(optionRows, voteRows, { finalized: Boolean(election.data.finalized_at) });
  const winner = election.data.result_kind === "winner" && election.data.finalized_at
    ? mappedOptions.find((item) => item.id === election.data.winner_option_id) || null : null;

  return {
    id: election.data.id,
    title: election.data.title,
    description: election.data.description,
    status: election.data.status,
    phaseStatus: phaseStatus(election.data),
    finalized: Boolean(election.data.finalized_at),
    resultKind: election.data.result_kind || (election.data.status === "closed" ? "legacy_review" : outcome.kind),
    tiedOptions: outcome.tiedOptions.map((option) => ({ id: option.id, name: option.name })),
    startsAt: election.data.starts_at,
    endsAt: election.data.ends_at,
    imageUrl: election.data.image_url,
    sourceSuggestionId: election.data.source_suggestion_id,
    totalVotes,
    eligibleVoters,
    notVotedCount: Math.max(eligibleVoters - totalVotes, 0),
    participationRate: eligibleVoters ? Number(((totalVotes / eligibleVoters) * 100).toFixed(1)) : 0,
    completionCount: completions.data?.length || 0,
    winner: winner
      ? {
          id: winner.id,
          name: winner.name,
          votes: Number(winner.votes || 0),
        }
      : null,
    options: mappedOptions.map((option) => ({
      ...option,
      isWinner: winner ? winner.id === option.id : false,
    })),
  };
};

router.get("/suggestions", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 10)));
    const status = `${req.query.status || "all"}`.trim().toLowerCase();
    const search = `${req.query.search || ""}`.trim();

    let query = db
      .from("project_suggestions")
      .select("*, users!project_suggestions_user_id_fkey(full_name, first_name, last_name, purok)", { count: "exact" })
      .order("created_at", { ascending: false });

    if (["pending", "approved", "rejected"].includes(status)) query = query.eq("status", status);
    if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);

    const from = (page - 1) * limit;
    const { data, error, count } = await query.range(from, from + limit - 1);
    if (error) throw error;

    res.json({
      suggestions: await attachCaseHistories(db, "project_suggestion", data || []),
      pagination: { page, limit, total: count || 0, totalPages: Math.max(1, Math.ceil((count || 0) / limit)) },
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/suggestions/:id", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const status = `${req.body.status || ""}`.trim().toLowerCase();
    const response = parseNewCaseResponse(req.body);
    const reviewNote = response.message;

    requireValue(status, "Status is required.");
    if (!SUGGESTION_REVIEW_STATUSES.has(status)) {
      throw Object.assign(new Error("Suggestion status must be approved or rejected."), { status: 400 });
    }
    const existingResult = await db.from("project_suggestions").select("*").eq("id", req.params.id).maybeSingle();
    if (existingResult.error) throw existingResult.error;
    if (!existingResult.data) throw Object.assign(new Error("Project suggestion not found."), { status: 404 });
    if (status === "rejected" && status !== existingResult.data.status && reviewNote.length < 3) {
      throw Object.assign(new Error("Add a short reason so the resident understands why the suggestion was not approved."), { status: 400 });
    }

    const suggestion = await updateCaseWithHistory(db, { entityType: "project_suggestion", id: req.params.id,
      currentStatus: req.body.expectedStatus || existingResult.data.status, status,
      response, actorId: req.currentUser.id, operationId: req.body.operationId });
    const result = { data: suggestion };

    const residentBody = status === "approved"
      ? `Your project suggestion “${result.data.title}” was approved for consideration in a future community vote.${response.visibility === "resident" && reviewNote ? ` Barangay note: ${reviewNote}` : ""}`
      : `Your project suggestion “${result.data.title}” was not approved.${response.visibility === "resident" && reviewNote ? ` Barangay note: ${reviewNote}` : ""}`;

    if (status !== existingResult.data.status || (response.visibility === "resident" && reviewNote)) {
    await db.from("notifications").insert({
      user_id: result.data.user_id,
      title: status === "approved" ? "Project suggestion approved" : "Project suggestion review",
      body: residentBody,
      kind: status === "approved" ? "success" : "warning",
      broadcast: false,
      entity_type: "project_suggestion",
      entity_id: result.data.id,
      destination: "/portal/suggestions",
    }).then(({ error }) => {
      // Allow older schemas without entity metadata columns.
      if (error && /entity_type|entity_id|destination/i.test(error.message || "")) {
        return db.from("notifications").insert({
          user_id: result.data.user_id,
          title: status === "approved" ? "Project suggestion approved" : "Project suggestion review",
          body: residentBody,
          kind: status === "approved" ? "success" : "warning",
          broadcast: false,
        });
      }
      if (error) throw error;
      return null;
    });
    }

    await logAudit({
      actorId: req.currentUser.id,
      actorName: req.currentUser.full_name || req.currentUser.fullName,
      actorRole: normalizeRole(req.currentUser.role),
      action: "review_project_suggestion",
      module: "project_suggestions",
      entityType: "project_suggestion",
      entityId: req.params.id,
      beforeData: existingResult.data,
      afterData: result.data,
      details: { status, visibility: response.visibility },
      req,
    });

    res.json({ suggestion: result.data });
  } catch (error) {
    next(error);
  }
});

router.get("/election", async (_req, res, next) => {
  try {
    const db = requireSupabase();

    const { data: election, error } = await db
      .from("elections")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!election) {
      return res.json({ election: null, options: [] });
    }

    const { data: options, error: optionError } = await db
      .from("election_options")
      .select("*")
      .eq("election_id", election.id)
      .order("created_at");

    if (optionError) throw optionError;

    const { count: voteCount, error: voteError } = await db
      .from("votes")
      .select("id", { count: "exact", head: true })
      .eq("election_id", election.id);

    if (voteError) throw voteError;

    res.json({
      election: {
        ...election,
        totalVotes: voteCount || 0,
      },
      options: options || [],
    });
  } catch (error) {
    next(error);
  }
});


router.get("/election/:id", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: election, error } = await db.from("elections").select("*").eq("id", req.params.id).maybeSingle();
    if (error) throw error;
    if (!election) throw Object.assign(new Error("Voting post not found."), { status: 404 });

    const [options, votes] = await Promise.all([
      db.from("election_options").select("*").eq("election_id", election.id).order("created_at"),
      db.from("votes").select("id", { count: "exact", head: true }).eq("election_id", election.id),
    ]);
    if (options.error) throw options.error;
    if (votes.error) throw votes.error;

    res.json({ election, options: options.data || [], totalVotes: votes.count || 0 });
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

    if (!ELECTION_STATUSES.has(status)) {
      throw Object.assign(new Error("Voting status must be draft, live, or closed."), { status: 400 });
    }

    const options = normalizeElectionOptions(rawOptions);

    if (status !== "draft" && options.length < 2) {
      throw Object.assign(new Error("At least two approved project suggestions are required before posting voting."), {
        status: 400,
      });
    }

    const sourceSuggestionIds = [...new Set(options.map((option) => option.sourceSuggestionId).filter(Boolean))];

    if (sourceSuggestionIds.length) {
      const { data: selectedSuggestions, error: suggestionError } = await db
        .from("project_suggestions")
        .select("id, status")
        .in("id", sourceSuggestionIds);

      if (suggestionError) throw suggestionError;

      if ((selectedSuggestions || []).length !== sourceSuggestionIds.length) {
        throw Object.assign(new Error("One or more selected project suggestions no longer exist."), { status: 400 });
      }

      const notApproved = (selectedSuggestions || []).find((suggestion) => suggestion.status !== "approved");

      if (notApproved) {
        throw Object.assign(new Error("Only approved project suggestions can be posted for voting."), { status: 400 });
      }
    }

    const startsAt = normalizeElectionDate(rawElection.startsAt);
    const endsAt = normalizeElectionDate(rawElection.endsAt);

    if (status === "live") {
      requireValue(startsAt, "Voting open date and time are required.");
      requireValue(endsAt, "Voting close date and time are required.");

      if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
        throw Object.assign(new Error("Voting close time must be after the open time."), { status: 400 });
      }

      if (new Date(endsAt).getTime() <= Date.now()) {
        throw Object.assign(new Error("Voting close time must be in the future before posting live voting."), {
          status: 400,
        });
      }
    }

    const imageUrl = req.file
      ? await uploadAsset({ file: req.file, folder: "elections", prefix: rawElection.title })
      : rawElection.imageUrl || null;
    let previousElection = null;
    if (rawElection.id) {
      const previous = await db.from("elections").select("*").eq("id", rawElection.id).maybeSingle();
      if (previous.error) throw previous.error;
      previousElection = previous.data;
    }
    if (status === "live" && sourceSuggestionIds.length !== options.length) {
      throw Object.assign(new Error("Every published candidate must come from an approved suggestion."), { status: 400 });
    }
    const { data: savedElection, error: saveError } = await db.rpc("bgy_phase10_save_election", {
      p_actor: req.currentUser.id,
      p_id: rawElection.id || null,
      p_title: `${rawElection.title || ""}`.trim(),
      p_description: rawElection.description || "",
      p_status: status,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_image_url: imageUrl,
      p_options: options,
      p_runoff_parent: rawElection.runoffParentId || null,
    });
    if (saveError) throw mapVotingRpcError(saveError);
    // Database outbox owns resident notifications; no duplicate direct broadcast.
    const electionPayload = {
      title: savedElection.title, status: savedElection.status,
      starts_at: savedElection.starts_at, ends_at: savedElection.ends_at,
      selected_suggestions: sourceSuggestionIds,
    };

    await logAudit({
      actorId: req.currentUser.id,
      actorName: req.currentUser.full_name || req.currentUser.fullName,
      actorRole: normalizeRole(req.currentUser.role),
      action: "save_election",
      module: "project_voting",
      entityType: "election",
      entityId: savedElection.id,
      beforeData: previousElection,
      afterData: savedElection,
      details: electionPayload,
      req,
    });

    res.json({ election: savedElection });
  } catch (error) {
    next(error);
  }
});


router.post("/election/:id/close", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: election, error } = await db.from("elections").select("*").eq("id", req.params.id).maybeSingle();
    if (error) throw error;
    if (!election) throw Object.assign(new Error("Voting post not found."), { status: 404 });
    if (election.status !== "live") throw Object.assign(new Error("Only an open voting period can be closed."), { status: 409 });

    const reason = `${req.body.reason || ""}`.trim();
    if (!reason || reason.length < 5) {
      throw Object.assign(new Error("Please explain why the voting period is being closed early."), { status: 400 });
    }
    const { data: savedElection, error: updateError } = await db.rpc("bgy_phase10_finalize_election", {
      p_election_id: election.id, p_actor: req.currentUser.id, p_early_reason: reason,
    });
    if (updateError) throw mapVotingRpcError(updateError);

    await logAudit({
      actorId: req.currentUser.id,
      actorName: req.currentUser.full_name || req.currentUser.fullName,
      actorRole: normalizeRole(req.currentUser.role),
      action: "close_election",
      module: "project_voting",
      entityType: "election",
      entityId: savedElection.id,
      beforeData: election,
      afterData: savedElection,
      details: { reason, resultKind: savedElection.result_kind },
      req,
    });

    res.json({ election: savedElection, message: savedElection.result_kind === "tie" ? "Voting closed with a tie; prepare a runoff round." : "Voting has been finalized. Results are now locked." });
  } catch (error) {
    next(error);
  }
});

router.delete("/election/:id", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: election, error } = await db.from("elections").select("*").eq("id", req.params.id).maybeSingle();
    if (error) throw error;
    if (!election) throw Object.assign(new Error("Voting post not found."), { status: 404 });
    if (election.status !== "draft") {
      throw Object.assign(new Error("Only draft voting posts can be deleted. Open or closed elections must be preserved for transparency."), { status: 409 });
    }

    const { count: voteCount, error: voteError } = await db.from("votes").select("id", { count: "exact", head: true }).eq("election_id", election.id);
    if (voteError) throw voteError;
    if ((voteCount || 0) > 0) throw Object.assign(new Error("A voting post with recorded votes cannot be deleted."), { status: 409 });

    const { error: deleteError } = await db.from("elections").delete().eq("id", election.id);
    if (deleteError) throw deleteError;

    await logAudit({
      actorId: req.currentUser.id,
      actorName: req.currentUser.full_name || req.currentUser.fullName,
      actorRole: normalizeRole(req.currentUser.role),
      action: "delete_draft_election",
      module: "project_voting",
      entityType: "election",
      entityId: election.id,
      beforeData: election,
      details: { title: election.title },
      req,
    });

    res.json({ message: "Draft voting post deleted." });
  } catch (error) {
    next(error);
  }
});

router.get("/election-results", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(20, Math.max(1, Number(req.query.limit || 6)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const status = `${req.query.status || "all"}`.trim().toLowerCase();

    let query = db.from("elections").select("id", { count: "exact" }).order("created_at", { ascending: false });
    if (["draft", "live", "closed"].includes(status)) query = query.eq("status", status);
    const { data: elections, error, count } = await query.range(from, to);
    if (error) throw error;

    const items = [];
    for (const election of elections || []) items.push(await getElectionMetrics(db, election.id));

    res.json({
      elections: items,
      pagination: { page, limit, total: count || 0, totalPages: Math.max(1, Math.ceil((count || 0) / limit)) },
    });
  } catch (error) {
    next(error);
  }
});

export default router;


