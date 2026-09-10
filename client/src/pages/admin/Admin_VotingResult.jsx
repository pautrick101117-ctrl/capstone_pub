import { CalendarClock, CheckCircle2, ImagePlus, Pencil, Plus, Sparkles, Trophy, Vote, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  SelectInput,
  TableShell,
  TextArea,
  TextInput,
} from "../../components/ui";
import { formatDateTime } from "../../lib/format";

const getEmptyElection = () => ({
  id: "",
  title: "Community Project Voting",
  description: "Choose the recommended barangay project you want to prioritize.",
  status: "draft",
  startsAt: "",
  endsAt: "",
  sourceSuggestionId: "",
  image: null,
  preview: "",
  imageUrl: "",
});

const toDateTimeLocal = (value) => {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  const offset = date.getTimezoneOffset() * 60_000;

  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const serializeDateTime = (value) => (value ? new Date(value).toISOString() : "");

const clampPercentage = (value) => Math.min(100, Math.max(0, Number(value || 0)));

const getStatusTone = (status) => {
  if (status === "closed") return "success";
  if (status === "live") return "warning";
  return "neutral";
};

const attachWinnerFlag = (elections) =>
  elections.map((el) => ({
    ...el,
    options: (el.options || []).map((opt) => ({
      ...opt,
      isWinner: el.winner ? el.winner.id === opt.id : false,
    })),
  }));

const getResidentName = (suggestion) => {
  if (suggestion.users?.full_name) return suggestion.users.full_name;

  const firstName = suggestion.users?.first_name || "";
  const lastName = suggestion.users?.last_name || "";
  const fullName = `${firstName} ${lastName}`.trim();

  return fullName || "Resident";
};

const mapOptionFromSuggestion = (suggestion) => ({
  name: suggestion.title || "",
  description: suggestion.description || "",
  sourceSuggestionId: suggestion.id || "",
  imageUrl: suggestion.image_url || "",
});

const Admin_VotingResult = () => {
  const { token } = useAuth();
  const toast = useToast();

  const [suggestions, setSuggestions] = useState([]);
  const [elections, setElections] = useState([]);
  const [draftElection, setDraftElection] = useState(getEmptyElection());
  const [draftOptions, setDraftOptions] = useState([]);
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState([]);
  const [selectedElectionId, setSelectedElectionId] = useState("");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const approvedSuggestions = useMemo(
    () => suggestions.filter((suggestion) => suggestion.status === "approved"),
    [suggestions]
  );

  const load = async () => {
    setDataLoaded(false);

    try {
      const [suggestionData, electionData, resultData] = await Promise.all([
        api("/admin/suggestions", { token }),
        api("/admin/election", { token }),
        api("/admin/election-results", { token }),
      ]);

      const rawElections = resultData.elections || [];
      const electionsWithWinners = attachWinnerFlag(rawElections);

      setSuggestions(suggestionData.suggestions || []);
      setElections(electionsWithWinners);

      setSelectedElectionId((current) => {
        if (!electionsWithWinners.length) return "";
        if (!current) return electionsWithWinners[0].id;
        return electionsWithWinners.some((item) => item.id === current) ? current : electionsWithWinners[0].id;
      });

      if (electionData.election) {
        const optionDrafts = (electionData.options || []).map((item) => ({
          name: item.name || "",
          description: item.description || "",
          sourceSuggestionId: item.source_suggestion_id || item.sourceSuggestionId || "",
          imageUrl: item.image_url || item.imageUrl || "",
        }));

        setDraftElection({
          id: electionData.election.id,
          title: electionData.election.title || "",
          description: electionData.election.description || "",
          status: electionData.election.status || "draft",
          startsAt: toDateTimeLocal(electionData.election.starts_at || electionData.election.startsAt),
          endsAt: toDateTimeLocal(electionData.election.ends_at || electionData.election.endsAt),
          sourceSuggestionId:
            electionData.election.source_suggestion_id || electionData.election.sourceSuggestionId || "",
          image: null,
          preview: electionData.election.image_url || electionData.election.imageUrl || "",
          imageUrl: electionData.election.image_url || electionData.election.imageUrl || "",
        });

        setDraftOptions(optionDrafts);
        setSelectedSuggestionIds(optionDrafts.map((option) => option.sourceSuggestionId).filter(Boolean));
      } else {
        setDraftElection(getEmptyElection());
        setDraftOptions([]);
        setSelectedSuggestionIds([]);
      }
    } catch (error) {
      toast.error(error.message);
      setSuggestions([]);
      setElections([]);
      setSelectedElectionId("");
      setDraftElection(getEmptyElection());
      setDraftOptions([]);
      setSelectedSuggestionIds([]);
    } finally {
      setDataLoaded(true);
    }
  };

  useEffect(() => {
    if (!token) {
      setDataLoaded(true);
      return;
    }

    load();
  }, [token]);

  const selectedResults = elections.find((el) => el.id === selectedElectionId) || elections[0] || null;
  const selectedOptions = selectedResults?.options || [];
  const totalVotes = Number(selectedResults?.totalVotes || 0);
  const hasVotes = totalVotes > 0;

  const leaderLabel =
    selectedResults?.status === "closed"
      ? "Winner"
      : selectedResults?.status === "live"
        ? "Current Leader"
        : "Leader";

  const currentOrLatest = elections[0] || null;

  const toggleSuggestion = (suggestion) => {
    const exists = selectedSuggestionIds.includes(suggestion.id);

    if (exists) {
      setSelectedSuggestionIds((current) => current.filter((id) => id !== suggestion.id));
      setDraftOptions((current) => current.filter((option) => option.sourceSuggestionId !== suggestion.id));
      return;
    }

    setSelectedSuggestionIds((current) => [...current, suggestion.id]);
    setDraftOptions((current) => [...current, mapOptionFromSuggestion(suggestion)]);
  };

  const reviewSuggestion = async (id, status) => {
    try {
      await api(`/admin/suggestions/${id}`, {
        method: "PATCH",
        token,
        body: { status },
      });

      toast.success(`Suggestion ${status}.`);
      await load();
    } catch (error) {
      toast.error(error.message);
    }
  };

  const openNewElection = () => {
    setDraftElection(getEmptyElection());
    setDraftOptions([]);
    setSelectedSuggestionIds([]);
    setBuilderOpen(true);
  };

  const openLatestElection = () => {
    setSelectedSuggestionIds(draftOptions.map((option) => option.sourceSuggestionId).filter(Boolean));
    setBuilderOpen(true);
  };

  const saveElection = async (event) => {
    event.preventDefault();

    if (draftElection.status !== "draft" && draftOptions.length < 2) {
      toast.error("Select at least two approved project suggestions before posting voting.");
      return;
    }

    setSaving(true);

    const formData = new FormData();

    if (draftElection.image) {
      formData.append("image", draftElection.image);
    }

    formData.append(
      "election",
      JSON.stringify({
        id: draftElection.id,
        title: draftElection.title,
        description: draftElection.description,
        status: draftElection.status,
        startsAt: serializeDateTime(draftElection.startsAt),
        endsAt: serializeDateTime(draftElection.endsAt),
        sourceSuggestionId: draftOptions[0]?.sourceSuggestionId || draftElection.sourceSuggestionId || null,
        imageUrl: draftElection.image ? null : draftElection.imageUrl || draftElection.preview || null,
      })
    );

    formData.append("options", JSON.stringify(draftOptions));

    try {
      await api("/admin/election", {
        method: "PUT",
        token,
        body: formData,
      });

      toast.success("Voting post saved.");
      setBuilderOpen(false);
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  if (!dataLoaded) {
    return <div className="text-sm text-stone-500">Loading...</div>;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Voting Management"
        title="Recommended project voting"
        description="Create voting posts from approved resident project suggestions, manage voting dates, and review results."
        actions={
          <>
            <Button variant="secondary" onClick={openNewElection}>
              <Plus className="h-4 w-4" />
              Create Voting Post
            </Button>

            <Button onClick={openLatestElection} disabled={!draftElection.id && !dataLoaded}>
              <Pencil className="h-4 w-4" />
              Edit Current / Latest
            </Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-stone-500">Current / Latest Voting Post</p>
              <h2 className="mt-2 text-2xl font-black text-[var(--brand-900)]">
                {currentOrLatest?.title || "No voting post"}
              </h2>
            </div>

            {currentOrLatest ? <Badge tone={getStatusTone(currentOrLatest.status)}>{currentOrLatest.status}</Badge> : null}
          </div>

          {currentOrLatest ? (
            <div className="mt-5 space-y-3 text-sm text-stone-600">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-[var(--brand-600)]" />
                Opens {formatDateTime(currentOrLatest.startsAt)}
              </div>

              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-[var(--brand-600)]" />
                Closes {formatDateTime(currentOrLatest.endsAt)}
              </div>

              <div className="flex items-center gap-2">
                <Vote className="h-4 w-4 text-[var(--brand-600)]" />
                {currentOrLatest.options?.length || 0} voting option
                {(currentOrLatest.options?.length || 0) === 1 ? "" : "s"}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-stone-500">Create a voting post from approved suggestions.</p>
          )}

          <div className="mt-5">
            <Button onClick={openNewElection}>
              <Plus className="h-4 w-4" />
              Create Voting Post
            </Button>
          </div>
        </Card>

        <Card>
          <p className="text-sm font-medium text-stone-500">Approved Suggestions Ready</p>
          <p className="mt-2 text-3xl font-black text-[var(--brand-900)]">{approvedSuggestions.length}</p>
          <p className="mt-2 text-sm text-stone-500">
            These are resident project suggestions that can be selected for the next voting post.
          </p>

          <div className="mt-5">
            <Button variant="secondary" onClick={openNewElection}>
              View Approved Suggestions
            </Button>
          </div>
        </Card>

        <Card>
          <p className="text-sm font-medium text-stone-500">{leaderLabel}</p>
          <div className="mt-3 flex items-center gap-3">
            <div className="rounded-2xl bg-amber-100 p-3 text-amber-700">
              <Trophy className="h-5 w-5" />
            </div>

            <div>
              <p className="text-2xl font-black text-[var(--brand-900)]">
                {hasVotes ? selectedResults?.winner?.name || "No leader yet" : "No votes yet"}
              </p>
              <p className="text-sm text-stone-500">{selectedResults?.title || "No selected voting post"}</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 2xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <div className="mb-5 flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-[var(--brand-600)]" />
            <div>
              <h2 className="text-xl font-bold text-[var(--brand-900)]">Resident Project Suggestions</h2>
              <p className="mt-1 text-sm text-stone-500">
                Approve suggestions here. Approved items can be selected inside the voting post modal.
              </p>
            </div>
          </div>

          {suggestions.length ? (
            <div className="space-y-4">
              {suggestions.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-stone-200 p-4 transition hover:border-[var(--brand-200)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.title} className="mb-4 h-44 w-full rounded-2xl object-cover" />
                      ) : null}

                      <p className="font-semibold text-[var(--brand-900)]">{item.title}</p>
                      <p className="mt-2 text-sm text-stone-600">{item.description}</p>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-stone-500">
                        <span>Submitted by {getResidentName(item)}</span>
                        <span>•</span>
                        <span>{formatDateTime(item.created_at)}</span>
                      </div>
                    </div>

                    <Badge tone={item.status === "approved" ? "success" : item.status === "rejected" ? "danger" : "info"}>
                      {item.status}
                    </Badge>
                  </div>

                  {item.status === "pending" ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button onClick={() => reviewSuggestion(item.id, "approved")}>
                        <CheckCircle2 className="h-4 w-4" />
                        Approve
                      </Button>

                      <Button variant="ghost" onClick={() => reviewSuggestion(item.id, "rejected")}>
                        <X className="h-4 w-4" />
                        Reject
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No suggestions" description="Resident project suggestions will appear here once submitted." />
          )}
        </Card>

        <Card>
          <div className="mb-5">
            <h2 className="text-xl font-bold text-[var(--brand-900)]">Election Results Dashboard</h2>
            <p className="mt-1 text-sm text-stone-500">
              Switch between voting posts and review participation, votes, and completion confirmations.
            </p>
          </div>

          {elections.length > 1 ? (
            <SelectInput
              label="Select Voting Post"
              className="mb-5"
              value={selectedElectionId}
              onChange={(event) => setSelectedElectionId(event.target.value)}
            >
              {elections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </SelectInput>
          ) : null}

          {selectedResults ? (
            <div className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
              <div className="space-y-4">
                <TableShell>
                  <table className="min-w-full text-sm">
                    <tbody>
                      {[
                        ["Status", <Badge tone={getStatusTone(selectedResults.status)}>{selectedResults.status}</Badge>],
                        ["Opens", formatDateTime(selectedResults.startsAt)],
                        ["Closes", formatDateTime(selectedResults.endsAt)],
                        ["Total Votes", selectedResults.totalVotes || 0],
                        ["Eligible Residents", selectedResults.eligibleVoters || 0],
                        ["Participation Rate", totalVotes === 0 ? "—" : `${selectedResults.participationRate || 0}%`],
                        ["Not Yet Voted", selectedResults.notVotedCount ?? "—"],
                        ["Completion Confirmations", selectedResults.completionCount || 0],
                      ].map(([label, value]) => (
                        <tr key={label} className="border-t border-stone-100">
                          <td className="px-4 py-3 font-semibold text-stone-600">{label}</td>
                          <td className="px-4 py-3 text-[var(--brand-900)]">{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableShell>

                <div className="space-y-3 rounded-3xl border border-stone-200 bg-white p-4">
                  <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-stone-500">
                    Options Breakdown
                  </h3>

                  {selectedOptions.length ? (
                    selectedOptions.map((option) => {
                      const percentage = clampPercentage(option.percentage);

                      return (
                        <div key={option.id} className="rounded-2xl border border-stone-100 bg-stone-50 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-[var(--brand-900)]">{option.name}</p>
                              <p className="text-xs text-stone-500">
                                {option.votes || 0} vote{option.votes === 1 ? "" : "s"} • {percentage}%
                              </p>
                            </div>

                            {option.isWinner && hasVotes ? <Badge tone="success">{leaderLabel}</Badge> : null}
                          </div>

                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100">
                            <div className="h-full rounded-full bg-[var(--brand-500)]" style={{ width: `${percentage}%` }} />
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm text-stone-500">No options added yet.</p>
                  )}
                </div>
              </div>

              {hasVotes ? (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={selectedOptions}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="votes" fill="var(--brand-500)" radius={[12, 12, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState title="No votes yet" description="The chart will appear when residents start voting." />
              )}
            </div>
          ) : (
            <EmptyState title="No election results" description="Create a voting post to start collecting results." />
          )}
        </Card>
      </div>

      <Modal
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        title="Create Voting From Approved Suggestions"
        description="Select approved project suggestions, set the voting period, then post it to the resident Voting Center."
        widthClass="max-w-6xl"
      >
        <form className="space-y-6" onSubmit={saveElection}>
          <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <Card className="border-dashed shadow-none hover:shadow-none">
              <div className="mb-4">
                <h3 className="text-lg font-bold text-[var(--brand-900)]">1. Select Approved Suggestions</h3>
                <p className="mt-1 text-sm text-stone-500">
                  Each selected suggestion becomes one voting option.
                </p>
              </div>

              {approvedSuggestions.length ? (
                <div className="grid max-h-[520px] gap-3 overflow-y-auto pr-1 md:grid-cols-2">
                  {approvedSuggestions.map((suggestion) => {
                    const selected = selectedSuggestionIds.includes(suggestion.id);

                    return (
                      <button
                        key={suggestion.id}
                        type="button"
                        onClick={() => toggleSuggestion(suggestion)}
                        className={`rounded-2xl border p-4 text-left transition ${
                          selected
                            ? "border-[var(--brand-500)] bg-[var(--brand-50)] ring-4 ring-[var(--brand-100)]"
                            : "border-stone-200 bg-white hover:border-[var(--brand-200)]"
                        }`}
                      >
                        {suggestion.image_url ? (
                          <img
                            src={suggestion.image_url}
                            alt={suggestion.title}
                            className="mb-3 h-32 w-full rounded-2xl object-cover"
                          />
                        ) : null}

                        <div className="flex items-start gap-3">
                          <div
                            className={`mt-1 flex h-5 w-5 items-center justify-center rounded-full border ${
                              selected
                                ? "border-[var(--brand-500)] bg-[var(--brand-500)] text-white"
                                : "border-stone-300 bg-white"
                            }`}
                          >
                            {selected ? <CheckCircle2 className="h-4 w-4" /> : null}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-[var(--brand-900)]">{suggestion.title}</p>
                            <p className="mt-1 line-clamp-3 text-sm text-stone-500">{suggestion.description}</p>
                            <p className="mt-2 text-xs font-semibold text-stone-400">
                              Submitted by {getResidentName(suggestion)}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  title="No approved suggestions"
                  description="Approve project suggestions first before creating a voting post."
                />
              )}
            </Card>

            <Card className="border-dashed shadow-none hover:shadow-none">
              <div className="mb-4">
                <h3 className="text-lg font-bold text-[var(--brand-900)]">2. Voting Post Details</h3>
                <p className="mt-1 text-sm text-stone-500">
                  Draft keeps it hidden. Live shows it in Voting Center.
                </p>
              </div>

              <div className="grid gap-4">
                <TextInput
                  label="Voting Title"
                  value={draftElection.title}
                  onChange={(event) => setDraftElection((current) => ({ ...current, title: event.target.value }))}
                />

                <TextArea
                  label="Description"
                  value={draftElection.description}
                  onChange={(event) =>
                    setDraftElection((current) => ({ ...current, description: event.target.value }))
                  }
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <TextInput
                    label="Voting Opens"
                    type="datetime-local"
                    value={draftElection.startsAt}
                    onChange={(event) =>
                      setDraftElection((current) => ({ ...current, startsAt: event.target.value }))
                    }
                  />

                  <TextInput
                    label="Voting Closes"
                    type="datetime-local"
                    value={draftElection.endsAt}
                    onChange={(event) =>
                      setDraftElection((current) => ({ ...current, endsAt: event.target.value }))
                    }
                  />
                </div>

                <SelectInput
                  label="Status"
                  value={draftElection.status}
                  onChange={(event) => setDraftElection((current) => ({ ...current, status: event.target.value }))}
                >
                  <option value="draft">Draft - hidden from residents</option>
                  <option value="live">Live - show in Voting Center</option>
                  <option value="closed">Closed - show in Voting Results</option>
                </SelectInput>

                <label className="flex flex-col gap-2 text-sm font-medium text-stone-700">
                  <span>Voting Post Image</span>

                  <div className="flex items-center gap-3 rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-3">
                    <ImagePlus className="h-5 w-5 text-[var(--brand-600)]" />

                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];

                        setDraftElection((current) => ({
                          ...current,
                          image: file || null,
                          preview: file ? URL.createObjectURL(file) : current.preview,
                          imageUrl: file ? "" : current.imageUrl,
                        }));
                      }}
                      className="text-sm text-stone-600 file:mr-4 file:rounded-full file:border-0 file:bg-[var(--brand-500)] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-[var(--brand-600)]"
                    />
                  </div>
                </label>

                {draftElection.preview ? (
                  <img src={draftElection.preview} alt="Voting preview" className="h-48 w-full rounded-3xl object-cover" />
                ) : null}
              </div>
            </Card>
          </div>

          <Card className="border-dashed shadow-none hover:shadow-none">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-[var(--brand-900)]">3. Selected Voting Options</h3>
                <p className="mt-1 text-sm text-stone-500">
                  You can edit the display title and description before posting.
                </p>
              </div>

              <Badge tone={draftOptions.length >= 2 ? "success" : "warning"}>
                {draftOptions.length} selected
              </Badge>
            </div>

            {draftOptions.length ? (
              <div className="space-y-3">
                {draftOptions.map((option, index) => (
                  <div key={`${option.sourceSuggestionId || option.name}-${index}`} className="grid gap-3 rounded-2xl border border-stone-200 p-4 sm:grid-cols-[0.7fr_1fr_auto]">
                    <TextInput
                      label={`Option ${index + 1}`}
                      value={option.name}
                      onChange={(event) =>
                        setDraftOptions((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, name: event.target.value } : item
                          )
                        )
                      }
                    />

                    <TextInput
                      label="Description"
                      value={option.description}
                      onChange={(event) =>
                        setDraftOptions((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, description: event.target.value } : item
                          )
                        )
                      }
                    />

                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setDraftOptions((current) => current.filter((_item, itemIndex) => itemIndex !== index));

                          if (option.sourceSuggestionId) {
                            setSelectedSuggestionIds((current) => current.filter((id) => id !== option.sourceSuggestionId));
                          }
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No selected options"
                description="Choose approved project suggestions above to build the voting options."
              />
            )}
          </Card>

          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={saving} disabled={saving}>
              Save Voting Post
            </Button>

            <Button type="button" variant="ghost" onClick={() => setBuilderOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default Admin_VotingResult;
