import { Download, IdCard, Info, SendHorizonal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, API_URL } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Card, EmptyState, PageHeader, SelectInput, TextArea, TextInput } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

const requestTypes = [
  "Barangay Clearance",
  "Certificate of Residency",
  "Certificate of Indigency",
  "Barangay ID",
  "Other",
];

const toneForStatus = (status) => {
  if (status === "completed" || status === "confirmed") return "success";
  if (status === "processing" || status === "rescheduled") return "warning";
  if (status === "submitted" || status === "acknowledged") return "info";
  return "neutral";
};

const RequestsPage = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [requests, setRequests] = useState([]);
  const [idRequests, setIdRequests] = useState([]);
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requestForm, setRequestForm] = useState({ requestType: requestTypes[0], details: "" });
  const [idForm, setIdForm] = useState({ purpose: "", preferredDate: "", timeSlot: "" });
  const [savingRequest, setSavingRequest] = useState(false);
  const [savingId, setSavingId] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [requestData, idData, slotData] = await Promise.all([
        api("/requests/mine", { token }),
        api("/requests/id-mine", { token }),
        api("/requests/id-slots", { token }),
      ]);
      setRequests(requestData.requests || []);
      setIdRequests(idData.requests || []);
      setSlots(slotData.slots || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) load();
  }, [token]);

  const slotOptions = useMemo(() => {
    const grouped = new Map();
    for (const slot of slots) {
      const date = slot.slot_date;
      const current = grouped.get(date) || [];
      current.push(slot.time_slot);
      grouped.set(date, current);
    }
    return grouped;
  }, [slots]);

  const submitRequest = async (event) => {
    event.preventDefault();
    setSavingRequest(true);
    try {
      await api("/requests", { method: "POST", token, body: requestForm });
      toast.success("Request submitted.");
      setRequestForm({ requestType: requestTypes[0], details: "" });
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSavingRequest(false);
    }
  };

  const submitIdRequest = async (event) => {
    event.preventDefault();
    setSavingId(true);
    try {
      await api("/requests/id", { method: "POST", token, body: idForm });
      toast.success("Barangay ID request submitted.");
      setIdForm({ purpose: "", preferredDate: "", timeSlot: "" });
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSavingId(false);
    }
  };

  const downloadClearance = async (requestId) => {
    try {
      const response = await fetch(`${API_URL}/requests/document/${requestId}/clearance`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Failed to download clearance PDF.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `barangay-clearance-${requestId}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error.message);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Resident Requests"
        title="Submit requests and monitor progress"
        description="Track every step of your document requests, receive admin notes, and schedule Barangay ID pickup slots from one place."
      />

      <Card className="bg-gradient-to-br from-white to-[var(--brand-50)]">
        <div className="flex items-start gap-3"><div className="rounded-2xl bg-[var(--brand-500)]/10 p-3 text-[var(--brand-600)]"><Info className="h-5 w-5" /></div><div><h2 className="text-xl font-bold text-[var(--brand-900)]">How requests work</h2><p className="mt-1 text-sm leading-6 text-stone-600">Choose the correct service, provide complete details, submit once, then follow the Request Timeline. Barangay staff will update the status and add notes when action is needed from you.</p></div></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">{["1. Choose service", "2. Submit details", "3. Barangay processes", "4. Track completion"].map((step) => <div key={step} className="rounded-2xl border border-[var(--brand-100)] bg-white p-3 text-sm font-semibold text-[var(--brand-800)]">{step}</div>)}</div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <h2 className="text-xl font-bold text-[var(--brand-900)]">New Service Request</h2>
          <form className="mt-5 space-y-4" onSubmit={submitRequest}>
            <SelectInput
              label="Request Type"
              required
              value={requestForm.requestType}
              onChange={(event) => setRequestForm((current) => ({ ...current, requestType: event.target.value }))}
            >
              {requestTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </SelectInput>
            <TextArea
              label="Purpose / Details"
              required
              minLength={5}
              maxLength={1000}
              hint="Include the purpose and any information the barangay needs to process the request."
              value={requestForm.details}
              onChange={(event) => setRequestForm((current) => ({ ...current, details: event.target.value }))}
              placeholder="Explain what document you need and why."
            />
            <Button type="submit" loading={savingRequest}>
              <SendHorizonal className="h-4 w-4" />
              Submit Request
            </Button>
          </form>
        </Card>

        <Card>
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]">
              <IdCard className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--brand-900)]">Barangay ID Scheduling</h2>
              <p className="mt-1 text-sm text-stone-500">Choose an available pickup date and slot for your Barangay ID request.</p>
            </div>
          </div>
          <form className="mt-5 space-y-4" onSubmit={submitIdRequest}>
            <TextInput
              label="Purpose"
              required
              maxLength={200}
              value={idForm.purpose}
              onChange={(event) => setIdForm((current) => ({ ...current, purpose: event.target.value }))}
              placeholder="Example: employment requirement"
            />
            <SelectInput
              label="Preferred Date"
              required
              value={idForm.preferredDate}
              onChange={(event) => setIdForm((current) => ({ ...current, preferredDate: event.target.value, timeSlot: "" }))}
            >
              <option value="">Select a date</option>
              {Array.from(slotOptions.keys()).map((date) => (
                <option key={date} value={date}>
                  {date}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              label="Time Slot"
              required
              value={idForm.timeSlot}
              onChange={(event) => setIdForm((current) => ({ ...current, timeSlot: event.target.value }))}
              disabled={!idForm.preferredDate}
            >
              <option value="">Select a time slot</option>
              {(slotOptions.get(idForm.preferredDate) || []).map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </SelectInput>
            <Button type="submit" loading={savingId}>
              Schedule ID Pickup
            </Button>
          </form>
        </Card>
      </div>

      <Card>
        <h2 className="text-xl font-bold text-[var(--brand-900)]">Request Timeline</h2>
        <div className="mt-5 space-y-5">
          {loading ? (
            <p className="text-sm text-stone-500">Loading your requests...</p>
          ) : !requests.length ? (
            <EmptyState title="No requests yet" description="Your submitted document requests will appear here." />
          ) : (
            requests.map((request) => (
              <div key={request.id} className="rounded-3xl border border-stone-200 p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-[var(--brand-900)]">{request.request_type}</h3>
                    <p className="text-sm text-stone-600">{request.details}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={toneForStatus(request.status)}>{request.status}</Badge>
                    {request.request_type === "Barangay Clearance" && request.status === "completed" ? (
                      <button
                        type="button"
                        onClick={() => downloadClearance(request.id)}
                        className="inline-flex items-center gap-2 rounded-full bg-[var(--brand-500)] px-4 py-2 text-sm font-semibold text-white"
                      >
                        <Download className="h-4 w-4" />
                        Download PDF
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-4">
                  {(request.request_timeline || []).map((step) => (
                    <div key={step.id} className="rounded-2xl bg-[var(--brand-50)] p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--brand-500)]">{step.status}</p>
                      <p className="mt-2 text-sm text-stone-600">{step.note || "Status updated."}</p>
                      <p className="mt-3 text-xs text-stone-400">{formatDateTime(step.created_at)}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card>
        <h2 className="text-xl font-bold text-[var(--brand-900)]">Barangay ID Requests</h2>
        <div className="mt-5 space-y-4">
          {!idRequests.length && !loading ? (
            <EmptyState title="No Barangay ID requests yet" description="Your ID schedule confirmations will appear here." />
          ) : (
            idRequests.map((request) => (
              <div key={request.id} className="rounded-2xl border border-stone-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--brand-900)]">{request.purpose}</p>
                    <p className="text-sm text-stone-500">
                      {request.preferred_date || request.preferredDate || "Date pending"}
                      {(request.time_slot || request.timeSlot) ? ` - ${request.time_slot || request.timeSlot}` : ""}
                    </p>
                  </div>
                  <Badge tone={toneForStatus(request.status)}>{request.status}</Badge>
                </div>
                {request.admin_note ? <p className="mt-3 text-sm text-stone-600">Admin note: {request.admin_note}</p> : null}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
};

export default RequestsPage;
