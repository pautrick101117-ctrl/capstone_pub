import { ImagePlus, Info, Lightbulb, Send, Trophy, Vote, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, Pagination, SegmentedTabs, TextArea, TextInput } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { getStatusMeta } from "../../lib/status";

const pageSize = 8;
const filters = [
  { value: "all", label: "All" },
  { value: "pending", label: "Under Review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Not Approved" },
  { value: "won", label: "Won Community Vote" },
];
const outcomeMeta = {
  won: { label: "Won Community Vote", tone: "success" },
  in_voting: { label: "Currently in Voting", tone: "info" },
  scheduled: { label: "Included in Voting", tone: "info" },
  not_selected: { label: "Not Selected by Vote", tone: "neutral" },
};

const SuggestionsPage = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [suggestions, setSuggestions] = useState([]);
  const [form, setForm] = useState({ title: "", description: "", image: null, preview: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("mine");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [success, setSuccess] = useState(false);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const data = await api(`/suggestions/mine?status=${filter}&page=${page}&limit=${pageSize}`, { token });
      setSuggestions(data.suggestions || []); setPagination(data.pagination || { total: 0, totalPages: 1 });
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  useEffect(() => { if (token && activeTab === "mine") load(); }, [token, activeTab, filter, page]);
  useEffect(() => { setPage(1); }, [filter]);

  const submit = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      const formData = new FormData(); formData.append("title", form.title); formData.append("description", form.description); if (form.image) formData.append("image", form.image);
      await api("/suggestions", { method: "POST", token, body: formData });
      setForm({ title: "", description: "", image: null, preview: "" }); setSuccess(true); setFilter("all"); setPage(1); setActiveTab("mine");
      toast.success("Project suggestion submitted for barangay review.");
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Community Participation" title="Project Suggestions" description="Submit ideas for Barangay Iba and follow the full path from review to community voting and, if selected, actual implementation." actions={<Button type="button" onClick={() => setActiveTab("submit")}><Lightbulb className="h-4 w-4" /> Suggest a Project</Button>} />
      <Alert tone="info" title="Suggestion, voting, and implementation are separate"><p>Your idea is first reviewed by the barangay. Approved suggestions may be included in Project Voting. If your suggestion wins, it becomes a separate Community Project with public implementation updates.</p></Alert>
      {success ? <Alert tone="success" title="Project suggestion submitted"><p>Your idea is now under review. Newest suggestions appear first.</p></Alert> : null}
      <SegmentedTabs value={activeTab} onChange={(value) => { setSuccess(false); setActiveTab(value); }} items={[{ value: "mine", label: "My Suggestions", count: pagination.total || suggestions.length }, { value: "submit", label: "Submit Idea" }]} />

      {activeTab === "submit" ? (
        <div className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
          <Card className="bg-gradient-to-br from-white to-[var(--brand-50)]"><div className="flex items-start gap-3"><Info className="mt-0.5 h-5 w-5 shrink-0 text-[var(--brand-600)]" /><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Make the idea easy to evaluate</h2><p className="mt-1 text-sm leading-6 text-stone-600">Explain the problem, proposed solution, location, and who would benefit. You can add a reference photo or sketch.</p></div></div></Card>
          <Card><form className="space-y-5" onSubmit={submit}><TextInput label="Project Title" required minLength={5} maxLength={120} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Example: Solar lights for Purok 3" /><TextArea label="Description" required minLength={20} maxLength={1500} hint="Describe the problem, proposed solution, location and community benefit." value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /><label className="flex flex-col gap-2 text-sm font-medium text-stone-700"><span>Project Image <span className="font-normal text-stone-400">(optional)</span></span><div className="flex flex-col gap-3 rounded-3xl border border-dashed border-stone-300 bg-stone-50 p-4"><input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0] || null; setForm((current) => ({ ...current, image: file, preview: file ? URL.createObjectURL(file) : "" })); }} />{form.preview ? <div className="relative"><img src={form.preview} alt="Selected project" className="h-64 w-full rounded-2xl object-cover" /><button type="button" onClick={() => setForm((current) => ({ ...current, image: null, preview: "" }))} className="absolute right-3 top-3 rounded-full bg-white/90 p-2 shadow" aria-label="Remove image"><X className="h-4 w-4" /></button></div> : <div className="flex items-center gap-3 text-sm text-stone-500"><ImagePlus className="h-5 w-5 text-[var(--brand-600)]" /> Add a photo, sketch or reference image.</div>}</div></label><Button type="submit" loading={saving}><Send className="h-4 w-4" /> Submit Suggestion</Button></form></Card>
        </div>
      ) : <>
        <SegmentedTabs value={filter} onChange={setFilter} items={filters} />
        {loading ? <LoadingState rows={4} /> : error ? <ErrorState description={error} onRetry={load} /> : !suggestions.length ? <EmptyState title="No suggestions in this filter" description="Your submitted project ideas will appear here newest first." action={filter === "all" ? <Button type="button" onClick={() => setActiveTab("submit")}>Suggest a Project</Button> : null} /> : (
          <div className="grid gap-4 lg:grid-cols-2">
            {suggestions.map((item) => {
              const meta = getStatusMeta(item.status, "suggestion");
              const outcome = outcomeMeta[item.votingOutcome];
              const projectMeta = item.project ? getStatusMeta(item.project.status) : null;
              return <Card key={item.id}>{item.image_url ? <img src={item.image_url} alt={item.title} className="mb-4 h-52 w-full rounded-2xl object-cover" /> : null}<div className="flex flex-wrap items-center gap-2"><Badge tone={meta.tone}>{meta.label}</Badge>{outcome ? <Badge tone={outcome.tone}>{outcome.label}</Badge> : null}{item.project ? <Badge tone={projectMeta.tone}>{projectMeta.label} · {item.project.progress_percentage || 0}%</Badge> : null}</div><h3 className="mt-3 text-lg font-bold text-[var(--brand-900)]">{item.title}</h3><p className="mt-3 text-sm leading-7 text-stone-600">{item.description}</p>{item.review_note ? <div className="mt-4 rounded-2xl bg-stone-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-stone-400">Barangay review note</p><p className="mt-1 text-sm text-stone-700">{item.review_note}</p></div> : null}<div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-stone-400">Submitted {formatDateTime(item.created_at)}</p>{item.project ? <NavLink to={`/project-updates/${item.project.id}`} className="inline-flex items-center gap-2 text-sm font-bold text-[var(--brand-700)] hover:underline"><Trophy className="h-4 w-4" /> View Project Updates</NavLink> : item.votingOutcome === "in_voting" ? <NavLink to="/portal/voting" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--brand-700)] hover:underline"><Vote className="h-4 w-4" /> View Voting</NavLink> : null}</div></Card>;
            })}
          </div>
        )}
        {!loading && !error && pagination.totalPages > 1 ? <Pagination page={page} totalPages={pagination.totalPages} onPageChange={setPage} /> : null}
      </>}
    </div>
  );
};

export default SuggestionsPage;
