import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, Modal, PageHeader, Pagination, SegmentedTabs, TextArea, TextInput } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

const pageSize = 8;
const tone = { pending: "warning", in_review: "info", resolved: "success" };
const statusLabel = { pending: "Pending", in_review: "Under Review", resolved: "Resolved" };

const Admin_Complaints = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [complaints, setComplaints] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("pending");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [review, setReview] = useState({ status: "in_review", adminNote: "" });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try { const data = await api("/admin/complaints", { token }); setComplaints(data.complaints || []); }
    catch (err) { setError(err.message || "Unable to load community concerns."); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (token) load(); }, [token]);
  useEffect(() => { setPage(1); }, [status, search]);

  const filtered = useMemo(() => complaints.filter((item) => {
    if (status !== "all" && item.status !== status) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [item.complaint_type, item.details, item.admin_note, item.users?.full_name, item.users?.purok].filter(Boolean).join(" ").toLowerCase().includes(q);
  }), [complaints, status, search]);
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  const openReview = (item) => {
    setSelected(item);
    setReview({ status: item.status === "pending" ? "in_review" : item.status, adminNote: item.admin_note || "" });
  };
  const save = async () => {
    if (!selected) return;
    if (review.status === "resolved" && review.adminNote.trim().length < 3) return toast.error("Add a short resolution note for the resident.");
    setSaving(true);
    try {
      await api(`/admin/complaints/${selected.id}`, { method: "PATCH", token, body: review });
      toast.success(review.status === "resolved" ? "Concern resolved." : "Concern review updated.");
      setSelected(null); await load();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  const counts = Object.fromEntries(["pending", "in_review", "resolved"].map((value) => [value, complaints.filter((item) => item.status === value).length]));

  return <div className="space-y-8">
    <PageHeader eyebrow="Resident Services" title="Community Concerns" description="Review resident concerns from newest to oldest and move each one through a clear Pending → Under Review → Resolved workflow." />
    <Card>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><SegmentedTabs value={status} onChange={setStatus} items={[{ value: "pending", label: "Pending", count: counts.pending }, { value: "in_review", label: "Under Review", count: counts.in_review }, { value: "resolved", label: "Resolved", count: counts.resolved }, { value: "all", label: "All", count: complaints.length }]} /><div className="w-full lg:max-w-sm"><TextInput label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Resident, category, purok..." /></div></div>
    </Card>
    {loading ? <LoadingState rows={5} /> : error ? <ErrorState description={error} onRetry={load} /> : !visible.length ? <EmptyState title="No concerns in this view" description="Try another status or search term." /> : <div className="space-y-3">{visible.map((item) => <button key={item.id} type="button" onClick={() => openReview(item)} className="w-full text-left"><Card className="hover:border-[var(--brand-200)] hover:shadow-md"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><Badge tone={tone[item.status] || "neutral"}>{statusLabel[item.status] || item.status}</Badge><span className="text-xs text-stone-400">{formatDateTime(item.created_at)}</span></div><h2 className="mt-2 font-bold text-[var(--brand-900)]">{item.complaint_type}</h2><p className="mt-1 text-sm text-stone-500">{item.users?.full_name || "Resident"}{item.users?.purok ? ` · ${item.users.purok}` : ""}</p><p className="mt-3 line-clamp-2 text-sm leading-6 text-stone-600">{item.details}</p></div><Search className="h-5 w-5 text-stone-400" /></div></Card></button>)}</div>}
    {!loading && !error ? <Pagination page={page} totalPages={Math.max(1, Math.ceil(filtered.length / pageSize))} onPageChange={setPage} /> : null}

    <Modal open={Boolean(selected)} onClose={() => !saving && setSelected(null)} title={selected?.complaint_type || "Concern Details"} description={selected ? `${selected.users?.full_name || "Resident"} · ${formatDateTime(selected.created_at)}` : ""} widthClass="max-w-3xl" closeDisabled={saving}>{selected ? <div className="space-y-5"><div className="rounded-2xl bg-stone-50 p-5"><p className="text-sm leading-7 text-stone-700">{selected.details}</p></div><div className="grid gap-3 sm:grid-cols-2"><Button variant={review.status === "in_review" ? "primary" : "secondary"} onClick={() => setReview((v) => ({ ...v, status: "in_review" }))}>Mark Under Review</Button><Button variant={review.status === "resolved" ? "primary" : "secondary"} onClick={() => setReview((v) => ({ ...v, status: "resolved" }))}>Mark Resolved</Button></div><TextArea label="Barangay Response" value={review.adminNote} onChange={(e) => setReview((v) => ({ ...v, adminNote: e.target.value }))} hint="This response is visible to the resident." /><div className="flex gap-3"><Button onClick={save} loading={saving}>Save Update</Button><Button variant="ghost" onClick={() => setSelected(null)}>Cancel</Button></div></div> : null}</Modal>
  </div>;
};
export default Admin_Complaints;
