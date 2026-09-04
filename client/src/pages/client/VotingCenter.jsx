import { CalendarClock, CheckCircle2, Circle, Clock3, Flag, History, ReceiptText, Vote } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { AlertBanner, Button, Card, EmptyState, Modal, PageError, PageHeader, StatusBadge, Tabs } from "../../components/ui";
import { countdownText, formatDateTime } from "../../lib/format";

const tabs = [
  { value: "current", label: "Current Voting" },
  { value: "upcoming", label: "Upcoming" },
  { value: "activity", label: "My Voting Activity" },
  { value: "projects", label: "Community Projects" },
];

const VotingCenter = () => {
  const { token, user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState("current");
  const [elections, setElections] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [activity, setActivity] = useState([]);
  const [projects, setProjects] = useState([]);
  const [statusByElection, setStatusByElection] = useState({});
  const [selectedOptionByElection, setSelectedOptionByElection] = useState({});
  const [confirmElectionId, setConfirmElectionId] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [receiptElectionTitle, setReceiptElectionTitle] = useState("");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingElectionId, setSavingElectionId] = useState("");
  const [error, setError] = useState("");

  const isResident = user?.role === "resident";

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [electionData, statusData, upcomingData, activityData, projectData] = await Promise.all([
        api("/voting/current", { token }),
        api("/voting/my-status", { token }).catch(() => ({ statuses: [] })),
        api("/voting/upcoming", { token }),
        api("/voting/my-history", { token }).catch(() => ({ activity: [] })),
        api("/voting/projects", { token }).catch(() => ({ projects: [] })),
      ]);

      const activeElections = (electionData.elections || (electionData.election ? [electionData.election] : []))
        .filter((item) => item?.status === "live");
      const nextStatusMap = Object.fromEntries(
        (statusData.statuses || []).map((item) => [item.electionId, item])
      );

      // Backward compatibility for older API responses.
      if (!statusData.statuses && statusData.electionId) {
        nextStatusMap[statusData.electionId] = {
          electionId: statusData.electionId,
          hasVoted: statusData.hasVoted,
          receipt: statusData.receipt,
        };
      }

      setElections(activeElections);
      setStatusByElection(nextStatusMap);
      setUpcoming(upcomingData.elections || []);
      setActivity(activityData.activity || []);
      setProjects(projectData.projects || []);
      setSelectedOptionByElection({});
    } catch (loadError) {
      setError(loadError.message || "Unable to load voting information.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) load();
  }, [token]);

  const confirmElection = useMemo(
    () => elections.find((item) => item.id === confirmElectionId) || null,
    [elections, confirmElectionId]
  );
  const confirmSelectedOption = useMemo(() => {
    const selectedId = selectedOptionByElection[confirmElectionId];
    return confirmElection?.options?.find((option) => option.id === selectedId) || null;
  }, [confirmElection, confirmElectionId, selectedOptionByElection]);

  const castVote = async () => {
    if (!confirmElection) return;
    const selectedOptionId = selectedOptionByElection[confirmElection.id];
    if (!selectedOptionId) return toast.error("Choose an option first.");

    setSavingElectionId(confirmElection.id);
    try {
      const data = await api("/voting/vote", {
        method: "POST",
        token,
        body: { electionId: confirmElection.id, optionId: selectedOptionId },
      });
      setReceipt(data.receipt || null);
      setReceiptElectionTitle(confirmElection.title);
      setConfirmElectionId("");
      setReceiptOpen(true);
      toast.success("Your vote has been recorded.");
      await load();
    } catch (voteError) {
      toast.error(voteError.message);
    } finally {
      setSavingElectionId("");
    }
  };

  const confirmProject = async (project) => {
    setSavingElectionId(project.id);
    try {
      await api(`/voting/projects/${project.id}/confirm-completion`, { method: "POST", token, body: {} });
      toast.success("Project completion confirmed. Thank you.");
      await load();
    } catch (confirmError) {
      toast.error(confirmError.message);
    } finally {
      setSavingElectionId("");
    }
  };

  if (loading) return <div className="text-sm text-stone-500">Loading voting center...</div>;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Community Participation"
        title="Voting & community projects"
        description="Vote once in each active election, review upcoming schedules, keep your participation receipts, and follow winning projects through completion."
      />
      {error ? <PageError message={error} onRetry={load} /> : null}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === "current" ? (
        !elections.length ? (
          <EmptyState
            title="No active voting right now"
            description={
              upcoming.length
                ? `The next scheduled voting opens ${formatDateTime(upcoming[0].starts_at)}.`
                : "There is no live recommended project voting posted by the barangay admin."
            }
            action={upcoming.length ? <Button variant="secondary" onClick={() => setTab("upcoming")}>View Upcoming</Button> : null}
          />
        ) : (
          <div className="space-y-6">
            {elections.length > 1 ? (
              <AlertBanner tone="info" title={`${elections.length} elections are currently open`}>
                You may participate once in each live election. Your vote in one election does not affect your eligibility in the others.
              </AlertBanner>
            ) : null}

            {elections.map((election) => {
              const electionStatus = statusByElection[election.id] || {};
              const hasVoted = Boolean(electionStatus.hasVoted);
              const electionReceipt = electionStatus.receipt || null;
              const selectedOptionId = selectedOptionByElection[election.id] || "";
              const canVote = Boolean(election.status === "live" && !hasVoted && isResident);

              return (
                <Card key={election.id} className="overflow-hidden p-0">
                  <div className="grid gap-0 lg:grid-cols-[0.9fr_1.1fr]">
                    <div className="h-64 bg-[var(--brand-50)] sm:h-72 lg:h-full">
                      {election.imageUrl ? (
                        <img src={election.imageUrl} alt={election.title} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-[linear-gradient(135deg,#dfeedd,#ffffff)] text-[var(--brand-600)]">
                          <Vote className="h-12 w-12" />
                        </div>
                      )}
                    </div>
                    <div className="space-y-6 p-5 sm:p-6">
                      <div>
                        <div className="flex flex-wrap items-center gap-3">
                          <StatusBadge status="live" />
                          <span className="inline-flex items-center gap-2 rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-700">
                            <Clock3 className="h-3.5 w-3.5" />
                            {countdownText(election.endsAt)}
                          </span>
                        </div>
                        <h2 className="mt-4 text-2xl font-black text-[var(--brand-900)]">{election.title}</h2>
                        <p className="mt-2 text-sm leading-6 text-stone-600">{election.description}</p>
                        <p className="mt-3 text-xs font-semibold text-stone-500">Closes {formatDateTime(election.endsAt)}</p>
                      </div>

                      {hasVoted ? (
                        <AlertBanner tone="success" title="Your vote has been counted">
                          <span>{electionReceipt?.code ? `Receipt ${electionReceipt.code}. ` : ""}Your selection cannot be changed after submission.</span>
                        </AlertBanner>
                      ) : null}
                      {!isResident ? <AlertBanner tone="warning" title="Resident account required">Only registered residents can cast a vote.</AlertBanner> : null}

                      <div className="space-y-3">
                        {(election.options || []).map((option) => {
                          const selected = selectedOptionId === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => canVote && setSelectedOptionByElection((current) => ({ ...current, [election.id]: option.id }))}
                              disabled={!canVote}
                              className={`w-full rounded-3xl border p-4 text-left transition ${
                                selected
                                  ? "border-[var(--brand-500)] bg-[var(--brand-50)] ring-4 ring-[var(--brand-100)]"
                                  : "border-stone-200 bg-white hover:border-[var(--brand-200)]"
                              } disabled:cursor-default`}
                            >
                              <div className="flex items-start gap-4">
                                {option.imageUrl ? <img src={option.imageUrl} alt={option.name} className="h-20 w-20 shrink-0 rounded-2xl object-cover" /> : null}
                                <div className={`mt-1 ${selected ? "text-[var(--brand-600)]" : "text-stone-400"}`}>
                                  {selected ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <h3 className="text-lg font-bold text-[var(--brand-900)]">{option.name}</h3>
                                  <p className="mt-1 text-sm text-stone-500">{option.description || "No extra description provided."}</p>
                                  {option.percentage !== undefined ? (
                                    <p className="mt-2 text-xs font-semibold text-[var(--brand-600)]">{option.votes || 0} votes • {option.percentage || 0}%</p>
                                  ) : null}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex flex-wrap gap-3">
                        {canVote ? (
                          <Button
                            onClick={() => setConfirmElectionId(election.id)}
                            disabled={!selectedOptionId || savingElectionId === election.id}
                          >
                            <Vote className="h-4 w-4" />
                            Review Vote
                          </Button>
                        ) : null}
                        {hasVoted && electionReceipt ? (
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setReceipt(electionReceipt);
                              setReceiptElectionTitle(election.title);
                              setReceiptOpen(true);
                            }}
                          >
                            <ReceiptText className="h-4 w-4" />
                            View Receipt
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )
      ) : null}

      {tab === "upcoming" ? (
        <div className="space-y-4">
          {!upcoming.length ? (
            <EmptyState title="No scheduled voting" description="New scheduled elections will appear here before they open." />
          ) : (
            upcoming.map((item) => (
              <Card key={item.id}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <CalendarClock className="h-5 w-5 text-[var(--brand-600)]" />
                      <h2 className="text-xl font-bold text-[var(--brand-900)]">{item.title}</h2>
                    </div>
                    <p className="mt-2 text-sm text-stone-600">{item.description}</p>
                    <p className="mt-3 text-xs font-semibold text-stone-500">Opens {formatDateTime(item.starts_at)} • Closes {formatDateTime(item.ends_at)}</p>
                  </div>
                  <StatusBadge status="scheduled" />
                </div>
              </Card>
            ))
          )}
        </div>
      ) : null}

      {tab === "activity" ? (
        <Card>
          <div className="mb-5 flex items-center gap-3">
            <History className="h-5 w-5 text-[var(--brand-600)]" />
            <div>
              <h2 className="text-xl font-bold text-[var(--brand-900)]">My Voting Activity</h2>
              <p className="text-sm text-stone-500">Your record shows participation and receipt references, not your selected option.</p>
            </div>
          </div>
          {!activity.length ? (
            <EmptyState title="No voting activity yet" description="After you participate, your voting receipt will appear here." />
          ) : (
            <div className="divide-y divide-stone-100 rounded-2xl border border-stone-200">
              {activity.map((item) => (
                <div key={item.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-[var(--brand-900)]">{item.title}</p>
                    <p className="mt-1 text-xs text-stone-500">Participated {formatDateTime(item.recordedAt)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={item.electionStatus} />
                    <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-600">{item.receiptCode}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {tab === "projects" ? (
        <div className="space-y-4">
          {!projects.length ? (
            <EmptyState title="No community projects yet" description="Winning finalized elections can be converted into trackable community projects by the barangay admin." />
          ) : (
            projects.map((project) => (
              <Card key={project.id}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Flag className="h-5 w-5 text-[var(--brand-600)]" />
                      <h2 className="text-xl font-bold text-[var(--brand-900)]">{project.title}</h2>
                    </div>
                    <p className="mt-2 text-sm text-stone-600">{project.description}</p>
                    <p className="mt-2 text-xs text-stone-500">{[project.location, project.purok].filter(Boolean).join(" • ") || "Barangay-wide project"}</p>
                  </div>
                  <StatusBadge status={project.status} />
                </div>

                <div className="mt-5">
                  <div className="flex items-center justify-between text-xs font-semibold text-stone-500"><span>Progress</span><span>{project.progress_percentage || 0}%</span></div>
                  <div className="mt-2 h-3 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-[var(--brand-500)]" style={{ width: `${Math.min(100, project.progress_percentage || 0)}%` }} /></div>

                  {(project.project_updates || []).length ? (
                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                      {project.project_updates.slice(0, 4).map((update) => (
                        <div key={update.id} className="rounded-2xl bg-stone-50 p-4">
                          {update.image_url ? <img src={update.image_url} alt={update.title} className="mb-3 h-32 w-full rounded-xl object-cover" /> : null}
                          <p className="font-semibold text-stone-800">{update.title}</p>
                          <p className="mt-1 text-sm text-stone-600">{update.description}</p>
                          <p className="mt-2 text-xs text-stone-400">{formatDateTime(update.created_at)}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {project.status === "completed" ? (
                    <div className="mt-5">
                      <Button variant="secondary" onClick={() => confirmProject(project)} loading={savingElectionId === project.id} disabled={project.confirmed_by_me}>
                        <CheckCircle2 className="h-4 w-4" />
                        {project.confirmed_by_me ? "Completion Confirmed" : "Confirm Project Completion"}
                      </Button>
                      <p className="mt-2 text-xs text-stone-500">{project.confirmation_count || 0} resident confirmation(s){project.confirmed_by_me ? " • You already confirmed this project." : ""}</p>
                    </div>
                  ) : null}
                </div>
              </Card>
            ))
          )}
        </div>
      ) : null}

      <Modal
        open={Boolean(confirmElectionId)}
        onClose={() => setConfirmElectionId("")}
        title="Confirm Vote"
        description="Votes are final within this election and cannot be changed after submission."
        widthClass="max-w-xl"
      >
        <div className="space-y-5">
          <div className="rounded-3xl border border-stone-200 bg-stone-50 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-500)]">Election</p>
            <h3 className="mt-2 text-lg font-bold text-[var(--brand-900)]">{confirmElection?.title || "Election"}</h3>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-500)]">Selected project suggestion</p>
            <h4 className="mt-2 text-2xl font-black text-[var(--brand-900)]">{confirmSelectedOption?.name || "No option selected"}</h4>
            {confirmSelectedOption?.description ? <p className="mt-2 text-sm text-stone-600">{confirmSelectedOption.description}</p> : null}
          </div>
          <AlertBanner tone="info" title="Ballot privacy">Your participation is audited, but the admin audit screen does not show which option you selected.</AlertBanner>
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <Button variant="ghost" onClick={() => setConfirmElectionId("")}>Back</Button>
            <Button onClick={castVote} loading={savingElectionId === confirmElectionId} disabled={!confirmSelectedOption}>Submit Vote</Button>
          </div>
        </div>
      </Modal>

      <Modal open={receiptOpen} onClose={() => setReceiptOpen(false)} title="Voting Receipt" description="Keep this reference as confirmation that your participation was recorded." widthClass="max-w-lg">
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
          <p className="mt-3 text-sm font-semibold text-emerald-800">Vote successfully recorded</p>
          {receiptElectionTitle ? <p className="mt-2 text-sm font-bold text-emerald-950">{receiptElectionTitle}</p> : null}
          <p className="mt-2 text-2xl font-black tracking-wide text-emerald-950">{receipt?.code || "Receipt available in activity"}</p>
          <p className="mt-2 text-xs text-emerald-800">{receipt?.recordedAt ? formatDateTime(receipt.recordedAt) : ""}</p>
          <p className="mt-4 text-xs text-emerald-700">For ballot privacy, the receipt confirms participation without displaying the selected option.</p>
        </div>
      </Modal>
    </div>
  );
};

export default VotingCenter;
