import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classifyElectionOutcome, phaseStatus, mapVotingRpcError } from '../src/lib/votingOutcome.js';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const sql = read('supabase-v4-phase10-project-lifecycle.sql');
const voting = read('src/routes/voting.js');
const adminVoting = read('src/routes/adminVoting.js');
const admin = read('src/routes/admin.js');

const options = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const votes = (...ids) => ids.map((option_id) => ({ option_id }));
test('exact tie never selects a winner, even when finalized', () => {
  const result = classifyElectionOutcome(options, votes('a','a','b','b','c'), { finalized: true });
  assert.equal(result.kind, 'tie'); assert.equal(result.winner, null);
  assert.equal(result.tiedOptions.length, 2);
});
test('zero vote result cannot select a winner', () => {
  const result = classifyElectionOutcome(options, [], { finalized: true });
  assert.equal(result.kind, 'no_votes'); assert.equal(result.winner, null);
});
test('leader is not a finalized winner while voting is open', () => {
  const result = classifyElectionOutcome(options, votes('a','a','b'), { finalized: false });
  assert.equal(result.kind, 'winner'); assert.equal(result.winner, null);
  assert.equal(result.provisionalLeader.id, 'a');
});
test('unique winner returns only in finalized state', () => {
  const result = classifyElectionOutcome(options, votes('a','a','b'), { finalized: true });
  assert.equal(result.winner.id, 'a'); assert.equal(result.totalVotes, 3);
});
test('scheduled published election is not open to voters early', () => {
  assert.equal(phaseStatus({ status:'live', starts_at:'2030-01-03T00:00:00Z', ends_at:'2030-01-07T00:00:00Z' },new Date('2030-01-01')), 'scheduled');
  assert.equal(phaseStatus({ status:'live', starts_at:'2030-01-03T00:00:00Z', ends_at:'2030-01-07T00:00:00Z' },new Date('2030-01-08')), 'awaiting_finalization');
});
test('conflict errors use HTTP 409 and unauthorized use HTTP 403', () => {
  assert.equal(mapVotingRpcError({ code: '23505',message:'Duplicate vote' }).status,409);
  assert.equal(mapVotingRpcError({ code: '42501',message:'Forbidden' }).status,403);
});
test('SQL vote transaction verifies eligibility and locks elections', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.bgy_phase10_cast_vote/);
  assert.match(sql, /WHERE id=eid FOR UPDATE/);
  assert.match(sql, /public\.votes\(election_id,option_id,user_id\)/);
  assert.match(sql, /Voting option does not belong to the election/);
});
test('SQL finalization explicitly handles ties/no votes and idempotent project', () => {
  assert.match(sql, /WHEN array_length\(winners,1\)>1 THEN 'tie'/);
  assert.match(sql, /WHEN total=0 THEN 'no_votes'/);
  assert.match(sql, /ON CONFLICT \(election_id\) DO NOTHING/);
  assert.match(sql, /IF e\.finalized_at IS NOT NULL THEN RETURN e/);
});
test('published options and user vote records are immutable', () => {
  assert.match(sql, /bgy_phase10_lock_published_options/);
  assert.match(sql, /Committed votes cannot be edited or deleted/);
  assert.match(sql, /Published elections and ballots are locked/);
});
test('audit redacts ballot identifiers and IP metadata', () => {
  assert.match(sql, /actor_role_value := 'anonymous_ballot'/);
  assert.match(sql, /TG_TABLE_NAME='votes' THEN NULL ELSE nullif\(headers->>'x-bgy-audit-ip'/);
  assert.match(sql, /jsonb_build_object\('election_id',NEW\.election_id\)/);
  assert.doesNotMatch(voting, /details: \{ optionId:/);
});
test('voting GET routes do not synchronize vote counts or close elections', () => {
  assert.doesNotMatch(voting, /syncOptionVoteCounts|closeExpiredLiveElections/);
  assert.doesNotMatch(adminVoting, /syncOptionVoteCounts|closeExpiredLiveElections/);
});
test('project milestones are published and corrected transactionally', () => {
  assert.match(sql, /bgy_phase10_publish_project_update/);
  assert.match(sql, /bgy_phase10_correct_project_update/);
  assert.match(sql, /bgy_phase10_update_project/);
  assert.match(admin, /db\.rpc\("bgy_phase10_publish_project_update"/);
  assert.match(admin, /db\.rpc\("bgy_phase10_correct_project_update"/);
  assert.match(admin, /db\.rpc\("bgy_phase10_update_project"/);
});
test('resident completion acknowledgment requires official completed project', () => {
  assert.match(sql, /WHERE election_id=p_election AND status='completed'/);
  assert.match(voting, /bgy_phase10_acknowledge_completion/);
  assert.match(sql, /acknowledged_after_official_completion/);
});
test('notifications are queued in transaction and dispatched with row locks', () => {
  assert.match(sql, /bgy_phase10_notification_outbox/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /ON CONFLICT \(event_key\) DO NOTHING/);
});
test('Phase 10 schema readiness is checked on startup', () => {
  assert.match(read('src/index.js'), /rpc\("bgy_phase10_ready"\)/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.bgy_phase10_ready/);
});
test('published suggestion snapshots cannot be rewritten through later moderation', () => {
  assert.match(sql, /bgy_phase10_lock_published_suggestions/);
  assert.match(sql, /A suggestion on a published ballot cannot be altered/);
});
test('runoff candidates must equal the finalized top-tied suggestions', () => {
  assert.match(sql, /Runoff parent must be a finalized tied election/);
  assert.match(sql, /Runoff candidates must match the tied highest-vote suggestions/);
  assert.match(read('..\/client\/src\/pages\/admin\/Admin_VotingResult.jsx'), /Prepare Runoff/);
});
test('future scheduled rounds enqueue a single opening announcement', () => {
  assert.match(sql, /bgy_phase10_queue_opened_rounds/);
  assert.match(sql, /opened_notified_at IS NULL/);
  assert.match(read('src/lib/scheduler.js'), /bgy_phase10_queue_opened_rounds/);
});
test('published election details and finalized elections are protected', () => {
  assert.match(sql, /bgy_phase10_protect_election/);
  assert.match(sql, /Finalized elections cannot be edited/);
  assert.match(sql, /current_setting\('bgy.phase10_finalizing',true\)/);
});
