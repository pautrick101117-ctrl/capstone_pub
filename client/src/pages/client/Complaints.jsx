import { Clock3, Phone, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { Badge, Button, Card, EmptyState, PageHeader, SelectInput, TextArea } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

const INITIAL_FORM = { complaint_type: "", details: "" };
const tone = { pending: "warning", in_review: "info", resolved: "success" };

const Complaints = () => {
  const { token, refreshNotifications } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(INITIAL_FORM);
  const [complaints, setComplaints] = useState([]);
  const [hotline, setHotline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [mine, support] = await Promise.all([
        api("/complaints/mine", { token }),
        api("/public/community-support"),
      ]);
      setComplaints(mine.complaints || []);
      setHotline(support.hotline || null);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) load();
  }, [token]);

  const submitComplaint = async (event) => {
    event.preventDefault();
    if (!form.complaint_type.trim() || !form.details.trim()) {
      toast.error("Concern type and details are required.");
      return;
    }
    setSubmitting(true);
    try {
      await api("/complaints", { method: "POST", token, body: form });
      toast.success("Community concern submitted. You can track its status below.");
      setForm(INITIAL_FORM);
      await Promise.all([load(), refreshNotifications()]);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Community Support"
        title="Report a community concern"
        description="Send non-emergency barangay concerns to the admin team and track their status. For urgent matters, use the hotline below."
      />

      {hotline ? (
        <Card className="border-rose-200 bg-rose-50/70">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <div className="rounded-2xl bg-rose-100 p-3 text-rose-700"><Phone className="h-5 w-5" /></div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-600">Hotline</p>
                <h2 className="mt-1 text-xl font-black text-stone-900">{hotline.title || "Barangay Hotline"}</h2>
                <p className="mt-1 text-sm text-stone-600">{hotline.hours}</p>
                {hotline.note ? <p className="mt-2 text-xs text-stone-500">{hotline.note}</p> : null}
              </div>
            </div>
            <a href={`tel:${hotline.phone || ""}`} className="inline-flex items-center justify-center rounded-full bg-rose-600 px-5 py-3 text-sm font-bold text-white hover:bg-rose-700">
              <Phone className="mr-2 h-4 w-4" /> {hotline.phone || "Call Hotline"}
            </a>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <h2 className="text-xl font-bold text-[var(--brand-900)]">Concern details</h2>
          <p className="mt-1 text-sm text-stone-500">Please be specific so barangay staff can review the concern efficiently.</p>
          <form className="mt-5 space-y-4" onSubmit={submitComplaint}>
            <SelectInput label="Concern Type" value={form.complaint_type} onChange={(e) => setForm((v) => ({ ...v, complaint_type: e.target.value }))}>
              <option value="">Select a concern</option>
              <option>Road / Drainage</option>
              <option>Noise / Disturbance</option>
              <option>Waste / Cleanliness</option>
              <option>Street Light / Public Facility</option>
              <option>Safety / Security</option>
              <option>Other Community Concern</option>
            </SelectInput>
            <TextArea label="Details" value={form.details} onChange={(e) => setForm((v) => ({ ...v, details: e.target.value }))} placeholder="Describe the location, issue, and any useful details..." />
            <Button type="submit" loading={submitting}><Send className="h-4 w-4" /> Submit Concern</Button>
          </form>
        </Card>

        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-bold text-[var(--brand-900)]">My reported concerns</h2>
            <p className="mt-1 text-sm text-stone-500">Status updates from barangay staff appear here.</p>
          </div>
          {loading ? <Card><p className="text-sm text-stone-500">Loading concerns...</p></Card> : null}
          {!loading && complaints.length === 0 ? <EmptyState title="No concerns submitted" description="Your submitted community concerns will appear here." /> : null}
          {complaints.map((complaint) => (
            <Card key={complaint.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-[var(--brand-900)]">{complaint.complaint_type}</h3>
                  <p className="mt-1 flex items-center gap-1 text-xs text-stone-500"><Clock3 className="h-3.5 w-3.5" /> {formatDateTime(complaint.created_at)}</p>
                </div>
                <Badge tone={tone[complaint.status] || "neutral"}>{`${complaint.status || "pending"}`.replace("_", " ")}</Badge>
              </div>
              <p className="mt-4 text-sm leading-6 text-stone-700">{complaint.details}</p>
              {complaint.admin_note ? (
                <div className="mt-4 rounded-2xl bg-[var(--brand-50)] p-4 text-sm text-stone-700">
                  <p className="font-semibold text-[var(--brand-800)]">Barangay response</p>
                  <p className="mt-1">{complaint.admin_note}</p>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Complaints;
