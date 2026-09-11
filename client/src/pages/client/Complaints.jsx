import { Clock3, Phone, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, Pagination, SegmentedTabs, SelectInput, TextArea } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useMasterData } from "../../hooks/useMasterData";
import { getStatusMeta } from "../../lib/status";

const INITIAL_FORM = { complaint_type: "", details: "" };
const pageSize = 6;

const Complaints = () => {
  const { token, refreshNotifications } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(INITIAL_FORM);
  const [complaints, setComplaints] = useState([]);
  const [hotline, setHotline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState("mine");
  const [success, setSuccess] = useState(null);
  const [page, setPage] = useState(1);
  const { options: concernOptions } = useMasterData("concern_category");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [mine, support] = await Promise.all([api("/complaints/mine", { token }), api("/public/community-support")]);
      setComplaints(mine.complaints || []);
      setHotline(support.hotline || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (token) load(); }, [token]);

  const visibleComplaints = useMemo(() => complaints.slice((page - 1) * pageSize, page * pageSize), [complaints, page]);

  const submitComplaint = async (event) => {
    event.preventDefault();
    if (!form.complaint_type.trim() || !form.details.trim()) return toast.error("Concern type and details are required.");
    setSubmitting(true);
    try {
      const data = await api("/complaints", { method: "POST", token, body: form });
      setSuccess(data.complaint || true);
      setForm(INITIAL_FORM);
      setActiveTab("mine");
      await Promise.all([load(), refreshNotifications()]);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Resident Services" title="Community concerns" description="Report non-emergency community issues to barangay staff and follow the response until the concern is resolved." actions={<Button type="button" onClick={() => setActiveTab("report")}><Send className="h-4 w-4" /> Report Concern</Button>} />

      {hotline ? (
        <Alert tone="danger" title={hotline.title || "Barangay Hotline"} actions={<a href={`tel:${hotline.phone || ""}`} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white"><Phone className="h-4 w-4" /> {hotline.phone || "Call Hotline"}</a>}>
          <p>For urgent matters, call the barangay instead of submitting a normal concern and waiting for review. {hotline.hours ? `Availability: ${hotline.hours}.` : ""}</p>
        </Alert>
      ) : null}

      {success ? <Alert tone="success" title="Concern submitted"><p>Your report is now in the barangay review queue. Status updates and barangay responses will appear in My Concerns and Notifications.</p>{success?.id ? <p className="mt-1 text-xs font-semibold">Reference: {success.id}</p> : null}</Alert> : null}

      <SegmentedTabs value={activeTab} onChange={(value) => { setSuccess(null); setActiveTab(value); }} items={[{ value: "mine", label: "My Concerns", count: complaints.length }, { value: "report", label: "Report Concern" }]} />

      {activeTab === "report" ? (
        <div className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
          <Card className="bg-gradient-to-br from-white to-[var(--brand-50)]">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand-500)]">Before submitting</p>
            <h2 className="mt-2 text-2xl font-black text-[var(--brand-900)]">Help staff understand the issue quickly</h2>
            <div className="mt-5 space-y-3 text-sm leading-6 text-stone-600">
              <div className="rounded-2xl bg-white p-4"><strong className="text-stone-800">Choose the correct category.</strong><br />This helps the barangay route the concern to the right team.</div>
              <div className="rounded-2xl bg-white p-4"><strong className="text-stone-800">Include the exact location.</strong><br />Add street, landmark or purok details inside the description.</div>
              <div className="rounded-2xl bg-white p-4"><strong className="text-stone-800">Do not duplicate reports.</strong><br />Track an existing concern from My Concerns instead.</div>
            </div>
          </Card>
          <Card>
            <h2 className="text-xl font-bold text-[var(--brand-900)]">Concern details</h2>
            <p className="mt-1 text-sm text-stone-500">Your report will be visible to authorized barangay staff.</p>
            <form className="mt-6 space-y-5" onSubmit={submitComplaint}>
              <SelectInput label="Concern Type" required value={form.complaint_type} onChange={(event) => setForm((current) => ({ ...current, complaint_type: event.target.value }))}><option value="">Select a concern</option>{concernOptions.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</SelectInput>
              <TextArea label="Details" required minLength={10} maxLength={1500} hint="Include the exact location and enough context for barangay staff to understand what happened." value={form.details} onChange={(event) => setForm((current) => ({ ...current, details: event.target.value }))} placeholder="Describe the location, issue, and any useful details..." />
              <Button type="submit" loading={submitting}><Send className="h-4 w-4" /> Submit Concern</Button>
            </form>
          </Card>
        </div>
      ) : (
        <div className="space-y-4">
          {loading ? <LoadingState rows={3} /> : error ? <ErrorState description={error} onRetry={load} /> : complaints.length === 0 ? <EmptyState title="No concerns submitted" description="If you notice a non-emergency issue in the community, submit a report and track the barangay response here." action={<Button type="button" onClick={() => setActiveTab("report")}>Report a Concern</Button>} /> : visibleComplaints.map((complaint) => {
            const meta = getStatusMeta(complaint.status || "pending", "complaint");
            return (
              <Card key={complaint.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div><h3 className="text-lg font-bold text-[var(--brand-900)]">{complaint.complaint_type}</h3><p className="mt-1 flex items-center gap-1 text-xs text-stone-500"><Clock3 className="h-3.5 w-3.5" /> Submitted {formatDateTime(complaint.created_at)}</p></div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>
                <p className="mt-4 text-sm leading-7 text-stone-700">{complaint.details}</p>
                {complaint.admin_note ? <div className="mt-4 rounded-2xl bg-sky-50 p-4 text-sm text-stone-700"><p className="font-semibold text-sky-800">Barangay response</p><p className="mt-1 leading-6">{complaint.admin_note}</p></div> : complaint.status !== "resolved" ? <div className="mt-4 rounded-2xl bg-stone-50 p-4 text-sm text-stone-500">Barangay staff has not added a response yet.</div> : null}
              </Card>
            );
          })}
          {!loading && !error ? <Pagination page={page} totalPages={Math.max(1, Math.ceil(complaints.length / pageSize))} onPageChange={setPage} /> : null}
        </div>
      )}
    </div>
  );
};

export default Complaints;
