import { CalendarClock, CheckCircle2, Pencil, Plus, Trophy, Vote } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, SegmentedTabs, SelectInput, TextArea, TextInput } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

const tabs = [
  { value: "posts", label: "Voting Posts" },
  { value: "builder", label: "Create / Edit Voting" },
  { value: "results", label: "Election Results" },
];
const blankElection = { id: "", title: "Community Project Voting", description: "Choose the community project you want Barangay Iba to prioritize.", status: "draft", startsAt: "", endsAt: "" };
const tone = (status) => status === "closed" ? "success" : status === "live" ? "warning" : "neutral";
const toLocal = (value) => {
  if (!value) return "";
  const date = new Date(value); if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const toIso = (value) => value ? new Date(value).toISOString() : "";

const Admin_VotingResult = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState("posts");
  const [elections, setElections] = useState([]);
  const [approved, setApproved] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedElectionId, setSelectedElectionId] = useState("");
  const [form, setForm] = useState(blankElection);
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [resultData, suggestionData, projectData, latestData] = await Promise.all([
        api("/admin/election-results", { token }),
        api("/admin/suggestions?status=approved&page=1&limit=100", { token }),
        api("/admin/projects?status=all&page=1&limit=50", { token }).catch(() => ({ projects: [] })),
        api("/admin/election", { token }),
      ]);
      const resultElections = resultData.elections || [];
      setElections(resultElections);
      setApproved(suggestionData.suggestions || []);
      setProjects(projectData.projects || []);
      setSelectedElectionId((current) => current && resultElections.some((item) => item.id === current) ? current : resultElections[0]?.id || "");
      if (latestData.election) {
        setForm({
          id: latestData.election.id,
          title: latestData.election.title || "",
          description: latestData.election.description || "",
          status: latestData.election.status || "draft",
          startsAt: toLocal(latestData.election.starts_at || latestData.election.startsAt),
          endsAt: toLocal(latestData.election.ends_at || latestData.election.endsAt),
        });
        setSelectedSuggestionIds((latestData.options || []).map((option) => option.source_suggestion_id || option.sourceSuggestionId).filter(Boolean));
      } else {
        setForm(blankElection); setSelectedSuggestionIds([]);
      }
    } catch (loadError) { setError(loadError.message || "Unable to load project voting."); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (token) load(); }, [token]);

  const selectedResults = elections.find((item) => item.id === selectedElectionId) || elections[0] || null;
  const existingProject = selectedResults ? projects.find((project) => project.election_id === selectedResults.id) : null;
  const chartData = useMemo(() => (selectedResults?.options || []).map((item) => ({ name: item.name, votes: Number(item.votes || 0), share: Number(item.percentage || 0) })), [selectedResults]);

  const startNew = () => { setForm(blankElection); setSelectedSuggestionIds([]); setTab("builder"); };
  const editLatest = () => setTab("builder");
  const toggle = (id) => setSelectedSuggestionIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  const saveElection = async (event) => {
    event.preventDefault();
    if (form.status !== "draft" && selectedSuggestionIds.length < 2) return toast.error("Select at least two approved suggestions before publishing voting.");
    const choices = approved.filter((item) => selectedSuggestionIds.includes(item.id));
    setSaving(true);
    try {
      const body = new FormData();
      body.append("election", JSON.stringify({ id: form.id || undefined, title: form.title, description: form.description, status: form.status, startsAt: toIso(form.startsAt), endsAt: toIso(form.endsAt), sourceSuggestionId: choices[0]?.id || null }));
      body.append("options", JSON.stringify(choices.map((item) => ({ name: item.title, description: item.description, sourceSuggestionId: item.id, imageUrl: item.image_url || null }))));
      await api("/admin/election", { method: "PUT", token, body });
      toast.success("Voting post saved."); await load(); setTab("posts");
    } catch (saveError) { toast.error(saveError.message); }
    finally { setSaving(false); }
  };

  const createWinningProject = async () => {
    if (!selectedResults) return;
    setSaving(true);
    try {
      const data = await api(`/admin/projects/from-election/${selectedResults.id}`, { method: "POST", token });
      toast.success(data.message || "Community project created."); await load();
    } catch (createError) { toast.error(createError.message); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="space-y-8"><PageHeader eyebrow="Governance" title="Project Voting" description="Loading elections and results." /><LoadingState rows={6} /></div>;
  if (error) return <div className="space-y-8"><PageHeader eyebrow="Governance" title="Project Voting" description="Manage community voting separately from project suggestion review." /><ErrorState description={error} onRetry={load} /></div>;

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Governance & Transparency" title="Project Voting" description="Build ballots from approved suggestions, manage voting periods, and review a proper election results dashboard." actions={<Button onClick={startNew}><Plus className="h-4 w-4" /> Create Voting</Button>} />
      <SegmentedTabs value={tab} onChange={setTab} items={tabs} />

      {tab === "posts" ? <div className="space-y-5">
        <Card className="bg-[var(--brand-50)]"><p className="font-bold text-[var(--brand-900)]">Suggestions are reviewed separately</p><p className="mt-1 text-sm leading-6 text-stone-600">Only Approved resident suggestions are available here as voting choices. Approve or reject new ideas from <strong>Project Suggestions</strong> in the sidebar.</p></Card>
        {!elections.length ? <EmptyState title="No voting posts yet" description="Create the first community project voting post from approved resident suggestions." action={<Button onClick={startNew}>Create Voting</Button>} /> : <div className="grid gap-4 xl:grid-cols-2">{elections.map((item) => <Card key={item.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><Badge tone={tone(item.status)}>{item.status === "live" ? "Voting Open" : item.status === "closed" ? "Voting Closed" : "Draft"}</Badge><h2 className="mt-3 text-xl font-bold text-[var(--brand-900)]">{item.title}</h2></div><span className="text-2xl font-black text-[var(--brand-700)]">{item.totalVotes || 0}</span></div><div className="mt-4 grid gap-2 text-sm text-stone-600 sm:grid-cols-2"><p>Opens: {formatDateTime(item.startsAt)}</p><p>Closes: {formatDateTime(item.endsAt)}</p><p>{item.options?.length || 0} project choices</p><p>{item.participationRate || 0}% participation</p></div><div className="mt-5 flex gap-2"><Button variant="secondary" onClick={() => { setSelectedElectionId(item.id); setTab("results"); }}><Vote className="h-4 w-4" /> View Results</Button>{elections[0]?.id === item.id ? <Button variant="ghost" onClick={editLatest}><Pencil className="h-4 w-4" /> Edit Latest</Button> : null}</div></Card>)}</div>}
      </div> : null}

      {tab === "builder" ? <form onSubmit={saveElection} className="space-y-6">
        <Card><h2 className="text-xl font-bold text-[var(--brand-900)]">1. Voting Details</h2><div className="mt-5 grid gap-4 lg:grid-cols-2"><TextInput label="Voting Title" required value={form.title} onChange={(e) => setForm((v) => ({ ...v, title: e.target.value }))} /><SelectInput label="Status" value={form.status} onChange={(e) => setForm((v) => ({ ...v, status: e.target.value }))}><option value="draft">Draft</option><option value="live">Voting Open</option><option value="closed">Voting Closed</option></SelectInput><div className="lg:col-span-2"><TextArea label="Description" value={form.description} onChange={(e) => setForm((v) => ({ ...v, description: e.target.value }))} /></div><TextInput label="Voting Opens" type="datetime-local" value={form.startsAt} onChange={(e) => setForm((v) => ({ ...v, startsAt: e.target.value }))} /><TextInput label="Voting Closes" type="datetime-local" value={form.endsAt} onChange={(e) => setForm((v) => ({ ...v, endsAt: e.target.value }))} /></div></Card>
        <Card><div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold text-[var(--brand-900)]">2. Select Approved Suggestions</h2><p className="mt-1 text-sm text-stone-500">Each selected suggestion becomes one resident voting option.</p></div><Badge tone={selectedSuggestionIds.length >= 2 ? "success" : "warning"}>{selectedSuggestionIds.length} selected</Badge></div>{approved.length ? <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{approved.map((item) => { const selected = selectedSuggestionIds.includes(item.id); return <button key={item.id} type="button" onClick={() => toggle(item.id)} className={`overflow-hidden rounded-3xl border p-4 text-left transition ${selected ? "border-[var(--brand-500)] bg-[var(--brand-50)] ring-2 ring-[var(--brand-200)]" : "border-stone-200 bg-white hover:border-[var(--brand-200)]"}`}>{item.image_url ? <img src={item.image_url} alt={item.title} className="mb-3 h-36 w-full rounded-2xl object-cover" /> : null}<div className="flex items-start gap-3"><span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selected ? "border-[var(--brand-500)] bg-[var(--brand-500)] text-white" : "border-stone-300"}`}>{selected ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}</span><div><p className="font-bold text-[var(--brand-900)]">{item.title}</p><p className="mt-1 line-clamp-3 text-sm text-stone-500">{item.description}</p></div></div></button>; })}</div> : <EmptyState title="No approved suggestions" description="Approve resident project suggestions first, then return here to create a ballot." />}</Card>
        <Card><h2 className="text-xl font-bold text-[var(--brand-900)]">3. Review & Save</h2><p className="mt-2 text-sm leading-6 text-stone-600">Draft remains hidden. Setting the status to Voting Open lets eligible residents submit one final vote. Closing an election produces final results and creates the winning Community Project.</p><div className="mt-5 flex flex-wrap gap-3"><Button type="submit" loading={saving}>Save Voting Post</Button><Button type="button" variant="ghost" onClick={() => setTab("posts")}>Cancel</Button></div></Card>
      </form> : null}

      {tab === "results" ? <div className="space-y-6">
        {!elections.length ? <EmptyState title="No election results yet" description="Results appear after a voting post is created." /> : <>
          <Card><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div className="w-full lg:max-w-xl"><SelectInput label="Election" value={selectedResults?.id || ""} onChange={(e) => setSelectedElectionId(e.target.value)}>{elections.map((item) => <option key={item.id} value={item.id}>{item.title} — {item.status}</option>)}</SelectInput></div><Badge tone={tone(selectedResults?.status)}>{selectedResults?.status === "closed" ? "Voting Closed" : selectedResults?.status === "live" ? "Voting Open" : "Draft"}</Badge></div></Card>
          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">{[
            ["Votes Cast", selectedResults?.totalVotes || 0], ["Eligible Residents", selectedResults?.eligibleVoters || 0], ["Participation", `${selectedResults?.participationRate || 0}%`], ["Project Options", selectedResults?.options?.length || 0]
          ].map(([label, value]) => <Card key={label}><p className="text-sm font-semibold text-stone-500">{label}</p><p className="mt-2 text-3xl font-black text-[var(--brand-900)]">{value}</p></Card>)}</div>
          <Card className="overflow-hidden bg-gradient-to-br from-amber-50 to-white"><div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-start gap-4"><div className="rounded-3xl bg-amber-100 p-4 text-amber-700"><Trophy className="h-7 w-7" /></div><div><p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-700">{selectedResults?.status === "closed" ? "Winning Community Project" : "Current Leader"}</p><h2 className="mt-2 text-2xl font-black text-[var(--brand-900)]">{selectedResults?.winner?.name || "No votes yet"}</h2><p className="mt-2 text-sm text-stone-600">{selectedResults?.winner?.votes || 0} votes</p></div></div>{selectedResults?.status === "closed" && selectedResults?.winner ? existingProject ? <Button onClick={() => window.location.assign("/admin/projects")}>Manage Community Project</Button> : <Button loading={saving} onClick={createWinningProject}><Plus className="h-4 w-4" /> Create Community Project</Button> : null}</div></Card>
          <div className="grid gap-6 2xl:grid-cols-[1.2fr_0.8fr]"><Card><h2 className="text-xl font-bold text-[var(--brand-900)]">Vote Distribution</h2><div className="mt-5 h-80">{chartData.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 20 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} /><Tooltip /><Bar dataKey="votes" fill="var(--brand-500)" radius={[0, 8, 8, 0]} /></BarChart></ResponsiveContainer> : <EmptyState title="No votes recorded" description="Vote distribution will appear here after residents participate." />}</div></Card><Card><h2 className="text-xl font-bold text-[var(--brand-900)]">Project Ranking</h2><div className="mt-4 space-y-3">{[...(selectedResults?.options || [])].sort((a, b) => Number(b.votes || 0) - Number(a.votes || 0)).map((item, index) => <div key={item.id} className="rounded-2xl border border-stone-200 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold text-stone-400">#{index + 1}</p><p className="font-bold text-[var(--brand-900)]">{item.name}</p></div><div className="text-right"><p className="text-lg font-black text-[var(--brand-700)]">{item.votes || 0}</p><p className="text-xs text-stone-400">{item.percentage || 0}%</p></div></div></div>)}</div></Card></div>
          <Card><div className="grid gap-3 text-sm text-stone-600 sm:grid-cols-2 xl:grid-cols-4"><div><p className="text-xs font-bold uppercase text-stone-400">Opened</p><p className="mt-1 font-semibold">{formatDateTime(selectedResults?.startsAt)}</p></div><div><p className="text-xs font-bold uppercase text-stone-400">Closed</p><p className="mt-1 font-semibold">{formatDateTime(selectedResults?.endsAt)}</p></div><div><p className="text-xs font-bold uppercase text-stone-400">Not Yet Voted</p><p className="mt-1 font-semibold">{selectedResults?.notVotedCount || 0}</p></div><div><p className="text-xs font-bold uppercase text-stone-400">Completion Confirmations</p><p className="mt-1 font-semibold">{selectedResults?.completionCount || 0}</p></div></div></Card>
        </>}
      </div> : null}
    </div>
  );
};

export default Admin_VotingResult;
