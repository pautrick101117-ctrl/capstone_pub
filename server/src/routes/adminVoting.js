import express from "express";
import multer from "multer";
import { requireSupabase } from "../lib/supabase.js";
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
};

router.get("/suggestions", async (_req, res, next) => {
  try {
    const db = requireSupabase();

    const { data, error } = await db
      .from("project_suggestions")
      .select("*, users!project_suggestions_user_id_fkey(full_name, first_name, last_name)")
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
    const status = req.body.status;

    requireValue(status, "Status is required.");

    if (!SUGGESTION_REVIEW_STATUSES.has(status)) {
      throw Object.assign(new Error("Suggestion status must be approved or rejected."), { status: 400 });
    }

    const { data, error } = await db
      .from("project_suggestions")
      .update({ status })
      .eq("id", req.params.id)
      .select("*")
      .single();

    if (error) throw error;

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "review_project_suggestion",
      entityType: "project_suggestion",
      entityId: req.params.id,
      details: { status },
    });

    res.json({ suggestion: data });
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
      actorRole: normalizeRole(req.currentUser.role),
      action: "save_election",
      entityType: "election",
      entityId: savedElection.id,
      details: electionPayload,
    });

    res.json({ election: savedElection });
  } catch (error) {
    next(error);
  }
});

router.get("/election-results", async (_req, res, next) => {
  try {
    const db = requireSupabase();

    await closeExpiredLiveElections(db);

    const { data: elections, error } = await db
      .from("elections")
      .select("id")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const items = [];

    for (const election of elections || []) {
      items.push(await getElectionMetrics(db, election.id));
    }

    res.json({ elections: items });
  } catch (error) {
    next(error);
  }
});

export default router;
