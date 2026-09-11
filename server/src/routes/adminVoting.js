import express from "express";
import multer from "multer";
import { requireSupabase } from "../lib/supabase.js";
import { ensureCommunityProjectForElection, ensureProjectsForClosedElections } from "../lib/projects.js";
import { uploadAsset } from "../lib/storage.js";
import { sendSystemEmail } from "../lib/mailer.js";
import { logAudit } from "../utils/audit.js";
import { normalizeRole } from "../utils/helpers.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const ELECTION_STATUSES = new Set(["draft", "live", "closed"]);
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

const syncOptionVoteCounts = async (db, electionId) => {
  const [optionsResult, votesResult] = await Promise.all([
    db.from("election_options").select("id").eq("election_id", electionId),
    db.from("votes").select("option_id").eq("election_id", electionId),
  ]);

  if (optionsResult.error) throw optionsResult.error;
  if (votesResult.error) throw votesResult.error;

  const counts = getVoteCountsByOption(votesResult.data || []);

  for (const option of optionsResult.data || []) {
    const { error } = await db
      .from("election_options")
      .update({ votes_count: counts[option.id] || 0 })
      .eq("id", option.id);

    if (error) throw error;
  }
};

const getElectionMetrics = async (db, electionId) => {
  await syncOptionVoteCounts(db, electionId);

  const [election, options, votes, completions, residents] = await Promise.all([
    db.from("elections").select("*").eq("id", electionId).single(),
    db.from("election_options").select("*").eq("election_id", electionId).order("created_at"),
    db.from("votes").select("id, user_id, option_id").eq("election_id", electionId),
    db.from("project_completions").select("id, user_id").eq("election_id", electionId),
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

  const winner =
    totalVotes > 0
      ? [...mappedOptions].sort((a, b) => Number(b.votes || 0) - Number(a.votes || 0))[0] || null
      : null;

  return {
    id: election.data.id,
    title: election.data.title,
    description: election.data.description,
    status: election.data.status,
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

const closeExpiredLiveElections = async (db) => {
  const now = new Date().toISOString();

  const { error } = await db
    .from("elections")
    .update({ status: "closed" })
    .eq("status", "live")
    .lte("ends_at", now);

  if (error) throw error;
  await ensureProjectsForClosedElections(db).catch((projectError) => {
    if (!`${projectError.message || ""}`.toLowerCase().includes("community_projects")) throw projectError;
  });
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
      suggestions: data || [],
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
    const reviewNote = `${req.body.reviewNote ?? req.body.review_note ?? ""}`.trim();

    requireValue(status, "Status is required.");
    if (!SUGGESTION_REVIEW_STATUSES.has(status)) {
      throw Object.assign(new Error("Suggestion status must be approved or rejected."), { status: 400 });
    }
    if (status === "rejected" && reviewNote.length < 3) {
      throw Object.assign(new Error("Add a short reason so the resident understands why the suggestion was not approved."), { status: 400 });
    }

    const existingResult = await db.from("project_suggestions").select("*").eq("id", req.params.id).maybeSingle();
    if (existingResult.error) throw existingResult.error;
    if (!existingResult.data) throw Object.assign(new Error("Project suggestion not found."), { status: 404 });

    const updatePayload = {
      status,
      review_note: reviewNote || null,
      reviewed_by: req.currentUser.id,
      reviewed_at: new Date().toISOString(),
    };

    let result = await db
      .from("project_suggestions")
      .update(updatePayload)
      .eq("id", req.params.id)
      .select("*")
      .single();

    // Backward-compatible fallback if V4 review columns have not been migrated yet.
    if (result.error && /review_note|reviewed_by|reviewed_at/i.test(result.error.message || "")) {
      result = await db.from("project_suggestions").update({ status }).eq("id", req.params.id).select("*").single();
    }
    if (result.error) throw result.error;

    const residentBody = status === "approved"
      ? `Your project suggestion “${result.data.title}” was approved for consideration in a future community vote.${reviewNote ? ` Barangay note: ${reviewNote}` : ""}`
      : `Your project suggestion “${result.data.title}” was not approved.${reviewNote ? ` Barangay note: ${reviewNote}` : ""}`;

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
      details: { status, reviewNote },
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

    await closeExpiredLiveElections(db);

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
    await closeExpiredLiveElections(db);

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
      ? await uploadAsset({
          file: req.file,
          folder: "elections",
          prefix: rawElection.title,
        })
      : rawElection.imageUrl || null;

    let previousElection = null;
    let existingOptions = [];
    let existingVoteCount = 0;

    if (rawElection.id) {
      const [previous, optionRows, voteRows] = await Promise.all([
        db.from("elections").select("*").eq("id", rawElection.id).maybeSingle(),
        db
          .from("election_options")
          .select("name, description, source_suggestion_id")
          .eq("election_id", rawElection.id)
          .order("created_at"),
        db.from("votes").select("id", { count: "exact", head: true }).eq("election_id", rawElection.id),
      ]);

      if (previous.error) throw previous.error;
      if (optionRows.error) throw optionRows.error;
      if (voteRows.error) throw voteRows.error;

      previousElection = previous.data;
      existingOptions = normalizeElectionOptions(optionRows.data || []);
      existingVoteCount = voteRows.count || 0;
    }

    if (existingVoteCount > 0 && !sameElectionOptions(existingOptions, options)) {
      throw Object.assign(new Error("Voting options cannot be changed after votes have been recorded."), {
        status: 400,
      });
    }

    const electionPayload = {
      title: `${rawElection.title || ""}`.trim(),
      description: rawElection.description || "",
      status,
      starts_at: startsAt,
      ends_at: endsAt,
      image_url: imageUrl,
      source_suggestion_id: rawElection.sourceSuggestionId || sourceSuggestionIds[0] || null,
    };

    let savedElection;

    if (rawElection.id) {
      const update = await db
        .from("elections")
        .update(electionPayload)
        .eq("id", rawElection.id)
        .select("*")
        .single();

      if (update.error) throw update.error;

      savedElection = update.data;
    } else {
      const insert = await db.from("elections").insert(electionPayload).select("*").single();

      if (insert.error) throw insert.error;

      savedElection = insert.data;
    }

    if (existingVoteCount === 0) {
      const deleteOptions = await db.from("election_options").delete().eq("election_id", savedElection.id);

      if (deleteOptions.error) throw deleteOptions.error;

      if (options.length) {
        const insertOptions = await db.from("election_options").insert(
          options.map((option) => ({
            election_id: savedElection.id,
            name: option.name,
            description: option.description,
            source_suggestion_id: option.sourceSuggestionId || null,
            image_url: option.imageUrl || null,
            votes_count: 0,
          }))
        );

        if (insertOptions.error) throw insertOptions.error;
      }
    }

    if (savedElection.status === "closed") {
      await ensureCommunityProjectForElection(db, savedElection.id, { createdBy: req.currentUser.id }).catch((projectError) => {
        if (!`${projectError.message || ""}`.toLowerCase().includes("community_projects")) throw projectError;
      });
    }

    if (savedElection.status === "live") {
      const closeOtherLives = await db
        .from("elections")
        .update({ status: "closed" })
        .neq("id", savedElection.id)
        .eq("status", "live");

      if (closeOtherLives.error) throw closeOtherLives.error;

      if (previousElection?.status !== "live") {
        const resetVotes = await db.from("users").update({ has_voted: false }).eq("role", "resident");

        if (resetVotes.error) throw resetVotes.error;

        const residents = await getResidentRecipients(db);

        await notifyResidents(db, residents, {
          title: "Voting is now open",
          body: `${savedElection.title} is now live for voting.`,
        });

      }
    }

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

    const closedAt = new Date().toISOString();
    const { data: savedElection, error: updateError } = await db
      .from("elections")
      .update({ status: "closed", ends_at: closedAt })
      .eq("id", election.id)
      .select("*")
      .single();
    if (updateError) throw updateError;

    await ensureCommunityProjectForElection(db, savedElection.id, { createdBy: req.currentUser.id }).catch((projectError) => {
      if (!`${projectError.message || ""}`.toLowerCase().includes("community_projects")) throw projectError;
    });

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
      details: { reason: `${req.body.reason || ""}`.trim() || null },
      req,
    });

    res.json({ election: savedElection, message: "Voting has been closed. Final results are now locked." });
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
    await closeExpiredLiveElections(db);

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

