import { Filter, MessageSquareMore } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Card, Modal, PageHeader, Pagination, SelectInput, TableShell, TextArea, TextInput } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

const requestStatuses = ["submitted", "acknowledged", "processing", "completed"];
const idStatuses = ["submitted", "confirmed", "rescheduled", "completed", "cancelled"];
const pageSize = 8;

const toneForStatus = (status) => {
  if (status === "completed" || status === "confirmed") return "success";
  if (status === "processing" || status === "rescheduled") return "warning";
  if (status === "cancelled") return "danger";
  return "info";
};

const AdminRequests = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [requests, setRequests] = useState([]);
  const [idRequests, setIdRequests] = useState([]);
  const [idSlots, setIdSlots] = useState([]);
  const [selected, setSelected] = useState(null);
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState({ type: "all", status: "all" });
  const [form, setForm] = useState({ status: "submitted", adminNote: "", preferredDate: "", timeSlot: "" });
  const [requestPage, setRequestPage] = useState(1);
  const [idRequestPage, setIdRequestPage] = useState(1);

  const load = async () => {
    const [requestData, idData, slotData] = await Promise.all([
      api("/admin/requests", { token }),
      api("/admin/id-requests", { token }),
      api("/admin/id_pickup_slots", { token }),
    ]);
    setRequests(requestData.requests || []);
    setIdRequests(idData.requests || []);
    setIdSlots(slotData.id_pickup_slots || []);
  };

  useEffect(() => {
    if (token) load();
  }, [token]);

  useEffect(() => {
    setRequestPage(1);
  }, [filters]);

  const openUpdate = (request, mode) => {
    setSelected({ ...request, mode });
    setForm({
      status: request.status,
      adminNote: request.admin_note || "",
      preferredDate: request.preferred_date || request.preferredDate || "",
      timeSlot: request.preferred_time_slot || request.time_slot || "",
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      const path = selected.mode === "id" ? `/admin/id-requests/${selected.id}` : `/admin/requests/${selected.id}`;
      await api(path, { method: "PATCH", token, body: form });
      toast.success("Request updated.");
      setOpen(false);
      setSelected(null);
      setForm({ status: "submitted", adminNote: "", preferredDate: "", timeSlot: "" });
      await load();
    } catch (error) {
      toast.error(error.message);
    }
  };

  const availableTimeSlots = useMemo(
    () => idSlots.filter((slot) => slot.is_active && slot.slot_date === form.preferredDate).map((slot) => slot.time_slot),
    [idSlots, form.preferredDate]
  );

  const requestTypes = useMemo(
    () => ["all", ...Array.from(new Set(requests.map((request) => request.request_type).filter(Boolean)))],
    [requests]
  );

  const filteredRequests = useMemo(
    () =>
      requests.filter((request) => {
        const typeMatch = filters.type === "all" || request.request_type === filters.type;
        const statusMatch = filters.status === "all" || request.status === filters.status;
        return typeMatch && statusMatch;
      }),
    [requests, filters]
  );

  const paginatedRequests = useMemo(
    () => filteredRequests.slice((requestPage - 1) * pageSize, requestPage * pageSize),
    [filteredRequests, requestPage]
  );

  const paginatedIdRequests = useMemo(
    () => idRequests.slice((idRequestPage - 1) * pageSize, idRequestPage * pageSize),
    [idRequests, idRequestPage]
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Request Management"
        title="Track requests and Barangay ID scheduling"
        description="Filter resident requests, update their timeline in a modal, and keep the main workspace open for wider review."
      />

      <Card>
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-xl font-bold text-[var(--brand-900)]">Resident Requests</h2>
            <p className="mt-1 text-sm text-stone-500">Filter by type and status, then update each request without shrinking the table area.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[28rem]">
            <SelectInput label="Request Type" value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}>
              {requestTypes.map((type) => (
                <option key={type} value={type}>
                  {type === "all" ? "All types" : type}
                </option>
              ))}
            </SelectInput>
            <SelectInput label="Status" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="all">All statuses</option>
              {requestStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </SelectInput>
          </div>
        </div>

        <TableShell>
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-stone-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Resident</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Updated</th>
                <th className="px-4 py-3 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRequests.map((request) => (
                <tr key={request.id} className="border-t border-stone-100 align-top transition hover:bg-stone-50/70">
                  <td className="px-4 py-4">
                    <p className="font-semibold text-[var(--brand-900)]">{request.resident_name}</p>
                    <p className="mt-1 max-w-xl text-xs text-stone-500">{request.details}</p>
                  </td>
                  <td className="px-4 py-4 text-stone-600">{request.request_type}</td>
                  <td className="px-4 py-4">
                    <Badge tone={toneForStatus(request.status)}>{request.status}</Badge>
                  </td>
                  <td className="px-4 py-4 text-stone-500">{formatDateTime(request.updated_at || request.created_at)}</td>
                  <td className="px-4 py-4">
                    <Button variant="secondary" onClick={() => openUpdate(request, "request")}>
                      <MessageSquareMore className="h-4 w-4" />
                      Update
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
        <Pagination page={requestPage} totalPages={Math.max(1, Math.ceil(filteredRequests.length / pageSize))} onPageChange={setRequestPage} />
      </Card>

      <Card>
        <div className="mb-5 flex items-center gap-3">
          <div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]">
            <Filter className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-[var(--brand-900)]">Barangay ID Requests</h2>
            <p className="mt-1 text-sm text-stone-500">Confirm schedules, reschedule pickups, or mark ID requests as completed.</p>
          </div>
        </div>

        <TableShell>
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-stone-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Resident</th>
                <th className="px-4 py-3 font-semibold">Purpose</th>
                <th className="px-4 py-3 font-semibold">Schedule</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedIdRequests.map((request) => (
                <tr key={request.id} className="border-t border-stone-100 transition hover:bg-stone-50/70">
                  <td className="px-4 py-4 font-semibold text-[var(--brand-900)]">{request.users?.full_name || request.users?.first_name || "Resident"}</td>
                  <td className="px-4 py-4 text-stone-600">{request.purpose}</td>
                  <td className="px-4 py-4 text-stone-600">
                    {request.preferred_date || request.preferredDate || "Pending"}
                    {(request.time_slot || request.timeSlot) ? ` - ${request.time_slot || request.timeSlot}` : ""}
                  </td>
                  <td className="px-4 py-4">
                    <Badge tone={toneForStatus(request.status)}>{request.status}</Badge>
                  </td>
                  <td className="px-4 py-4">
                    <Button variant="secondary" onClick={() => openUpdate(request, "id")}>
                      Update
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
        <Pagination page={idRequestPage} totalPages={Math.max(1, Math.ceil(idRequests.length / pageSize))} onPageChange={setIdRequestPage} />
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Update Request"
        description="Modify the request status, add an admin note, and keep the resident informed."
      >
        {!selected ? null : (
          <div className="space-y-4">
            <div className="rounded-2xl bg-[var(--brand-50)] p-4">
              <p className="font-semibold text-[var(--brand-900)]">{selected.resident_name || selected.users?.full_name || "Resident"}</p>
              <p className="mt-1 text-sm text-stone-500">{selected.request_type || selected.purpose}</p>
            </div>
            <SelectInput label="Status" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
              {(selected.mode === "id" ? idStatuses : requestStatuses).map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </SelectInput>
            <TextArea
              label="Admin Note"
              value={form.adminNote}
              onChange={(event) => setForm((current) => ({ ...current, adminNote: event.target.value }))}
              placeholder="Example: Please bring a valid ID during claiming."
            />
            {selected.mode === "id" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <TextInput label="Pickup Date" type="date" value={form.preferredDate} onChange={(event) => setForm((current) => ({ ...current, preferredDate: event.target.value, timeSlot: "" }))} />
                <SelectInput label="Time Slot" value={form.timeSlot} onChange={(event) => setForm((current) => ({ ...current, timeSlot: event.target.value }))} disabled={!form.preferredDate}><option value="">Select configured slot</option>{availableTimeSlots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}</SelectInput>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button onClick={save}>Save Update</Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AdminRequests;
