import { MessageSquareWarning, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Button, Card, EmptyState, Modal, PageError, PageHeader, Pagination, ResponsiveListTable, SelectInput, StatCard, StatusBadge, Tabs, TextArea, TextInput } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

const statusTabs = ["all", "submitted", "under_review", "in_progress", "resolved", "closed"];
const pageSize = 8;

const Admin_Complaints = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ status: "submitted", priority: "normal", adminNote: "" });
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true); setError("");
    try { const data = await api("/admin/complaints", { token }); setItems(data.complaints || []); }
    catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (token) load(); }, [token]);

  const filtered = useMemo(() => items.filter((item) => {
    const statusMatch = status === "all" || item.status === status;
    const q = search.trim().toLowerCase();
    const searchMatch = !q || [item.reference_code, item.resident_name, item.complaint_type, item.details].filter(Boolean).some((value) => `${value}`.toLowerCase().includes(q));
    return statusMatch && searchMatch;
  }), [items, status, search]);

  useEffect(() => { setPage(1); }, [status, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const openUpdate = (item) => {
    setSelected(item);
    setForm({ status: item.status, priority: item.priority || "normal", adminNote: item.admin_note || "" });
  };

  const save = async () => {
    setSaving(true);
    try {
      await api(`/admin/complaints/${selected.id}`, { method: "PATCH", token, body: form });
      toast.success("Complaint updated and resident notified.");
      setSelected(null);
      await load();
    } catch (saveError) { toast.error(saveError.message); }
    finally { setSaving(false); }
  };

  const counts = Object.fromEntries(statusTabs.map((key) => [key, key === "all" ? items.length : items.filter((item) => item.status === key).length]));

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Complaint Management" title="Resident complaint desk" description="Review concerns, assign priority, update progress, and give residents clear status notes." />
      {error ? <PageError message={error} onRetry={load} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={MessageSquareWarning} label="Open Complaints" value={items.filter((item) => !["resolved", "closed"].includes(item.status)).length} hint="Needs staff attention" />
        <StatCard label="Under Review" value={counts.under_review || 0} />
        <StatCard label="In Progress" value={counts.in_progress || 0} />
        <StatCard label="Resolved / Closed" value={(counts.resolved || 0) + (counts.closed || 0)} />
      </div>

      <Card>
        <Tabs tabs={statusTabs.map((value) => ({ value, label: value === "all" ? "All" : value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()), count: counts[value] }))} value={status} onChange={setStatus} />
        <div className="mt-4 max-w-xl"><TextInput label="Search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Reference, resident, type, or details" /></div>
        <div className="mt-5">
          {loading ? <p className="text-sm text-stone-500">Loading complaints...</p> : !filtered.length ? <EmptyState title="No matching complaints" description="Try another status or search term." /> : (
            <ResponsiveListTable
              headers={["Reference / Resident", "Concern", "Priority", "Status", "Updated", "Action"]}
              rows={paginated}
              renderDesktopRow={(item) => (
                <tr key={item.id} className="border-t border-stone-100 align-top hover:bg-stone-50/70">
                  <td className="px-4 py-4"><p className="font-bold text-[var(--brand-900)]">{item.reference_code || String(item.id).slice(0, 8)}</p><p className="mt-1 text-xs text-stone-500">{item.resident_name}</p></td>
                  <td className="px-4 py-4"><p className="font-semibold text-stone-800">{item.complaint_type}</p><p className="mt-1 max-w-md text-xs text-stone-500">{item.details}</p></td>
                  <td className="px-4 py-4 capitalize text-stone-600">{item.priority || "normal"}</td>
                  <td className="px-4 py-4"><StatusBadge status={item.status} /></td>
                  <td className="px-4 py-4 text-stone-500">{formatDateTime(item.updated_at || item.created_at)}</td>
                  <td className="px-4 py-4"><Button variant="secondary" onClick={() => openUpdate(item)}>Review</Button></td>
                </tr>
              )}
              renderMobileCard={(item) => (
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-stone-400">{item.reference_code || String(item.id).slice(0, 8)}</p><h3 className="mt-1 font-bold text-[var(--brand-900)]">{item.complaint_type}</h3><p className="text-sm text-stone-500">{item.resident_name}</p></div><StatusBadge status={item.status} /></div>
                  <p className="mt-3 line-clamp-3 text-sm text-stone-600">{item.details}</p>
                  <div className="mt-4 flex items-center justify-between"><span className="text-xs font-semibold capitalize text-stone-500">{item.priority || "normal"} priority</span><Button variant="secondary" onClick={() => openUpdate(item)}>Review</Button></div>
                </Card>
              )}
            />
          )}
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </Card>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Review Complaint" description={selected ? `${selected.reference_code || "Complaint"} • ${selected.resident_name}` : ""} widthClass="max-w-2xl">
        {selected ? <div className="space-y-5">
          <div className="rounded-2xl bg-stone-50 p-4"><p className="font-bold text-[var(--brand-900)]">{selected.complaint_type}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-600">{selected.details}</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectInput label="Status" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
              <option value="submitted">Submitted</option><option value="under_review">Under Review</option><option value="in_progress">In Progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option>
            </SelectInput>
            <SelectInput label="Priority" value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}>
              <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
            </SelectInput>
          </div>
          <TextArea label="Barangay Note" value={form.adminNote} onChange={(event) => setForm((current) => ({ ...current, adminNote: event.target.value }))} placeholder="Explain the action taken or what the resident should do next." />
          <div className="flex flex-col-reverse gap-3 sm:flex-row"><Button variant="ghost" onClick={() => setSelected(null)}>Cancel</Button><Button onClick={save} loading={saving}>Save & Notify Resident</Button></div>
        </div> : null}
      </Modal>
    </div>
  );
};

export default Admin_Complaints;
