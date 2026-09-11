import { CheckCircle2, CircleAlert, MessageSquareText, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, Modal, PageHeader, SegmentedTabs, TextArea, TextInput } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { getStatusMeta } from "../../lib/status";

const Admin_Complaints = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [complaints, setComplaints] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("pending");
  const [selected, setSelected] = useState(null);
  const [review, setReview] = useState({ status: "in_review", adminNote: "" });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api("/admin/complaints", { token });
      setComplaints(data.complaints || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { if (token) load(); }, [token]);

  const filtered = useMemo(() => complaints.filter((item) => {
    const matchesStatus = status === "all" || item.status === status;
    const haystack = `${item.resident_name} ${item.complaint_type} ${item.details}`.toLowerCase();
    return matchesStatus && haystack.includes(search.trim().toLowerCase());
  }), [complaints, search, status]);

  const openReview = (item, nextStatus = item.status === "pending" ? "in_review" : item.status) => {
    setSelected(item);
    setReview({ status: nextStatus, adminNote: item.admin_note || "" });
  };

  const saveReview = async () => {
    if (review.status === "resolved" && review.adminNote.trim().length < 3) return toast.error("Add a resident-facing response before resolving the concern.");
    setSaving(true);
    try {
      const data = await api(`/admin/complaints/${selected.id}`, { method: "PATCH", token, body: review });
      toast.success(data.message || "Community concern updated.");
      setSelected(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Resident Services" title="Community concerns" description="Work from the oldest pending concerns first, communicate clearly with residents, and resolve reports only after a useful response is recorded." />

      <SegmentedTabs value={status} onChange={setStatus} items={[
        { value: "pending", label: "Pending", count: complaints.filter((item) => item.status === "pending").length },
        { value: "in_review", label: "Under Review", count: complaints.filter((item) => item.status === "in_review").length },
        { value: "resolved", label: "Resolved", count: complaints.filter((item) => item.status === "resolved").length },
        { value: "all", label: "All" },
      ]} />

      <Card><div className="max-w-xl"><TextInput label="Search concerns" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Resident, category, or report details..." /></div></Card>

      {loading ? <LoadingState rows={5} /> : error ? <ErrorState description={error} onRetry={load} /> : filtered.length === 0 ? <EmptyState title="No community concerns in this queue" description={search ? "Try another search term or status." : "You're all caught up in this concern status."} /> : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const meta = getStatusMeta(item.status, "complaint");
            return <Card key={item.id} className="p-4"><div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-[var(--brand-900)]">{item.complaint_type}</h3><Badge tone={meta.tone}>{meta.label}</Badge></div><p className="mt-1 text-sm font-semibold text-stone-600">{item.resident_name}</p><p className="mt-3 max-w-3xl text-sm leading-7 text-stone-600">{item.details}</p>{item.admin_note ? <div className="mt-3 rounded-2xl bg-sky-50 p-3 text-sm text-stone-700"><span className="font-semibold text-sky-800">Current response:</span> {item.admin_note}</div> : null}<p className="mt-3 text-xs text-stone-400">Submitted {formatDateTime(item.created_at)}</p></div><div className="flex shrink-0 flex-wrap gap-2">{item.status === "pending" ? <Button onClick={() => openReview(item, "in_review")}><MessageSquareText className="h-4 w-4" /> Start Review</Button> : null}{item.status !== "resolved" ? <Button variant="secondary" onClick={() => openReview(item, "resolved")}><CheckCircle2 className="h-4 w-4" /> Resolve</Button> : <Button variant="secondary" onClick={() => openReview(item, "resolved")}><MessageSquareText className="h-4 w-4" /> View Response</Button>}</div></div></Card>;
          })}
        </div>
      )}

      <Modal open={Boolean(selected)} onClose={() => !saving && setSelected(null)} closeDisabled={saving} title={review.status === "resolved" ? "Resolve community concern" : "Review community concern"} description={selected ? `${selected.resident_name} · ${selected.complaint_type}` : ""} widthClass="max-w-2xl">
        {selected ? <div className="space-y-5"><div className="rounded-2xl bg-stone-50 p-4 text-sm leading-7 text-stone-700"><div className="mb-2 flex items-center gap-2 font-semibold text-stone-900"><CircleAlert className="h-4 w-4" /> Resident report</div>{selected.details}</div><div className="rounded-2xl bg-[var(--brand-50)] p-4"><p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--brand-500)]">New status</p><p className="mt-1 font-bold text-[var(--brand-900)]">{getStatusMeta(review.status, "complaint").label}</p></div><TextArea label="Barangay response" required={review.status === "resolved"} value={review.adminNote} onChange={(event) => setReview((current) => ({ ...current, adminNote: event.target.value }))} placeholder={review.status === "resolved" ? "Explain what was done or how the concern was resolved." : "Add an update visible to the resident..."} /><div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button variant="secondary" onClick={() => setSelected(null)} disabled={saving}>Cancel</Button><Button onClick={saveReview} loading={saving}>{review.status === "resolved" ? "Mark Resolved" : "Start Review"}</Button></div></div> : null}
      </Modal>
    </div>
  );
};
export default Admin_Complaints;
