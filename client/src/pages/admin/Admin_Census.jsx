import { Download, Plus, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { API_URL, api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useMasterData } from "../../hooks/useMasterData";
import { Badge, Button, Card, Modal, PageHeader, Pagination, SelectInput, TableShell, TextInput } from "../../components/ui";

const emptyForm = { householdName: "", purok: "", members: 1, houseNumber: "", status: "active" };
const pageSize = 8;

const Admin_Census = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [households, setHouseholds] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [batchLoading, setBatchLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const fileInputRef = useRef(null);
  const { options: purokOptions } = useMasterData("purok");

  const load = async () => {
    const data = await api("/admin/census_households", { token });
    setHouseholds(data.census_households || []);
  };

  useEffect(() => {
    if (token) load();
  }, [token]);

  const save = async (event) => {
    event.preventDefault();
    try {
      const members = Number(form.members);
      if (!Number.isInteger(members) || members < 1) {
        toast.error("Members must be a positive whole number.");
        return;
      }

      const data = await api("/admin/census_households", { method: "POST", token, body: { ...form, members } });
      toast.success(data.action === "updated" ? "Household updated." : "Household saved.");
      setForm(emptyForm);
      setOpen(false);
      await load();
    } catch (error) {
      toast.error(error.message);
    }
  };

  const uploadBatch = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setBatchLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const data = await api("/admin/census_households/batch", { method: "POST", token, body: formData });
      toast.success(`${data.inserted || 0} added, ${data.updated || 0} updated.`);
      setPage(1);
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBatchLoading(false);
      event.target.value = "";
    }
  };

  const exportBackup = async () => {
    setExportLoading(true);
    try {
      const response = await fetch(`${API_URL}/admin/census_households/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        const payload = contentType.includes("application/json") ? await response.json() : { message: await response.text() };
        throw new Error(payload.message || "Export failed.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `census-households-backup-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Household backup exported.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setExportLoading(false);
    }
  };

  const paginatedHouseholds = households.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Census"
        title="Maintain household census records"
        description="Keep household records clear and flexible while the resident field requirements are still being finalized."
        actions={
          <>
            <a
              href="/census-households-sample.xlsx"
              download
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-[var(--brand-700)] ring-1 ring-[var(--brand-200)] transition hover:bg-[var(--brand-50)]"
            >
              <Download className="h-4 w-4" />
              Sample File
            </a>
            <input ref={fileInputRef} type="file" accept=".csv,.txt,.xlsx" onChange={uploadBatch} className="hidden" />
            <Button type="button" variant="secondary" loading={batchLoading} onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              Batch Upload
            </Button>
            <Button type="button" variant="secondary" loading={exportLoading} onClick={exportBackup}>
              <Download className="h-4 w-4" />
              Export Backup
            </Button>
            <Button type="button" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              Add Household
            </Button>
          </>
        }
      />

      <Card>
        <div className="mb-5">
          <h2 className="text-xl font-bold text-[var(--brand-900)]">Household List</h2>
          <p className="mt-1 text-sm text-stone-500">Upload Excel or CSV columns: household_name, purok, members, house_number, status.</p>
        </div>

        <TableShell>
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-stone-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Household</th>
                <th className="px-4 py-3 font-semibold">Purok</th>
                <th className="px-4 py-3 font-semibold">Members</th>
                <th className="px-4 py-3 font-semibold">House Number</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {paginatedHouseholds.map((item) => (
                <tr key={item.id} className="border-t border-stone-100 transition hover:bg-stone-50/70">
                  <td className="px-4 py-4 font-semibold text-[var(--brand-900)]">{item.household_name}</td>
                  <td className="px-4 py-4 text-stone-600">{item.purok}</td>
                  <td className="px-4 py-4 text-stone-600">{item.members}</td>
                  <td className="px-4 py-4 text-stone-600">{item.house_number}</td>
                  <td className="px-4 py-4"><Badge tone={item.status === "active" ? "success" : "warning"}>{item.status === "active" ? "Active" : "For Update"}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
        <Pagination page={page} totalPages={Math.max(1, Math.ceil(households.length / pageSize))} onPageChange={setPage} />
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add Household"
        description="Use the modal to keep the main list wide and easier to scan."
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
          <TextInput label="Household Name" required maxLength={120} className="sm:col-span-2" value={form.householdName} onChange={(event) => setForm((current) => ({ ...current, householdName: event.target.value }))} />
          <SelectInput label="Purok" required value={form.purok} onChange={(event) => setForm((current) => ({ ...current, purok: event.target.value }))}><option value="">Select Purok</option>{purokOptions.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</SelectInput>
          <TextInput label="House Number" required maxLength={40} value={form.houseNumber} onChange={(event) => setForm((current) => ({ ...current, houseNumber: event.target.value }))} />
          <TextInput
            label="Members"
            type="number"
            min="1"
            step="1"
            value={form.members}
            onKeyDown={(event) => {
              if (["-", "+", "e", "E", "."].includes(event.key)) event.preventDefault();
            }}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                members: event.target.value === "" ? "" : Math.max(1, Number.parseInt(event.target.value, 10) || 1),
              }))
            }
          />
          <SelectInput label="Status" required value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option value="active">Active</option><option value="for update">For Update</option></SelectInput>
          <div className="sm:col-span-2 flex gap-3">
            <Button type="submit">Save Household</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default Admin_Census;
