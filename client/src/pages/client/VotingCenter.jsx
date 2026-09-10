import { CheckCircle2, Circle, Clock3, Vote } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Card, EmptyState, Modal, PageHeader } from "../../components/ui";
import { countdownText, formatDateTime } from "../../lib/format";

const VotingCenter = () => {
  const { token, user } = useAuth();
  const toast = useToast();

  const [election, setElection] = useState(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [selectedOptionId, setSelectedOptionId] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isResident = user?.role === "resident";

  const load = async () => {
    setLoading(true);

    try {
      const [electionData, statusData] = await Promise.all([
        api("/voting/current", { token }),
        token
          ? api("/voting/my-status", { token }).catch(() => ({
              hasVoted: false,
              electionId: null,
            }))
          : Promise.resolve({ hasVoted: false, electionId: null }),
      ]);

      const activeElection = electionData.election?.status === "live" ? electionData.election : null;

      setElection(activeElection);
      setHasVoted(Boolean(activeElection && statusData.electionId === activeElection.id && statusData.hasVoted));
      setSelectedOptionId("");
    } catch (error) {
      toast.error(error.message);
      setElection(null);
      setHasVoted(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [token]);

  const options = election?.options || [];

  const selectedOption = useMemo(
    () => options.find((option) => option.id === selectedOptionId) || null,
    [options, selectedOptionId]
  );

  const isLive = election?.status === "live";
  const canVote = isLive && !hasVoted && isResident;

  const castVote = async () => {
    if (!selectedOptionId) {
      toast.error("Choose an option first.");
      return;
    }

    let submitted = false;

    setSaving(true);

    try {
      await api("/voting/vote", {
        method: "POST",
        token,
        body: { optionId: selectedOptionId },
      });

      submitted = true;
      toast.success("Your vote has been recorded.");
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);

      if (submitted) {
        setConfirmOpen(false);
      }
    }
  };

  if (loading) {
    return <div className="text-sm text-stone-500">Loading active voting...</div>;
  }

  if (!election) {
    return (
      <EmptyState
        title="No active voting right now"
        description="There is no live recommended project voting posted by the barangay admin."
      />
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Voting Center"
        title={election.title}
        description={
          election.description ||
          "Review the approved project suggestions and cast your vote while voting is open."
        }
      />

      <Card className="overflow-hidden p-0">
        <div className="grid gap-0 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="h-72 bg-[var(--brand-50)] lg:h-full">
            {election.imageUrl ? (
              <img src={election.imageUrl} alt={election.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center bg-[linear-gradient(135deg,#dfeedd,#ffffff)] text-[var(--brand-600)]">
                <Vote className="h-12 w-12" />
              </div>
            )}
          </div>

          <div className="space-y-6 p-6">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone="warning">Voting Open</Badge>

              <div className="inline-flex items-center gap-2 rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-700">
                <Clock3 className="h-3.5 w-3.5" />
                {countdownText(election.endsAt)}
              </div>

              <span className="text-xs font-semibold text-stone-500">
                Closes {formatDateTime(election.endsAt)}
              </span>
            </div>

            {isLive && !isResident && !hasVoted ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                Only registered residents can cast a vote.
              </div>
            ) : null}

            {hasVoted ? (
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-2 text-sm font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                Your vote has already been counted.
              </div>
            ) : null}

            <div className="space-y-3">
              {options.map((option) => {
                const selected = selectedOptionId === option.id;

                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => canVote && setSelectedOptionId(option.id)}
                    disabled={!canVote}
                    className={`w-full rounded-3xl border p-4 text-left transition ${
                      selected
                        ? "border-[var(--brand-500)] bg-[var(--brand-50)] ring-4 ring-[var(--brand-100)]"
                        : "border-stone-200 bg-white hover:border-[var(--brand-200)]"
                    } disabled:cursor-default disabled:hover:border-stone-200`}
                  >
                    <div className="flex items-start gap-4">
                      {option.imageUrl ? (
                        <img
                          src={option.imageUrl}
                          alt={option.name}
                          className="h-20 w-20 rounded-2xl object-cover"
                        />
                      ) : null}

                      <div className={`mt-1 rounded-full ${selected ? "text-[var(--brand-600)]" : "text-stone-400"}`}>
                        {selected ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
                      </div>

                      <div className="min-w-0 flex-1">
                        <h3 className="text-lg font-bold text-[var(--brand-900)]">{option.name}</h3>
                        <p className="mt-1 text-sm text-stone-500">
                          {option.description || "No extra description provided."}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {canVote ? (
              <Button onClick={() => setConfirmOpen(true)} disabled={!selectedOptionId || saving}>
                <Vote className="h-4 w-4" />
                Review Vote
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm Vote"
        description="Votes are final and cannot be changed after submission."
        widthClass="max-w-xl"
      >
        <div className="space-y-5">
          <div className="rounded-3xl border border-stone-200 bg-stone-50 p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--brand-500)]">
              Selected project suggestion
            </p>

            <h3 className="mt-2 text-2xl font-black text-[var(--brand-900)]">
              {selectedOption?.name || "No option selected"}
            </h3>

            {selectedOption?.description ? (
              <p className="mt-2 text-sm text-stone-600">{selectedOption.description}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={castVote} loading={saving} disabled={!selectedOptionId}>
              Submit Vote
            </Button>

            <Button type="button" variant="ghost" onClick={() => setConfirmOpen(false)}>
              Back
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default VotingCenter;
