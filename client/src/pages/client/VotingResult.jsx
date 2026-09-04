import { CircleAlert, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../lib/api";
import { AlertBanner, Card, EmptyState, PageHeader, StatusBadge } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

const clampPercentage = (value) => Math.min(100, Math.max(0, Number(value || 0)));

const VotingResult = () => {
  const [election, setElection] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try { const data = await api("/voting/results/latest"); setElection(data.election || null); }
    catch { setElection(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if (loading) return <section className="section-shell py-10"><p className="text-sm text-stone-500">Loading voting results...</p></section>;
  if (!election) return <section className="section-shell py-10"><EmptyState title="No closed voting results yet" description="Official result data will appear after a voting period closes." /></section>;

  const options = election.options || [];
  const hasVotes = (election.totalVotes || 0) > 0;

  return (
    <section className="section-shell py-10 sm:py-14">
      <PageHeader eyebrow="Voting Results" title={election.title} description={election.description || "Final and historical resident voting results."} />
      <div className="mt-8 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card className="space-y-5">
          <div className="flex flex-wrap items-center gap-3"><StatusBadge status={election.status} /><span className="text-sm font-semibold text-stone-500">Ended {formatDateTime(election.endsAt)}</span></div>
          <div className="grid gap-4 sm:grid-cols-2">{[["Votes Cast", election.totalVotes || 0],["Eligible Residents", election.eligibleVoters || 0],["Participation Rate", hasVotes ? `${election.participationRate || 0}%` : "—"],["Not Yet Voted", election.notVotedCount ?? "—"]].map(([label,value]) => <div key={label} className="rounded-2xl bg-[var(--brand-50)] p-4"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-500)]">{label}</p><p className="mt-2 text-2xl font-black text-[var(--brand-900)]">{value}</p></div>)}</div>
          {election.resultStatus === "tie" || election.isTie ? <AlertBanner tone="warning" title="Tied result"><span>The top options received the same number of votes. The barangay may conduct a runoff election.</span></AlertBanner> : election.winner ? <AlertBanner tone="success" title={`Winning option: ${election.winner.name}`}><span>{election.winner.votes} votes • {election.winner.percentage || 0}%</span></AlertBanner> : <AlertBanner tone="info" title="No winner recorded">No votes were recorded or finalization is still pending.</AlertBanner>}
          <p className="text-sm text-stone-500">Voting period: {formatDateTime(election.startsAt)} — {formatDateTime(election.endsAt)}</p>
        </Card>

        <Card>
          <h2 className="text-xl font-bold text-[var(--brand-900)]">Option performance</h2>
          {!hasVotes ? (
            <div className="mt-6">
              <EmptyState title="No votes recorded" description="This election closed without recorded votes." />
            </div>
          ) : (
            <>
              <div className="mt-6 h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={options}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="votes" fill="var(--brand-500)" radius={[10, 10, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {options.map((option) => {
                  const percentage = clampPercentage(option.percentage);
                  return (
                    <div
                      key={option.id}
                      className={`rounded-2xl border p-4 ${
                        option.isWinner
                          ? "border-emerald-300 bg-emerald-50"
                          : option.isTiedLeader
                            ? "border-amber-300 bg-amber-50"
                            : "border-stone-200 bg-white"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {option.imageUrl ? (
                          <img
                            src={option.imageUrl}
                            alt={option.name}
                            className="h-20 w-20 rounded-2xl object-cover"
                          />
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-[var(--brand-900)]">{option.name}</p>
                              <p className="mt-1 text-sm text-stone-500">
                                {option.description || "No description provided."}
                              </p>
                            </div>
                            {option.isWinner ? (
                              <Trophy className="h-5 w-5 shrink-0 text-amber-600" />
                            ) : option.isTiedLeader ? (
                              <CircleAlert className="h-5 w-5 shrink-0 text-amber-600" />
                            ) : null}
                          </div>
                          <div className="mt-4">
                            <div className="mb-2 flex justify-between text-xs font-semibold text-stone-500">
                              <span>{option.votes || 0} votes</span>
                              <span>{percentage}%</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-stone-100">
                              <div
                                className="h-full rounded-full bg-[var(--brand-500)]"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>
      </div>
    </section>
  );
};

export default VotingResult;
