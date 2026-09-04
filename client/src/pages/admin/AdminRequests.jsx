import { CalendarPlus, ClipboardList, IdCard, MessageSquareMore, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Modal,
  PageError,
  PageHeader,
  Pagination,
  ResponsiveListTable,
  SelectInput,
  StatusBadge,
  Tabs,
  TextArea,
  TextInput,
} from "../../components/ui";
import { formatDateTime } from "../../lib/format";

const requestStatuses = ["submitted", "acknowledged", "processing", "needs_information", "ready_for_release", "completed", "rejected", "cancelled"];
const idStatuses = ["submitted", "confirmed", "rescheduled", "ready_for_pickup", "completed", "cancelled"];
const pageSize = 8;

const AdminRequests = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState("documents");
  const [requests, setRequests] = useState([]);
  const [idRequests, setIdRequests] = useState([]);
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [filters, setFilters] = useState({ type: "all", status: "all" });
  const [form, setForm] = useState({ status: "submitted", adminNote: "", preferredDate: "", timeSlot: "" });
  const [requestPage, setRequestPage] = useState(1);
  const [idRequestPage, setIdRequestPage] = useState(1);
  const [slotPage, setSlotPage] = useState(1);
  const [slotOpen, setSlotOpen] = useState(false);
  const [slotForm, setSlotForm] = useState({ slotDate: "", timeSlot: "", capacity: 10, isActive: true });
  const [deleteSlot, setDeleteSlot] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setLoadError("");
    try {
      const [requestData, idData, slotData] = await Promise.all([
        api("/admin/requests", { token }),
        api("/admin/id-requests", { token }),
        api("/admin/id_pickup_slots", { token }),
      ]);
      setRequests(requestData.requests || []);
      setIdRequests(idData.requests || []);
      setSlots(slotData.id_pickup_slots || []);
    } catch (error) { setLoadError(error.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (token) load(); }, [token]);
  useEffect(() => { setRequestPage(1); }, [filters]);

  const requestTypes = useMemo(() => ["all", ...Array.from(new Set(requests.map((request) => request.request_type).filter(Boolean)))], [requests]);
  const filteredRequests = useMemo(() => requests.filter((request) => (filters.type === "all" || request.request_type === filters.type) && (filters.status === "all" || request.status === filters.status)), [requests, filters]);
  const paginatedRequests = filteredRequests.slice((requestPage - 1) * pageSize, requestPage * pageSize);
  const paginatedIdRequests = idRequests.slice((idRequestPage - 1) * pageSize, idRequestPage * pageSize);
  const slotTotalPages = Math.max(1, Math.ceil(slots.length / pageSize));
  const paginatedSlots = slots.slice((slotPage - 1) * pageSize, slotPage * pageSize);

  useEffect(() => {
    setRequestPage((current) => Math.min(current, Math.max(1, Math.ceil(filteredRequests.length / pageSize))));
  }, [filteredRequests.length]);
  useEffect(() => {
    setIdRequestPage((current) => Math.min(current, Math.max(1, Math.ceil(idRequests.length / pageSize))));
  }, [idRequests.length]);
  useEffect(() => {
    setSlotPage((current) => Math.min(current, slotTotalPages));
  }, [slotTotalPages]);

  const slotUsage = useMemo(() => {
    const map = new Map();
    for (const request of idRequests) {
      if (!request.preferred_date || !request.time_slot || request.status === "cancelled") continue;
      const key = `${request.preferred_date}::${request.time_slot}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [idRequests]);

  const openUpdate = (request, mode) => {
    setSelected({ ...request, mode });
    setForm({ status: request.status, adminNote: request.admin_note || "", preferredDate: request.preferred_date || request.preferredDate || "", timeSlot: request.time_slot || request.timeSlot || "" });
    setUpdateOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const path = selected.mode === "id" ? `/admin/id-requests/${selected.id}` : `/admin/requests/${selected.id}`;
      await api(path, { method: "PATCH", token, body: form });
      toast.success("Request updated and resident notified.");
      setUpdateOpen(false); setSelected(null); await load();
    } catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  };

  const saveSlot = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      await api("/admin/id_pickup_slots", { method: "POST", token, body: slotForm });
      toast.success("Pickup slot created.");
      setSlotOpen(false); setSlotForm({ slotDate: "", timeSlot: "", capacity: 10, isActive: true }); await load();
    } catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  };

  const removeSlot = async () => {
    setSaving(true);
    try { await api(`/admin/id_pickup_slots/${deleteSlot.id}`, { method: "DELETE", token }); toast.success("Pickup slot deleted."); setDeleteSlot(null); await load(); }
    catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Request Management" title="Requests, documents & Barangay ID" description="Process resident document requests, manage Barangay ID schedules, and control pickup capacity from one module." />
      {loadError ? <PageError message={loadError} onRetry={load} /> : null}
      <Tabs tabs={[{ value: "documents", label: "Document Requests", count: requests.length }, { value: "id", label: "Barangay ID", count: idRequests.length }, { value: "slots", label: "Pickup Slots", count: slots.length }]} value={tab} onChange={setTab} />

      {tab === "documents" ? <Card>
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Resident Document Requests</h2><p className="mt-1 text-sm text-stone-500">Use Needs Information for resident follow-up and Ready for Release before completion.</p></div><div className="grid gap-3 sm:grid-cols-2 xl:min-w-[30rem]"><SelectInput label="Request Type" value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}>{requestTypes.map((type) => <option key={type} value={type}>{type === "all" ? "All types" : type}</option>)}</SelectInput><SelectInput label="Status" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="all">All statuses</option>{requestStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</SelectInput></div></div>
        {loading ? <p className="text-sm text-stone-500">Loading requests...</p> : !paginatedRequests.length ? <EmptyState title="No matching requests" description="Adjust the filters or wait for a new resident request." /> : <ResponsiveListTable headers={["Resident", "Type", "Status", "Updated", "Action"]} rows={paginatedRequests} renderDesktopRow={(request) => <tr key={request.id} className="border-t border-stone-100 align-top hover:bg-stone-50/70"><td className="px-4 py-4"><p className="font-semibold text-[var(--brand-900)]">{request.resident_name}</p><p className="mt-1 max-w-lg text-xs text-stone-500">{request.details}</p></td><td className="px-4 py-4 text-stone-600">{request.request_type}</td><td className="px-4 py-4"><StatusBadge status={request.status} /></td><td className="px-4 py-4 text-stone-500">{formatDateTime(request.updated_at || request.created_at)}</td><td className="px-4 py-4"><Button variant="secondary" onClick={() => openUpdate(request, "request")}><MessageSquareMore className="h-4 w-4" />Update</Button></td></tr>} renderMobileCard={(request) => <Card className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-bold text-[var(--brand-900)]">{request.resident_name}</p><p className="text-sm text-stone-500">{request.request_type}</p></div><StatusBadge status={request.status} /></div><p className="mt-3 text-sm text-stone-600">{request.details}</p><div className="mt-4 flex justify-end"><Button variant="secondary" onClick={() => openUpdate(request, "request")}>Update</Button></div></Card>} />}
        <Pagination page={requestPage} totalPages={Math.max(1, Math.ceil(filteredRequests.length / pageSize))} onPageChange={setRequestPage} />
      </Card> : null}

      {tab === "id" ? <Card>
        <div className="mb-5 flex items-center gap-3"><IdCard className="h-5 w-5 text-[var(--brand-600)]" /><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Barangay ID Requests</h2><p className="mt-1 text-sm text-stone-500">Confirm, reschedule, mark ready for pickup, complete, or cancel requests.</p></div></div>
        {loading ? <p className="text-sm text-stone-500">Loading ID requests...</p> : !paginatedIdRequests.length ? <EmptyState title="No Barangay ID requests" description="Resident ID requests will appear here." /> : <ResponsiveListTable headers={["Resident", "Purpose", "Schedule", "Status", "Action"]} rows={paginatedIdRequests} renderDesktopRow={(request) => <tr key={request.id} className="border-t border-stone-100 hover:bg-stone-50/70"><td className="px-4 py-4 font-semibold text-[var(--brand-900)]">{request.users?.full_name || request.users?.first_name || "Resident"}</td><td className="px-4 py-4 text-stone-600">{request.purpose}</td><td className="px-4 py-4 text-stone-600">{request.preferred_date || "Pending"}{request.time_slot ? ` • ${request.time_slot}` : ""}</td><td className="px-4 py-4"><StatusBadge status={request.status} /></td><td className="px-4 py-4"><Button variant="secondary" onClick={() => openUpdate(request, "id")}>Update</Button></td></tr>} renderMobileCard={(request) => <Card className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-bold text-[var(--brand-900)]">{request.users?.full_name || request.users?.first_name || "Resident"}</p><p className="text-sm text-stone-500">{request.purpose}</p></div><StatusBadge status={request.status} /></div><p className="mt-3 text-sm text-stone-600">{request.preferred_date || "Date pending"}{request.time_slot ? ` • ${request.time_slot}` : ""}</p><div className="mt-4 flex justify-end"><Button variant="secondary" onClick={() => openUpdate(request, "id")}>Update</Button></div></Card>} />}
        <Pagination page={idRequestPage} totalPages={Math.max(1, Math.ceil(idRequests.length / pageSize))} onPageChange={setIdRequestPage} />
      </Card> : null}

      {tab === "slots" ? <Card>
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><CalendarPlus className="h-5 w-5 text-[var(--brand-600)]" /><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Barangay ID Pickup Slots</h2><p className="mt-1 text-sm text-stone-500">Capacity is enforced when residents submit or admins reschedule ID requests.</p></div></div><Button onClick={() => setSlotOpen(true)}><Plus className="h-4 w-4" />Add Slot</Button></div>
        {!slots.length ? <EmptyState title="No pickup slots" description="Create a future pickup date and capacity." /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{paginatedSlots.map((slot) => { const used = slotUsage.get(`${slot.slot_date}::${slot.time_slot}`) || 0; const remaining = Math.max(Number(slot.capacity || 1) - used, 0); return <div key={slot.id} className="rounded-2xl border border-stone-200 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-bold text-[var(--brand-900)]">{slot.slot_date}</p><p className="text-sm text-stone-500">{slot.time_slot}</p></div><StatusBadge status={slot.is_active ? "active" : "inactive"} /></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-stone-50 p-2"><p className="text-xs text-stone-500">Capacity</p><p className="font-bold">{slot.capacity}</p></div><div className="rounded-xl bg-stone-50 p-2"><p className="text-xs text-stone-500">Booked</p><p className="font-bold">{used}</p></div><div className="rounded-xl bg-stone-50 p-2"><p className="text-xs text-stone-500">Left</p><p className="font-bold">{remaining}</p></div></div><div className="mt-4 flex justify-end"><Button variant="ghost" onClick={() => setDeleteSlot(slot)} disabled={used > 0}><Trash2 className="h-4 w-4" />Delete</Button></div>{used > 0 ? <p className="mt-2 text-xs text-stone-400">Slots with existing bookings cannot be safely deleted from the UI.</p> : null}</div>; })}</div>}
        {slots.length ? <Pagination page={slotPage} totalPages={slotTotalPages} onPageChange={setSlotPage} /> : null}
      </Card> : null}

      <Modal open={updateOpen} onClose={() => setUpdateOpen(false)} title="Update Request" description="Update status, add a resident-facing note, and keep the request lifecycle clear.">
        {selected ? <div className="space-y-4"><div className="rounded-2xl bg-[var(--brand-50)] p-4"><p className="font-semibold text-[var(--brand-900)]">{selected.resident_name || selected.users?.full_name || "Resident"}</p><p className="mt-1 text-sm text-stone-500">{selected.request_type || selected.purpose}</p></div><SelectInput label="Status" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>{(selected.mode === "id" ? idStatuses : requestStatuses).map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</SelectInput><TextArea label="Admin Note" value={form.adminNote} onChange={(event) => setForm((current) => ({ ...current, adminNote: event.target.value }))} placeholder="Tell the resident what changed or what they need to do next." />{selected.mode === "id" ? <div className="grid gap-4 sm:grid-cols-2"><TextInput label="Pickup Date" type="date" value={form.preferredDate} onChange={(event) => setForm((current) => ({ ...current, preferredDate: event.target.value }))} /><TextInput label="Time Slot" value={form.timeSlot} onChange={(event) => setForm((current) => ({ ...current, timeSlot: event.target.value }))} placeholder="Example: 9:00 AM" /></div> : null}<div className="flex flex-col-reverse gap-3 sm:flex-row"><Button variant="ghost" onClick={() => setUpdateOpen(false)}>Cancel</Button><Button onClick={save} loading={saving}>Save & Notify Resident</Button></div></div> : null}
      </Modal>

      <Modal open={slotOpen} onClose={() => setSlotOpen(false)} title="Add Pickup Slot" description="Residents will only see slots with remaining capacity." widthClass="max-w-xl"><form onSubmit={saveSlot} className="space-y-4"><TextInput label="Date" type="date" value={slotForm.slotDate} onChange={(event) => setSlotForm((current) => ({ ...current, slotDate: event.target.value }))} required /><TextInput label="Time Slot" value={slotForm.timeSlot} onChange={(event) => setSlotForm((current) => ({ ...current, timeSlot: event.target.value }))} placeholder="Example: 9:00 AM - 10:00 AM" required /><TextInput label="Capacity" type="number" min="1" value={slotForm.capacity} onChange={(event) => setSlotForm((current) => ({ ...current, capacity: Number(event.target.value) }))} required /><div className="flex gap-3"><Button type="submit" loading={saving}>Save Slot</Button><Button type="button" variant="ghost" onClick={() => setSlotOpen(false)}>Cancel</Button></div></form></Modal>
      <ConfirmDialog open={Boolean(deleteSlot)} onClose={() => setDeleteSlot(null)} onConfirm={removeSlot} title="Delete pickup slot?" description="Only unused slots should be deleted." confirmLabel="Delete Slot" danger loading={saving} />
    </div>
  );
};

export default AdminRequests;
