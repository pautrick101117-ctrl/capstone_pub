import { KeyRound, Power, Printer, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Card, Modal, PageHeader, Pagination, SelectInput, TableShell, TextInput } from "../../components/ui";
import { formatDate } from "../../lib/format";

const pageSize = 8;
const purokOptions = ["Purok 1", "Purok 2", "Purok 3", "Purok 4", "Purok 5", "Purok 6"];

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

  const totalPages = Math.max(1, Math.ceil(residents.length / pageSize));
  const paginatedResidents = useMemo(
    () => residents.slice((page - 1) * pageSize, page * pageSize),
    [residents, page]
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const createResident = async (event) => {
    event.preventDefault();

    if (!form.email.trim()) {
      toast.error("Email is required for resident accounts.");
      return;
    }

    setSaving(true);
    try {
      await api("/admin/users", {
        method: "POST",
        token,
        body: form,
      });
      toast.success("Resident account created. Login details were emailed to the resident.");
      setForm(initialForm);
      setShowCreateModal(false);
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const updateResident = async (residentId, updates) => {
    try {
      await api(`/admin/users/${residentId}`, { method: "PATCH", token, body: updates });
      toast.success("Resident updated.");
      await load();
    } catch (error) {
      toast.error(error.message);
    }
  };

  const resetPassword = async (residentId) => {
    try {
      await api(`/admin/users/${residentId}/reset-password`, { method: "POST", token });
      toast.success("Temporary password reset and emailed to the resident.");
    } catch (error) {
      toast.error(error.message);
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
                <th className="px-4 py-3 font-semibold">Birthdate</th>
                <th className="px-4 py-3 font-semibold">Status</th>
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
                  <td className="px-4 py-4 text-stone-600">{resident.birthdate ? formatDate(resident.birthdate) : "Not set"}</td>
                  <td className="px-4 py-4">
                    <div className="space-y-2">
                      <Badge tone={resident.isActive ? "success" : "danger"}>{resident.isActive ? "Active" : "Inactive"}</Badge>
                      <Badge tone={resident.mustChangePassword ? "warning" : "info"}>
                        {resident.mustChangePassword ? "Must change password" : "Password updated"}
                      </Badge>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => updateResident(resident.id, { isActive: !resident.isActive })}>
                        <Power className="h-4 w-4" />
                        {resident.isActive ? "Deactivate" : "Activate"}
                      </Button>
                      <Button variant="ghost" onClick={() => resetPassword(resident.id)}>
                        <KeyRound className="h-4 w-4" />
                        Reset Password
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!paginatedResidents.length ? (
                <tr>
                  <td className="px-4 py-8 text-center text-sm text-stone-500" colSpan={6}>
                    No residents match the current search.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableShell>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </Card>

      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Resident Account"
        description="Enter the required resident details. Username and temporary password will be generated automatically."
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={createResident}>
          <TextInput label="Full Name" value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} />
          <TextInput label="Birthdate" type="date" value={form.birthdate} onChange={(event) => setForm((current) => ({ ...current, birthdate: event.target.value }))} />
          <TextInput label="Address" className="sm:col-span-2" value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} />
          <SelectInput label="Purok" value={form.purok} onChange={(event) => setForm((current) => ({ ...current, purok: event.target.value }))} required>
            <option value="">Select a purok</option>
            {purokOptions.map((purok) => <option key={purok} value={purok}>{purok}</option>)}
          </SelectInput>
          <TextInput label="Phone Number" value={form.phoneNumber} onChange={(event) => setForm((current) => ({ ...current, phoneNumber: event.target.value }))} />
          <TextInput label="Email" type="email" className="sm:col-span-2" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required />
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
    </div>
  );
};

export default Admin_Residents;
