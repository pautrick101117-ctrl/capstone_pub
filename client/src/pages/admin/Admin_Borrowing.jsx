import {
  CalendarDays,
  Check,
  Clock3,
  PackageCheck,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  Pagination,
  SelectInput,
  TableShell,
  TextArea,
  TextInput,
} from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { getBorrowingStatusMeta, isFacility, RETURN_CONDITION_LABELS } from "../../lib/borrowing";

const blankAsset = { name: "", category: "item", description: "", totalQuantity: 1, isActive: true };
const blankInspection = { returnedQuantity: 1, returnCondition: "good", returnNote: "" };
const pageSize = 8;
const calendarPageSize = 5;

const startOfDay = (date = new Date()) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
const dateKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
};

const Admin_Borrowing = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [assets, setAssets] = useState([]);
  const [requests, setRequests] = useState([]);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("requests");
  const [assetModal, setAssetModal] = useState(null);
  const [requestAction, setRequestAction] = useState(null);
  const [adminNote, setAdminNote] = useState("");
  const [inspection, setInspection] = useState(blankInspection);
  const [saving, setSaving] = useState(false);
  const [requestPage, setRequestPage] = useState(1);
  const [assetPage, setAssetPage] = useState(1);
  const [calendarPage, setCalendarPage] = useState(1);

  const load = async () => {
    try {
      const [assetData, requestData] = await Promise.all([
        api("/borrowing/admin/assets", { token }),
        api("/borrowing/admin/requests", { token }),
      ]);
      setAssets(assetData.assets || []);
      setRequests(requestData.requests || []);
    } catch (error) {
      toast.error(error.message);
    }
  };

  useEffect(() => {
    if (token) load();
  }, [token]);

  const stats = useMemo(() => {
    const today = startOfDay();
    const tomorrow = today + 24 * 60 * 60 * 1000;
    return {
      pending: requests.filter((request) => request.status === "pending").length,
      out: requests.filter((request) => request.status === "borrowed").length,
      dueToday: requests.filter((request) => request.status === "borrowed" && new Date(request.due_at).getTime() >= today && new Date(request.due_at).getTime() < tomorrow).length,
      late: requests.filter((request) => request.isLate).length,
    };
  }, [requests]);

  const filteredRequests = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return requests
      .filter((request) => status === "all" || request.status === status || (status === "overdue" && request.isLate))
      .filter((request) => {
        if (!keyword) return true;
        const resident = request.resident?.full_name || `${request.resident?.first_name || ""} ${request.resident?.last_name || ""}`;
        const searchable = [resident, request.asset?.name, request.purpose, request.event_location, request.resident?.purok, request.resident?.contact_number]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return searchable.includes(keyword);
      })
      .sort((a, b) => {
        if (a.isLate !== b.isLate) return a.isLate ? -1 : 1;
        if (a.status === "pending" && b.status !== "pending") return -1;
        if (b.status === "pending" && a.status !== "pending") return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [requests, status, search]);

  const calendarGroups = useMemo(() => {
    const active = requests
      .filter((request) => ["approved", "borrowed"].includes(request.status))
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
    return active.reduce((groups, request) => {
      const key = dateKey(request.start_at);
      if (!groups[key]) groups[key] = [];
      groups[key].push(request);
      return groups;
    }, {});
  }, [requests]);

  useEffect(() => { setRequestPage(1); }, [status, search]);

  const paginatedRequests = useMemo(() => filteredRequests.slice((requestPage - 1) * pageSize, requestPage * pageSize), [filteredRequests, requestPage]);
  const paginatedAssets = useMemo(() => assets.slice((assetPage - 1) * pageSize, assetPage * pageSize), [assets, assetPage]);
  const calendarEntries = useMemo(() => Object.entries(calendarGroups), [calendarGroups]);
  const paginatedCalendarEntries = useMemo(() => calendarEntries.slice((calendarPage - 1) * calendarPageSize, calendarPage * calendarPageSize), [calendarEntries, calendarPage]);

  const saveAsset = async (event) => {
    event.preventDefault();
    if (!assetModal?.name?.trim()) return toast.error("Resource name is required.");
    const totalQuantity = assetModal.category === "facility" ? 1 : Number(assetModal.totalQuantity);
    if (!Number.isInteger(totalQuantity) || totalQuantity < 1) return toast.error("Total quantity must be a positive whole number.");

    setSaving(true);
    try {
      const isEdit = Boolean(assetModal.id);
      const payload = { ...assetModal, totalQuantity };
      const data = await api(
        isEdit ? `/borrowing/admin/assets/${assetModal.id}` : "/borrowing/admin/assets",
        { method: isEdit ? "PATCH" : "POST", token, body: payload }
      );
      toast.success(data.message);
      setAssetModal(null);
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const openAction = (request, nextStatus) => {
    setRequestAction({ request, nextStatus });
    setAdminNote(request.admin_note || "");
    setInspection({ ...blankInspection, returnedQuantity: request.quantity || 1 });
  };

  const updateRequest = async () => {
    if (!requestAction) return;
    const { request, nextStatus } = requestAction;
    const facility = isFacility(request.asset);

    if (nextStatus === "rejected" && adminNote.trim().length < 3) {
      toast.error("Add a short reason so the resident understands why the request was rejected.");
      return;
    }

    const body = { status: nextStatus, adminNote: adminNote.trim() };
    if (nextStatus === "returned" && !facility) {
      const returnedQuantity = Number(inspection.returnedQuantity);
      if (!Number.isInteger(returnedQuantity) || returnedQuantity < 0 || returnedQuantity > Number(request.quantity)) {
        toast.error(`Returned quantity must be between 0 and ${request.quantity}.`);
        return;
      }
      if (!inspection.returnCondition) {
        toast.error("Select the condition of the returned items.");
        return;
      }
      if (returnedQuantity < Number(request.quantity) && inspection.returnCondition !== "missing_items") {
        toast.error("Choose Missing item(s) when fewer items are returned than were released.");
        return;
      }
      if ((inspection.returnCondition !== "good" || returnedQuantity < Number(request.quantity)) && inspection.returnNote.trim().length < 3) {
        toast.error("Add a return note when there is damage or a quantity discrepancy.");
        return;
      }
      Object.assign(body, {
        returnedQuantity,
        returnCondition: inspection.returnCondition,
        returnNote: inspection.returnNote.trim(),
      });
    }

    setSaving(true);
    try {
      const data = await api(`/borrowing/admin/requests/${request.id}`, { method: "PATCH", token, body });
      toast.success(data.message);
      setRequestAction(null);
      setAdminNote("");
      setInspection(blankInspection);
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const actionButtons = (request) => {
    const facility = isFacility(request.asset);
    if (request.status === "pending") {
      return (
        <>
          <Button onClick={() => openAction(request, "approved")}><Check className="h-4 w-4" /> Approve</Button>
          <Button variant="danger" onClick={() => openAction(request, "rejected")}><X className="h-4 w-4" /> Reject</Button>
        </>
      );
    }
    if (request.status === "approved") {
      return <Button onClick={() => openAction(request, "borrowed")}>{facility ? "Mark In Use" : "Mark Released"}</Button>;
    }
    if (request.status === "borrowed") {
      return (
        <Button onClick={() => openAction(request, "returned")}>
          <RotateCcw className="h-4 w-4" /> {facility ? "Mark Completed" : "Inspect Return"}
        </Button>
      );
    }
    return null;
  };

  const requestStatus = (request) => getBorrowingStatusMeta(request.status, request.isLate);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Resource Management"
        title="Facility & item borrowing"
        description="Review requests, reserve available resources, track what is currently in use, and inspect returned equipment."
        actions={<Button onClick={() => { setTab("inventory"); setAssetModal({ ...blankAsset }); }}><Plus className="h-4 w-4" /> Add Resource</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <button type="button" className="text-left" onClick={() => { setTab("requests"); setStatus("pending"); }}>
          <Card className="h-full"><p className="text-sm text-stone-500">Needs approval</p><p className="mt-2 text-3xl font-black text-[var(--brand-900)]">{stats.pending}</p><p className="mt-2 text-xs text-stone-400">Resident requests waiting for a decision</p></Card>
        </button>
        <button type="button" className="text-left" onClick={() => { setTab("requests"); setStatus("borrowed"); }}>
          <Card className="h-full"><p className="text-sm text-stone-500">Currently in use</p><p className="mt-2 text-3xl font-black text-[var(--brand-900)]">{stats.out}</p><p className="mt-2 text-xs text-stone-400">Released equipment or active facility use</p></Card>
        </button>
        <button type="button" className="text-left" onClick={() => { setTab("requests"); setStatus("borrowed"); }}>
          <Card className="h-full"><p className="text-sm text-stone-500">Due today</p><p className="mt-2 text-3xl font-black text-amber-700">{stats.dueToday}</p><p className="mt-2 text-xs text-stone-400">Returns expected before the day ends</p></Card>
        </button>
        <button type="button" className="text-left" onClick={() => { setTab("requests"); setStatus("overdue"); }}>
          <Card className="h-full"><p className="text-sm text-stone-500">Overdue</p><p className="mt-2 text-3xl font-black text-rose-700">{stats.late}</p><p className="mt-2 text-xs text-stone-400">Past the approved return deadline</p></Card>
        </button>
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-stone-200 bg-white p-2">
        {[
          ["requests", "Requests"],
          ["calendar", "Reservation Calendar"],
          ["inventory", "Inventory"],
        ].map(([value, label]) => (
          <Button key={value} type="button" variant={tab === value ? "primary" : "ghost"} onClick={() => setTab(value)}>{label}</Button>
        ))}
      </div>

      {tab === "requests" ? (
        <section className="space-y-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="text-xl font-bold text-[var(--brand-900)]">Borrowing requests</h2>
              <p className="mt-1 text-sm text-stone-500">Overdue and pending requests are surfaced first so staff can act on them quickly.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[34rem]">
              <TextInput label="Search" placeholder="Resident, resource, purok..." value={search} onChange={(event) => setSearch(event.target.value)} />
              <SelectInput label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="all">All statuses</option>
                <option value="overdue">Overdue</option>
                <option value="pending">Pending Review</option>
                <option value="approved">Approved</option>
                <option value="borrowed">Released / In Use</option>
                <option value="returned">Returned / Completed</option>
                <option value="rejected">Rejected</option>
                <option value="cancelled">Cancelled</option>
              </SelectInput>
            </div>
          </div>

          {!filteredRequests.length ? (
            <EmptyState title="No borrowing requests found" description="Try another status or search term." />
          ) : (
            <TableShell>
              <table className="min-w-full text-sm">
                <thead className="bg-stone-50 text-left text-stone-500">
                  <tr>
                    <th className="px-4 py-3">Resident</th>
                    <th className="px-4 py-3">Resource</th>
                    <th className="px-4 py-3">Schedule</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRequests.map((request) => {
                    const meta = requestStatus(request);
                    const facility = isFacility(request.asset);
                    return (
                      <tr key={request.id} className={`border-t border-stone-100 align-top ${request.isLate ? "bg-rose-50/40" : ""}`}>
                        <td className="px-4 py-4">
                          <p className="font-semibold text-[var(--brand-900)]">{request.resident?.full_name || `${request.resident?.first_name || "Resident"} ${request.resident?.last_name || ""}`}</p>
                          <p className="mt-1 text-xs text-stone-500">{request.resident?.purok || "No purok"} • {request.resident?.contact_number || "No contact"}</p>
                          {request.event_location ? <p className="mt-2 text-xs text-stone-500"><strong>Use at:</strong> {request.event_location}</p> : null}
                        </td>
                        <td className="px-4 py-4">
                          <p className="font-semibold">{request.asset?.name || "Resource"}{facility ? "" : ` × ${request.quantity}`}</p>
                          <p className="mt-1 max-w-xs text-xs text-stone-500">{request.purpose}</p>
                        </td>
                        <td className="px-4 py-4 text-stone-600">
                          <p>{formatDateTime(request.start_at)}</p>
                          <p className="mt-1">Return: {formatDateTime(request.due_at)}</p>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col items-start gap-2">
                            <Badge tone={meta.tone}>{meta.label}</Badge>
                            {request.status === "returned" && !facility && request.return_condition ? (
                              <span className="text-xs text-stone-500">{request.returned_quantity ?? request.quantity}/{request.quantity} • {RETURN_CONDITION_LABELS[request.return_condition] || request.return_condition}</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-4"><div className="flex flex-wrap gap-2">{actionButtons(request)}</div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
          )}
          <Pagination page={requestPage} totalPages={Math.max(1, Math.ceil(filteredRequests.length / pageSize))} onPageChange={setRequestPage} />
        </section>
      ) : null}

      {tab === "calendar" ? (
        <section className="space-y-5">
          <div>
            <h2 className="text-xl font-bold text-[var(--brand-900)]">Reservation calendar</h2>
            <p className="mt-1 text-sm text-stone-500">Approved and currently used resources are grouped by borrowing start date. This is an operational view, not a replacement for the availability check on approval.</p>
          </div>
          {!Object.keys(calendarGroups).length ? (
            <EmptyState title="No active reservations" description="Approved reservations and currently borrowed resources will appear here." />
          ) : paginatedCalendarEntries.map(([day, dayRequests]) => (
            <Card key={day}>
              <div className="mb-4 flex items-center gap-3">
                <CalendarDays className="h-5 w-5 text-[var(--brand-600)]" />
                <h3 className="font-bold text-[var(--brand-900)]">{day}</h3>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {dayRequests.map((request) => {
                  const meta = requestStatus(request);
                  return (
                    <div key={request.id} className={`rounded-2xl border p-4 ${request.isLate ? "border-rose-200 bg-rose-50" : "border-stone-200"}`}>
                      <div className="flex items-start justify-between gap-2"><p className="font-semibold text-[var(--brand-900)]">{request.asset?.name}</p><Badge tone={meta.tone}>{meta.label}</Badge></div>
                      <p className="mt-2 text-sm text-stone-600">{request.resident?.full_name || "Resident"}</p>
                      <p className="mt-1 text-xs text-stone-500">{formatDateTime(request.start_at)} → {formatDateTime(request.due_at)}</p>
                      {!isFacility(request.asset) ? <p className="mt-2 text-xs font-semibold text-[var(--brand-700)]">Quantity: {request.quantity}</p> : null}
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
          <Pagination page={calendarPage} totalPages={Math.max(1, Math.ceil(calendarEntries.length / calendarPageSize))} onPageChange={setCalendarPage} />
        </section>
      ) : null}

      {tab === "inventory" ? (
        <section className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-[var(--brand-900)]">Borrowable inventory</h2>
              <p className="mt-1 text-sm text-stone-500">Deactivate a resource to stop new requests without deleting its borrowing history.</p>
            </div>
            <Button onClick={() => setAssetModal({ ...blankAsset })}><Plus className="h-4 w-4" /> Add Resource</Button>
          </div>
          {!assets.length ? <EmptyState title="No resources configured" description="Add a facility or item residents can request to borrow." /> : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {paginatedAssets.map((asset) => (
                <Card key={asset.id}>
                  <div className="flex justify-between gap-2"><PackageCheck className="h-5 w-5 text-[var(--brand-600)]" /><Badge tone={asset.is_active ? "success" : "danger"}>{asset.is_active ? "Active" : "Inactive"}</Badge></div>
                  <h3 className="mt-3 font-bold text-[var(--brand-900)]">{asset.name}</h3>
                  <p className="mt-1 text-xs uppercase tracking-wider text-stone-400">{asset.category} • {asset.category === "facility" ? "Whole facility" : `Qty ${asset.total_quantity}`}</p>
                  <p className="mt-3 min-h-10 text-sm text-stone-500">{asset.description || "No description provided."}</p>
                  <Button className="mt-4" variant="secondary" onClick={() => setAssetModal({ ...asset, totalQuantity: asset.total_quantity, isActive: asset.is_active })}><Pencil className="h-4 w-4" /> Edit</Button>
                </Card>
              ))}
            </div>
          )}
          <Pagination page={assetPage} totalPages={Math.max(1, Math.ceil(assets.length / pageSize))} onPageChange={setAssetPage} />
        </section>
      ) : null}

      <Modal open={Boolean(assetModal)} onClose={() => !saving && setAssetModal(null)} title={assetModal?.id ? "Edit borrowable resource" : "Add borrowable resource"} description="Facilities are reserved as a whole resource; equipment and items can have multiple units." widthClass="max-w-xl">
        {assetModal ? (
          <form className="space-y-4" onSubmit={saveAsset}>
            <TextInput label="Resource Name *" value={assetModal.name} maxLength={120} onChange={(event) => setAssetModal((current) => ({ ...current, name: event.target.value }))} required />
            <SelectInput label="Category *" value={assetModal.category} onChange={(event) => setAssetModal((current) => ({ ...current, category: event.target.value, totalQuantity: event.target.value === "facility" ? 1 : Math.max(1, Number(current.totalQuantity) || 1) }))}>
              <option value="facility">Facility</option>
              <option value="item">Equipment / Item</option>
            </SelectInput>
            {assetModal.category === "item" ? (
              <TextInput label="Total Quantity *" type="number" min="1" step="1" inputMode="numeric" value={assetModal.totalQuantity} onChange={(event) => setAssetModal((current) => ({ ...current, totalQuantity: event.target.value }))} required />
            ) : (
              <div className="rounded-2xl bg-stone-50 p-4 text-sm text-stone-600"><strong>Facility quantity:</strong> 1 whole facility. Availability is controlled by schedule reservations.</div>
            )}
            <TextArea label="Description" value={assetModal.description || ""} maxLength={500} onChange={(event) => setAssetModal((current) => ({ ...current, description: event.target.value }))} />
            <label className="flex items-center gap-3 rounded-2xl border border-stone-200 p-4 text-sm font-medium text-stone-700"><input type="checkbox" checked={assetModal.isActive} onChange={(event) => setAssetModal((current) => ({ ...current, isActive: event.target.checked }))} /> Available for new requests</label>
            <div className="flex gap-3"><Button type="submit" loading={saving}>Save Resource</Button><Button type="button" variant="ghost" disabled={saving} onClick={() => setAssetModal(null)}>Cancel</Button></div>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(requestAction)}
        onClose={() => !saving && setRequestAction(null)}
        title={requestAction ? `${requestAction.nextStatus === "returned" && !isFacility(requestAction.request.asset) ? "Return inspection" : "Confirm request update"}` : "Update borrowing request"}
        description={requestAction ? `${requestAction.request.resident?.full_name || "Resident"} • ${requestAction.request.asset?.name || "Resource"}` : ""}
        widthClass="max-w-xl"
      >
        {requestAction ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-stone-50 p-4 text-sm text-stone-600">
              Current status: <strong>{getBorrowingStatusMeta(requestAction.request.status, requestAction.request.isLate).label}</strong><br />
              Next action: <strong>{requestAction.nextStatus === "borrowed" ? (isFacility(requestAction.request.asset) ? "Mark facility in use" : "Release resource") : requestAction.nextStatus === "returned" ? (isFacility(requestAction.request.asset) ? "Complete facility use" : "Record return") : getBorrowingStatusMeta(requestAction.nextStatus).label}</strong>
            </div>

            {requestAction.nextStatus === "returned" && !isFacility(requestAction.request.asset) ? (
              <div className="space-y-4 rounded-3xl border border-stone-200 p-4">
                <div className="flex items-center gap-2"><TriangleAlert className="h-4 w-4 text-amber-600" /><h4 className="font-semibold text-stone-800">Inspect returned items before completing</h4></div>
                <TextInput label={`Returned Quantity * — ${requestAction.request.quantity} released`} type="number" min="0" max={requestAction.request.quantity} step="1" inputMode="numeric" value={inspection.returnedQuantity} onChange={(event) => setInspection((current) => ({ ...current, returnedQuantity: event.target.value }))} />
                <SelectInput label="Return Condition *" value={inspection.returnCondition} onChange={(event) => setInspection((current) => ({ ...current, returnCondition: event.target.value }))}>
                  {Object.entries(RETURN_CONDITION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </SelectInput>
                <TextArea label="Return Inspection Note" value={inspection.returnNote} maxLength={500} onChange={(event) => setInspection((current) => ({ ...current, returnNote: event.target.value }))} placeholder="Required if items are missing or damaged. Example: 2 chairs returned with cracked backrests." />
              </div>
            ) : null}

            <TextArea
              label={requestAction.nextStatus === "rejected" ? "Reason for Rejection *" : "Admin Note"}
              value={adminNote}
              maxLength={500}
              onChange={(event) => setAdminNote(event.target.value)}
              placeholder={requestAction.nextStatus === "rejected" ? "Explain why the request cannot be approved..." : "Optional note visible to the resident..."}
            />

            {requestAction.nextStatus === "approved" ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><Clock3 className="mr-2 inline h-4 w-4" />Approval checks schedule availability again before reserving the resource.</div>
            ) : null}

            <div className="flex gap-3">
              <Button variant={requestAction.nextStatus === "rejected" ? "danger" : "primary"} onClick={updateRequest} loading={saving}>
                {requestAction.nextStatus === "returned" && !isFacility(requestAction.request.asset) ? "Confirm Return Inspection" : `Confirm ${getBorrowingStatusMeta(requestAction.nextStatus).label}`}
              </Button>
              <Button variant="ghost" disabled={saving} onClick={() => setRequestAction(null)}>Cancel</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
};

export default Admin_Borrowing;

