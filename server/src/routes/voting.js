import express from "express";
import { requireSupabase } from "../lib/supabase.js";
import { requireAuth, requireCurrentUser } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { logAudit } from "../utils/audit.js";
import { sendSystemEmail } from "../lib/mailer.js";
import { normalizeRole } from "../utils/helpers.js";
import {
  canResidentSeeResults,
  getActiveElections,
  getCommunityProjects,
  getElectionMetrics,
  hideElectionResults,
  snapshotEligibleVoters,
  synchronizeElectionStatuses,
} from "../services/electionService.js";

const router = express.Router();

const requireValue = (value, message) => {
  if (!value) throw Object.assign(new Error(message), { status: 400 });
};

const getResidentVote = async (db, electionId, userId) => {
  if (!electionId || !userId) return null;
  const { data, error } = await db
    .from("votes")
    .select("id, receipt_code, created_at")
    .eq("election_id", electionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
};

router.get("/current", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const activeElections = await getActiveElections(db);
    if (!activeElections.length) return res.json({ election: null, elections: [] });

    let userId = null;
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (token) {
      try {
        const { verifyToken } = await import("../lib/jwt.js");
        userId = verifyToken(token)?.sub || null;
      } catch {
        userId = null;
      }
    }

    const elections = [];
    for (const election of activeElections) {
      const bundle = await getElectionMetrics(db, election.id);
      const hasVoted = userId ? Boolean(await getResidentVote(db, election.id, userId)) : false;
      elections.push(canResidentSeeResults(bundle, hasVoted) ? bundle : hideElectionResults(bundle));
    }

    // `election` is preserved for older dashboard/landing code.
    res.json({ election: elections[0] || null, elections });
  } catch (error) {
    next(error);
  }
});

router.get("/upcoming", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    await synchronizeElectionStatuses(db);
    const now = new Date().toISOString();
    const { data, error } = await db
      .from("elections")
      .select("id, title, description, starts_at, ends_at, image_url, status")
      .eq("status", "scheduled")
      .gt("starts_at", now)
      .order("starts_at", { ascending: true })
      .limit(10);
    if (error) throw error;
    res.json({ elections: data || [] });
  } catch (error) {
    next(error);
  }
});

router.get("/results/latest", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    await synchronizeElectionStatuses(db);
    const { data: election, error } = await db
      .from("elections")
      .select("id")
      .in("status", ["closed", "finalized", "archived"])
      .order("ends_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!election) return res.json({ election: null });
    res.json({ election: await getElectionMetrics(db, election.id) });
  } catch (error) {
    next(error);
  }
});

router.get("/history", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    await synchronizeElectionStatuses(db);
    const { data: elections, error } = await db
      .from("elections")
      .select("id")
      .in("status", ["closed", "finalized", "archived"])
      .order("created_at", { ascending: false });
    if (error) throw error;

    const items = [];
    for (const election of elections || []) items.push(await getElectionMetrics(db, election.id));
    res.json({ elections: items });
  } catch (error) {
    next(error);
  }
});

router.get("/my-status", requireAuth, requireCurrentUser(), async (req, res, next) => {
  try {
    const db = requireSupabase();
    const activeElections = await getActiveElections(db);
    if (!activeElections.length) {
      return res.json({ hasVoted: false, electionId: null, receipt: null, statuses: [] });
    }

    const statuses = [];
    for (const election of activeElections) {
      const vote = await getResidentVote(db, election.id, req.currentUser.id);
      statuses.push({
        electionId: election.id,
        hasVoted: Boolean(vote),
        receipt: vote ? { code: vote.receipt_code, recordedAt: vote.created_at } : null,
      });
    }

    const first = statuses[0];
    res.json({
      hasVoted: Boolean(first?.hasVoted),
      electionId: first?.electionId || null,
      receipt: first?.receipt || null,
      statuses,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/my-history", requireAuth, requireCurrentUser(), async (req, res, next) => {
  try {
    if (normalizeRole(req.currentUser.role) !== "resident") return res.json({ activity: [] });
    const db = requireSupabase();
    const { data, error } = await db
      .from("votes")
      .select("id, election_id, receipt_code, created_at, elections!votes_election_id_fkey(title, status, starts_at, ends_at)")
      .eq("user_id", req.currentUser.id)
      .order("created_at", { ascending: false });
    if (error) throw error;

    res.json({
      activity: (data || []).map((vote) => ({
        id: vote.id,
        electionId: vote.election_id,
        title: vote.elections?.title || "Community voting",
        electionStatus: vote.elections?.status || "closed",
        recordedAt: vote.created_at,
        receiptCode: vote.receipt_code,
      })),
    });
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

      const optionId = req.body.optionId;
      const requestedElectionId = req.body.electionId;
      requireValue(optionId, "Choose a voting option first.");

      const db = requireSupabase();
      const activeElections = await getActiveElections(db);
      if (!activeElections.length) {
        throw Object.assign(new Error("There is no live voting right now."), { status: 400 });
      }

      const election = requestedElectionId
        ? activeElections.find((item) => item.id === requestedElectionId)
        : activeElections.length === 1
          ? activeElections[0]
          : null;

      if (!election) {
        throw Object.assign(
          new Error(requestedElectionId ? "That election is not currently open for voting." : "Choose which live election you want to vote in."),
          { status: 400 }
        );
      }

      await snapshotEligibleVoters(db, election.id);

      const { data: option, error: optionError } = await db
        .from("election_options")
        .select("id, name")
        .eq("id", optionId)
        .eq("election_id", election.id)
        .single();
      if (optionError) throw optionError;

      const { data: voteRows, error: voteError } = await db.rpc("cast_election_vote", {
        p_election_id: election.id,
        p_option_id: option.id,
        p_user_id: req.currentUser.id,
      });
      if (voteError) {
        const message = `${voteError.message || ""}`;
        const status = /already voted/i.test(message) ? 409 : /eligible voter/i.test(message) ? 403 : 400;
        throw Object.assign(new Error(message || "Unable to record vote."), { status });
      }

      const vote = Array.isArray(voteRows) ? voteRows[0] : voteRows;
      const notificationTitle = "Vote recorded";
      const notificationBody = `Your participation in ${election.title} has been recorded successfully. Receipt: ${vote?.receipt_code || "available in Voting Activity"}.`;

      await db.from("notifications").insert({
        user_id: req.currentUser.id,
        title: notificationTitle,
        body: notificationBody,
        kind: "success",
        broadcast: false,
      }).then(({ error }) => {
        if (error) console.warn("[VOTE NOTIFICATION ERROR]", error.message);
      });

      if (req.currentUser.email) {
        await sendSystemEmail({ to: req.currentUser.email, subject: notificationTitle, text: notificationBody }).catch((emailError) => {
          console.warn(`[EMAIL NOTIFICATION ERROR] ${req.currentUser.email}: ${emailError.message}`);
        });
      }

      // Privacy: audit participation, not the resident's selected option.
      await logAudit({
        actorId: req.currentUser.id,
        actorRole: normalizeRole(req.currentUser.role),
        action: "vote_participation_recorded",
        entityType: "election",
        entityId: election.id,
        details: { receiptCode: vote?.receipt_code || null },
      }).catch((auditError) => console.warn("[VOTE AUDIT ERROR]", auditError.message));

      res.json({
        message: "Your vote has been recorded.",
        receipt: { code: vote?.receipt_code || null, recordedAt: vote?.recorded_at || new Date().toISOString() },
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get("/projects", async (req, res, next) => {
  try {
    const db = requireSupabase();
    let userId = null;
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (token) {
      try {
        const { verifyToken } = await import("../lib/jwt.js");
        userId = verifyToken(token)?.sub || null;
      } catch {
        userId = null;
      }
    }
    res.json({ projects: await getCommunityProjects(db, { userId }) });
  } catch (error) {
    next(error);
  }
});

router.post("/projects/:projectId/confirm-completion", requireAuth, requireCurrentUser(), async (req, res, next) => {
  try {
    if (normalizeRole(req.currentUser.role) !== "resident") {
      throw Object.assign(new Error("Only residents can confirm completed community projects."), { status: 403 });
    }

    const db = requireSupabase();
    const { data: project, error: projectError } = await db
      .from("community_projects")
      .select("id, title, status")
      .eq("id", req.params.projectId)
      .single();
    if (projectError) throw projectError;
    if (project.status !== "completed") {
      throw Object.assign(new Error("Completion can only be confirmed after the barangay marks the project completed."), { status: 400 });
    }

    const { error } = await db.from("project_completion_confirmations").upsert(
      { project_id: project.id, user_id: req.currentUser.id },
      { onConflict: "project_id,user_id", ignoreDuplicates: true }
    );
    if (error) throw error;

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "confirm_project_completion",
      entityType: "community_project",
      entityId: project.id,
      details: {},
    });

    res.json({ message: "Thank you for confirming project completion." });
  } catch (error) {
    next(error);
  }
});

// Legacy endpoint retained only to give older clients a clear migration message.
router.post("/mark-completed", requireAuth, requireCurrentUser(), (_req, _res, next) => {
  next(Object.assign(new Error("Project completion now uses Community Projects. Refresh the portal and confirm from the completed project card."), { status: 410 }));
});

export default router;
