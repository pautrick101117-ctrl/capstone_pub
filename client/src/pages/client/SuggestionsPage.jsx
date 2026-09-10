import { ImagePlus, Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Card, EmptyState, PageHeader, TextArea, TextInput } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

const SuggestionsPage = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [suggestions, setSuggestions] = useState([]);
  const [form, setForm] = useState({ title: "", description: "", image: null, preview: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api("/suggestions/mine", { token });
      setSuggestions(data.suggestions || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) load();
  }, [token]);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("title", form.title);
      formData.append("description", form.description);
      if (form.image) formData.append("image", form.image);

      await api("/suggestions", { method: "POST", token, body: formData });
      toast.success("Project suggestion submitted.");
      setForm({ title: "", description: "", image: null, preview: "" });
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Project Suggestions"
        title="Suggest a project for the barangay"
        description="Share an idea that could improve your purok or the wider Barangay Iba community. Approved suggestions can be turned into a voting draft."
      />

      <Card className="bg-[var(--brand-50)]">
        <div className="flex items-start gap-3"><Info className="mt-0.5 h-5 w-5 shrink-0 text-[var(--brand-600)]" /><div><h2 className="font-bold text-[var(--brand-900)]">What happens after you submit?</h2><p className="mt-1 text-sm leading-6 text-stone-600">Your suggestion goes to barangay review first. Approval does not automatically mean the project will be implemented; approved suggestions may be selected as choices in a future Community Project Voting period. You can track your suggestion status below.</p></div></div>
      </Card>

      <Card>
        <form className="space-y-4" onSubmit={submit}>
          <TextInput
            label="Project Title"
            required
            minLength={5}
            maxLength={120}
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            placeholder="Example: Solar lights for Purok 3"
          />
          <TextArea
            label="Description"
            required
            minLength={20}
            maxLength={1500}
            hint="Describe the community problem, who benefits, and the proposed improvement."
            value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            placeholder="Explain the community problem and how your idea helps."
          />
          <label className="flex flex-col gap-2 text-sm font-medium text-stone-700">
            <span>Project Image (optional)</span>
            <div className="flex flex-col gap-3 rounded-3xl border border-dashed border-stone-300 bg-stone-50 p-4">
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  setForm((current) => ({
                    ...current,
                    image: file,
                    preview: file ? URL.createObjectURL(file) : "",
                  }));
                }}
                className="text-sm text-stone-600 file:mr-4 file:rounded-full file:border-0 file:bg-[var(--brand-500)] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-[var(--brand-600)]"
              />
              {form.preview ? (
                <div className="relative overflow-hidden rounded-3xl border border-stone-200 bg-white">
                  <img src={form.preview} alt="Selected project" className="h-64 w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, image: null, preview: "" }))}
                    className="absolute right-3 top-3 rounded-full bg-white/90 p-2 text-stone-700 shadow-sm transition hover:bg-white"
                    aria-label="Remove selected image"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 text-sm text-stone-500">
                  <ImagePlus className="h-5 w-5 text-[var(--brand-600)]" />
                  Add a photo, sketch, or reference image for the proposed project.
                </div>
              )}
            </div>
          </label>
          <Button type="submit" loading={saving}>
            Submit Suggestion
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="text-xl font-bold text-[var(--brand-900)]">Your Submissions</h2>
        <div className="mt-5 space-y-4">
          {loading ? (
            <p className="text-sm text-stone-500">Loading suggestions...</p>
          ) : !suggestions.length ? (
            <EmptyState title="No suggestions yet" description="Your submitted ideas will appear here with their review status." />
          ) : (
            suggestions.map((item) => (
              <div key={item.id} className="rounded-2xl border border-stone-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.title} className="mb-4 h-56 w-full rounded-2xl object-cover" />
                    ) : null}
                    <h3 className="text-lg font-bold text-[var(--brand-900)]">{item.title}</h3>
                    <p className="mt-2 text-sm text-stone-600">{item.description}</p>
                    <p className="mt-3 text-xs text-stone-400">{formatDateTime(item.created_at)}</p>
                  </div>
                  <Badge tone={item.status === "approved" ? "success" : item.status === "rejected" ? "danger" : "info"}>
                    {item.status}
                  </Badge>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
};

export default SuggestionsPage;
