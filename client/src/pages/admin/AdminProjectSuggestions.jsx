import CaseHistory from "../../components/CaseHistory";
import { useReviewAction, reviewChanges } from "../../components/ActionReviewProvider";
import { CheckCircle2, Lightbulb, Search, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, Modal, PageHeader, Pagination, SegmentedTabs, SelectInput, TextArea, TextInput } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { getStatusMeta } from "../../lib/status";

const pageSize = 10;
const tabs = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

const AdminProjectSuggestions = () => {
  const { token } = useAuth();
  const reviewAction = useReviewAction();
  const toast = useToast();
  const [status, setStatus] = useState("pending");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [review, setReview] = useState(null);
  const [reviewNote, setReviewNote] = useState("");
  const operationId = useRef(null);
  const [visibility, setVisibility] = useState("resident");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ status, page: String(page), limit: String(pageSize) });
      if (search.trim()) params.set("search", search.trim());
      const data = await api(`/admin/suggestions?${params.toString()}`, { token });
      setItems(data.suggestions || []);
      setPagination(data.pagination || { total: 0, totalPages: 1 });
    } catch (loadError) {
      setError(loadError.message || "Unable to load project suggestions.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (token) load(); }, [token, status, page]);
  useEffect(() => { setPage(1); }, [status]);

  const submitSearch = (event) => { event.preventDefault(); setPage(1); load(); };
  const openReview = (item, nextStatus) => {
    operationId.current = crypto.randomUUID();
    setReview({ item, nextStatus });
    setReviewNote("");
    setVisibility("resident");
  };

  const saveReview = async () => {
    if (!review) return;
    if (review.item.status === review.nextStatus && !reviewNote.trim()) return toast.error("Write a new response before saving.");
    if (review.nextStatus === "rejected" && review.nextStatus !== review.item.status && reviewNote.trim().length < 3) {
      toast.error("Add a short reason before rejecting this suggestion.");
      return;
    }
    if (!await reviewAction({ title: review.nextStatus === "approved" ? "Approve Project Suggestion?" : "Reject Project Suggestion?", subject: review.item.title, description: "The resident will be notified of this decision.", after: { status: review.nextStatus, reason: reviewNote.trim() }, tone: review.nextStatus === "rejected" ? "danger" : "primary", confirmLabel: review.nextStatus === review.item.status ? "Save Response" : review.nextStatus === "approved" ? "Approve Suggestion" : "Reject Suggestion" })) return;
    setSaving(true);
    try {
      await api(`/admin/suggestions/${review.item.id}`, {
        method: "PATCH",
        token,
        body: { status: review.nextStatus, expectedStatus: review.item.status, reviewNote: reviewNote.trim(), visibility, operationId: operationId.current },
      });
      toast.success(review.nextStatus === "approved" ? "Project suggestion approved." : "Project suggestion rejected.");
      setReview(null);
      setReviewNote("");
      await load();
    } catch (saveError) {
      toast.error(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Community Participation" title="Project Suggestions" description="Review resident ideas separately from the voting process. Approved suggestions become eligible for future community voting." />

      <Card className="bg-[var(--brand-50)]">
        <div className="flex items-start gap-3"><Lightbulb className="mt-0.5 h-5 w-5 text-[var(--brand-600)]" /><div><h2 className="font-bold text-[var(--brand-900)]">Clear project lifecycle</h2><p className="mt-1 text-sm leading-6 text-stone-600">Suggestions remain Pending, Approved or Rejected. If an approved suggestion later wins a community vote, a separate Community Project is created and tracked through Planned, Ongoing and Completed implementation stages.</p></div></div>
      </Card>

      <div className="space-y-4">
        <SegmentedTabs value={status} onChange={setStatus} items={tabs} />
        <form onSubmit={submitSearch} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="w-full sm:max-w-md"><TextInput label="Search suggestions" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Title or description" /></div>
          <Button type="submit" variant="secondary"><Search className="h-4 w-4" /> Search</Button>
        </form>
      </div>

      {loading ? <LoadingState rows={6} /> : error ? <ErrorState description={error} onRetry={load} /> : !items.length ? <EmptyState title="No project suggestions found" description="There are no suggestions matching this status or search." /> : (
        <div className="grid gap-4 xl:grid-cols-2">
          {items.map((item) => {
            const meta = getStatusMeta(item.status, "suggestion");
            const resident = item.users?.full_name || [item.users?.first_name, item.users?.last_name].filter(Boolean).join(" ") || "Resident";
            return (
              <Card key={item.id}>
                {item.image_url ? <img src={item.image_url} alt={item.title} className="mb-5 h-52 w-full rounded-2xl object-cover" /> : null}
                <div className="flex flex-wrap items-center justify-between gap-3"><Badge tone={meta.tone}>{meta.label}</Badge><span className="text-xs text-stone-400">{formatDateTime(item.created_at)}</span></div>
                <h2 className="mt-3 text-xl font-bold text-[var(--brand-900)]">{item.title}</h2>
                <p className="mt-2 text-sm font-semibold text-stone-500">{resident}{item.users?.purok ? ` · ${item.users.purok}` : ""}</p>
                <p className="mt-4 text-sm leading-7 text-stone-600">{item.description}</p>
                <CaseHistory events={item.case_history} compact />
                {item.status === "pending" ? <div className="mt-5 flex flex-wrap gap-2"><Button onClick={() => openReview(item, "approved")}><CheckCircle2 className="h-4 w-4" /> Approve</Button><Button variant="danger" onClick={() => openReview(item, "rejected")}><XCircle className="h-4 w-4" /> Reject</Button></div> : <Button variant="ghost" onClick={() => openReview(item, item.status)}>History / Reply</Button>}
              </Card>
            );
          })}
        </div>
      )}

      {!loading && !error && pagination.totalPages > 1 ? <Pagination page={page} totalPages={pagination.totalPages} onPageChange={setPage} /> : null}

      <Modal open={Boolean(review)} onClose={() => !saving && setReview(null)} title={review?.nextStatus === review?.item.status ? "Add response to suggestion" : review?.nextStatus === "approved" ? "Approve project suggestion" : "Reject project suggestion"} description={review?.nextStatus === "approved" ? "Approved ideas become eligible for inclusion in a future community vote." : "Give the resident a clear reason why this suggestion is not being approved."} closeDisabled={saving}>
        {review ? <div className="space-y-5"><div className="rounded-2xl bg-stone-50 p-4"><p className="font-bold text-[var(--brand-900)]">{review.item.title}</p><p className="mt-2 text-sm leading-6 text-stone-600">{review.item.description}</p></div><CaseHistory events={review.item.case_history} /><SelectInput label="Response Visibility" value={visibility} disabled={review.nextStatus !== review.item.status} onChange={(event) => setVisibility(event.target.value)}><option value="resident">Resident Response</option><option value="internal">Staff Only</option></SelectInput><TextArea label={review.nextStatus === "rejected" ? "Reason for rejection" : "Barangay note (optional)"} required={review.nextStatus === "rejected" && review.nextStatus !== review.item.status} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder={review.nextStatus === "rejected" ? "Explain why this proposal cannot be approved." : "Add context for the resident."} /><div className="flex flex-wrap gap-3"><Button loading={saving} variant={review.nextStatus === "rejected" ? "danger" : "primary"} onClick={saveReview}>{review.nextStatus === review.item.status ? "Save Response" : review.nextStatus === "approved" ? "Approve Suggestion" : "Reject Suggestion"}</Button><Button variant="ghost" disabled={saving} onClick={() => setReview(null)}>Cancel</Button></div></div> : null}
      </Modal>
    </div>
  );
};

export default AdminProjectSuggestions;

