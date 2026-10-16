/** Authoritative result classification from committed vote totals (never votes_count cache). */
export const classifyElectionOutcome = (options = [], votes = [], { finalized = false } = {}) => {
  const tally = new Map(options.map((option) => [option.id, 0]));
  for (const vote of votes) if (tally.has(vote.option_id)) tally.set(vote.option_id, tally.get(vote.option_id) + 1);
  const totalVotes = [...tally.values()].reduce((sum, n) => sum + n, 0);
  const highest = Math.max(0, ...tally.values());
  const leaders = highest > 0 ? options.filter((option) => tally.get(option.id) === highest) : [];
  const kind = totalVotes === 0 ? 'no_votes' : leaders.length > 1 ? 'tie' : 'winner';
  return { kind, totalVotes, counts: Object.fromEntries(tally), winner: kind === 'winner' && finalized ? leaders[0] : null,
    provisionalLeader: kind === 'winner' && !finalized ? leaders[0] : null,
    tiedOptions: kind === 'tie' ? leaders : [] };
};

export const phaseStatus = (election, now = new Date()) => {
  if (!election) return 'draft';
  if (election.status === 'live' && new Date(election.starts_at).getTime() > now.getTime()) return 'scheduled';
  if (election.status === 'live' && new Date(election.ends_at).getTime() <= now.getTime()) return 'awaiting_finalization';
  return election.status;
};

export const mapVotingRpcError = (error) => {
  const message = `${error?.message || 'Voting operation failed.'}`;
  const code = `${error?.code || ''}`;
  const status = code === '42501' ? 403 : code === 'P0002' ? 404 : ['23514', '23505'].includes(code) ? 409 : 400;
  return Object.assign(new Error(message), { status, code });
};
