import { CircleAlert, MessageSquareText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, SelectInput, TableShell, TextArea, TextInput } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

const tone = { pending: "warning", in_review: "info", resolved: "success" };

const Admin_Complaints = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [complaints, setComplaints] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState(null);
  const [review, setReview] = useState({ status: "in_review", adminNote: "" });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const data = await api("/admin/complaints", { token });
      setComplaints(data.complaints || []);
    } catch (error) { toast.error(error.message); }
  };
  useEffect(() => { if (token) load(); }, [token]);

  const filtered = useMemo(() => complaints.filter((item) => {
    const matchesStatus = status === "all" || item.status === status;
    const haystack = `${item.resident_name} ${item.complaint_type} ${item.details}`.toLowerCase();
    return matchesStatus && haystack.includes(search.trim().toLowerCase());
  }), [complaints, search, status]);

  const openReview = (item) => {
    setSelected(item);
    setReview({ status: item.status === "pending" ? "in_review" : item.status, adminNote: item.admin_note || "" });
  };

  const saveReview = async () => {
    setSaving(true);
    try {
      const data = await api(`/admin/complaints/${selected.id}`, { method: "PATCH", token, body: review });
      toast.success(data.message || "Community concern updated.");
      setSelected(null);
      await load();
    } catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Resident Support" title="Community concerns" description="Review reports submitted from the resident portal, leave an admin response, and clearly mark progress." />
      <Card>
        <div className="grid gap-4 md:grid-cols-[1fr_220px]">
          <TextInput label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Resident, type, or concern..." />
          <SelectInput label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option><option value="pending">Pending</option><option value="in_review">In review</option><option value="resolved">Resolved</option>
          </SelectInput>
        </div>
      </Card>
      {filtered.length === 0 ? <EmptyState title="No community concerns found" description="Submitted resident concerns will appear here." /> : (
        <TableShell><table className="min-w-full text-sm"><thead className="bg-stone-50 text-left text-stone-500"><tr><th className="px-4 py-3">Resident</th><th className="px-4 py-3">Concern</th><th className="px-4 py-3">Submitted</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Action</th></tr></thead><tbody>
          {filtered.map((item) => <tr key={item.id} className="border-t border-stone-100 align-top"><td className="px-4 py-4 font-semibold text-[var(--brand-900)]">{item.resident_name}</td><td className="max-w-lg px-4 py-4"><p className="font-semibold">{item.complaint_type}</p><p className="mt-1 line-clamp-2 text-stone-500">{item.details}</p></td><td className="px-4 py-4 text-stone-500">{formatDateTime(item.created_at)}</td><td className="px-4 py-4"><Badge tone={tone[item.status] || "neutral"}>{`${item.status}`.replace("_", " ")}</Badge></td><td className="px-4 py-4"><Button variant="secondary" onClick={() => openReview(item)}><MessageSquareText className="h-4 w-4" /> Review</Button></td></tr>)}
        </tbody></table></TableShell>
      )}
      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Review community concern" description={selected ? `${selected.resident_name} • ${selected.complaint_type}` : ""}>
        {selected ? <div className="space-y-5"><div className="rounded-2xl bg-stone-50 p-4 text-sm leading-6 text-stone-700"><div className="mb-2 flex items-center gap-2 font-semibold text-stone-900"><CircleAlert className="h-4 w-4" /> Resident report</div>{selected.details}</div><SelectInput label="Status" value={review.status} onChange={(e) => setReview((v) => ({ ...v, status: e.target.value }))}><option value="pending">Pending</option><option value="in_review">In review</option><option value="resolved">Resolved</option></SelectInput><TextArea label="Admin response / note" value={review.adminNote} onChange={(e) => setReview((v) => ({ ...v, adminNote: e.target.value }))} placeholder="Add an update visible to the resident..." /><div className="flex gap-3"><Button onClick={saveReview} loading={saving}>Save Update</Button><Button variant="ghost" onClick={() => setSelected(null)}>Cancel</Button></div></div> : null}
      </Modal>
    </div>
  );
};
export default Admin_Complaints;
