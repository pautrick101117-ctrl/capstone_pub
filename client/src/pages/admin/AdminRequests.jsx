import CaseHistory from "../../components/CaseHistory";
import { useReviewAction, useUnsavedForm, useUnsavedNavigation } from "../../components/ActionReviewProvider";
import { CalendarCheck, CheckCircle2, Clock3, MessageSquareMore, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, Modal, PageHeader, Pagination, SegmentedTabs, SelectInput, TableShell, TextArea, TextInput } from "../../components/ui";
import { formatDate, formatDateTime } from "../../lib/format";
import { getStatusMeta } from "../../lib/status";

const pageSize = 8;
const Status = ({ status, feature }) => { const meta = getStatusMeta(status, feature); return <Badge tone={meta.tone}>{meta.label}</Badge>; };

const AdminRequests = () => {
  const { token } = useAuth();
  const reviewAction = useReviewAction();
  const toast = useToast();
  const [requests, setRequests] = useState([]);
  const [idRequests, setIdRequests] = useState([]);
  const [idSlots, setIdSlots] = useState([]);
  const [activeTab, setActiveTab] = useState("documents");
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ status: "", adminNote: "", preferredDate: "", timeSlot: "", visibility: "resident" });
  const [saving, setSaving] = useState(false);
  const operationId = useRef(null);
  const [filters, setFilters] = useState({ type: "all", status: "active" });
  const [idFilter, setIdFilter] = useState("active");
  const [requestPage, setRequestPage] = useState(1);
  const [idPage, setIdPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const initialAction = selected ? { status: selected.nextStatus, adminNote: "", visibility: "resident", preferredDate: selected.preferred_date || selected.preferredDate || "", timeSlot: selected.preferred_time_slot || selected.time_slot || "" } : null;
  const actionGuard = useUnsavedForm({ initial: initialAction, current: form, enabled: Boolean(selected) });
  useUnsavedNavigation(actionGuard.dirty);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [requestData, idData, slotData] = await Promise.all([
        api("/admin/requests", { token }),
        api("/admin/id-requests", { token }),
        api("/admin/id_pickup_slots", { token }),
      ]);
      setRequests(requestData.requests || []);
      setIdRequests(idData.requests || []);
      setIdSlots(slotData.id_pickup_slots || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (token) load(); }, [token]);
  useEffect(() => { setRequestPage(1); }, [filters]);
  useEffect(() => { setIdPage(1); }, [idFilter]);

  const requestTypes = useMemo(() => ["all", ...Array.from(new Set(requests.map((item) => item.request_type).filter(Boolean)))], [requests]);
  const filteredRequests = useMemo(() => requests.filter((item) => {
    const typeMatch = filters.type === "all" || item.request_type === filters.type;
    const statusMatch = filters.status === "all" || (filters.status === "active" ? item.status !== "completed" : item.status === filters.status);
    return typeMatch && statusMatch;
  }).sort((a, b) => {
    const priority = { submitted: 0, acknowledged: 1, processing: 2, completed: 3 };
    return (priority[a.status] ?? 9) - (priority[b.status] ?? 9) || new Date(b.created_at) - new Date(a.created_at);
  }), [requests, filters]);

  const filteredIds = useMemo(() => idRequests.filter((item) => idFilter === "all" || (idFilter === "active" ? !["completed", "cancelled"].includes(item.status) : item.status === idFilter)), [idRequests, idFilter]);
  const paginatedRequests = filteredRequests.slice((requestPage - 1) * pageSize, requestPage * pageSize);
  const paginatedIds = filteredIds.slice((idPage - 1) * pageSize, idPage * pageSize);

  const availableTimeSlots = useMemo(() => idSlots.filter((slot) => slot.is_active && slot.slot_date === form.preferredDate).map((slot) => slot.time_slot), [idSlots, form.preferredDate]);

  const openAction = (record, mode, nextStatus) => {
    operationId.current = crypto.randomUUID();
    setSelected({ ...record, mode, nextStatus });
    setForm({
      status: nextStatus,
      adminNote: "",
      visibility: "resident",
      preferredDate: record.preferred_date || record.preferredDate || "",
      timeSlot: record.preferred_time_slot || record.time_slot || "",
    });
  };

  const closeModal = () => { if (saving) return; setSelected(null); setForm({ status: "", adminNote: "", preferredDate: "", timeSlot: "", visibility: "resident" }); };
  const requestClose = () => actionGuard.closeSafely(closeModal);

  const save = async () => {
    if (!selected) return;
    if (form.status === selected.status && !form.adminNote.trim() && (selected.mode !== "id" || (form.preferredDate === (selected.preferred_date || "") && form.timeSlot === (selected.time_slot || "")))) return toast.error("Write a new response or change the request before saving.");
    if (selected.mode === "id" && ["confirmed", "rescheduled"].includes(form.status) && (!form.preferredDate || !form.timeSlot)) return toast.error("Choose a pickup date and time slot before confirming the schedule.");
    if (["cancelled"].includes(form.status) && form.adminNote.trim().length < 3) return toast.error("Add a short note so the resident understands why the appointment was cancelled.");
    if (!await reviewAction({ title: form.status === "completed" ? "Complete this Request?" : "Confirm Request Update", description: "This decision will update the resident-facing status.", subject: selected.request_type || selected.purpose || "Barangay request", before: { status: selected.status, pickupDate: selected.preferred_date, timeSlot: selected.time_slot }, after: { ...form, pickupDate: form.preferredDate }, note: form.adminNote, confirmLabel: form.status === "completed" ? "Mark Completed" : "Confirm Update", tone: form.status === "cancelled" ? "danger" : "primary" })) return;
    setSaving(true);
    try {
      const path = selected.mode === "id" ? `/admin/id-requests/${selected.id}` : `/admin/requests/${selected.id}`;
      await api(path, { method: "PATCH", token, body: { ...form, expectedStatus: selected.status, operationId: operationId.current } });
      toast.success("Request updated and resident notification sent.");
      closeModal();
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const actionLabel = selected?.mode === "id"
    ? { confirmed: "Confirm Schedule", rescheduled: "Save Reschedule", completed: "Mark Completed", cancelled: "Cancel Appointment" }[form.status]
    : { acknowledged: "Acknowledge Request", processing: "Start Processing", completed: "Mark Completed" }[form.status];

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Resident Services" title="Requests & ID appointments" description="Process document requests and Barangay ID schedules from separate queues so each workflow is clear and action-oriented." />

      <SegmentedTabs value={activeTab} onChange={setActiveTab} items={[
        { value: "documents", label: "Document Requests", count: requests.filter((item) => item.status !== "completed").length },
        { value: "id", label: "Barangay ID Appointments", count: idRequests.filter((item) => !["completed", "cancelled"].includes(item.status)).length },
      ]} />

      {loading ? <LoadingState rows={5} /> : error ? <ErrorState description={error} onRetry={load} /> : activeTab === "documents" ? (
        <div className="space-y-5">
          <Card className="p-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_auto] xl:items-end">
              <SelectInput label="Request Type" value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}>{requestTypes.map((type) => <option key={type} value={type}>{type === "all" ? "All request types" : type}</option>)}</SelectInput>
              <SelectInput label="Status" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="active">Needs action / In progress</option><option value="submitted">Submitted</option><option value="acknowledged">Acknowledged</option><option value="processing">Processing</option><option value="completed">Completed</option><option value="all">All statuses</option></SelectInput>
              <p className="pb-3 text-sm text-stone-500">{filteredRequests.length} request{filteredRequests.length === 1 ? "" : "s"}</p>
            </div>
          </Card>

          {!filteredRequests.length ? <EmptyState title="No document requests in this queue" description="Try another status or request type filter." /> : (
            <TableShell><table className="min-w-full text-sm"><thead className="bg-stone-50 text-left text-stone-500"><tr><th className="px-4 py-3 font-semibold">Resident</th><th className="px-4 py-3 font-semibold">Request</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Submitted</th><th className="px-4 py-3 font-semibold">Next Action</th></tr></thead><tbody>{paginatedRequests.map((request) => (
              <tr key={request.id} className="border-t border-stone-100 align-top hover:bg-stone-50/70">
                <td className="px-4 py-4"><p className="font-semibold text-[var(--brand-900)]">{request.resident_name}</p><p className="mt-1 max-w-sm text-xs leading-5 text-stone-500">{request.details}</p></td>
                <td className="px-4 py-4 text-stone-700">{request.request_type}</td>
                <td className="px-4 py-4"><Status status={request.status} /></td>
                <td className="px-4 py-4 text-stone-500">{formatDateTime(request.created_at)}</td>
                <td className="px-4 py-4">{request.status === "submitted" ? <Button onClick={() => openAction(request, "request", "acknowledged")}><MessageSquareMore className="h-4 w-4" /> Acknowledge</Button> : request.status === "acknowledged" ? <Button onClick={() => openAction(request, "request", "processing")}><Clock3 className="h-4 w-4" /> Start Processing</Button> : request.status === "processing" ? <Button onClick={() => openAction(request, "request", "completed")}><CheckCircle2 className="h-4 w-4" /> Complete</Button> : <span className="text-xs font-semibold text-emerald-700">No action needed</span>} <Button variant="ghost" onClick={() => openAction(request, "request", request.status)}>History / Reply</Button></td>
              </tr>
            ))}</tbody></table></TableShell>
          )}
          <Pagination page={requestPage} totalPages={Math.max(1, Math.ceil(filteredRequests.length / pageSize))} onPageChange={setRequestPage} />
        </div>
      ) : (
        <div className="space-y-5">
          <Card className="p-4"><div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><SelectInput className="w-full md:max-w-sm" label="Appointment Status" value={idFilter} onChange={(event) => setIdFilter(event.target.value)}><option value="active">Upcoming / Needs action</option><option value="submitted">Awaiting confirmation</option><option value="confirmed">Confirmed</option><option value="rescheduled">Rescheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="all">All statuses</option></SelectInput><p className="pb-3 text-sm text-stone-500">{filteredIds.length} appointment{filteredIds.length === 1 ? "" : "s"}</p></div></Card>
          {!filteredIds.length ? <EmptyState title="No Barangay ID appointments in this queue" description="Try another appointment status filter." /> : <TableShell><table className="min-w-full text-sm"><thead className="bg-stone-50 text-left text-stone-500"><tr><th className="px-4 py-3 font-semibold">Resident</th><th className="px-4 py-3 font-semibold">Purpose</th><th className="px-4 py-3 font-semibold">Schedule</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Actions</th></tr></thead><tbody>{paginatedIds.map((request) => (
            <tr key={request.id} className="border-t border-stone-100 align-top hover:bg-stone-50/70"><td className="px-4 py-4 font-semibold text-[var(--brand-900)]">{request.users?.full_name || request.users?.first_name || "Resident"}</td><td className="px-4 py-4 text-stone-600">{request.purpose}</td><td className="px-4 py-4 text-stone-600">{request.preferred_date ? formatDate(request.preferred_date) : "Pending"}{request.time_slot ? ` · ${request.time_slot}` : ""}</td><td className="px-4 py-4"><Status status={request.status} feature="id_request" /></td><td className="px-4 py-4"><div className="flex flex-wrap gap-2">{request.status === "submitted" ? <Button onClick={() => openAction(request, "id", "confirmed")}><CalendarCheck className="h-4 w-4" /> Confirm</Button> : null}{!["completed", "cancelled"].includes(request.status) ? <Button variant="secondary" onClick={() => openAction(request, "id", "rescheduled")}><Clock3 className="h-4 w-4" /> Reschedule</Button> : null}{["confirmed", "rescheduled"].includes(request.status) ? <Button variant="secondary" onClick={() => openAction(request, "id", "completed")}><CheckCircle2 className="h-4 w-4" /> Complete</Button> : null}{!["completed", "cancelled"].includes(request.status) ? <Button variant="ghost" onClick={() => openAction(request, "id", "cancelled")}><XCircle className="h-4 w-4" /> Cancel</Button> : null}<Button variant="ghost" onClick={() => openAction(request, "id", request.status)}>History / Reply</Button></div></td></tr>
          ))}</tbody></table></TableShell>}
          <Pagination page={idPage} totalPages={Math.max(1, Math.ceil(filteredIds.length / pageSize))} onPageChange={setIdPage} />
        </div>
      )}

      <Modal open={Boolean(selected)} onClose={requestClose} closeDisabled={saving} title={actionLabel || "Update Request"} description={selected?.mode === "id" ? "Confirm the schedule and add a resident-facing note when needed." : "Move the request to its next workflow stage and optionally add a resident-facing note."} widthClass="max-w-2xl">
        {selected ? <div className="space-y-5"><div className="rounded-2xl bg-[var(--brand-50)] p-4"><p className="font-semibold text-[var(--brand-900)]">{selected.resident_name || selected.users?.full_name || "Resident"}</p><p className="mt-1 text-sm text-stone-500">{selected.request_type || selected.purpose}</p><div className="mt-3"><Status status={form.status} feature={selected.mode === "id" ? "id_request" : "request"} /></div></div>
          <CaseHistory events={selected.case_history} />
          {selected.mode === "id" && ["confirmed", "rescheduled"].includes(form.status) ? <div className="grid gap-4 sm:grid-cols-2"><TextInput label="Pickup Date" required type="date" value={form.preferredDate} onChange={(event) => setForm((current) => ({ ...current, preferredDate: event.target.value, timeSlot: "" }))} /><SelectInput label="Time Slot" required value={form.timeSlot} onChange={(event) => setForm((current) => ({ ...current, timeSlot: event.target.value }))} disabled={!form.preferredDate}><option value="">Select configured slot</option>{availableTimeSlots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}</SelectInput></div> : null}
          <SelectInput label="Response Visibility" value={form.visibility} onChange={(event) => setForm((current) => ({ ...current, visibility: event.target.value }))} disabled={form.status !== selected.status}><option value="resident">Resident Response (visible to resident)</option><option value="internal">Internal Staff Note (hidden from resident)</option></SelectInput><TextArea label="New Resident Response" required={form.status === "cancelled"} value={form.adminNote} onChange={(event) => setForm((current) => ({ ...current, adminNote: event.target.value }))} placeholder={form.status === "cancelled" ? "Explain why this appointment is being cancelled." : "Add clear instructions or information for the resident (optional)."} />
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button variant="secondary" onClick={requestClose} disabled={saving}>Cancel</Button><Button variant={form.status === "cancelled" ? "danger" : "primary"} onClick={save} loading={saving}>{actionLabel || "Save Update"}</Button></div></div> : null}
      </Modal>
    </div>
  );
};

export default AdminRequests;

