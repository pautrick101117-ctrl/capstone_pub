import { Check, PackageCheck, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, SelectInput, TableShell, TextArea, TextInput } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

const statusTone = { pending: "warning", approved: "info", borrowed: "info", returned: "success", rejected: "danger", cancelled: "neutral" };
const blankAsset = { name: "", category: "item", description: "", totalQuantity: 1, isActive: true };

const Admin_Borrowing = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [assets, setAssets] = useState([]);
  const [requests, setRequests] = useState([]);
  const [status, setStatus] = useState("all");
  const [assetModal, setAssetModal] = useState(null);
  const [requestAction, setRequestAction] = useState(null);
  const [adminNote, setAdminNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const [assetData, requestData] = await Promise.all([
        api("/borrowing/admin/assets", { token }),
        api(`/borrowing/admin/requests${status === "all" ? "" : `?status=${status}`}`, { token }),
      ]);
      setAssets(assetData.assets || []);
      setRequests(requestData.requests || []);
    } catch (error) { toast.error(error.message); }
  };
  useEffect(() => { if (token) load(); }, [token, status]);

  const stats = useMemo(() => ({
    pending: requests.filter((r) => r.status === "pending").length,
    active: requests.filter((r) => ["approved", "borrowed"].includes(r.status)).length,
    late: requests.filter((r) => r.isLate).length,
  }), [requests]);

  const saveAsset = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const isEdit = Boolean(assetModal.id);
      const payload = { ...assetModal, totalQuantity: Number(assetModal.totalQuantity) };
      const data = await api(isEdit ? `/borrowing/admin/assets/${assetModal.id}` : "/borrowing/admin/assets", { method: isEdit ? "PATCH" : "POST", token, body: payload });
      toast.success(data.message);
      setAssetModal(null);
      await load();
    } catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  };

  const openAction = (request, nextStatus) => {
    setRequestAction({ request, nextStatus });
    setAdminNote(request.admin_note || "");
  };

  const updateRequest = async () => {
    setSaving(true);
    try {
      const data = await api(`/borrowing/admin/requests/${requestAction.request.id}`, { method: "PATCH", token, body: { status: requestAction.nextStatus, adminNote } });
      toast.success(data.message);
      setRequestAction(null);
      setAdminNote("");
      await load();
    } catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  };

  const actionButtons = (request) => {
    if (request.status === "pending") return <><Button onClick={() => openAction(request, "approved")}><Check className="h-4 w-4" /> Approve</Button><Button variant="danger" onClick={() => openAction(request, "rejected")}><X className="h-4 w-4" /> Reject</Button></>;
    if (request.status === "approved") return <Button onClick={() => openAction(request, "borrowed")}>Mark Released</Button>;
    if (request.status === "borrowed") return <Button onClick={() => openAction(request, "returned")}><RotateCcw className="h-4 w-4" /> Mark Returned</Button>;
    return null;
  };

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Resource Management" title="Facility & item borrowing" description="Manage inventory, approve resident requests, track what is currently out, and flag late returns automatically." actions={<Button onClick={() => setAssetModal(blankAsset)}><Plus className="h-4 w-4" /> Add Resource</Button>} />
      <div className="grid gap-4 md:grid-cols-3">
        <Card><p className="text-sm text-stone-500">Pending approval</p><p className="mt-2 text-3xl font-black text-[var(--brand-900)]">{stats.pending}</p></Card>
        <Card><p className="text-sm text-stone-500">Approved / released</p><p className="mt-2 text-3xl font-black text-[var(--brand-900)]">{stats.active}</p></Card>
        <Card><p className="text-sm text-stone-500">Late returns</p><p className="mt-2 text-3xl font-black text-rose-700">{stats.late}</p></Card>
      </div>

      <Card>
        <div className="mb-5 flex items-center justify-between gap-4"><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Borrowable inventory</h2><p className="mt-1 text-sm text-stone-500">Deactivate a resource to hide it from new resident requests without deleting history.</p></div></div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{assets.map((asset) => <div key={asset.id} className="rounded-2xl border border-stone-200 p-4"><div className="flex justify-between gap-2"><PackageCheck className="h-5 w-5 text-[var(--brand-600)]" /><Badge tone={asset.is_active ? "success" : "danger"}>{asset.is_active ? "Active" : "Inactive"}</Badge></div><h3 className="mt-3 font-bold text-[var(--brand-900)]">{asset.name}</h3><p className="mt-1 text-xs uppercase tracking-wider text-stone-400">{asset.category} • Qty {asset.total_quantity}</p><p className="mt-3 line-clamp-2 text-sm text-stone-500">{asset.description}</p><Button className="mt-4" variant="secondary" onClick={() => setAssetModal({ ...asset, totalQuantity: asset.total_quantity, isActive: asset.is_active })}><Pencil className="h-4 w-4" /> Edit</Button></div>)}</div>
      </Card>

      <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Borrowing requests</h2><p className="mt-1 text-sm text-stone-500">The due date determines the automatic late-return flag.</p></div><SelectInput label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="borrowed">Borrowed</option><option value="returned">Returned</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></SelectInput></div>
      {requests.length === 0 ? <EmptyState title="No borrowing requests" description="Resident requests will appear here." /> : <TableShell><table className="min-w-full text-sm"><thead className="bg-stone-50 text-left text-stone-500"><tr><th className="px-4 py-3">Resident</th><th className="px-4 py-3">Resource</th><th className="px-4 py-3">Schedule</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id} className="border-t border-stone-100 align-top"><td className="px-4 py-4"><p className="font-semibold text-[var(--brand-900)]">{request.resident?.full_name || `${request.resident?.first_name || "Resident"} ${request.resident?.last_name || ""}`}</p><p className="mt-1 text-xs text-stone-500">{request.resident?.purok || ""} {request.resident?.contact_number || ""}</p></td><td className="px-4 py-4"><p className="font-semibold">{request.asset?.name || "Resource"} × {request.quantity}</p><p className="mt-1 max-w-xs text-xs text-stone-500">{request.purpose}</p></td><td className="px-4 py-4 text-stone-600"><p>{formatDateTime(request.start_at)}</p><p className="mt-1">Return: {formatDateTime(request.due_at)}</p></td><td className="px-4 py-4"><div className="flex flex-col items-start gap-2"><Badge tone={statusTone[request.status] || "neutral"}>{request.status}</Badge>{request.isLate ? <Badge tone="danger">Late return</Badge> : null}</div></td><td className="px-4 py-4"><div className="flex flex-wrap gap-2">{actionButtons(request)}</div></td></tr>)}</tbody></table></TableShell>}

      <Modal open={Boolean(assetModal)} onClose={() => setAssetModal(null)} title={assetModal?.id ? "Edit borrowable resource" : "Add borrowable resource"} widthClass="max-w-xl">
        {assetModal ? <form className="space-y-4" onSubmit={saveAsset}><TextInput label="Name" value={assetModal.name} onChange={(e) => setAssetModal((v) => ({ ...v, name: e.target.value }))} /><SelectInput label="Category" value={assetModal.category} onChange={(e) => setAssetModal((v) => ({ ...v, category: e.target.value }))}><option value="facility">Facility</option><option value="item">Item</option></SelectInput><TextInput label="Total Quantity" type="number" min="1" value={assetModal.totalQuantity} onChange={(e) => setAssetModal((v) => ({ ...v, totalQuantity: e.target.value }))} /><TextArea label="Description" value={assetModal.description || ""} onChange={(e) => setAssetModal((v) => ({ ...v, description: e.target.value }))} /><label className="flex items-center gap-3 text-sm font-medium text-stone-700"><input type="checkbox" checked={assetModal.isActive} onChange={(e) => setAssetModal((v) => ({ ...v, isActive: e.target.checked }))} /> Available for new requests</label><div className="flex gap-3"><Button type="submit" loading={saving}>Save Resource</Button><Button type="button" variant="ghost" onClick={() => setAssetModal(null)}>Cancel</Button></div></form> : null}
      </Modal>

      <Modal open={Boolean(requestAction)} onClose={() => setRequestAction(null)} title={requestAction ? `Confirm: ${requestAction.nextStatus}` : "Update borrowing request"} description={requestAction ? `${requestAction.request.resident?.full_name || "Resident"} • ${requestAction.request.asset?.name || "Resource"}` : ""} widthClass="max-w-xl">
        {requestAction ? <div className="space-y-4"><p className="text-sm leading-6 text-stone-600">This changes the request from <strong>{requestAction.request.status}</strong> to <strong>{requestAction.nextStatus}</strong>. Approval reserves the requested quantity for its date range; returned releases it from the active/late list.</p><TextArea label="Admin Note" value={adminNote} onChange={(e) => setAdminNote(e.target.value)} placeholder="Optional note visible to the resident..." /><div className="flex gap-3"><Button variant={requestAction.nextStatus === "rejected" ? "danger" : "primary"} onClick={updateRequest} loading={saving}>Confirm {requestAction.nextStatus}</Button><Button variant="ghost" onClick={() => setRequestAction(null)}>Cancel</Button></div></div> : null}
      </Modal>
    </div>
  );
};
export default Admin_Borrowing;
