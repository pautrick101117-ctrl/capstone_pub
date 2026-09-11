import { ArrowRight, CheckCircle2, Download, FileText, IdCard, SendHorizonal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, API_URL } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, Pagination, SegmentedTabs, SelectInput, TextArea, TextInput } from "../../components/ui";
import { formatDate, formatDateTime } from "../../lib/format";
import { getStatusMeta } from "../../lib/status";

const requestTypes = ["Barangay Clearance", "Certificate of Residency", "Certificate of Indigency", "Other"];
const pageSize = 5;

const RequestStatus = ({ status, feature = "request" }) => {
  const meta = getStatusMeta(status, feature);
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
};

const RequestTimeline = ({ request }) => {
  const steps = ["submitted", "acknowledged", "processing", "completed"];
  const timeline = request.request_timeline || [];
  const currentIndex = Math.max(0, steps.indexOf(request.status));

  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {steps.map((step, index) => {
        const row = timeline.find((item) => item.status === step);
        const done = index <= currentIndex;
        return (
          <div key={step} className={`rounded-2xl border p-4 ${done ? "border-[var(--brand-100)] bg-[var(--brand-50)]" : "border-stone-200 bg-stone-50"}`}>
            <div className="flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-[var(--brand-500)] text-white" : "bg-stone-200 text-stone-500"}`}>{done ? "✓" : index + 1}</span>
              <p className={`text-xs font-bold uppercase tracking-[0.18em] ${done ? "text-[var(--brand-700)]" : "text-stone-400"}`}>{getStatusMeta(step).label}</p>
            </div>
            <p className="mt-3 text-sm leading-6 text-stone-600">{row?.note || (done ? "Status reached." : "Waiting for the previous step.")}</p>
            {row?.created_at ? <p className="mt-2 text-xs text-stone-400">{formatDateTime(row.created_at)}</p> : null}
          </div>
        );
      })}
    </div>
  );
};

const RequestsPage = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [requests, setRequests] = useState([]);
  const [idRequests, setIdRequests] = useState([]);
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("mine");
  const [requestForm, setRequestForm] = useState({ requestType: requestTypes[0], details: "" });
  const [idForm, setIdForm] = useState({ purpose: "", preferredDate: "", timeSlot: "" });
  const [savingRequest, setSavingRequest] = useState(false);
  const [savingId, setSavingId] = useState(false);
  const [success, setSuccess] = useState(null);
  const [filter, setFilter] = useState("all");
  const [requestPage, setRequestPage] = useState(1);
  const [idPage, setIdPage] = useState(1);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [requestData, idData, slotData] = await Promise.all([
        api("/requests/mine", { token }),
        api("/requests/id-mine", { token }),
        api("/requests/id-slots", { token }),
      ]);
      setRequests(requestData.requests || []);
      setIdRequests(idData.requests || []);
      setSlots(slotData.slots || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (token) load(); }, [token]);

  const slotOptions = useMemo(() => {
    const grouped = new Map();
    for (const slot of slots) {
      const date = slot.slot_date;
      const current = grouped.get(date) || [];
      current.push(slot);
      grouped.set(date, current);
    }
    return grouped;
  }, [slots]);

  const filteredRequests = useMemo(() => {
    if (filter === "active") return requests.filter((item) => item.status !== "completed");
    if (filter === "completed") return requests.filter((item) => item.status === "completed");
    return requests;
  }, [requests, filter]);

  useEffect(() => { setRequestPage(1); }, [filter]);

  const paginatedRequests = useMemo(() => filteredRequests.slice((requestPage - 1) * pageSize, requestPage * pageSize), [filteredRequests, requestPage]);
  const paginatedIdRequests = useMemo(() => idRequests.slice((idPage - 1) * pageSize, idPage * pageSize), [idRequests, idPage]);

  const submitRequest = async (event) => {
    event.preventDefault();
    setSavingRequest(true);
    try {
      const data = await api("/requests", { method: "POST", token, body: requestForm });
      setSuccess({ type: "request", id: data.request?.id, title: requestForm.requestType });
      setRequestForm({ requestType: requestTypes[0], details: "" });
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingRequest(false);
    }
  };

  const submitIdRequest = async (event) => {
    event.preventDefault();
    setSavingId(true);
    try {
      const data = await api("/requests/id", { method: "POST", token, body: idForm });
      setSuccess({ type: "id", id: data.request?.id, title: "Barangay ID appointment" });
      setIdForm({ purpose: "", preferredDate: "", timeSlot: "" });
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingId(false);
    }
  };

  const downloadClearance = async (requestId) => {
    try {
      const response = await fetch(`${API_URL}/requests/document/${requestId}/clearance`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Failed to download clearance PDF.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `barangay-clearance-${requestId}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Resident Services" title="Requests & documents" description="Apply for barangay documents, schedule a Barangay ID pickup, and track every status update in one place." actions={<Button type="button" onClick={() => setActiveTab("new")}><FileText className="h-4 w-4" /> New Request</Button>} />

      {success ? (
        <Alert tone="success" title={success.type === "id" ? "Barangay ID request submitted" : "Request submitted successfully"} actions={<Button type="button" variant="secondary" onClick={() => { setSuccess(null); setActiveTab("mine"); }}>View My Requests <ArrowRight className="h-4 w-4" /></Button>}>
          <p>{success.type === "id" ? "Your requested pickup schedule is waiting for barangay confirmation. Submitted does not mean confirmed yet." : `Your ${success.title} request is now in the barangay queue. We'll notify you when its status changes.`}</p>
          {success.id ? <p className="mt-1 text-xs font-semibold">Reference: {success.id}</p> : null}
        </Alert>
      ) : null}

      <SegmentedTabs value={activeTab} onChange={(value) => { setSuccess(null); setActiveTab(value); }} items={[
        { value: "mine", label: "My Requests", count: requests.length + idRequests.length },
        { value: "new", label: "New Request" },
        { value: "id", label: "Barangay ID", count: idRequests.filter((item) => !["completed", "cancelled"].includes(item.status)).length },
      ]} />

      {activeTab === "mine" ? (
        <div className="space-y-6">
          <Card className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div><h2 className="font-bold text-[var(--brand-900)]">My document requests</h2><p className="text-sm text-stone-500">Open a request to see its progress and barangay notes.</p></div>
              <SegmentedTabs value={filter} onChange={setFilter} className="border-0 bg-stone-50" items={[{ value: "all", label: "All" }, { value: "active", label: "In Progress" }, { value: "completed", label: "Completed" }]} />
            </div>
          </Card>

          {loading ? <LoadingState rows={3} /> : error ? <ErrorState description={error} onRetry={load} /> : !filteredRequests.length ? (
            <EmptyState title={filter === "all" ? "No document requests yet" : "No requests in this status"} description={filter === "all" ? "Start a new request for a Barangay Clearance, Residency Certificate, Indigency Certificate or another service." : "Try another status filter or start a new request."} action={filter === "all" ? <Button type="button" onClick={() => setActiveTab("new")}>Start a Request</Button> : null} />
          ) : (
            <div className="space-y-4">
              {paginatedRequests.map((request) => (
                <Card key={request.id}>
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-bold text-[var(--brand-900)]">{request.request_type}</h3><RequestStatus status={request.status} /></div>
                      <p className="mt-2 text-sm leading-6 text-stone-600">{request.details}</p>
                      <p className="mt-2 text-xs text-stone-400">Submitted {formatDateTime(request.created_at)}</p>
                    </div>
                    {request.request_type === "Barangay Clearance" && request.status === "completed" ? <Button type="button" onClick={() => downloadClearance(request.id)}><Download className="h-4 w-4" /> Download PDF</Button> : null}
                  </div>
                  {request.admin_note ? <div className="mt-4 rounded-2xl bg-sky-50 p-4 text-sm text-stone-700"><p className="font-semibold text-sky-800">Barangay note</p><p className="mt-1">{request.admin_note}</p></div> : null}
                  <RequestTimeline request={request} />
                </Card>
              ))}
            </div>
          )}
          {!loading && !error ? <Pagination page={requestPage} totalPages={Math.max(1, Math.ceil(filteredRequests.length / pageSize))} onPageChange={setRequestPage} /> : null}

          {!loading && !error && idRequests.length ? (
            <Card>
              <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Barangay ID appointments</h2><p className="mt-1 text-sm text-stone-500">Schedule confirmations and changes appear here.</p></div><Button type="button" variant="secondary" onClick={() => setActiveTab("id")}>Manage ID Request</Button></div>
              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                {paginatedIdRequests.map((request) => (
                  <div key={request.id} className="rounded-2xl border border-stone-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-[var(--brand-900)]">{request.purpose}</p><p className="mt-1 text-sm text-stone-500">{request.preferred_date ? formatDate(request.preferred_date) : "Date pending"}{request.time_slot ? ` · ${request.time_slot}` : ""}</p></div><RequestStatus status={request.status} feature="id_request" /></div>
                    {request.admin_note ? <p className="mt-3 rounded-xl bg-stone-50 p-3 text-sm text-stone-600">Barangay note: {request.admin_note}</p> : null}
                  </div>
                ))}
              </div>
              <Pagination page={idPage} totalPages={Math.max(1, Math.ceil(idRequests.length / pageSize))} onPageChange={setIdPage} />
            </Card>
          ) : null}
        </div>
      ) : null}

      {activeTab === "new" ? (
        <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <Card className="bg-gradient-to-br from-white to-[var(--brand-50)]">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand-500)]">Choose a service</p>
            <h2 className="mt-2 text-2xl font-black text-[var(--brand-900)]">What do you need?</h2>
            <div className="mt-5 grid gap-3">
              {requestTypes.map((type) => (
                <button key={type} type="button" onClick={() => setRequestForm((current) => ({ ...current, requestType: type }))} className={`flex items-center justify-between rounded-2xl border p-4 text-left transition ${requestForm.requestType === type ? "border-[var(--brand-300)] bg-white shadow-sm" : "border-stone-200 bg-white/60 hover:border-[var(--brand-200)]"}`}>
                  <span className="font-semibold text-[var(--brand-900)]">{type}</span>{requestForm.requestType === type ? <CheckCircle2 className="h-5 w-5 text-[var(--brand-600)]" /> : null}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setActiveTab("id")} className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-dashed border-[var(--brand-300)] p-4 text-left text-sm font-semibold text-[var(--brand-700)]"><IdCard className="h-5 w-5" /> Need a Barangay ID? Use the dedicated scheduling flow.</button>
          </Card>

          <Card>
            <h2 className="text-xl font-bold text-[var(--brand-900)]">Request details</h2>
            <p className="mt-1 text-sm text-stone-500">Provide enough information for barangay staff to process the request without needing to ask for basic details again.</p>
            <form className="mt-6 space-y-5" onSubmit={submitRequest}>
              <SelectInput label="Request Type" required value={requestForm.requestType} onChange={(event) => setRequestForm((current) => ({ ...current, requestType: event.target.value }))}>{requestTypes.map((type) => <option key={type} value={type}>{type}</option>)}</SelectInput>
              <TextArea label="Purpose / Details" required minLength={5} maxLength={1000} hint="Include the purpose and any information the barangay needs to process the request." value={requestForm.details} onChange={(event) => setRequestForm((current) => ({ ...current, details: event.target.value }))} placeholder="Explain what you need and why." />
              <div className="rounded-2xl bg-stone-50 p-4 text-sm leading-6 text-stone-600"><strong className="text-stone-800">Before submitting:</strong> review the service type and details. You can track every status change from My Requests after submission.</div>
              <Button type="submit" loading={savingRequest}><SendHorizonal className="h-4 w-4" /> Submit Request</Button>
            </form>
          </Card>
        </div>
      ) : null}

      {activeTab === "id" ? (
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="bg-gradient-to-br from-white to-[var(--brand-50)]">
            <div className="flex items-start gap-3"><div className="rounded-2xl bg-[var(--brand-500)]/10 p-3 text-[var(--brand-600)]"><IdCard className="h-5 w-5" /></div><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Barangay ID scheduling</h2><p className="mt-1 text-sm leading-6 text-stone-500">Choose from configured pickup schedules. Your submitted schedule still requires barangay confirmation.</p></div></div>
            <div className="mt-6 space-y-3">
              <div className="rounded-2xl bg-white p-4"><p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--brand-500)]">1 · Request</p><p className="mt-1 text-sm text-stone-600">Choose your preferred date and time.</p></div>
              <div className="rounded-2xl bg-white p-4"><p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--brand-500)]">2 · Confirmation</p><p className="mt-1 text-sm text-stone-600">Barangay staff confirms or reschedules the appointment.</p></div>
              <div className="rounded-2xl bg-white p-4"><p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--brand-500)]">3 · Pickup</p><p className="mt-1 text-sm text-stone-600">Follow the confirmed schedule and any admin note.</p></div>
            </div>
          </Card>
          <Card>
            <h2 className="text-xl font-bold text-[var(--brand-900)]">Request a pickup schedule</h2>
            <form className="mt-6 space-y-4" onSubmit={submitIdRequest}>
              <TextInput label="Purpose" required maxLength={200} value={idForm.purpose} onChange={(event) => setIdForm((current) => ({ ...current, purpose: event.target.value }))} placeholder="Example: employment requirement" />
              <SelectInput label="Preferred Date" required value={idForm.preferredDate} onChange={(event) => setIdForm((current) => ({ ...current, preferredDate: event.target.value, timeSlot: "" }))}><option value="">Select a date</option>{Array.from(slotOptions.keys()).map((date) => <option key={date} value={date}>{formatDate(date)}</option>)}</SelectInput>
              <SelectInput label="Time Slot" required value={idForm.timeSlot} onChange={(event) => setIdForm((current) => ({ ...current, timeSlot: event.target.value }))} disabled={!idForm.preferredDate}><option value="">Select a time slot</option>{(slotOptions.get(idForm.preferredDate) || []).map((slot) => <option key={slot.id || slot.time_slot} value={slot.time_slot}>{slot.time_slot}{slot.capacity ? ` · Capacity ${slot.capacity}` : ""}</option>)}</SelectInput>
              {!slots.length && !loading ? <Alert tone="warning" title="No pickup slots are available">Barangay staff has not configured an upcoming ID pickup schedule yet. Please check again later.</Alert> : null}
              <Button type="submit" loading={savingId} disabled={!slots.length}><IdCard className="h-4 w-4" /> Submit Schedule Request</Button>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
};

export default RequestsPage;
