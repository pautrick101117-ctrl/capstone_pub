import { KeyRound, Power, RefreshCw, ShieldCheck, UserPlus, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Modal, PageHeader, StatCard, TableShell, TextInput } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { formatDate } from "../../lib/format";
import { api } from "../../lib/api";

const initialForm = {
  fullName: "",
  email: "",
  contactNumber: "",
  role: "admin",
};

const Admin_UserMaintenance = () => {
  const { token, user } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [activeFilter, setActiveFilter] = useState("all");
  const [form, setForm] = useState(initialForm);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [credential, setCredential] = useState(null);

  const loadUsers = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api("/super-admin/users", { token });
      setUsers(data.users || []);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [token]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users
      .filter((account) => roleFilter === "all" || account.role === roleFilter)
      .filter((account) => activeFilter === "all" || String(account.isActive) === activeFilter)
      .filter((account) => {
        if (!term) return true;
        return [account.fullName, account.username, account.email, account.role]
          .filter(Boolean)
          .some((value) => `${value}`.toLowerCase().includes(term));
      });
  }, [users, search, roleFilter, activeFilter]);

  const counts = useMemo(
    () => ({
      total: users.length,
      admins: users.filter((account) => account.role === "admin").length,
      superAdmins: users.filter((account) => account.role === "super_admin").length,
      inactive: users.filter((account) => !account.isActive).length,
    }),
    [users]
  );

  const createUser = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const data = await api("/super-admin/users", {
        method: "POST",
        token,
        body: form,
      });
      setCredential({
        title: "Admin account created",
        fullName: data.user.fullName,
        email: data.user.email,
        username: data.user.username,
        temporaryPassword: data.temporaryPassword,
      });
      setForm(initialForm);
      setShowCreateModal(false);
      toast.success("Admin account created.");
      await loadUsers();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const updateUser = async (account, updates) => {
    try {
      await api(`/super-admin/users/${account.id}`, {
        method: "PATCH",
        token,
        body: updates,
      });
      toast.success("User account updated.");
      await loadUsers();
    } catch (error) {
      toast.error(error.message);
    }
  };

  const resetPassword = async (account) => {
    try {
      const data = await api(`/super-admin/users/${account.id}/reset-password`, {
        method: "POST",
        token,
      });
      setCredential({
        title: "Temporary password reset",
        fullName: data.user.fullName,
        email: data.user.email,
        username: data.user.username,
        temporaryPassword: data.temporaryPassword,
      });
      toast.success("Temporary password generated.");
      await loadUsers();
    } catch (error) {
      toast.error(error.message);
    }
  };

  const copyCredential = async () => {
    if (!credential) return;
    try {
      await navigator.clipboard.writeText(
        `Name: ${credential.fullName}\nEmail: ${credential.email}\nUsername: ${credential.username}\nTemporary password: ${credential.temporaryPassword}`
      );
      toast.success("Credentials copied.");
    } catch {
      toast.error("Unable to copy credentials.");
    }
  };

  if (user?.role !== "super_admin") {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Restricted"
          title="User maintenance"
          description="Only super admin accounts can open this maintenance area."
        />
        <Card>
          <p className="text-sm text-stone-600">Your current account does not have access to user maintenance.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Super Admin"
        title="User maintenance"
        description="Manage admin access, account status, password resets, and user role levels from one place."
        actions={
          <>
            <Button variant="secondary" onClick={loadUsers} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button onClick={() => setShowCreateModal(true)}>
              <UserPlus className="h-4 w-4" />
              Add Admin
            </Button>
          </>
        }
      />

      <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-4">
        <StatCard icon={Users} label="Total Users" value={counts.total} />
        <StatCard icon={ShieldCheck} label="Super Admins" value={counts.superAdmins} />
        <StatCard icon={UserPlus} label="Admins" value={counts.admins} />
        <StatCard icon={Power} label="Inactive" value={counts.inactive} />
      </div>

      <Card>
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-xl font-bold text-[var(--brand-900)]">Accounts</h2>
            <p className="mt-1 text-sm text-stone-500">Search and update access for resident, admin, and super admin accounts.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[720px]">
            <TextInput label="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
            <label className="flex flex-col gap-2 text-sm font-medium text-stone-700">
              <span>Role</span>
              <select
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value)}
                className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--brand-400)] focus:ring-4 focus:ring-[var(--brand-100)]"
              >
                <option value="all">All roles</option>
                <option value="resident">Resident</option>
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-stone-700">
              <span>Status</span>
              <select
                value={activeFilter}
                onChange={(event) => setActiveFilter(event.target.value)}
                className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--brand-400)] focus:ring-4 focus:ring-[var(--brand-100)]"
              >
                <option value="all">All statuses</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
          </div>
        </div>

        <TableShell>
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-stone-500">
              <tr>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Created</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((account) => {
                const isSelf = account.id === user.id;
                return (
                  <tr key={account.id} className="border-t border-stone-100 align-top transition hover:bg-stone-50/70">
                    <td className="px-4 py-4">
                      <p className="font-semibold text-[var(--brand-900)]">{account.fullName || "Unnamed user"}</p>
                      <p className="mt-1 text-xs text-stone-500">{account.email || "No email"}</p>
                      <p className="mt-1 text-xs text-stone-500">@{account.username || "not-set"}</p>
                    </td>
                    <td className="px-4 py-4">
                      <select
                        value={account.role}
                        disabled={isSelf}
                        onChange={(event) => updateUser(account, { role: event.target.value })}
                        className="rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition disabled:bg-stone-100 disabled:text-stone-500 focus:border-[var(--brand-400)] focus:ring-4 focus:ring-[var(--brand-100)]"
                      >
                        <option value="resident">Resident</option>
                        <option value="admin">Admin</option>
                        <option value="super_admin">Super Admin</option>
                      </select>
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-2">
                        <Badge tone={account.isActive ? "success" : "danger"}>{account.isActive ? "Active" : "Inactive"}</Badge>
                        <Badge tone={account.mustChangePassword ? "warning" : "info"}>
                          {account.mustChangePassword ? "Password change required" : "Password updated"}
                        </Badge>
                        {isSelf ? <Badge tone="neutral">Current user</Badge> : null}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-stone-600">{formatDate(account.createdAt)}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant={account.isActive ? "secondary" : "primary"}
                          onClick={() => updateUser(account, { isActive: !account.isActive })}
                          disabled={isSelf}
                        >
                          <Power className="h-4 w-4" />
                          {account.isActive ? "Deactivate" : "Activate"}
                        </Button>
                        <Button variant="ghost" onClick={() => updateUser(account, { mustChangePassword: !account.mustChangePassword })} disabled={isSelf}>
                          <RefreshCw className="h-4 w-4" />
                          {account.mustChangePassword ? "Clear Flag" : "Require Change"}
                        </Button>
                        <Button variant="ghost" onClick={() => resetPassword(account)}>
                          <KeyRound className="h-4 w-4" />
                          Reset
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!filteredUsers.length ? (
                <tr>
                  <td className="px-4 py-8 text-center text-sm text-stone-500" colSpan={5}>
                    {loading ? "Loading accounts..." : "No user accounts match the current filters."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableShell>
      </Card>

      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Add Admin Account"
        description="Create an admin or super admin account with a generated temporary password."
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={createUser}>
          <TextInput label="Full Name" value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} />
          <TextInput label="Email" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
          <TextInput label="Contact Number" value={form.contactNumber} onChange={(event) => setForm((current) => ({ ...current, contactNumber: event.target.value }))} />
          <label className="flex flex-col gap-2 text-sm font-medium text-stone-700">
            <span>Role</span>
            <select
              value={form.role}
              onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}
              className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--brand-400)] focus:ring-4 focus:ring-[var(--brand-100)]"
            >
              <option value="admin">Admin</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </label>
          <div className="sm:col-span-2 flex flex-wrap gap-3">
            <Button type="submit" loading={saving}>
              Create Account
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(credential)}
        onClose={() => setCredential(null)}
        title={credential?.title || "Account credentials"}
        description="Give these credentials to the account owner. The account will be required to change the password after login."
        widthClass="max-w-xl"
      >
        {credential ? (
          <div className="space-y-4">
            <div className="rounded-3xl border border-stone-200 bg-stone-50 p-5 text-sm">
              <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                <span className="font-semibold text-stone-500">Name</span>
                <span className="font-semibold text-[var(--brand-900)]">{credential.fullName}</span>
                <span className="font-semibold text-stone-500">Email</span>
                <span className="text-stone-700">{credential.email}</span>
                <span className="font-semibold text-stone-500">Username</span>
                <span className="font-mono text-stone-900">{credential.username}</span>
                <span className="font-semibold text-stone-500">Temporary Password</span>
                <span className="font-mono text-stone-900">{credential.temporaryPassword}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="button" onClick={copyCredential}>
                Copy Credentials
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCredential(null)}>
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
};

export default Admin_UserMaintenance;
