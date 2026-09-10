import { CalendarClock, PackageCheck, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { Badge, Button, Card, EmptyState, PageHeader, SelectInput, TextArea, TextInput } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

const statusTone = { pending: "warning", approved: "info", borrowed: "info", returned: "success", rejected: "danger", cancelled: "neutral" };
const toLocalInput = (date) => {
  const d = new Date(date);
  const pad = (n) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const initialWindow = () => {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000); start.setHours(8, 0, 0, 0);
  const due = new Date(start.getTime() + 8 * 60 * 60 * 1000);
  return { startAt: toLocalInput(start), dueAt: toLocalInput(due) };
};

const BorrowingPage = () => {
  const { token, refreshNotifications } = useAuth();
  const toast = useToast();
  const [windowForm, setWindowForm] = useState(initialWindow);
  const [assets, setAssets] = useState([]);
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState({ assetId: "", quantity: 1, purpose: "" });
  const [saving, setSaving] = useState(false);

  const loadMine = async () => {
    const data = await api("/borrowing/mine", { token });
    setRequests(data.requests || []);
  };
  const checkAvailability = async () => {
    try {
      const params = new URLSearchParams({ startAt: new Date(windowForm.startAt).toISOString(), dueAt: new Date(windowForm.dueAt).toISOString() });
      const data = await api(`/borrowing/assets?${params}`, { token });
      setAssets(data.assets || []);
      if (form.assetId && !(data.assets || []).some((a) => a.id === form.assetId && a.isAvailable)) setForm((v) => ({ ...v, assetId: "" }));
    } catch (error) { toast.error(error.message); }
  };
  useEffect(() => { if (token) { loadMine().catch((e) => toast.error(e.message)); checkAvailability(); } }, [token]);

  const selected = useMemo(() => assets.find((asset) => asset.id === form.assetId), [assets, form.assetId]);

  const submit = async (event) => {
    event.preventDefault();
    if (!form.assetId || !form.purpose.trim()) return toast.error("Choose an available facility/item and enter a purpose.");
    setSaving(true);
    try {
      const data = await api("/borrowing/requests", { method: "POST", token, body: { ...form, quantity: Number(form.quantity), startAt: new Date(windowForm.startAt).toISOString(), dueAt: new Date(windowForm.dueAt).toISOString() } });
      toast.success(data.message);
      setForm({ assetId: "", quantity: 1, purpose: "" });
      await Promise.all([loadMine(), checkAvailability(), refreshNotifications()]);
    } catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  };

  const cancel = async (id) => {
    try {
      const data = await api(`/borrowing/requests/${id}/cancel`, { method: "POST", token });
      toast.success(data.message);
      await Promise.all([loadMine(), checkAvailability()]);
    } catch (error) { toast.error(error.message); }
  };

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Barangay Resources" title="Borrow facilities & items" description="Check schedule availability for the covered court, tents, chairs, tables, and other barangay resources before submitting a request." />
      <Card>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_auto] xl:items-end">
          <TextInput label="Borrow From" type="datetime-local" value={windowForm.startAt} onChange={(e) => setWindowForm((v) => ({ ...v, startAt: e.target.value }))} />
          <TextInput label="Return By" type="datetime-local" value={windowForm.dueAt} onChange={(e) => setWindowForm((v) => ({ ...v, dueAt: e.target.value }))} />
          <Button type="button" onClick={checkAvailability}><CalendarClock className="h-4 w-4" /> Check Availability</Button>
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {assets.map((asset) => <Card key={asset.id} className={!asset.isAvailable ? "opacity-70" : ""}><div className="flex items-start justify-between gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><PackageCheck className="h-5 w-5" /></div><Badge tone={asset.isAvailable ? "success" : "danger"}>{asset.isAvailable ? "Available" : "Unavailable"}</Badge></div><h3 className="mt-4 font-bold text-[var(--brand-900)]">{asset.name}</h3><p className="mt-1 text-xs uppercase tracking-wider text-stone-400">{asset.category}</p><p className="mt-3 text-sm text-stone-600">{asset.description}</p><p className="mt-4 text-sm font-semibold text-[var(--brand-700)]">{asset.availableQuantity} of {asset.total_quantity} available</p></Card>)}
      </div>
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card><h2 className="text-xl font-bold text-[var(--brand-900)]">Request to borrow</h2><form className="mt-5 space-y-4" onSubmit={submit}><SelectInput label="Facility / Item" value={form.assetId} onChange={(e) => setForm((v) => ({ ...v, assetId: e.target.value }))}><option value="">Select available resource</option>{assets.filter((a) => a.isAvailable).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.availableQuantity} available)</option>)}</SelectInput><TextInput label="Quantity" type="number" min="1" max={selected?.availableQuantity || 1} value={form.quantity} onChange={(e) => setForm((v) => ({ ...v, quantity: e.target.value }))} /><TextArea label="Purpose" value={form.purpose} onChange={(e) => setForm((v) => ({ ...v, purpose: e.target.value }))} placeholder="Example: chairs and tables for a family community event..." /><Button type="submit" loading={saving}>Submit Borrowing Request</Button></form></Card>
        <div className="space-y-4"><div><h2 className="text-xl font-bold text-[var(--brand-900)]">My borrowing requests</h2><p className="mt-1 text-sm text-stone-500">Approved requests reserve inventory for your selected date range.</p></div>{requests.length === 0 ? <EmptyState title="No borrowing requests" description="Your borrowing history will appear here." /> : requests.map((item) => <Card key={item.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-[var(--brand-900)]">{item.asset?.name || "Barangay resource"} × {item.quantity}</h3><p className="mt-1 text-sm text-stone-500">{formatDateTime(item.start_at)} → {formatDateTime(item.due_at)}</p></div><div className="flex gap-2"><Badge tone={statusTone[item.status] || "neutral"}>{item.status}</Badge>{item.isLate ? <Badge tone="danger">Late return</Badge> : null}</div></div><p className="mt-3 text-sm text-stone-700">{item.purpose}</p>{item.admin_note ? <p className="mt-3 rounded-2xl bg-stone-50 p-3 text-sm text-stone-600"><strong>Admin note:</strong> {item.admin_note}</p> : null}{["pending", "approved"].includes(item.status) ? <Button className="mt-4" variant="secondary" onClick={() => cancel(item.id)}><RotateCcw className="h-4 w-4" /> Cancel Request</Button> : null}</Card>)}</div>
      </div>
    </div>
  );
};
export default BorrowingPage;
