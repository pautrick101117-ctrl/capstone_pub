import { Copy, Eye, KeyRound, Mail, Pencil, Power, Printer, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Card, Modal, PageHeader, Pagination, SelectInput, TableShell, TextInput } from "../../components/ui";
import { formatDate } from "../../lib/format";
import { useMasterData } from "../../hooks/useMasterData";

const pageSize = 8;

const initialForm = {
  fullName: "",
  address: "",
  purok: "",
  phoneNumber: "",
  email: "",
  birthdate: "",
};

const escapeHtml = (value = "") =>
  `${value ?? ""}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const Admin_Residents = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [page, setPage] = useState(1);
  const [confirmAction, setConfirmAction] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [credentialResult, setCredentialResult] = useState(null);
  const [retryingEmail, setRetryingEmail] = useState(false);
  const [selectedResident, setSelectedResident] = useState(null);
  const [editResident, setEditResident] = useState(null);
  const { options: purokOptions } = useMasterData("purok");

  const load = async () => {
    const data = await api("/admin/users", { token });
    setUsers(data.users || []);
  };

  useEffect(() => {
    if (token) load();
  }, [token]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const residents = useMemo(
    () =>
      users
        .filter((user) => user.role === "resident")
        .filter((user) => {
          const searchable = [
            user.fullName,
            user.username,
            user.email,
            user.contactNumber,
            user.address,
            user.purok,
            user.birthdate,
            user.isActive ? "active" : "inactive",
            user.mustChangePassword ? "must change password" : "password updated",
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return searchable.includes(search.trim().toLowerCase());
        }),
    [users, search]
  );

  const paginatedResidents = useMemo(
    () => residents.slice((page - 1) * pageSize, page * pageSize),
    [residents, page]
  );

  const createResident = async (event) => {
    event.preventDefault();

    if (!form.email.trim()) {
      toast.error("Email is required for resident accounts.");
      return;
    }

    setSaving(true);
    try {
      const data = await api("/admin/users", {
        method: "POST",
        token,
        body: form,
      });
      setCredentialResult({ ...data, action: "created" });
      toast.success("Resident account created. Temporary login details were emailed successfully.");
      setForm(initialForm);
      setShowCreateModal(false);
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const copyText = async (text, successMessage) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(successMessage);
    } catch {
      toast.error("Could not copy automatically. Please select and copy it manually.");
    }
  };

  const retryCredentialEmail = async () => {
    if (!credentialResult?.user?.id || !credentialResult?.temporaryPassword) return;
    setRetryingEmail(true);
    try {
      const data = await api(`/admin/users/${credentialResult.user.id}/resend-temporary-password`, {
        method: "POST",
        token,
        body: { temporaryPassword: credentialResult.temporaryPassword },
      });
      setCredentialResult((current) => ({ ...current, emailDelivery: data.emailDelivery }));
      if (data.emailDelivery?.delivered) toast.success(data.message);
      else toast.info(data.message);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setRetryingEmail(false);
    }
  };

  const runConfirmedAction = async () => {
    if (!confirmAction) return;
    const { type, resident } = confirmAction;
    setActionLoading(true);
    try {
      if (type === "reset") {
        const data = await api(`/admin/users/${resident.id}/reset-password`, { method: "POST", token });
        setCredentialResult({ ...data, action: "reset", user: data.user || resident });
        if (data.emailDelivery?.delivered) toast.success(data.message);
        else toast.info(data.message);
      } else {
        const isActive = type === "activate";
        await api(`/admin/users/${resident.id}`, { method: "PATCH", token, body: { isActive } });
        toast.success(
          isActive
            ? `${resident.fullName} has been activated and can sign in again.`
            : `${resident.fullName} has been deactivated and can no longer sign in.`
        );
      }
      setConfirmAction(null);
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setActionLoading(false);
    }
  };


  const openEditResident = (resident) => {
    setEditResident({
      id: resident.id,
      fullName: resident.fullName || "",
      birthdate: resident.birthdate || "",
      address: resident.address || "",
      purok: resident.purok || "",
      contactNumber: resident.contactNumber || "",
      email: resident.email || "",
    });
  };

  const saveResidentEdit = async (event) => {
    event.preventDefault();
    if (!editResident) return;
    setSaving(true);
    try {
      const data = await api(`/admin/users/${editResident.id}`, {
        method: "PATCH",
        token,
        body: {
          fullName: editResident.fullName,
          birthdate: editResident.birthdate,
          address: editResident.address,
          purok: editResident.purok,
          contactNumber: editResident.contactNumber,
          email: editResident.email,
        },
      });
      toast.success("Resident information updated.");
      setEditResident(null);
      setSelectedResident((current) => current?.id === data.user?.id ? data.user : current);
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const printResidents = () => {
    if (!residents.length) {
      toast.error("No residents to print.");
      return;
    }

    const rows = residents
      .map(
        (resident, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>
              <strong>${escapeHtml(resident.fullName || "Unnamed resident")}</strong><br />
              <span>${escapeHtml(resident.username || "")}</span>
            </td>
            <td>${escapeHtml(resident.birthdate ? formatDate(resident.birthdate) : "Not set")}</td>
            <td>${escapeHtml(resident.address || "")}</td>
            <td>${escapeHtml(resident.purok || "")}</td>
            <td>${escapeHtml(resident.contactNumber || "")}</td>
            <td>${escapeHtml(resident.email || "")}</td>
            <td>${escapeHtml(resident.isActive ? "Active" : "Inactive")}</td>
          </tr>
        `
      )
      .join("");

    const printWindow = window.open("", "_blank", "width=1100,height=760");
    if (!printWindow) {
      toast.error("Print window was blocked by the browser.");
      return;
    }

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Resident Directory</title>
          <style>
            body { font-family: Arial, sans-serif; color: #1f2933; margin: 28px; }
            header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
            h1 { margin: 0; color: #174d25; font-size: 24px; }
            p { margin: 4px 0 0; color: #64748b; font-size: 12px; }
            table { border-collapse: collapse; width: 100%; font-size: 11px; }
            th, td { border: 1px solid #d8dee4; padding: 8px; text-align: left; vertical-align: top; }
            th { background: #eaf4ea; color: #174d25; }
            tr:nth-child(even) { background: #f8faf8; }
            @media print { body { margin: 16px; } }
          </style>
        </head>
        <body>
          <header>
            <div>
              <h1>Barangay Iba Resident Directory</h1>
              <p>${escapeHtml(search ? `Filtered by: ${search}` : "All residents")} | ${residents.length} record${residents.length === 1 ? "" : "s"}</p>
              <p>Printed ${escapeHtml(new Date().toLocaleString("en-PH"))}</p>
            </div>
          </header>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Resident</th>
                <th>Birthdate</th>
                <th>Address</th>
                <th>Purok</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <script>
            window.addEventListener("load", () => {
              window.print();
              window.setTimeout(() => window.close(), 300);
            });
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Resident Management"
        title="Create and maintain resident accounts"
        description="Resident signup is admin-only. Create usernames, issue temporary passwords, and manage active status without deleting data."
        actions={
          <>
            <Button variant="secondary" onClick={printResidents}>
              <Printer className="h-4 w-4" />
              Print Residents
            </Button>
            <Button onClick={() => setShowCreateModal(true)}>
              <UserPlus className="h-4 w-4" />
              Create Resident
            </Button>
          </>
        }
      />

      <Card>
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-[var(--brand-900)]">Resident Directory</h2>
            <p className="mt-1 text-sm text-stone-500">Search by name, username, address, purok, contact, email, or status.</p>
          </div>
          <TextInput label="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>

        <TableShell>
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-stone-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Resident</th>
                <th className="px-4 py-3 font-semibold">Username</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Purok</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Updated</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedResidents.map((resident) => (
                <tr key={resident.id} className="border-t border-stone-100 align-top transition hover:bg-stone-50/70">
                  <td className="px-4 py-4">
                    <p className="font-semibold text-[var(--brand-900)]">{resident.fullName}</p>
                    <p className="mt-1 text-xs text-stone-500">{resident.address} - {resident.purok}</p>
                  </td>
                  <td className="px-4 py-4 text-stone-600">{resident.username}</td>
                  <td className="px-4 py-4 text-stone-600">
                    <p>{resident.contactNumber || "Not set"}</p>
                    <p className="mt-1 text-xs text-stone-500">{resident.email || "No email"}</p>
                  </td>
                  <td className="px-4 py-4 text-stone-600">{resident.purok || "Not set"}</td>
                  <td className="px-4 py-4">
                    <div className="space-y-2">
                      <Badge tone={resident.isActive ? "success" : "danger"}>{resident.isActive ? "Active" : "Inactive"}</Badge>
                      <Badge tone={resident.mustChangePassword ? "warning" : "info"}>
                        {resident.mustChangePassword ? "Must change password" : "Password updated"}
                      </Badge>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-stone-600">{formatDate(resident.updatedAt || resident.createdAt)}</td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => setSelectedResident(resident)}><Eye className="h-4 w-4" /> View</Button>
                      <Button variant="secondary" onClick={() => openEditResident(resident)}><Pencil className="h-4 w-4" /> Edit</Button>
                      <Button variant="ghost" onClick={() => setConfirmAction({ type: "reset", resident })}><KeyRound className="h-4 w-4" /> Reset</Button>
                      <Button variant={resident.isActive ? "danger" : "primary"} onClick={() => setConfirmAction({ type: resident.isActive ? "deactivate" : "activate", resident })}><Power className="h-4 w-4" /> {resident.isActive ? "Deactivate" : "Activate"}</Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!paginatedResidents.length ? (
                <tr>
                  <td className="px-4 py-8 text-center text-sm text-stone-500" colSpan={7}>
                    No residents match the current search.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableShell>
        <Pagination page={page} totalPages={Math.max(1, Math.ceil(residents.length / pageSize))} onPageChange={setPage} />
      </Card>

      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Resident Account"
        description="Enter the required resident details. Username and temporary password will be generated automatically."
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={createResident}>
          <TextInput label="Full Name" required autoComplete="name" maxLength={120} value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} />
          <TextInput label="Birthdate" required type="date" max={(() => { const d = new Date(); d.setFullYear(d.getFullYear() - 18); return d.toISOString().slice(0, 10); })()} hint="Resident must be at least 18 years old." value={form.birthdate} onChange={(event) => setForm((current) => ({ ...current, birthdate: event.target.value }))} />
          <TextInput label="Address" required autoComplete="street-address" maxLength={180} className="sm:col-span-2" value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} />
          <SelectInput label="Purok" required value={form.purok} onChange={(event) => setForm((current) => ({ ...current, purok: event.target.value }))}>
            <option value="">Select Purok</option>
            {purokOptions.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}
          </SelectInput>
          <TextInput label="Phone Number" required type="tel" inputMode="tel" autoComplete="tel" maxLength={20} placeholder="09XX XXX XXXX" value={form.phoneNumber} onChange={(event) => setForm((current) => ({ ...current, phoneNumber: event.target.value }))} />
          <TextInput label="Email" required type="email" autoComplete="email" maxLength={180} className="sm:col-span-2" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
          <div className="sm:col-span-2 flex gap-3">
            <Button type="submit" loading={saving}>
              Create Account
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(selectedResident)} onClose={() => setSelectedResident(null)} title={selectedResident?.fullName || "Resident Profile"} description="Resident record and account information." widthClass="max-w-3xl">
        {selectedResident ? <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["Full Name", selectedResident.fullName], ["Username", selectedResident.username],
              ["Birthdate", selectedResident.birthdate ? formatDate(selectedResident.birthdate) : "Not set"], ["Purok", selectedResident.purok || "Not set"],
              ["Address", selectedResident.address || "Not set"], ["Contact", selectedResident.contactNumber || "Not set"],
              ["Email", selectedResident.email || "Not set"], ["Created", formatDate(selectedResident.createdAt)],
              ["Last Updated", formatDate(selectedResident.updatedAt || selectedResident.createdAt)], ["Account", selectedResident.isActive ? "Active" : "Inactive"],
            ].map(([label, value]) => <div key={label} className="rounded-2xl bg-stone-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-stone-400">{label}</p><p className="mt-2 text-sm font-semibold text-stone-700">{value}</p></div>)}
          </div>
          <div className="flex flex-wrap gap-2"><Button onClick={() => { openEditResident(selectedResident); setSelectedResident(null); }}><Pencil className="h-4 w-4" /> Edit Resident</Button><Button variant="secondary" onClick={() => setConfirmAction({ type: "reset", resident: selectedResident })}><KeyRound className="h-4 w-4" /> Reset Password</Button></div>
        </div> : null}
      </Modal>

      <Modal open={Boolean(editResident)} onClose={() => !saving && setEditResident(null)} title="Edit Resident" description="Update resident profile information. Password changes remain a separate security action." widthClass="max-w-3xl" closeDisabled={saving}>
        {editResident ? <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveResidentEdit}>
          <TextInput label="Full Name" required value={editResident.fullName} onChange={(e) => setEditResident((v) => ({ ...v, fullName: e.target.value }))} />
          <TextInput label="Birthdate" required type="date" value={editResident.birthdate} onChange={(e) => setEditResident((v) => ({ ...v, birthdate: e.target.value }))} />
          <TextInput label="Address" required className="sm:col-span-2" value={editResident.address} onChange={(e) => setEditResident((v) => ({ ...v, address: e.target.value }))} />
          <SelectInput label="Purok" required value={editResident.purok} onChange={(e) => setEditResident((v) => ({ ...v, purok: e.target.value }))}><option value="">Select Purok</option>{purokOptions.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</SelectInput>
          <TextInput label="Contact Number" required value={editResident.contactNumber} onChange={(e) => setEditResident((v) => ({ ...v, contactNumber: e.target.value }))} />
          <TextInput label="Email" required type="email" className="sm:col-span-2" value={editResident.email} onChange={(e) => setEditResident((v) => ({ ...v, email: e.target.value }))} />
          <div className="sm:col-span-2 flex gap-3"><Button type="submit" loading={saving}>Save Changes</Button><Button type="button" variant="ghost" onClick={() => setEditResident(null)} disabled={saving}>Cancel</Button></div>
        </form> : null}
      </Modal>

      <Modal
        open={Boolean(confirmAction)}
        onClose={() => !actionLoading && setConfirmAction(null)}
        title={confirmAction?.type === "reset" ? "Confirm password reset" : confirmAction?.type === "deactivate" ? "Confirm deactivation" : "Confirm activation"}
        description={confirmAction?.resident?.fullName || "Resident account"}
        widthClass="max-w-xl"
      >
        {confirmAction ? (
          <div className="space-y-5">
            <p className="text-sm leading-6 text-stone-600">
              {confirmAction.type === "reset"
                ? "This will invalidate the resident's current password, generate a new temporary password, and require a password change on their next login. Email delivery is attempted after the reset and will stop waiting after a short timeout instead of leaving this action pending indefinitely."
                : confirmAction.type === "deactivate"
                  ? "The resident will be signed out on the next API check and will not be able to sign in while the account is inactive. Existing records are kept."
                  : "The resident will be allowed to sign in again using their existing credentials."}
            </p>
            <div className="flex gap-3">
              <Button
                variant={confirmAction.type === "activate" ? "primary" : "danger"}
                onClick={runConfirmedAction}
                loading={actionLoading}
              >
                {confirmAction.type === "reset" ? "Reset Password" : confirmAction.type === "deactivate" ? "Deactivate Account" : "Activate Account"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmAction(null)} disabled={actionLoading}>Cancel</Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(credentialResult)}
        onClose={() => setCredentialResult(null)}
        title={credentialResult?.action === "reset" ? "Password reset complete" : "Resident account created"}
        description={credentialResult?.emailDelivery?.delivered ? "Email delivery confirmed." : "Email delivery was not confirmed."}
        widthClass="max-w-xl"
      >
        {credentialResult ? (
          <div className="space-y-4">
            <div className={`rounded-2xl border p-4 text-sm ${credentialResult.emailDelivery?.delivered ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
              {credentialResult.action === "reset"
                ? (credentialResult.emailDelivery?.delivered
                    ? "The reset credentials were sent to the resident by email. For security, the temporary password is not displayed when email delivery is confirmed."
                    : "The password was reset, but email delivery was not confirmed. The temporary password is shown below only as an administrator recovery fallback, or you can retry the same email.")
                : "The resident account was created and the temporary login credentials were sent by email. For security, the temporary password is never displayed after account creation."}
            </div>
            <div className="rounded-2xl bg-stone-50 p-4 text-sm">
              <p><span className="text-stone-500">Resident email:</span> <strong>{credentialResult.user?.email || "Not set"}</strong></p>
              <p className="mt-2"><span className="text-stone-500">Username:</span> <strong>{credentialResult.user?.username || "Not set"}</strong></p>
              {credentialResult.action === "reset" && credentialResult.temporaryPassword ? <p className="mt-2 break-all"><span className="text-stone-500">Temporary password:</span> <strong>{credentialResult.temporaryPassword}</strong></p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {credentialResult.action === "reset" && credentialResult.temporaryPassword ? <Button type="button" variant="secondary" onClick={() => copyText(credentialResult.temporaryPassword, "Temporary password copied.")}><Copy className="h-4 w-4" /> Copy Password</Button> : null}
              {credentialResult.action === "reset" && credentialResult.temporaryPassword ? <Button type="button" variant="secondary" onClick={() => copyText(`Username: ${credentialResult.user?.username || ""}\nTemporary password: ${credentialResult.temporaryPassword}`, "Credentials copied.")}><Copy className="h-4 w-4" /> Copy Credentials</Button> : null}
              {!credentialResult.emailDelivery?.delivered && credentialResult.action === "reset" ? <Button type="button" variant="secondary" loading={retryingEmail} onClick={retryCredentialEmail}><Mail className="h-4 w-4" /> Retry Same Email</Button> : null}
              <Button onClick={() => setCredentialResult(null)}>Done</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
};

export default Admin_Residents;

