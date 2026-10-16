import { RefreshCw, ShieldCheck, UserPlus, Mail } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, ConfirmDialog, ErrorState, LoadingState, Modal, PageHeader, Pagination, TableShell, TextInput } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { formatDate } from "../../lib/format";
import { api } from "../../lib/api";

const emptyForm = { fullName: "", email: "", contactNumber: "" };
const PAGE_SIZE = 10;
const Admin_UserMaintenance = () => {
  const { token, user } = useAuth();
  const toast = useToast();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [pending, setPending] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!token) return;
    setLoading(true); setError("");
    try { const data = await api("/super-admin/users", { token }); setAccounts(data.users || []); }
    catch (err) { setError(err.message || "Unable to load administrator accounts."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [token]);
  useEffect(() => { setPage(1); }, [search]);
  const filtered = useMemo(() => accounts.filter((entry) =>
    [entry.fullName, entry.username, entry.email].some((value) => `${value || ""}`.toLowerCase().includes(search.trim().toLowerCase()))
  ), [accounts, search]);

  const confirmCreate = (event) => {
    event.preventDefault();
    if (form.fullName.trim().split(/\s+/).length < 2 || !form.email.trim()) return toast.error("Enter a complete name and email address.");
    setShowForm(false);
    setPending({ type: "create" });
  };
  const confirmResend = (entry) => setPending({ type: "resend", entry });
  const perform = async () => {
    if (!pending || saving) return;
    setSaving(true);
    try {
      const result = pending.type === "create"
        ? await api("/super-admin/users", { method: "POST", token, body: { ...form, role: "admin" } })
        : await api(`/super-admin/users/${pending.entry.id}/resend-invitation`, { method: "POST", token });
      toast[result.deliveryStatus === "sent" ? "success" : "info"](result.message);
      setPending(null);
      if (pending.type === "create") { setShowForm(false); setForm(emptyForm); }
      await load();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };
  if (user?.role !== "super_admin") return <ErrorState description="Only a Super Admin can create administrator accounts." />;
  return <div className="space-y-8">
    <PageHeader eyebrow="Super Admin" title="Admin Accounts" description="Invite new administrators. All other administrative tools are shared with existing Admin accounts." actions={<>
      <Button variant="secondary" onClick={load} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>
      <Button onClick={() => { setForm(emptyForm); setShowForm(true); }}><UserPlus className="h-4 w-4" /> Create Admin</Button>
    </>} />
    <Card className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-lg font-bold text-[var(--brand-900)]">Administrators</h2><p className="text-sm text-stone-500">Invitations do not grant access until the recipient sets a password.</p></div>
        <div className="w-full sm:max-w-xs"><TextInput label="Search accounts" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email or username" /></div>
      </div>
      {error ? <ErrorState description={error} onRetry={load} /> : null}
      {loading && !accounts.length ? <LoadingState rows={4} /> : null}
      {!error && <><TableShell><table className="min-w-full text-sm"><thead className="bg-stone-50 text-left text-stone-500"><tr><th className="px-4 py-3">Administrator</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Created</th><th className="px-4 py-3">Action</th></tr></thead><tbody>
      {filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((entry) => {
        const invitation = entry.invitation;
        const pendingInvite = !entry.isActive && entry.status === "pending" && Boolean(invitation);
        const expired = pendingInvite && new Date(invitation.expires_at).getTime() < Date.now();
        const label = entry.isActive ? "Active" : pendingInvite ? expired ? "Invitation expired" : invitation.delivery_status === "delivery_failed" ? "Email failed" : "Invitation pending" : "Inactive";
        return <tr className="border-t border-stone-100" key={entry.id}><td className="px-4 py-4"><p className="font-semibold">{entry.fullName || "Administrator"}</p><p className="text-stone-500">{entry.email}</p><p className="text-xs text-stone-400">@{entry.username}</p></td><td className="px-4 py-4">Admin</td><td className="px-4 py-4"><Badge tone={entry.isActive ? "success" : "warning"}>{label}</Badge></td><td className="px-4 py-4 text-stone-500">{formatDate(entry.createdAt)}</td><td className="px-4 py-4">{pendingInvite ? <Button variant="secondary" onClick={() => confirmResend(entry)}><Mail className="h-4 w-4"/> Resend Invitation</Button> : <span className="text-stone-400">—</span>}</td></tr>;
      })}
      {!filtered.length && !loading ? <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">No administrators match your search.</td></tr> : null}
      </tbody></table></TableShell>
      <Pagination page={page} totalPages={Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))} onPageChange={setPage} /></>}
    </Card>
    <Modal open={showForm} onClose={() => !saving && setShowForm(false)} title="Create Admin Invitation" description="An invitation will be emailed through Resend. The role is fixed as Admin.">
      <form onSubmit={confirmCreate} className="space-y-4">
        <TextInput label="Full Name" required maxLength={120} value={form.fullName} onChange={(event) => setForm((old) => ({ ...old, fullName: event.target.value }))} placeholder="First name and last name" />
        <TextInput label="Email Address" required type="email" maxLength={180} value={form.email} onChange={(event) => setForm((old) => ({ ...old, email: event.target.value }))} placeholder="admin@example.com" />
        <TextInput label="Contact Number (optional)" value={form.contactNumber} onChange={(event) => setForm((old) => ({ ...old, contactNumber: event.target.value }))} placeholder="09XXXXXXXXX" />
        <div className="rounded-2xl bg-stone-50 p-4"><div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4"/> Role: Admin</div><p className="mt-2 text-sm text-stone-500">Only an Admin account may be invited here. The account stays inactive until accepted.</p></div>
        <div className="flex justify-end gap-3"><Button variant="ghost" type="button" onClick={() => setShowForm(false)}>Cancel</Button><Button type="submit"><Mail className="h-4 w-4"/> Review Invitation</Button></div>
      </form>
    </Modal>
    <ConfirmDialog open={Boolean(pending)} onClose={() => { if (!saving) { if (pending?.type === "create") setShowForm(true); setPending(null); } }} onConfirm={perform} loading={saving}
      title={pending?.type === "create" ? "Invite this administrator?" : "Resend this invitation?"}
      description={pending?.type === "create" ? `An Admin invitation will be sent to ${form.email}. The account cannot log in until password setup.` : `A new one-time invitation link will be sent to ${pending?.entry?.email}. The previous link will stop working.`}
      confirmLabel={pending?.type === "create" ? "Create & Send Invitation" : "Resend Invitation"} />
  </div>;
};
export default Admin_UserMaintenance;
