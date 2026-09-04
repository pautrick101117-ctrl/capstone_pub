import { sendSystemEmail } from "../lib/mailer.js";
import { logAudit } from "../utils/audit.js";

const ACTIVE_RESULT_STATUSES = new Set(["closed", "finalized", "archived"]);

export const getResidentRecipients = async (db) => {
  const { data, error } = await db
    .from("users")
    .select("id, email, full_name, first_name, purok")
    .eq("role", "resident")
    .eq("is_active", true)
    .eq("status", "approved");
  if (error) throw error;
  return data || [];
};

export const notifyResidents = async (db, residents, { title, body, kind = "info", email = true } = {}) => {
  if (!(residents || []).length || !title) return;

  const { error } = await db.from("notifications").insert(
    residents.map((resident) => ({
      user_id: resident.id,
      title,
      body: body || "",
      kind,
      broadcast: false,
    }))
  );
  if (error) throw error;

  if (!email) return;

  await Promise.all(
    residents
      .filter((resident) => resident.email)
      .map((resident) =>
        sendSystemEmail({ to: resident.email, subject: title, text: body || "" }).catch((emailError) => {
          console.warn(`[EMAIL NOTIFICATION ERROR] ${resident.email}: ${emailError.message}`);
        })
      )
  );
};

export const snapshotEligibleVoters = async (db, electionId) => {
  const residents = await getResidentRecipients(db);
  if (!residents.length) return [];

  const { error } = await db.from("election_voters").upsert(
    residents.map((resident) => ({
      election_id: electionId,
      user_id: resident.id,
      eligible: true,
    })),
    { onConflict: "election_id,user_id", ignoreDuplicates: true }
  );
  if (error) throw error;
  return residents;
};

export const ensureNoElectionOverlap = async (_db, _window = {}) => {
  // Multiple elections may be live or scheduled at the same time.
  // Kept as a compatibility helper for callers that still import it.
  return null;
};


const notifyOpened = async (db, election) => {
  if (election.opened_notified_at) return;
  const residents = await snapshotEligibleVoters(db, election.id);
  await notifyResidents(db, residents, {
    title: "Voting is now open",
    body: `${election.title} is now open for voting. Sign in to the resident portal to participate.`,
    kind: "info",
  });
  await db.from("elections").update({ opened_notified_at: new Date().toISOString() }).eq("id", election.id);
};

const notifyClosed = async (db, election) => {
  if (election.closed_notified_at) return;
  const residents = await getResidentRecipients(db);
  await notifyResidents(db, residents, {
    title: "Voting has closed",
    body: `${election.title} has closed. Final results will be available after review.`,
    kind: "info",
  });
  await db.from("elections").update({ closed_notified_at: new Date().toISOString() }).eq("id", election.id);
};

export const synchronizeElectionStatuses = async (db) => {
  const now = new Date().toISOString();
  const transitions = [];

  const { data: scheduled, error: scheduledError } = await db
    .from("elections")
    .select("*")
    .eq("status", "scheduled")
    .lte("starts_at", now)
    .order("starts_at", { ascending: true });
  if (scheduledError) throw scheduledError;

  for (const election of scheduled || []) {
    if (election.ends_at && election.ends_at <= now) {
      const { error } = await db
        .from("elections")
        .update({ status: "closed", updated_at: now })
        .eq("id", election.id)
        .eq("status", "scheduled");
      if (error) throw error;
      await snapshotEligibleVoters(db, election.id);
      await notifyClosed(db, election);
      transitions.push({ id: election.id, from: "scheduled", to: "closed" });
      continue;
    }

    const { data: updated, error } = await db
      .from("elections")
      .update({ status: "live", updated_at: now })
      .eq("id", election.id)
      .eq("status", "scheduled")
      .select("*")
      .single();
    if (error) throw error;

    await notifyOpened(db, updated);
    transitions.push({ id: election.id, from: "scheduled", to: "live" });
  }

  const { data: expired, error: expiredError } = await db
    .from("elections")
    .select("*")
    .eq("status", "live")
    .lte("ends_at", now);
  if (expiredError) throw expiredError;

  for (const election of expired || []) {
    const { data: updated, error } = await db
      .from("elections")
      .update({ status: "closed", updated_at: now })
      .eq("id", election.id)
      .eq("status", "live")
      .select("*")
      .single();
    if (error) throw error;
    await notifyClosed(db, updated);
    transitions.push({ id: election.id, from: "live", to: "closed" });
  }

  return transitions;
};

export const activateElection = async (db, election, actor = null) => {
  const now = new Date().toISOString();
  const startsAt = election.starts_at || now;
  const endsAt = election.ends_at;
  if (!endsAt || new Date(endsAt).getTime() <= Date.now()) {
    throw Object.assign(new Error("Voting close time must be in the future."), { status: 400 });
  }

  await snapshotEligibleVoters(db, election.id);

  const { data, error } = await db
    .from("elections")
    .update({ status: "live", starts_at: startsAt, updated_at: now })
    .eq("id", election.id)
    .select("*")
    .single();
  if (error) throw error;

  await notifyOpened(db, data);
  if (actor) {
    await logAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: "start_election",
      entityType: "election",
      entityId: election.id,
      details: { startsAt, endsAt },
    });
  }
  return data;
};

export const closeElection = async (db, electionId, actor = null, reason = "") => {
  const { data: election, error: findError } = await db.from("elections").select("*").eq("id", electionId).single();
  if (findError) throw findError;
  if (!["scheduled", "live"].includes(election.status)) {
    throw Object.assign(new Error("Only scheduled or live elections can be closed."), { status: 400 });
  }

  const now = new Date().toISOString();
  const { data, error } = await db
    .from("elections")
    .update({ status: "closed", ends_at: election.status === "live" ? now : election.ends_at, updated_at: now })
    .eq("id", electionId)
    .select("*")
    .single();
  if (error) throw error;

  await snapshotEligibleVoters(db, electionId);
  await notifyClosed(db, data);

  if (actor) {
    await logAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: "close_election",
      entityType: "election",
      entityId: electionId,
      details: { reason },
    });
  }
  return data;
};

export const getActiveElections = async (db) => {
  await synchronizeElectionStatuses(db);
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("elections")
    .select("*")
    .eq("status", "live")
    .lte("starts_at", now)
    .gt("ends_at", now)
    .order("starts_at", { ascending: false });
  if (error) throw error;
  return data || [];
};

export const getActiveElection = async (db) => {
  const elections = await getActiveElections(db);
  return elections[0] || null;
};


const getVoteCountsByOption = (votes = []) =>
  votes.reduce((counts, vote) => {
    counts[vote.option_id] = (counts[vote.option_id] || 0) + 1;
    return counts;
  }, {});

export const getElectionMetrics = async (db, electionId) => {
  const [electionResult, optionsResult, votesResult, voterRollResult, resultSnapshot] = await Promise.all([
    db.from("elections").select("*").eq("id", electionId).single(),
    db.from("election_options").select("*").eq("election_id", electionId).order("created_at"),
    db.from("votes").select("id, user_id, option_id, created_at, receipt_code").eq("election_id", electionId),
    db.from("election_voters").select("id, user_id, eligible, voted_at").eq("election_id", electionId).eq("eligible", true),
    db.from("election_results").select("*").eq("election_id", electionId).maybeSingle(),
  ]);

  if (electionResult.error) throw electionResult.error;
  if (optionsResult.error) throw optionsResult.error;
  if (votesResult.error) throw votesResult.error;
  if (voterRollResult.error) throw voterRollResult.error;
  if (resultSnapshot.error) throw resultSnapshot.error;

  let eligibleVoters = (voterRollResult.data || []).length;
  if (!eligibleVoters) {
    const { count, error } = await db
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "resident")
      .eq("is_active", true)
      .eq("status", "approved");
    if (error) throw error;
    eligibleVoters = count || 0;
  }

  const election = electionResult.data;
  const options = optionsResult.data || [];
  const votes = votesResult.data || [];
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

  const topVotes = mappedOptions.reduce((max, option) => Math.max(max, option.votes || 0), 0);
  const topOptions = topVotes > 0 ? mappedOptions.filter((option) => option.votes === topVotes) : [];
  const isTie = topOptions.length > 1;
  const computedWinner = topOptions.length === 1 ? topOptions[0] : null;
  const finalizedWinnerId = election.winning_option_id || resultSnapshot.data?.winning_option_id || null;
  const winner = finalizedWinnerId
    ? mappedOptions.find((option) => option.id === finalizedWinnerId) || computedWinner
    : computedWinner;

  return {
    id: election.id,
    title: election.title,
    description: election.description,
    status: election.status,
    startsAt: election.starts_at,
    endsAt: election.ends_at,
    imageUrl: election.image_url,
    sourceSuggestionId: election.source_suggestion_id,
    runoffOfElectionId: election.runoff_of_election_id,
    resultsVisibility: election.results_visibility || "after_close",
    finalizedAt: election.finalized_at,
    resultStatus: election.result_status || resultSnapshot.data?.result_status || (totalVotes === 0 ? "no_votes" : isTie ? "tie" : "winner"),
    totalVotes,
    eligibleVoters,
    notVotedCount: Math.max(eligibleVoters - totalVotes, 0),
    participationRate: eligibleVoters ? Number(((totalVotes / eligibleVoters) * 100).toFixed(1)) : 0,
    isTie,
    tiedOptionIds: isTie ? topOptions.map((option) => option.id) : [],
    winner: winner
      ? { id: winner.id, name: winner.name, votes: winner.votes, percentage: winner.percentage }
      : null,
    options: mappedOptions.map((option) => ({
      ...option,
      isWinner: Boolean(winner && winner.id === option.id && !isTie),
      isTiedLeader: Boolean(isTie && topOptions.some((item) => item.id === option.id)),
    })),
  };
};

export const canResidentSeeResults = (bundle, hasVoted = false) => {
  if (!bundle) return false;
  if (ACTIVE_RESULT_STATUSES.has(bundle.status) || bundle.status === "finalized") return true;
  if (bundle.resultsVisibility === "live") return true;
  if (bundle.resultsVisibility === "after_vote" && hasVoted) return true;
  return false;
};

export const hideElectionResults = (bundle) => ({
  ...bundle,
  // Aggregate participation is safe to show while option-level results stay hidden.
  // This prevents resident dashboards from rendering blank values / `null%`.
  winner: null,
  resultStatus: null,
  isTie: false,
  tiedOptionIds: [],
  options: (bundle.options || []).map(({ votes: _votes, percentage: _percentage, isWinner: _winner, isTiedLeader: _tie, ...option }) => option),
  resultsHidden: true,
});

export const finalizeElection = async (db, electionId, actor) => {
  await synchronizeElectionStatuses(db);
  const metrics = await getElectionMetrics(db, electionId);
  if (metrics.status !== "closed") {
    throw Object.assign(new Error("Only closed elections can be finalized."), { status: 400 });
  }

  const resultStatus = metrics.totalVotes === 0 ? "no_votes" : metrics.isTie ? "tie" : "winner";
  const winningOptionId = resultStatus === "winner" ? metrics.winner?.id || null : null;
  const now = new Date().toISOString();
  const snapshot = {
    options: metrics.options.map((option) => ({ id: option.id, name: option.name, votes: option.votes, percentage: option.percentage })),
    tiedOptionIds: metrics.tiedOptionIds,
  };

  const { error: resultError } = await db.from("election_results").upsert(
    {
      election_id: electionId,
      result_status: resultStatus,
      winning_option_id: winningOptionId,
      total_votes: metrics.totalVotes,
      eligible_voters: metrics.eligibleVoters,
      participation_rate: metrics.participationRate,
      finalized_by: actor.id,
      finalized_at: now,
      snapshot,
    },
    { onConflict: "election_id" }
  );
  if (resultError) throw resultError;

  const { data, error } = await db
    .from("elections")
    .update({
      status: "finalized",
      finalized_at: now,
      finalized_by: actor.id,
      result_status: resultStatus,
      winning_option_id: winningOptionId,
      updated_at: now,
    })
    .eq("id", electionId)
    .select("*")
    .single();
  if (error) throw error;

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: "finalize_election",
    entityType: "election",
    entityId: electionId,
    details: { resultStatus, winningOptionId, totalVotes: metrics.totalVotes },
  });

  return { election: data, resultStatus, winningOptionId, metrics: await getElectionMetrics(db, electionId) };
};

export const createRunoffElection = async (db, electionId, actor) => {
  const metrics = await getElectionMetrics(db, electionId);
  if (metrics.status !== "finalized" || metrics.resultStatus !== "tie" || metrics.tiedOptionIds.length < 2) {
    throw Object.assign(new Error("A runoff can only be created from a finalized tied election."), { status: 400 });
  }

  const tiedOptions = metrics.options.filter((option) => metrics.tiedOptionIds.includes(option.id));
  const { data: created, error } = await db
    .from("elections")
    .insert({
      title: `${metrics.title} — Runoff`,
      description: "Runoff voting created automatically because the previous election ended in a tie.",
      status: "draft",
      results_visibility: "after_close",
      runoff_of_election_id: electionId,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;

  const { error: optionError } = await db.from("election_options").insert(
    tiedOptions.map((option) => ({
      election_id: created.id,
      name: option.name,
      description: option.description,
      source_suggestion_id: option.sourceSuggestionId || null,
      image_url: option.imageUrl || null,
      votes_count: 0,
    }))
  );
  if (optionError) throw optionError;

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: "create_runoff_election",
    entityType: "election",
    entityId: created.id,
    details: { sourceElectionId: electionId, tiedOptionIds: metrics.tiedOptionIds },
  });
  return created;
};

export const createCommunityProjectFromElection = async (db, electionId, actor) => {
  const metrics = await getElectionMetrics(db, electionId);
  if (metrics.status !== "finalized" || metrics.resultStatus !== "winner" || !metrics.winner) {
    throw Object.assign(new Error("Finalize a winning election result before creating the community project."), { status: 400 });
  }

  const winningOption = metrics.options.find((option) => option.id === metrics.winner.id);
  const { data: existing, error: existingError } = await db
    .from("community_projects")
    .select("*")
    .eq("source_election_id", electionId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;

  const { data, error } = await db
    .from("community_projects")
    .insert({
      source_election_id: electionId,
      winning_option_id: winningOption.id,
      source_suggestion_id: winningOption.sourceSuggestionId || null,
      title: winningOption.name,
      description: winningOption.description || "",
      status: "planned",
      progress_percentage: 0,
      created_by: actor.id,
    })
    .select("*")
    .single();
  if (error) throw error;

  if (winningOption.sourceSuggestionId) {
    await db
      .from("project_suggestions")
      .update({ status: "selected", updated_at: new Date().toISOString() })
      .eq("id", winningOption.sourceSuggestionId);
  }

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: "create_community_project",
    entityType: "community_project",
    entityId: data.id,
    details: { sourceElectionId: electionId, winningOptionId: winningOption.id },
  });
  return data;
};

export const getCommunityProjects = async (db, { userId = null } = {}) => {
  const { data, error } = await db
    .from("community_projects")
    .select("*, project_updates(*), project_completion_confirmations(id, user_id, created_at)")
    .order("updated_at", { ascending: false });
  if (error) throw error;

  // Never expose resident identifiers from completion confirmations to public/resident clients.
  return (data || []).map((project) => {
    const confirmations = project.project_completion_confirmations || [];
    const { project_completion_confirmations: _privateConfirmations, ...safeProject } = project;
    return {
      ...safeProject,
      confirmation_count: confirmations.length,
      confirmed_by_me: Boolean(userId && confirmations.some((item) => item.user_id === userId)),
      project_updates: [...(project.project_updates || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    };
  });
};

export const getElectionMonitoring = async (db, electionId) => {
  const metrics = await getElectionMetrics(db, electionId);
  const { data, error } = await db
    .from("election_voters")
    .select("voted_at, eligible, users!election_voters_user_id_fkey(purok)")
    .eq("election_id", electionId)
    .eq("eligible", true);
  if (error) throw error;

  const byPurok = new Map();
  for (const row of data || []) {
    const purok = row.users?.purok || "Unspecified";
    const current = byPurok.get(purok) || { purok, eligible: 0, voted: 0 };
    current.eligible += 1;
    if (row.voted_at) current.voted += 1;
    byPurok.set(purok, current);
  }

  return {
    ...metrics,
    purokBreakdown: Array.from(byPurok.values()).map((item) => ({
      ...item,
      participationRate: item.eligible ? Number(((item.voted / item.eligible) * 100).toFixed(1)) : 0,
    })),
  };
};
