import { useReviewAction, reviewChanges } from "../../components/ActionReviewProvider";
import { CheckCircle2, Pencil, Plus, Trash2, Trophy, Vote, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  SegmentedTabs,
  TextArea,
  TextInput,
} from "../../components/ui";
import { formatDateTime } from "../../lib/format";

const pageSize = 6;
const suggestionPageSize = 6;
const tabs = [
  { value: "posts", label: "Voting Posts" },
  { value: "results", label: "Election Results" },
];
const blankElection = {
  id: "",
  title: "Community Project Voting",
  description: "Choose the community project you want Barangay Iba to prioritize.",
  startsAt: "",
  endsAt: "",
  originalStatus: "draft",
  totalVotes: 0,
  runoffParentId: null,
};
const tone = (status) => status === "closed" ? "success" : status === "live" || status === "scheduled" ? "warning" : "neutral";
const label = (status) => status === "scheduled" ? "Scheduled" : status === "awaiting_finalization" ? "Awaiting Finalization" : status === "live" ? "Voting Open" : status === "closed" ? "Voting Closed" : "Draft";
const toLocal = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const toIso = (value) => value ? new Date(value).toISOString() : "";

const Admin_VotingResult = () => {
  const { token } = useAuth();
  const reviewAction = useReviewAction();
  const toast = useToast();
  const [tab, setTab] = useState("posts");
  const [elections, setElections] = useState([]);
  const [approved, setApproved] = useState([]);
  const [suggestionPagination, setSuggestionPagination] = useState({ total: 0, totalPages: 1 });
  const [suggestionSearch, setSuggestionSearch] = useState("");
  const [projects, setProjects] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [selectedElectionId, setSelectedElectionId] = useState("");
  const [form, setForm] = useState(blankElection);
  const [selectedSuggestions, setSelectedSuggestions] = useState({});
  const [builderOpen, setBuilderOpen] = useState(false);
  const [suggestionPage, setSuggestionPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [builderLoading, setBuilderLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [closeTarget, setCloseTarget] = useState(null);
  const [closeReason, setCloseReason] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [resultData, projectData] = await Promise.all([
        api(`/admin/election-results?page=${page}&limit=${pageSize}`, { token }),
        api("/admin/projects?status=all&page=1&limit=50", { token }).catch(() => ({ projects: [] })),
      ]);
      const resultElections = resultData.elections || [];
      setElections(resultElections);
      setPagination(resultData.pagination || { total: resultElections.length, totalPages: 1 });
      setProjects(projectData.projects || []);
      setSelectedElectionId((current) => current && resultElections.some((item) => item.id === current)
        ? current
        : resultElections[0]?.id || "");
    } catch (loadError) {
      setError(loadError.message || "Unable to load project voting.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (token) load(); }, [token, page]);
  useEffect(() => { setPage(1); }, [tab]);

  const selectedResults = elections.find((item) => item.id === selectedElectionId) || elections[0] || null;
  const existingProject = selectedResults ? projects.find((project) => project.election_id === selectedResults.id) : null;
  const chartData = useMemo(
    () => (selectedResults?.options || []).map((item) => ({ name: item.name, votes: Number(item.votes || 0), share: Number(item.percentage || 0) })),
    [selectedResults]
  );
  const selectedSuggestionIds = Object.keys(selectedSuggestions);
  const suggestionPages = suggestionPagination.totalPages || 1;
  const visibleSuggestions = approved;

  const loadApprovedSuggestions = async () => {
    if (!token || !builderOpen) return;
    try {
      const params = new URLSearchParams({ status: "approved", page: String(suggestionPage), limit: String(suggestionPageSize) });
      if (suggestionSearch.trim()) params.set("search", suggestionSearch.trim());
      const data = await api(`/admin/suggestions?${params.toString()}`, { token });
      setApproved(data.suggestions || []);
      setSuggestionPagination(data.pagination || { total: 0, totalPages: 1 });
    } catch (suggestionError) {
      toast.error(suggestionError.message || "Unable to load approved suggestions.");
      setApproved([]);
    }
  };

  useEffect(() => {
    if (builderOpen) loadApprovedSuggestions();
  }, [builderOpen, suggestionPage, suggestionSearch, token]);

  const startRunoff = () => {
    if (!selectedResults || selectedResults.resultKind !== "tie" || !selectedResults.finalized) return;
    const tiedIds = new Set((selectedResults.tiedOptions || []).map((item) => item.id));
    const tied = (selectedResults.options || []).filter((item) => tiedIds.has(item.id) && item.sourceSuggestionId);
    setForm({ ...blankElection, title: `Runoff: ${selectedResults.title}`,
      description: "Runoff between the tied top proposals.", runoffParentId: selectedResults.id });
    setSelectedSuggestions(Object.fromEntries(tied.map((item) => [item.sourceSuggestionId, {
      id: item.sourceSuggestionId, title: item.name, description: item.description,
      image_url: item.imageUrl || null,
    }])));
    setBuilderOpen(true);
    setTab("posts");
  };

  const startNew = () => {
    setForm(blankElection);
    setSelectedSuggestions({});
    setSuggestionSearch("");
    setSuggestionPage(1);
    setBuilderOpen(true);
  };

  const openEdit = async (election) => {
    setBuilderLoading(true);
    setBuilderOpen(true);
    try {
      const data = await api(`/admin/election/${election.id}`, { token });
      setForm({
        id: data.election.id,
        title: data.election.title || "",
        description: data.election.description || "",
        startsAt: toLocal(data.election.starts_at),
        endsAt: toLocal(data.election.ends_at),
        originalStatus: data.election.status || "draft",
        totalVotes: data.totalVotes || 0,
      });
      setSelectedSuggestions(Object.fromEntries((data.options || []).filter((option) => option.source_suggestion_id).map((option) => [option.source_suggestion_id, {
        id: option.source_suggestion_id,
        title: option.name,
        description: option.description || "",
        image_url: option.image_url || null,
      }])));
      setSuggestionSearch("");
      setSuggestionPage(1);
    } catch (editError) {
      toast.error(editError.message);
      setBuilderOpen(false);
    } finally {
      setBuilderLoading(false);
    }
  };

  const toggle = (item) => {
    if (form.totalVotes > 0) return;
    setSelectedSuggestions((current) => {
      const next = { ...current };
      if (next[item.id]) delete next[item.id];
      else next[item.id] = item;
      return next;
    });
  };

  const saveElection = async (targetStatus) => {
    if (form.originalStatus !== "draft") return toast.error("Published voting posts cannot be edited.");
    if (!form.title.trim()) return toast.error("Voting title is required.");
    if (targetStatus !== "draft" && selectedSuggestionIds.length < 2) return toast.error("Select at least two approved suggestions before opening voting.");
    if (targetStatus === "live" && (!form.startsAt || !form.endsAt)) return toast.error("Voting open and close date/time are required before opening voting.");

    const choices = Object.values(selectedSuggestions);
    if (!await reviewAction({ title: targetStatus === "live" ? "Publish Community Voting?" : "Save Voting Draft?", description: targetStatus === "live" ? "The ballot becomes permanent once published. Voting opens at its scheduled start time." : "Review the voting details before saving.", subject: form.title, after: { title: form.title, description: form.description, startsAt: form.startsAt, endsAt: form.endsAt, selectedProjects: selectedSuggestionIds.length, status: targetStatus }, confirmLabel: targetStatus === "live" ? "Publish Voting" : "Save Voting" })) return;
    setSaving(true);
    try {
      const body = new FormData();
      body.append("election", JSON.stringify({
        id: form.id || undefined,
        title: form.title,
        description: form.description,
        status: targetStatus,
        startsAt: toIso(form.startsAt),
        endsAt: toIso(form.endsAt),
        sourceSuggestionId: choices[0]?.id || null,
        runoffParentId: form.runoffParentId || null,
      }));
      body.append("options", JSON.stringify(choices.map((item) => ({
        name: item.title,
        description: item.description,
        sourceSuggestionId: item.id,
        imageUrl: item.image_url || null,
      }))));
      await api("/admin/election", { method: "PUT", token, body });
      toast.success(targetStatus === "draft" ? "Voting draft saved." : form.originalStatus === "live" ? "Open voting updated." : "Voting has been published with its scheduled dates.");
      setBuilderOpen(false);
      await load();
    } catch (saveError) {
      toast.error(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteDraft = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const data = await api(`/admin/election/${deleteTarget.id}`, { method: "DELETE", token });
      toast.success(data.message || "Draft voting post deleted.");
      setDeleteTarget(null);
      await load();
    } catch (deleteError) {
      toast.error(deleteError.message);
    } finally {
      setSaving(false);
    }
  };

  const closeVoting = async () => {
    if (!closeTarget) return;
    if (closeReason.trim().length < 5) return toast.error("Please explain why voting must close early.");
    setSaving(true);
    try {
      const data = await api(`/admin/election/${closeTarget.id}/close`, { method: "POST", token, body: { reason: closeReason.trim() } });
      toast.success(data.message || "Voting closed.");
      setCloseTarget(null);
      setCloseReason("");
      await load();
    } catch (closeError) {
      toast.error(closeError.message);
    } finally {
      setSaving(false);
    }
  };

  const createWinningProject = async () => {
    if (!selectedResults?.finalized || selectedResults.resultKind !== "winner") return toast.error("Only finalized elections with one winner can become projects.");
    if (!await reviewAction({ title: "Create Community Project?", subject: selectedResults.title, description: "This creates an implementation record from the finalized voting result.", confirmLabel: "Create Project" })) return;
    setSaving(true);
    try {
      const data = await api(`/admin/projects/from-election/${selectedResults.id}`, { method: "POST", token });
      toast.success(data.message || "Community project created.");
      await load();
    } catch (createError) {
      toast.error(createError.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !elections.length) return <div className="space-y-8"><PageHeader eyebrow="Governance" title="Project Voting" description="Loading elections and results." /><LoadingState rows={6} /></div>;
  if (error && !elections.length) return <div className="space-y-8"><PageHeader eyebrow="Governance" title="Project Voting" description="Manage community voting separately from project suggestion review." /><ErrorState description={error} onRetry={load} /></div>;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Governance & Transparency"
        title="Project Voting"
        description="Create voting posts in a modal, edit the exact post you selected, close live voting safely, and preserve closed elections as permanent records."
        actions={<Button onClick={startNew}><Plus className="h-4 w-4" /> Create Voting</Button>}
      />
      <SegmentedTabs value={tab} onChange={setTab} items={tabs} />

      {tab === "posts" ? <div className="space-y-5">
        <Alert tone="info" title="Voting lifecycle">
          Only drafts can be edited or deleted. Once published, candidates and dates are locked. Scheduled rounds open at their configured time; closing an active round early requires a reason. Closed rounds and votes remain available for transparency.
        </Alert>
        {!elections.length ? <EmptyState title="No voting posts yet" description="Create the first community project voting post from approved resident suggestions." /> : (
          <div className="grid gap-4 xl:grid-cols-2">
            {elections.map((item) => (
              <Card key={item.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><Badge tone={tone(item.phaseStatus || item.status)}>{label(item.phaseStatus || item.status)}</Badge><h2 className="mt-3 text-xl font-bold text-[var(--brand-900)]">{item.title}</h2></div>
                  <div className="text-right"><span className="text-2xl font-black text-[var(--brand-700)]">{item.totalVotes || 0}</span><p className="text-xs text-stone-400">votes</p></div>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-stone-600 sm:grid-cols-2">
                  <p>Opens: {formatDateTime(item.startsAt)}</p><p>Closes: {formatDateTime(item.endsAt)}</p><p>{item.options?.length || 0} project choices</p><p>{item.participationRate || 0}% participation</p>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => { setSelectedElectionId(item.id); setTab("results"); }}><Vote className="h-4 w-4" /> View Results</Button>
                  {item.status === "draft" ? <Button variant="ghost" onClick={() => openEdit(item)}><Pencil className="h-4 w-4" /> Edit</Button> : null}
                  {item.status === "live" && item.phaseStatus === "live" ? <Button variant="danger" onClick={() => { setCloseReason(""); setCloseTarget(item); }}><XCircle className="h-4 w-4" /> Close Voting</Button> : null}
                  {item.status === "draft" ? <Button variant="danger" onClick={() => setDeleteTarget(item)}><Trash2 className="h-4 w-4" /> Delete Draft</Button> : null}
                </div>
              </Card>
            ))}
          </div>
        )}
        <Pagination page={page} totalPages={pagination.totalPages || Math.max(1, Math.ceil((pagination.total || 0) / pageSize))} onPageChange={setPage} />
      </div> : null}

      {tab === "results" ? <div className="space-y-6">
        {!elections.length ? <EmptyState title="No election results yet" description="Results appear after a voting post is created." /> : <>
          <Card>
            <div className="flex flex-wrap gap-2">
              {elections.map((item) => <button key={item.id} type="button" onClick={() => setSelectedElectionId(item.id)} className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${selectedResults?.id === item.id ? "border-[var(--brand-500)] bg-[var(--brand-50)] text-[var(--brand-900)]" : "border-stone-200 bg-white text-stone-600 hover:border-[var(--brand-200)]"}`}><span className="font-bold">{item.title}</span><span className="ml-2 text-xs">{label(item.phaseStatus || item.status)}</span></button>)}
            </div>
          </Card>
          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">{[
            ["Votes Cast", selectedResults?.totalVotes || 0], ["Eligible Residents", selectedResults?.eligibleVoters || 0], ["Participation", `${selectedResults?.participationRate || 0}%`], ["Project Options", selectedResults?.options?.length || 0]
          ].map(([metricLabel, value]) => <Card key={metricLabel}><p className="text-sm font-semibold text-stone-500">{metricLabel}</p><p className="mt-2 text-3xl font-black text-[var(--brand-900)]">{value}</p></Card>)}</div>
          <Card className="overflow-hidden bg-gradient-to-br from-amber-50 to-white"><div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-start gap-4"><div className="rounded-3xl bg-amber-100 p-4 text-amber-700"><Trophy className="h-7 w-7" /></div><div><p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-700">{selectedResults?.finalized && selectedResults?.resultKind === "winner" ? "Official Winning Community Project" : "Voting Outcome"}</p><h2 className="mt-2 text-2xl font-black text-[var(--brand-900)]">{selectedResults?.resultKind === "tie" ? "Tie — Runoff Required" : selectedResults?.resultKind === "no_votes" ? "No Votes — No Winner" : selectedResults?.status === "closed" && !selectedResults?.finalized ? "Legacy Result — Review Required" : selectedResults?.winner?.name || "No Finalized Winner Yet"}</h2><p className="mt-2 text-sm text-stone-600">{selectedResults?.winner?.votes || 0} votes</p></div></div>{selectedResults?.finalized && selectedResults?.resultKind === "tie" ? <Button onClick={startRunoff}><Vote className="h-4 w-4" /> Prepare Runoff</Button> : null}{selectedResults?.finalized && selectedResults?.resultKind === "winner" && selectedResults?.winner ? existingProject ? <Button onClick={() => window.location.assign("/admin/projects")}>Manage Community Project</Button> : <Button loading={saving} onClick={createWinningProject}><Plus className="h-4 w-4" /> Create Community Project</Button> : null}</div></Card>
          <div className="grid gap-6 2xl:grid-cols-[1.2fr_0.8fr]"><Card><h2 className="text-xl font-bold text-[var(--brand-900)]">Vote Distribution</h2><div className="mt-5 h-80">{chartData.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 20 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} /><Tooltip /><Bar dataKey="votes" fill="var(--brand-500)" radius={[0, 8, 8, 0]} /></BarChart></ResponsiveContainer> : <EmptyState title="No votes recorded" description="Vote distribution will appear here after residents participate." />}</div></Card><Card><h2 className="text-xl font-bold text-[var(--brand-900)]">Project Ranking</h2><div className="mt-4 space-y-3">{[...(selectedResults?.options || [])].sort((a, b) => Number(b.votes || 0) - Number(a.votes || 0)).map((item, index) => <div key={item.id} className="rounded-2xl border border-stone-200 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold text-stone-400">#{index + 1}</p><p className="font-bold text-[var(--brand-900)]">{item.name}</p></div><div className="text-right"><p className="text-lg font-black text-[var(--brand-700)]">{item.votes || 0}</p><p className="text-xs text-stone-400">{item.percentage || 0}%</p></div></div></div>)}</div></Card></div>
          <Card><div className="grid gap-3 text-sm text-stone-600 sm:grid-cols-2 xl:grid-cols-4"><div><p className="text-xs font-bold uppercase text-stone-400">Opened</p><p className="mt-1 font-semibold">{formatDateTime(selectedResults?.startsAt)}</p></div><div><p className="text-xs font-bold uppercase text-stone-400">Closed</p><p className="mt-1 font-semibold">{formatDateTime(selectedResults?.endsAt)}</p></div><div><p className="text-xs font-bold uppercase text-stone-400">Not Yet Voted</p><p className="mt-1 font-semibold">{selectedResults?.notVotedCount || 0}</p></div><div><p className="text-xs font-bold uppercase text-stone-400">Completion Confirmations</p><p className="mt-1 font-semibold">{selectedResults?.completionCount || 0}</p></div></div></Card>
        </>}
        <Pagination page={page} totalPages={pagination.totalPages || Math.max(1, Math.ceil((pagination.total || 0) / pageSize))} onPageChange={setPage} />
      </div> : null}

      <Modal open={builderOpen} onClose={() => !saving && setBuilderOpen(false)} title={form.id ? "Edit Voting Post" : "Create Voting Post"} description={form.id ? `Editing this specific ${label(form.originalStatus).toLowerCase()} post.` : "Build a new voting post from approved resident project suggestions."} widthClass="max-w-6xl" closeDisabled={saving || builderLoading}>
        {builderLoading ? <LoadingState rows={5} /> : <div className="space-y-6">
          {form.originalStatus !== "draft" ? <Alert tone="warning" title="Voting is locked">Published voting posts and their options can no longer be edited.</Alert> : null}
          <Card><h2 className="text-xl font-bold text-[var(--brand-900)]">Voting Details</h2><div className="mt-5 grid gap-4 lg:grid-cols-2"><TextInput label="Voting Title" required value={form.title} onChange={(e) => setForm((v) => ({ ...v, title: e.target.value }))} /><div className="lg:col-span-2"><TextArea label="Description" value={form.description} onChange={(e) => setForm((v) => ({ ...v, description: e.target.value }))} /></div><TextInput label="Voting Opens" type="datetime-local" value={form.startsAt} onChange={(e) => setForm((v) => ({ ...v, startsAt: e.target.value }))} /><TextInput label="Voting Closes" type="datetime-local" value={form.endsAt} onChange={(e) => setForm((v) => ({ ...v, endsAt: e.target.value }))} /></div></Card>
          <Card><div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Approved Project Choices</h2><p className="mt-1 text-sm text-stone-500">Select at least two approved suggestions. Selection remains checked while you move between pages.</p></div><Badge tone={selectedSuggestionIds.length >= 2 ? "success" : "warning"}>{selectedSuggestionIds.length} selected</Badge></div><div className="mt-5 max-w-md"><TextInput label="Search approved suggestions" value={suggestionSearch} onChange={(event) => { setSuggestionSearch(event.target.value); setSuggestionPage(1); }} placeholder="Search title or description" /></div>{approved.length ? <><div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visibleSuggestions.map((item) => { const selected = Boolean(selectedSuggestions[item.id]); return <button key={item.id} type="button" disabled={form.totalVotes > 0} onClick={() => toggle(item)} className={`overflow-hidden rounded-3xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-70 ${selected ? "border-[var(--brand-500)] bg-[var(--brand-50)] ring-2 ring-[var(--brand-200)]" : "border-stone-200 bg-white hover:border-[var(--brand-200)]"}`}>{item.image_url ? <img src={item.image_url} alt={item.title} className="mb-3 h-36 w-full rounded-2xl object-cover" /> : null}<div className="flex items-start gap-3"><span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selected ? "border-[var(--brand-500)] bg-[var(--brand-500)] text-white" : "border-stone-300"}`}>{selected ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}</span><div><p className="font-bold text-[var(--brand-900)]">{item.title}</p><p className="mt-1 line-clamp-3 text-sm text-stone-500">{item.description}</p></div></div></button>; })}</div><Pagination page={suggestionPage} totalPages={suggestionPages} onPageChange={setSuggestionPage} /></> : <EmptyState title="No approved suggestions" description="Approve resident project suggestions first, then create a voting post." />}</Card>
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={() => setBuilderOpen(false)} disabled={saving}>Cancel</Button>
            {form.originalStatus === "draft" ? <Button variant="secondary" loading={saving} onClick={() => saveElection("draft")}>Save Draft</Button> : null}
            {form.originalStatus === "draft" ? <Button loading={saving} onClick={() => saveElection("live")}>Publish Voting</Button> : null}
          </div>
        </div>}
      </Modal>

      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => !saving && setDeleteTarget(null)} onConfirm={deleteDraft} loading={saving} title="Delete this voting draft?" description={deleteTarget ? `“${deleteTarget.title}” will be permanently removed. Only drafts with no recorded votes can be deleted.` : ""} confirmLabel="Delete Draft" />
      <ConfirmDialog open={Boolean(closeTarget)} onClose={() => !saving && setCloseTarget(null)} onConfirm={closeVoting} loading={saving} title="Close voting early?" description={closeTarget ? `“${closeTarget.title}” will stop accepting votes and finalize the official result. A tie will require a runoff.` : ""} confirmLabel="Finalize & Close">
        <TextArea label="Reason for early closure (required)" value={closeReason} onChange={(event) => setCloseReason(event.target.value)} placeholder="Explain the decision for the public record" />
      </ConfirmDialog>
    </div>
  );
};

export default Admin_VotingResult;

