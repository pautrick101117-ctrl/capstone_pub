import { ImagePlus, Info, Lightbulb, Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, SegmentedTabs, TextArea, TextInput } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { getStatusMeta } from "../../lib/status";

const SuggestionsPage = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [suggestions, setSuggestions] = useState([]);
  const [form, setForm] = useState({ title: "", description: "", image: null, preview: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("mine");
  const [success, setSuccess] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api("/suggestions/mine", { token });
      setSuggestions(data.suggestions || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (token) load(); }, [token]);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("title", form.title);
      formData.append("description", form.description);
      if (form.image) formData.append("image", form.image);
      await api("/suggestions", { method: "POST", token, body: formData });
      setForm({ title: "", description: "", image: null, preview: "" });
      setSuccess(true);
      setActiveTab("mine");
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Community Participation" title="Project suggestions" description="Share an idea that could improve your purok or the wider Barangay Iba community, then follow its review status." actions={<Button type="button" onClick={() => setActiveTab("submit")}><Lightbulb className="h-4 w-4" /> Suggest a Project</Button>} />

      <Alert tone="info" title="How suggestions become community projects"><p>Barangay staff reviews each suggestion first. Approval means the idea may be considered for a future Community Project Voting period; it does not automatically mean the project will be implemented.</p></Alert>
      {success ? <Alert tone="success" title="Project suggestion submitted"><p>Your idea is now under barangay review. You can track its status below.</p></Alert> : null}

      <SegmentedTabs value={activeTab} onChange={(value) => { setSuccess(false); setActiveTab(value); }} items={[{ value: "mine", label: "My Suggestions", count: suggestions.length }, { value: "submit", label: "Submit Idea" }]} />

      {activeTab === "submit" ? (
        <div className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
          <Card className="bg-gradient-to-br from-white to-[var(--brand-50)]">
            <div className="flex items-start gap-3"><Info className="mt-0.5 h-5 w-5 shrink-0 text-[var(--brand-600)]" /><div><h2 className="text-xl font-bold text-[var(--brand-900)]">What makes a useful suggestion?</h2><p className="mt-1 text-sm leading-6 text-stone-600">Explain the community problem, the proposed improvement, where it should happen, and who would benefit.</p></div></div>
            <div className="mt-5 space-y-3 text-sm text-stone-600"><div className="rounded-2xl bg-white p-4"><strong>Problem:</strong> What needs improvement?</div><div className="rounded-2xl bg-white p-4"><strong>Solution:</strong> What project are you proposing?</div><div className="rounded-2xl bg-white p-4"><strong>Impact:</strong> Who benefits and why?</div></div>
          </Card>
          <Card>
            <form className="space-y-5" onSubmit={submit}>
              <TextInput label="Project Title" required minLength={5} maxLength={120} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Example: Solar lights for Purok 3" />
              <TextArea label="Description" required minLength={20} maxLength={1500} hint="Describe the problem, proposed solution, location and community benefit." value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Explain the community problem and how your idea helps." />
              <label className="flex flex-col gap-2 text-sm font-medium text-stone-700">
                <span>Project Image <span className="font-normal text-stone-400">(optional)</span></span>
                <div className="flex flex-col gap-3 rounded-3xl border border-dashed border-stone-300 bg-stone-50 p-4">
                  <input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0] || null; setForm((current) => ({ ...current, image: file, preview: file ? URL.createObjectURL(file) : "" })); }} className="text-sm text-stone-600 file:mr-4 file:rounded-full file:border-0 file:bg-[var(--brand-500)] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-[var(--brand-600)]" />
                  {form.preview ? <div className="relative overflow-hidden rounded-3xl border border-stone-200 bg-white"><img src={form.preview} alt="Selected project" className="h-64 w-full object-cover" /><button type="button" onClick={() => setForm((current) => ({ ...current, image: null, preview: "" }))} className="absolute right-3 top-3 rounded-full bg-white/90 p-2 text-stone-700 shadow-sm" aria-label="Remove selected image"><X className="h-4 w-4" /></button></div> : <div className="flex items-center gap-3 text-sm text-stone-500"><ImagePlus className="h-5 w-5 text-[var(--brand-600)]" /> Add a photo, sketch or reference image.</div>}
                </div>
              </label>
              <Button type="submit" loading={saving}><Send className="h-4 w-4" /> Submit Suggestion</Button>
            </form>
          </Card>
        </div>
      ) : loading ? <LoadingState rows={3} /> : error ? <ErrorState description={error} onRetry={load} /> : !suggestions.length ? <EmptyState title="No suggestions yet" description="Share an idea for a community improvement and track the barangay review status here." action={<Button type="button" onClick={() => setActiveTab("submit")}>Suggest a Project</Button>} /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {suggestions.map((item) => {
            const meta = getStatusMeta(item.status, "suggestion");
            return <Card key={item.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1">{item.image_url ? <img src={item.image_url} alt={item.title} className="mb-4 h-52 w-full rounded-2xl object-cover" /> : null}<div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-bold text-[var(--brand-900)]">{item.title}</h3><Badge tone={meta.tone}>{meta.label}</Badge></div><p className="mt-3 text-sm leading-7 text-stone-600">{item.description}</p><p className="mt-3 text-xs text-stone-400">Submitted {formatDateTime(item.created_at)}</p></div></div></Card>;
          })}
        </div>
      )}
    </div>
  );
};

export default SuggestionsPage;
