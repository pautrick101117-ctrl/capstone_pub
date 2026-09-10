import express from "express";
import { requireSupabase } from "../lib/supabase.js";
import { requireAuth, requireCurrentUser } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { logAudit } from "../utils/audit.js";
import { sendSystemEmail } from "../lib/mailer.js";
import { normalizeRole } from "../utils/helpers.js";

const router = express.Router();

const requireValue = (value, message) => {
  if (!value) {
    throw Object.assign(new Error(message), { status: 400 });
  }
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

const getVoteCountsByOption = (votes = []) =>
  votes.reduce((counts, vote) => {
    counts[vote.option_id] = (counts[vote.option_id] || 0) + 1;
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

const mapElection = (election, options = [], votes = [], completions = [], eligibleVoters = 0) => {
  const voteCounts = getVoteCountsByOption(votes);
  const totalVotes = votes.length;

  const mappedOptions = options.map((option) => {
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
    id: election.id,
    title: election.title,
    description: election.description,
    imageUrl: election.image_url,
    status: election.status,
    startsAt: election.starts_at,
    endsAt: election.ends_at,
    sourceSuggestionId: election.source_suggestion_id,
    totalVotes,
    eligibleVoters,
    notVotedCount: Math.max(eligibleVoters - totalVotes, 0),
    participationRate: eligibleVoters ? Number(((totalVotes / eligibleVoters) * 100).toFixed(1)) : 0,
    completionCount: completions.length,
    winner: winner
      ? {
          id: winner.id,
          name: winner.name,
          votes: winner.votes,
        }
      : null,
    options: mappedOptions.map((option) => ({
      ...option,
      isWinner: winner ? winner.id === option.id : false,
    })),
  };
};

const getElectionBundle = async (db, electionId) => {
  await syncOptionVoteCounts(db, electionId);

  const { data: election, error } = await db.from("elections").select("*").eq("id", electionId).single();

  if (error) throw error;

  const [options, votes, completions, eligibleResidents] = await Promise.all([
    db.from("election_options").select("*").eq("election_id", electionId).order("created_at"),
    db.from("votes").select("id, user_id, option_id").eq("election_id", electionId),
    db.from("project_completions").select("id, user_id").eq("election_id", electionId),
    db.from("users").select("id", { count: "exact", head: true }).eq("role", "resident").eq("is_active", true),
  ]);

  if (options.error) throw options.error;
  if (votes.error) throw votes.error;
  if (completions.error) throw completions.error;

  return mapElection(
    election,
    options.data || [],
    votes.data || [],
    completions.data || [],
    eligibleResidents.count || 0
  );
};

const getActiveElection = async (db) => {
  const now = new Date().toISOString();

  const { data, error } = await db
    .from("elections")
    .select("*")
    .eq("status", "live")
    .lte("starts_at", now)
    .gt("ends_at", now)
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return data || null;
};

router.get("/current", async (_req, res, next) => {
  try {
    const db = requireSupabase();

    await closeExpiredLiveElections(db);

    const election = await getActiveElection(db);

    if (!election) {
      return res.json({ election: null });
    }

    const bundle = await getElectionBundle(db, election.id);

    res.json({ election: bundle });
  } catch (error) {
    next(error);
  }
});

router.get("/results/latest", async (_req, res, next) => {
  try {
    const db = requireSupabase();

    await closeExpiredLiveElections(db);

    const { data: election, error } = await db
      .from("elections")
      .select("*")
      .in("status", ["live", "closed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!election) {
      return res.json({ election: null });
    }

    const bundle = await getElectionBundle(db, election.id);

    res.json({ election: bundle });
  } catch (error) {
    next(error);
  }
});

router.get("/history", async (_req, res, next) => {
  try {
    const db = requireSupabase();

    await closeExpiredLiveElections(db);

    const { data: elections, error } = await db
      .from("elections")
      .select("*")
      .in("status", ["live", "closed"])
      .order("created_at", { ascending: false });

    if (error) throw error;

    const items = [];

    for (const election of elections || []) {
      items.push(await getElectionBundle(db, election.id));
    }

    res.json({ elections: items });
  } catch (error) {
    next(error);
  }
});

router.get("/my-status", requireAuth, requireCurrentUser(), async (req, res, next) => {
  try {
    const db = requireSupabase();

    await closeExpiredLiveElections(db);

    const election = await getActiveElection(db);

    if (!election) {
      return res.json({ hasVoted: false, electionId: null });
    }

    const { data: vote, error } = await db
      .from("votes")
      .select("id")
      .eq("election_id", election.id)
      .eq("user_id", req.currentUser.id)
      .maybeSingle();

    if (error) throw error;

    res.json({ hasVoted: Boolean(vote), electionId: election.id });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/vote",
  requireAuth,
  requireCurrentUser(),
  rateLimit({ key: "vote", max: 3, windowMs: 60_000 }),
  async (req, res, next) => {
    try {
      if (normalizeRole(req.currentUser.role) !== "resident") {
        throw Object.assign(new Error("Only residents can vote."), { status: 403 });
      }

      const db = requireSupabase();
      const { optionId } = req.body;

      requireValue(optionId, "Choose a voting option first.");

      await closeExpiredLiveElections(db);

      const election = await getActiveElection(db);

      if (!election) {
        throw Object.assign(new Error("There is no live voting right now."), { status: 400 });
      }

      const { data: existingVote, error: existingVoteError } = await db
        .from("votes")
        .select("id")
        .eq("election_id", election.id)
        .eq("user_id", req.currentUser.id)
        .maybeSingle();

      if (existingVoteError) throw existingVoteError;

      if (existingVote) {
        throw Object.assign(new Error("You have already voted in this voting post."), { status: 409 });
      }

      const { data: option, error: optionError } = await db
        .from("election_options")
        .select("*")
        .eq("id", optionId)
        .eq("election_id", election.id)
        .single();

      if (optionError) throw optionError;

      const insertVote = await db.from("votes").insert({
        election_id: election.id,
        option_id: option.id,
        user_id: req.currentUser.id,
      });

      if (insertVote.error) throw insertVote.error;

      await syncOptionVoteCounts(db, election.id);

      const updateUser = await db.from("users").update({ has_voted: true }).eq("id", req.currentUser.id);

      if (updateUser.error) throw updateUser.error;

      const notificationTitle = "Vote recorded";
      const notificationBody = `Your vote for ${option.name} has been recorded.`;

      await db.from("notifications").insert({
        user_id: req.currentUser.id,
        title: notificationTitle,
        body: notificationBody,
        kind: "success",
        broadcast: false,
      });

      await sendSystemEmail({
        to: req.currentUser.email,
        subject: notificationTitle,
        text: notificationBody,
      }).catch((emailError) => {
        console.warn(`[EMAIL NOTIFICATION ERROR] ${req.currentUser.email}: ${emailError.message}`);
      });

      await logAudit({
        actorId: req.currentUser.id,
        actorRole: normalizeRole(req.currentUser.role),
        action: "vote",
        entityType: "election",
        entityId: election.id,
        details: { optionId: option.id, optionName: option.name },
      });

      res.json({ message: "Your vote has been recorded." });
    } catch (error) {
      next(error);
    }
  }
);

router.post("/mark-completed", requireAuth, requireCurrentUser(), async (req, res, next) => {
  try {
    if (normalizeRole(req.currentUser.role) !== "resident") {
      throw Object.assign(new Error("Only residents can mark projects as completed."), { status: 403 });
    }

    const electionId = req.body.electionId;

    requireValue(electionId, "Election ID is required.");

    const db = requireSupabase();

    await closeExpiredLiveElections(db);

    const { data: election, error: electionError } = await db
      .from("elections")
      .select("*")
      .eq("id", electionId)
      .single();

    if (electionError) throw electionError;

    if (!election || election.status !== "closed") {
      throw Object.assign(new Error("Project completion can only be marked after voting closes."), { status: 400 });
    }

    const { error } = await db.from("project_completions").insert({
      election_id: electionId,
      user_id: req.currentUser.id,
    });

    if (error && !`${error.message}`.toLowerCase().includes("duplicate")) {
      throw error;
    }

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "confirm_project_completion",
      entityType: "election",
      entityId: electionId,
      details: { title: election.title },
    });

    res.json({ message: "Thank you for confirming project completion." });
  } catch (error) {
    next(error);
  }
});

export default router;
