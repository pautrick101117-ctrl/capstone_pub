import { Download, Plus, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { API_URL, api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useMasterData } from "../../hooks/useMasterData";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, LoadingState, Modal, PageHeader, Pagination, SelectInput, TableShell, TextInput } from "../../components/ui";

const emptyForm = { householdName: "", purok: "", members: 1, houseNumber: "", status: "active" };
const pageSize = 8;

const Admin_Census = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [households, setHouseholds] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [validation, setValidation] = useState(null);
  const fileInputRef = useRef(null);
  const { options: purokOptions } = useMasterData("purok");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api("/admin/census_households", { token });
      setHouseholds(data.census_households || []);
    } catch (loadError) {
      setError(loadError.message || "Unable to load census records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (token) load(); }, [token]);

  const save = async (event) => {
    event.preventDefault();
    const members = Number(form.members);
    if (!Number.isInteger(members) || members < 1) return toast.error("Members must be a positive whole number.");
    setSaving(true);
    try {
      const data = await api("/admin/census_households", { method: "POST", token, body: { ...form, members } });
      toast.success(data.action === "updated" ? "Household updated." : "Household saved.");
      setForm(emptyForm);
      setOpen(false);
      await load();
    } catch (saveError) {
      toast.error(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const validateBatch = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBatchLoading(true);
    setPendingFile(file);
    setValidation(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const data = await api("/admin/census_households/batch?validateOnly=true", { method: "POST", token, body: formData });
      setValidation(data);
    } catch (validationError) {
      setPendingFile(null);
      toast.error(validationError.message);
    } finally {
      setBatchLoading(false);
    }
  };

  const confirmBatch = async () => {
    if (!pendingFile) return;
    setBatchLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", pendingFile);
      const data = await api("/admin/census_households/batch", { method: "POST", token, body: formData });
      toast.success(`${data.inserted || 0} added, ${data.updated || 0} updated.`);
      setPendingFile(null);
      setValidation(null);
      setPage(1);
      await load();
    } catch (uploadError) {
      toast.error(uploadError.message);
    } finally {
      setBatchLoading(false);
    }
  };

  const exportBackup = async () => {
    setExportLoading(true);
    try {
      const response = await fetch(`${API_URL}/admin/census_households/export`, { headers: { Authorization: `Bearer ${token}` } });
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
    } catch (exportError) {
      toast.error(exportError.message);
    } finally {
      setExportLoading(false);
    }
  };

  const totalMembers = households.reduce((sum, item) => sum + Number(item.members || 0), 0);
  const needsUpdate = households.filter((item) => item.status !== "active").length;
  const totalPages = Math.max(1, Math.ceil(households.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedHouseholds = households.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Census"
        title="Maintain household census records"
        description="Add household records individually, validate batch files before importing, and export a backup when needed."
        actions={<><a href="/census-households-sample.csv" download className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-[var(--brand-700)] ring-1 ring-[var(--brand-200)] transition hover:bg-[var(--brand-50)]"><Download className="h-4 w-4" />Sample File</a><input ref={fileInputRef} type="file" accept=".csv,.txt,.xlsx" onChange={validateBatch} className="hidden" /><Button type="button" variant="secondary" loading={batchLoading && !pendingFile} onClick={() => fileInputRef.current?.click()}><Upload className="h-4 w-4" />Import Census</Button><Button type="button" variant="secondary" loading={exportLoading} onClick={exportBackup}><Download className="h-4 w-4" />Export Backup</Button><Button type="button" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Add Household</Button></>}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><p className="text-sm font-semibold text-stone-500">Households</p><p className="mt-2 text-3xl font-black text-[var(--brand-900)]">{households.length}</p></Card>
        <Card><p className="text-sm font-semibold text-stone-500">Residents Represented</p><p className="mt-2 text-3xl font-black text-[var(--brand-900)]">{totalMembers}</p></Card>
        <Card><p className="text-sm font-semibold text-stone-500">Needs Update</p><p className="mt-2 text-3xl font-black text-[var(--brand-900)]">{needsUpdate}</p></Card>
      </div>

      {error ? <ErrorState description={error} onRetry={load} /> : null}
      {!error ? <Card>
        <div className="mb-5"><h2 className="text-xl font-bold text-[var(--brand-900)]">Household List</h2><p className="mt-1 text-sm text-stone-500">Batch files use columns: household_name, purok, members, house_number, status.</p></div>
        {loading ? <LoadingState rows={5} /> : households.length === 0 ? <EmptyState title="No census households yet" description="Add a household manually or import a validated census file." action={<Button onClick={() => setOpen(true)}>Add Household</Button>} /> : <><TableShell><table className="min-w-full text-sm"><thead className="bg-stone-50 text-left text-stone-500"><tr><th className="px-4 py-3 font-semibold">Household</th><th className="px-4 py-3 font-semibold">Purok</th><th className="px-4 py-3 font-semibold">Members</th><th className="px-4 py-3 font-semibold">House Number</th><th className="px-4 py-3 font-semibold">Status</th></tr></thead><tbody>{paginatedHouseholds.map((item) => <tr key={item.id} className="border-t border-stone-100 transition hover:bg-stone-50/70"><td className="px-4 py-4 font-semibold text-[var(--brand-900)]">{item.household_name}</td><td className="px-4 py-4 text-stone-600">{item.purok}</td><td className="px-4 py-4 text-stone-600">{item.members}</td><td className="px-4 py-4 text-stone-600">{item.house_number}</td><td className="px-4 py-4"><Badge tone={item.status === "active" ? "success" : "warning"}>{item.status === "active" ? "Active" : "Needs Update"}</Badge></td></tr>)}</tbody></table></TableShell><Pagination page={safePage} totalPages={totalPages} onPageChange={setPage} /></>}
      </Card> : null}

      <Modal open={open} onClose={() => !saving && setOpen(false)} title="Add Household" description="House number is used to match an existing household during future batch updates.">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
          <TextInput label="Household Name" required maxLength={120} className="sm:col-span-2" value={form.householdName} onChange={(event) => setForm((current) => ({ ...current, householdName: event.target.value }))} />
          <SelectInput label="Purok" required value={form.purok} onChange={(event) => setForm((current) => ({ ...current, purok: event.target.value }))}><option value="">Select Purok</option>{purokOptions.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</SelectInput>
          <TextInput label="House Number" required maxLength={40} value={form.houseNumber} onChange={(event) => setForm((current) => ({ ...current, houseNumber: event.target.value }))} />
          <TextInput label="Members" type="number" min="1" step="1" value={form.members} onKeyDown={(event) => { if (["-", "+", "e", "E", "."].includes(event.key)) event.preventDefault(); }} onChange={(event) => setForm((current) => ({ ...current, members: event.target.value === "" ? "" : Math.max(1, Number.parseInt(event.target.value, 10) || 1) }))} />
          <SelectInput label="Status" required value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option value="active">Active</option><option value="for update">Needs Update</option></SelectInput>
          <div className="sm:col-span-2 flex gap-3"><Button type="submit" loading={saving}>Save Household</Button><Button type="button" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(pendingFile && validation)} onClose={() => !batchLoading && (setPendingFile(null), setValidation(null))} closeDisabled={batchLoading} title="Review Census Import" description="The file passed structural and master-data validation. Review the sample before committing changes.">
        {validation ? <div className="space-y-5"><Alert tone="success" title="Validation passed"><p>{validation.rowCount} household row{validation.rowCount === 1 ? "" : "s"} are ready to import. Existing records with the same house number may be updated.</p></Alert><div><p className="text-sm font-semibold text-stone-700">File</p><p className="mt-1 text-sm text-stone-500">{pendingFile?.name}</p></div><div><p className="mb-2 text-sm font-semibold text-stone-700">First {Math.min(5, validation.preview?.length || 0)} validated rows</p><div className="space-y-2">{(validation.preview || []).map((row, index) => <div key={`${row.house_number}-${index}`} className="rounded-2xl border border-stone-200 p-3 text-sm"><p className="font-semibold text-[var(--brand-900)]">{row.household_name}</p><p className="mt-1 text-stone-500">{row.purok} · House {row.house_number} · {row.members} member{Number(row.members) === 1 ? "" : "s"}</p></div>)}</div></div><div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button variant="secondary" disabled={batchLoading} onClick={() => { setPendingFile(null); setValidation(null); }}>Cancel Import</Button><Button loading={batchLoading} onClick={confirmBatch}>Import {validation.rowCount} Rows</Button></div></div> : null}
      </Modal>
    </div>
  );
};

export default Admin_Census;
