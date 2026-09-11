const getVoteCounts = (votes = []) => votes.reduce((map, vote) => {
  map[vote.option_id] = (map[vote.option_id] || 0) + 1;
  return map;
}, {});

export const getElectionWinner = async (db, electionId) => {
  const [electionResult, optionsResult, votesResult] = await Promise.all([
    db.from("elections").select("*").eq("id", electionId).single(),
    db.from("election_options").select("*").eq("election_id", electionId).order("created_at"),
    db.from("votes").select("option_id").eq("election_id", electionId),
  ]);
  if (electionResult.error) throw electionResult.error;
  if (optionsResult.error) throw optionsResult.error;
  if (votesResult.error) throw votesResult.error;

  const counts = getVoteCounts(votesResult.data || []);
  const ranked = (optionsResult.data || [])
    .map((option) => ({ ...option, votes: counts[option.id] || 0 }))
    .sort((a, b) => b.votes - a.votes || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  return {
    election: electionResult.data,
    winner: ranked[0] && ranked[0].votes > 0 ? ranked[0] : null,
    options: ranked,
    totalVotes: (votesResult.data || []).length,
  };
};

export const ensureCommunityProjectForElection = async (db, electionId, { createdBy = null } = {}) => {
  const { data: existing, error: existingError } = await db
    .from("community_projects")
    .select("*")
    .eq("election_id", electionId)
    .maybeSingle();
  if (existingError) {
    // Old databases without V4 simply skip auto-project creation until migration is applied.
    if (`${existingError.message || ""}`.toLowerCase().includes("community_projects")) return null;
    throw existingError;
  }
  if (existing) return existing;

  const { election, winner } = await getElectionWinner(db, electionId);
  if (election.status !== "closed" || !winner) return null;

  const payload = {
    election_id: election.id,
    election_option_id: winner.id,
    source_suggestion_id: winner.source_suggestion_id || null,
    title: winner.name,
    description: winner.description || election.description || "",
    cover_image_url: winner.image_url || election.image_url || null,
    status: "planned",
    progress_percentage: 0,
    created_by: createdBy,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db.from("community_projects").insert(payload).select("*").single();
  if (error) {
    // Handle a race between maintenance and an admin request.
    if (`${error.code || ""}` === "23505") {
      const { data: afterRace, error: afterRaceError } = await db.from("community_projects").select("*").eq("election_id", electionId).single();
      if (afterRaceError) throw afterRaceError;
      return afterRace;
    }
    throw error;
  }
  return data;
};

export const ensureProjectsForClosedElections = async (db, { createdBy = null } = {}) => {
  const { data, error } = await db.from("elections").select("id").eq("status", "closed");
  if (error) throw error;
  const projects = [];
  for (const election of data || []) {
    const project = await ensureCommunityProjectForElection(db, election.id, { createdBy });
    if (project) projects.push(project);
  }
  return projects;
};
