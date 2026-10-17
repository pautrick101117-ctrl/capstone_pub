import { persistentLimit } from "../middleware/persistentLimit.js";
import express from "express";
import { requireSupabase } from "../lib/supabase.js";
import { ensureCommunityProjectForElection, ensureProjectsForClosedElections } from "../lib/projects.js";
import { requireAuth, requireCurrentUser } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { logAudit } from "../utils/audit.js";
import { sendSystemEmail } from "../lib/mailer.js";
import { normalizeRole } from "../utils/helpers.js";
import { classifyElectionOutcome, phaseStatus, mapVotingRpcError } from "../lib/votingOutcome.js";

const router = express.Router();

const requireValue = (value, message) => {
  if (!value) {
    throw Object.assign(new Error(message), { status: 400 });
  }
};

const getVoteCountsByOption = (votes = []) =>
  votes.reduce((counts, vote) => {
    counts[vote.option_id] = (counts[vote.option_id] || 0) + 1;
    return counts;
  }, {});

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

  const outcome = classifyElectionOutcome(options, votes, { finalized: Boolean(election.finalized_at) });
  const winner = election.result_kind === "winner" && election.finalized_at
    ? mappedOptions.find((item) => item.id === election.winner_option_id) || null : null;

  return {
    id: election.id,
    title: election.title,
    description: election.description,
    imageUrl: election.image_url,
    status: election.status,
    phaseStatus: phaseStatus(election),
    finalized: Boolean(election.finalized_at),
    resultKind: election.result_kind || (election.status === "closed" ? "legacy_review" : outcome.kind),
    tiedOptions: outcome.tiedOptions.map((option) => ({ id: option.id, name: option.name })),
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
  const { data: election, error } = await db.from("elections").select("*").eq("id", electionId).single();

  if (error) throw error;

  const [options, votes, completions, eligibleResidents, projectResult] = await Promise.all([
    db.from("election_options").select("*").eq("election_id", electionId).order("created_at"),
    db.from("votes").select("id, user_id, option_id").eq("election_id", electionId),
    db.from("project_completions").select("id, user_id").eq("election_id", electionId).eq("acknowledged_after_official_completion", true),
    db.from("users").select("id", { count: "exact", head: true }).eq("role", "resident").eq("is_active", true),
    db.from("community_projects").select("id,status,progress_percentage").eq("election_id", electionId).maybeSingle(),
  ]);

  if (options.error) throw options.error;
  if (votes.error) throw votes.error;
  if (completions.error) throw completions.error;
  if (projectResult.error) throw projectResult.error;

  return { ...mapElection(
    election,
    options.data || [],
    votes.data || [],
    completions.data || [],
    eligibleResidents.count || 0
  ), project: projectResult.data || null };
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

    let election = await getActiveElection(db);
    if (!election) {
      // Published future rounds may be inspected, but cannot accept votes yet.
      const { data: upcoming, error: upcomingError } = await db.from("elections").select("*")
        .eq("status", "live").gt("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true }).limit(1).maybeSingle();
      if (upcomingError) throw upcomingError;
      election = upcoming || null;
    }
    if (!election) return res.json({ election: null });
    const bundle = await getElectionBundle(db, election.id);

    res.json({ election: bundle });
  } catch (error) {
    next(error);
  }
});

router.get("/results/latest", async (_req, res, next) => {
  try {
    const db = requireSupabase();

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

router.get("/results/:electionId", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: election, error } = await db.from("elections").select("id,status")
      .eq("id",req.params.electionId).maybeSingle();
    if (error) throw error;
    if (!election || !["live", "closed"].includes(election.status)) {
      throw Object.assign(new Error("Published voting round not found."), { status: 404 });
    }
    res.json({ election: await getElectionBundle(db, election.id) });
  } catch (error) { next(error); }
});

router.get("/history", async (_req, res, next) => {
  try {
    const db = requireSupabase();

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
  "/vote", requireAuth, requireCurrentUser(),
  rateLimit({ key: "vote", max: 15, windowMs: 60_000 }),
  persistentLimit("resident-vote",{max:3,windowSeconds:60,identity:req=>req.currentUser?.id||req.ip}),
  async (req, res, next) => {
    try {
      if (normalizeRole(req.currentUser.role) !== "resident") {
        throw Object.assign(new Error("Only residents can vote."), { status: 403 });
      }
      const { optionId } = req.body;
      requireValue(optionId, "Choose a voting option first.");
      const db = requireSupabase();
      const { data: voteId, error } = await db.rpc("bgy_phase10_cast_vote", {
        p_user: req.currentUser.id, p_option: optionId,
      });
      if (error) throw mapVotingRpcError(error);
      // Voter choice is intentionally NOT included in audit entries or notification text.
      // The database owns the committed ballot and its internal write audit.
      const notificationTitle = "Vote recorded";
      const notificationBody = "Your vote was recorded successfully. Thank you for participating.";
      const notify = await db.from("notifications").insert({
        user_id: req.currentUser.id, title: notificationTitle,
        body: notificationBody, kind: "success", broadcast: false,
      });
      if (notify.error) console.warn("[VOTE NOTIFICATION ERROR]", notify.error.message);
      if (req.currentUser.email) {
        await sendSystemEmail({ to: req.currentUser.email, subject: notificationTitle,
          text: notificationBody }).catch((mailError) => console.warn("[VOTE EMAIL ERROR]", mailError.message));
      }
      // No personally identifying link between actor and ballot option in general audit views.
      res.json({ message: "Your vote has been recorded.", voteId });
    } catch (error) { next(error); }
  }
);

router.get("/completion-status", requireAuth, requireCurrentUser(), async (req, res, next) => {
  try {
    const electionId = req.query.electionId;
    requireValue(electionId, "Election ID is required.");
    const db = requireSupabase();
    const { data, error } = await db.from("project_completions").select("id")
      .eq("election_id", electionId).eq("user_id", req.currentUser.id)
      .eq("acknowledged_after_official_completion", true).maybeSingle();
    if (error) throw error;
    res.json({ acknowledged: Boolean(data) });
  } catch (error) { next(error); }
});

router.post("/mark-completed", requireAuth, requireCurrentUser(), persistentLimit("project-completion-ack",{max:5,windowSeconds:600}), async (req, res, next) => {
  try {
    if (normalizeRole(req.currentUser.role) !== "resident") {
      throw Object.assign(new Error("Only residents can acknowledge a completed project."), { status: 403 });
    }
    const electionId = req.body.electionId;
    requireValue(electionId, "Election ID is required.");
    const db = requireSupabase();
    const { error } = await db.rpc("bgy_phase10_acknowledge_completion", {
      p_user: req.currentUser.id, p_election: electionId,
    });
    if (error) throw mapVotingRpcError(error);
    await logAudit({ actorId: req.currentUser.id, actorRole: normalizeRole(req.currentUser.role),
      action: "acknowledge_official_project_completion", entityType: "election",
      entityId: electionId, details: { confirmation: true } });
    res.json({ message: "Thank you for acknowledging the barangay's published project completion." });
  } catch (error) { next(error); }
});

export default router;


