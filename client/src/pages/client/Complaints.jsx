import { MessageSquareWarning, Send, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { Button, Card, EmptyState, PageError, PageHeader, Pagination, SelectInput, StatusBadge, TextArea, TextInput } from "../../components/ui";

const INITIAL_FORM = { complaint_type: "", details: "", priority: "normal" };
const pageSize = 5;

const Complaints = () => {
  const { token, refreshNotifications } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(INITIAL_FORM);
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [page, setPage] = useState(1);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setLoadError("");
    try {
      const data = await api("/complaints/mine", { token });
      setComplaints(data.complaints || []);
    } catch (error) {
      setLoadError(error.message || "Unable to load complaints.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const totalPages = Math.max(1, Math.ceil(complaints.length / pageSize));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const paginatedComplaints = complaints.slice((page - 1) * pageSize, page * pageSize);

  const submit = async (event) => {
    event.preventDefault();
    if (!form.complaint_type.trim() || !form.details.trim()) {
      toast.error("Complaint type and details are required.");
      return;
    }
    setSubmitting(true);
    try {
      const data = await api("/complaints", { method: "POST", token, body: form });
      toast.success(`Complaint ${data.complaint?.reference_code || ""} submitted.`.trim());
      setForm(INITIAL_FORM);
      await Promise.all([load(), refreshNotifications?.()]);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Complaint Desk"
        title="Report a community concern"
        description="Submit a complaint, keep the reference number, and follow the barangay response through each status update."
      />

      {loadError ? <PageError message={loadError} onRetry={load} /> : null}

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-rose-50 p-3 text-rose-600"><MessageSquareWarning className="h-5 w-5" /></div>
            <div><h2 className="text-xl font-bold text-[var(--brand-900)]">Submit Complaint</h2><p className="mt-1 text-sm text-stone-500">Be specific so barangay staff can route and respond to the concern correctly.</p></div>
          </div>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <TextInput
              label="Complaint Type"
              value={form.complaint_type}
              onChange={(event) => setForm((current) => ({ ...current, complaint_type: event.target.value }))}
              placeholder="Example: drainage, noise, road obstruction"
              maxLength={120}
            />
            <SelectInput label="Priority" value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))} hint="Use Urgent only for concerns requiring prompt barangay attention.">
              <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
            </SelectInput>
            <TextArea
              label="Details"
              value={form.details}
              onChange={(event) => setForm((current) => ({ ...current, details: event.target.value }))}
              placeholder="Describe what happened, where it happened, and any useful details."
              maxLength={3000}
            />
            <Button type="submit" loading={submitting}><Send className="h-4 w-4" />Submit Complaint</Button>
          </form>
        </Card>

        <Card>
          <div className="flex items-center gap-3"><ShieldCheck className="h-5 w-5 text-[var(--brand-600)]" /><div><h2 className="text-xl font-bold text-[var(--brand-900)]">My Complaints</h2><p className="mt-1 text-sm text-stone-500">Status, barangay notes, and reference numbers remain available here.</p></div></div>
          <div className="mt-5 space-y-4">
            {loading ? <p className="text-sm text-stone-500">Loading complaints...</p> : null}
            {!loading && !complaints.length ? <EmptyState title="No complaints submitted" description="Your complaint history will appear here after your first submission." /> : null}
            {paginatedComplaints.map((item) => (
              <div key={item.id} className="rounded-3xl border border-stone-200 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><p className="font-bold text-[var(--brand-900)]">{item.complaint_type}</p><span className="rounded-full bg-stone-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-stone-500">{item.priority || "normal"}</span></div>
                    <p className="mt-1 text-xs font-semibold text-stone-400">{item.reference_code || String(item.id).slice(0, 8)} • {formatDateTime(item.created_at)}</p>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
                <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-stone-600">{item.details}</p>
                {item.admin_note ? <div className="mt-4 rounded-2xl bg-[var(--brand-50)] p-4"><p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--brand-600)]">Barangay Note</p><p className="mt-2 text-sm text-stone-700">{item.admin_note}</p></div> : null}
              </div>
            ))}
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Complaints;
