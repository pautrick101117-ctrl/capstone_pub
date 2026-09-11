import { CheckCircle2, Circle, Clock3, Info, Vote } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, Modal, PageHeader } from "../../components/ui";
import { countdownText, formatDateTime } from "../../lib/format";

const guideSteps = [
  ["1", "Review projects", "Read the approved community project choices prepared for this voting period."],
  ["2", "Select one", "Choose the project you believe should be prioritized."],
  ["3", "Review your vote", "Check your selected project before submitting."],
  ["4", "Submit final vote", "Each eligible resident can submit only one final vote for this election."],
  ["5", "View results", "Results are intended to be reviewed after the voting period closes."],
];

const VotingCenter = () => {
  const { token, user } = useAuth();
  const toast = useToast();
  const [election, setElection] = useState(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [selectedOptionId, setSelectedOptionId] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isResident = user?.role === "resident";

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [electionData, statusData] = await Promise.all([
        api("/voting/current", { token }),
        token ? api("/voting/my-status", { token }).catch(() => ({ hasVoted: false, electionId: null })) : Promise.resolve({ hasVoted: false, electionId: null }),
      ]);
      const activeElection = electionData.election?.status === "live" ? electionData.election : null;
      setElection(activeElection);
      setHasVoted(Boolean(activeElection && statusData.electionId === activeElection.id && statusData.hasVoted));
      setSelectedOptionId("");
    } catch (loadError) {
      setError(loadError.message || "Unable to load the current voting period.");
      setElection(null);
      setHasVoted(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const options = election?.options || [];
  const selectedOption = useMemo(() => options.find((option) => option.id === selectedOptionId) || null, [options, selectedOptionId]);
  const canVote = election?.status === "live" && !hasVoted && isResident;

  const castVote = async () => {
    if (!selectedOptionId) return toast.error("Choose a project first.");
    setSaving(true);
    try {
      await api("/voting/vote", { method: "POST", token, body: { optionId: selectedOptionId } });
      toast.success("Your vote has been recorded.");
      setConfirmOpen(false);
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="space-y-8"><PageHeader eyebrow="Resident Participation" title="Community Project Voting" description="Loading the current voting period and your participation status." /><LoadingState rows={4} /></div>;
  if (error) return <div className="space-y-8"><PageHeader eyebrow="Resident Participation" title="Community Project Voting" description="Registered residents can help prioritize approved community projects." /><ErrorState description={error} onRetry={load} /></div>;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Resident Participation"
        title="Community Project Voting"
        description="Registered residents can help prioritize barangay-approved community project choices during an active voting period."
      />

      <Card className="bg-gradient-to-br from-white to-[var(--brand-50)]">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-[var(--brand-500)]/10 p-3 text-[var(--brand-600)]"><Info className="h-5 w-5" /></div>
          <div><h2 className="text-xl font-bold text-[var(--brand-900)]">How community project voting works</h2><p className="mt-1 text-sm text-stone-600">Project suggestions are reviewed by the barangay first. Approved choices may then be included in an official voting period for residents.</p></div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {guideSteps.map(([number, title, description]) => (
            <div key={number} className="rounded-2xl border border-[var(--brand-100)] bg-white p-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand-500)] text-sm font-bold text-white">{number}</span>
              <p className="mt-3 font-semibold text-[var(--brand-900)]">{title}</p>
              <p className="mt-1 text-xs leading-5 text-stone-500">{description}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-600">
          <strong>Process:</strong> Resident suggestion → Barangay review → Approved voting choices → Resident vote → Voting closes → Results.
        </div>
      </Card>

      {!election ? (
        <EmptyState title="No active voting right now" description="There is currently no live community project voting period. Check back when the barangay publishes the next vote." />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="grid gap-0 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="h-72 bg-[var(--brand-50)] lg:h-full">
              {election.imageUrl ? <img src={election.imageUrl} alt={election.title} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center bg-[linear-gradient(135deg,#dfeedd,#ffffff)] text-[var(--brand-600)]"><Vote className="h-12 w-12" /></div>}
            </div>
            <div className="space-y-6 p-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--brand-500)]">Current voting period</p>
                <h2 className="mt-2 text-2xl font-black text-[var(--brand-900)]">{election.title}</h2>
                <p className="mt-2 text-sm leading-6 text-stone-600">{election.description || "Review the approved project choices below and select one project to prioritize."}</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Badge tone="warning">Voting Open</Badge>
                <div className="inline-flex items-center gap-2 rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-700"><Clock3 className="h-3.5 w-3.5" />{countdownText(election.endsAt)}</div>
                <span className="text-xs font-semibold text-stone-500">Closes {formatDateTime(election.endsAt)}</span>
              </div>

              <div className={`rounded-2xl border p-4 ${hasVoted ? "border-emerald-200 bg-emerald-50" : "border-[var(--brand-200)] bg-[var(--brand-50)]"}`}>
                <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">Your voting status</p>
                {hasVoted ? (
                  <div className="mt-2 flex items-start gap-2 text-emerald-800"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-bold">Vote recorded</p><p className="mt-1 text-sm">Your vote has been counted and cannot be changed. Results can be reviewed when the voting period has ended.</p></div></div>
                ) : (
                  <p className="mt-2 text-sm font-semibold text-[var(--brand-800)]">You have not voted yet. Select one project below, review it, then submit your final vote.</p>
                )}
              </div>

              {!isResident && !hasVoted ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">Only registered resident accounts can cast a vote.</div> : null}

              <div>
                <h3 className="font-bold text-[var(--brand-900)]">Approved project choices</h3>
                <p className="mt-1 text-sm text-stone-500">Choose based on the project details. Live vote totals are not shown here while voting is open.</p>
              </div>

              <div className="space-y-3">
                {options.map((option) => {
                  const selected = selectedOptionId === option.id;
                  return (
                    <button key={option.id} type="button" onClick={() => canVote && setSelectedOptionId(option.id)} disabled={!canVote} className={`w-full rounded-3xl border p-4 text-left transition ${selected ? "border-[var(--brand-500)] bg-[var(--brand-50)] ring-4 ring-[var(--brand-100)]" : "border-stone-200 bg-white hover:border-[var(--brand-200)]"} disabled:cursor-default disabled:hover:border-stone-200`}>
                      <div className="flex items-start gap-4">
                        {option.imageUrl ? <img src={option.imageUrl} alt={option.name} className="h-20 w-20 rounded-2xl object-cover" /> : null}
                        <div className={`mt-1 ${selected ? "text-[var(--brand-600)]" : "text-stone-400"}`}>{selected ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}</div>
                        <div className="min-w-0 flex-1"><h3 className="text-lg font-bold text-[var(--brand-900)]">{option.name}</h3><p className="mt-1 text-sm text-stone-500">{option.description || "No extra description provided."}</p></div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {canVote ? <Button onClick={() => setConfirmOpen(true)} disabled={!selectedOptionId || saving}><Vote className="h-4 w-4" /> Review Vote</Button> : null}
              {hasVoted ? <Link to="/portal/voting-result" className="inline-flex rounded-full border border-[var(--brand-200)] bg-white px-4 py-2 text-sm font-semibold text-[var(--brand-700)] hover:bg-[var(--brand-50)]">Go to Project Voting Results</Link> : null}
            </div>
          </div>
        </Card>
      )}

      <Modal open={confirmOpen} onClose={() => !saving && setConfirmOpen(false)} title="Review your final vote" description="Check your selected project carefully. Once submitted, this vote cannot be changed." widthClass="max-w-xl">
        <div className="space-y-5">
          <div className="rounded-3xl border border-stone-200 bg-stone-50 p-5"><p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--brand-500)]">Selected project</p><h3 className="mt-2 text-2xl font-black text-[var(--brand-900)]">{selectedOption?.name || "No project selected"}</h3>{selectedOption?.description ? <p className="mt-2 text-sm text-stone-600">{selectedOption.description}</p> : null}</div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>Final action:</strong> You can submit only one vote in this voting period. You will not be able to switch projects afterward.</div>
          <div className="flex flex-wrap gap-3"><Button onClick={castVote} loading={saving} disabled={!selectedOptionId}>Submit Final Vote</Button><Button type="button" variant="ghost" onClick={() => setConfirmOpen(false)} disabled={saving}>Go Back</Button></div>
        </div>
      </Modal>
    </div>
  );
};

export default VotingCenter;

