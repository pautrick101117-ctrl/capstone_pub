import { CheckCircle2, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Card, EmptyState, PageHeader } from "../../components/ui";
import { countdownText, formatDateTime } from "../../lib/format";

const clampPercentage = (value) => Math.min(100, Math.max(0, Number(value || 0)));

const getStatusTone = (status) => {
  if (status === "closed") return "success";
  if (status === "live") return "warning";
  return "neutral";
};

const VotingResult = () => {
  const { token, user } = useAuth();
  const toast = useToast();

  const [election, setElection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [completionSaving, setCompletionSaving] = useState(false);
  const [hasConfirmedCompletion, setHasConfirmedCompletion] = useState(false);

  const isResident = user?.role === "resident";

  const load = async () => {
    setLoading(true);

    try {
      const data = await api("/voting/results/latest");
      setElection(data.election || null);
    } catch {
      setElection(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const markCompleted = async () => {
    if (!election?.id) return;

    setCompletionSaving(true);

    try {
      await api("/voting/mark-completed", {
        method: "POST",
        token,
        body: { electionId: election.id },
      });

      setHasConfirmedCompletion(true);
      toast.success("Project delivery confirmation submitted.");
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setCompletionSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="section-shell py-10">
        <p className="text-sm text-stone-500">Loading voting results...</p>
      </section>
    );
  }

  if (!election) {
    return (
      <section className="section-shell py-10">
        <EmptyState
          title="No voting results yet"
          description="Voting results will appear here once a voting post has been posted from the database."
        />
      </section>
    );
  }

  const isLive = election.status === "live";
  const isClosed = election.status === "closed";
  const hasVotes = (election.totalVotes || 0) > 0;
  const options = election.options || [];
  const winner = options.find((option) => option.isWinner) || null;
  const winnerLabel = isClosed ? "Winner" : isLive ? "Current Leader" : "Leader";

  return (
    <section className="section-shell py-10 sm:py-14">
      <PageHeader
        eyebrow="Voting Results"
        title={election.title}
        description={
          election.description ||
          "Results are based on resident votes from the posted approved project suggestions."
        }
      />

      <div className="mt-8 grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
        <Card className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={getStatusTone(election.status)}>{election.status}</Badge>

            {isLive ? <Badge tone="neutral">{countdownText(election.endsAt)}</Badge> : null}

            {isClosed ? (
              <span className="text-sm font-semibold text-stone-500">
                Ended {formatDateTime(election.endsAt)}
              </span>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ["Votes Cast", election.totalVotes || 0],
              ["Eligible Residents", election.eligibleVoters || 0],
              ["Participation Rate", hasVotes ? `${election.participationRate || 0}%` : "—"],
              ["Completion Confirmations", election.completionCount || 0],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-[var(--brand-50)] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--brand-500)]">
                  {label}
                </p>
                <p className="mt-2 text-2xl font-black text-[var(--brand-900)]">{value}</p>
              </div>
            ))}
          </div>

          {winner && hasVotes ? (
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
              <div className="flex items-center gap-3">
                <Trophy className="h-5 w-5 text-emerald-600" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">
                    {winnerLabel}
                  </p>
                  <h2 className="text-xl font-bold text-emerald-900">{winner.name}</h2>
                </div>
              </div>
            </div>
          ) : null}

          {isClosed && isResident ? (
            <div className="rounded-3xl border border-stone-200 bg-stone-50 p-4">
              {hasConfirmedCompletion ? (
                <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-2 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  Completion confirmed.
                </div>
              ) : (
                <Button onClick={markCompleted} loading={completionSaving}>
                  <CheckCircle2 className="h-4 w-4" />
                  Confirm Project Completed
                </Button>
              )}
            </div>
          ) : null}

          <p className="text-sm text-stone-500">
            Voting period: {formatDateTime(election.startsAt)} — {formatDateTime(election.endsAt)}
          </p>
        </Card>

        <Card>
          <h2 className="text-xl font-bold text-[var(--brand-900)]">Option performance</h2>

          {!hasVotes ? (
            <div className="mt-6">
              <EmptyState
                title="No votes yet"
                description="Vote counts and option performance will appear once residents cast votes."
              />
            </div>
          ) : (
            <>
              <div className="mt-6 h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={options}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="votes" fill="var(--brand-500)" radius={[12, 12, 0, 0]} />
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
                        option.isWinner ? "border-emerald-300 bg-emerald-50" : "border-stone-200 bg-white"
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

                            {option.isWinner ? <Badge tone="success">{winnerLabel}</Badge> : null}
                          </div>

                          <div className="mt-4">
                            <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-stone-500">
                              <span>
                                {option.votes || 0} vote{option.votes === 1 ? "" : "s"}
                              </span>
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
