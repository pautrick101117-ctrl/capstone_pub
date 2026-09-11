import { Edit3, Eye, Plus, ReceiptText, WalletCards } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useMasterData } from "../../hooks/useMasterData";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingState, Modal, PageHeader, Pagination, SegmentedTabs, SelectInput, TableShell, TextArea, TextInput } from "../../components/ui";
import { formatCurrency, formatDate } from "../../lib/format";
import { getStatusMeta } from "../../lib/status";

const emptySource = { id: "", name: "", term: "", allocatedAmount: "" };
const pageSize = 6;
const emptyProject = { id: "", name: "", date: "", amount: "", description: "", term: "", status: "ongoing", receipt: null, receiptUrl: "", preview: "" };

const AdminFunds = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [funds, setFunds] = useState({ sources: [], projects: [] });
  const [activeTab, setActiveTab] = useState("sources");
  const [sourceForm, setSourceForm] = useState(emptySource);
  const [projectForm, setProjectForm] = useState(emptyProject);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectPage, setProjectPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmSave, setConfirmSave] = useState(null);
  const { options: termOptions } = useMasterData("administration_term");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api("/public/funds");
      setFunds({ sources: data.sources || [], projects: data.projects || [] });
    } catch (loadError) {
      setError(loadError.message || "Unable to load fund records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openSourceCreate = () => { setSourceForm(emptySource); setSourceOpen(true); };
  const openSourceEdit = (source) => { setSourceForm({ id: source.id, name: source.name || "", term: source.term || "", allocatedAmount: source.allocated_amount ?? "" }); setSourceOpen(true); };
  const openProjectCreate = () => { setProjectForm(emptyProject); setProjectOpen(true); };
  const openProjectEdit = (project) => { setProjectForm({ id: project.id, name: project.name || "", date: project.date ? `${project.date}`.slice(0, 10) : "", amount: project.amount ?? "", description: project.description || "", term: project.term || "", status: project.status || "ongoing", receipt: null, receiptUrl: project.receiptUrl || "", preview: project.receiptUrl || "" }); setProjectOpen(true); };

  const requestSourceSave = (event) => { event.preventDefault(); setConfirmSave("source"); };
  const requestProjectSave = (event) => { event.preventDefault(); setConfirmSave("project"); };

  const commitSave = async () => {
    if (!confirmSave) return;
    setSaving(true);
    try {
      if (confirmSave === "source") {
        const path = sourceForm.id ? `/admin/fund_sources/${sourceForm.id}` : "/admin/fund_sources";
        await api(path, { method: sourceForm.id ? "PATCH" : "POST", token, body: sourceForm });
        toast.success(sourceForm.id ? "Fund source updated." : "Fund source added.");
        setSourceForm(emptySource); setSourceOpen(false);
      } else {
        const formData = new FormData();
        formData.append("name", projectForm.name);
        formData.append("date", projectForm.date);
        formData.append("amount", projectForm.amount);
        formData.append("description", projectForm.description);
        formData.append("term", projectForm.term);
        formData.append("status", projectForm.status);
        if (projectForm.receipt) formData.append("receipt", projectForm.receipt);
        else if (projectForm.receiptUrl) formData.append("receiptUrl", projectForm.receiptUrl);
        const path = projectForm.id ? `/admin/fund_projects/${projectForm.id}` : "/admin/fund_projects";
        await api(path, { method: projectForm.id ? "PATCH" : "POST", token, body: formData });
        toast.success(projectForm.id ? "Fund project updated." : "Fund project published.");
        setProjectForm(emptyProject); setProjectOpen(false);
      }
      setConfirmSave(null);
      await load();
    } catch (saveError) {
      toast.error(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil((funds.projects || []).length / pageSize));
  const safePage = Math.min(projectPage, totalPages);
  const paginatedProjects = (funds.projects || []).slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Fund Management" title="Manage fund transparency records" description="Keep fund sources and project spending separate, review financial details before saving, and maintain the public transparency record." actions={activeTab === "sources" ? <Button onClick={openSourceCreate}><WalletCards className="h-4 w-4" />Add Fund Source</Button> : <Button onClick={openProjectCreate}><Plus className="h-4 w-4" />Add Fund Project</Button>} />
      <SegmentedTabs value={activeTab} onChange={setActiveTab} items={[{ value: "sources", label: "Fund Sources", count: funds.sources.length }, { value: "projects", label: "Project Spending", count: funds.projects.length }]} />
      {error ? <ErrorState description={error} onRetry={load} /> : null}
      {!error && loading ? <LoadingState rows={5} /> : null}

      {!error && !loading && activeTab === "sources" ? <Card>
        <div className="mb-5"><h2 className="text-xl font-bold text-[var(--brand-900)]">Fund Sources</h2><p className="mt-1 text-sm text-stone-500">Allocated funding grouped by administration term.</p></div>
        {!funds.sources.length ? <EmptyState title="No fund sources recorded" description="Add a funding source so the public transparency summary can calculate allocations." action={<Button onClick={openSourceCreate}>Add Fund Source</Button>} /> : <TableShell><table className="min-w-full text-sm"><thead className="bg-stone-50 text-left text-stone-500"><tr><th className="px-4 py-3 font-semibold">Source</th><th className="px-4 py-3 font-semibold">Administration Term</th><th className="px-4 py-3 font-semibold">Allocated</th><th className="px-4 py-3 font-semibold">Action</th></tr></thead><tbody>{funds.sources.map((source) => <tr key={source.id} className="border-t border-stone-100"><td className="px-4 py-4 font-semibold text-[var(--brand-900)]">{source.name}</td><td className="px-4 py-4 text-stone-600">{source.term}</td><td className="px-4 py-4 font-bold text-[var(--brand-700)]">{formatCurrency(source.allocated_amount)}</td><td className="px-4 py-4"><Button variant="secondary" onClick={() => openSourceEdit(source)}><Edit3 className="h-4 w-4" />Edit</Button></td></tr>)}</tbody></table></TableShell>}
      </Card> : null}

      {!error && !loading && activeTab === "projects" ? <Card>
        <div className="mb-5 flex items-center gap-3"><ReceiptText className="h-5 w-5 text-[var(--brand-600)]" /><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Project Spending</h2><p className="mt-1 text-sm text-stone-500">Public project spending entries and receipt evidence.</p></div></div>
        {!funds.projects.length ? <EmptyState title="No project spending recorded" description="Add a project spending entry when funds are used for a barangay project." action={<Button onClick={openProjectCreate}>Add Fund Project</Button>} /> : <><TableShell><table className="min-w-full text-sm"><thead className="bg-stone-50 text-left text-stone-500"><tr><th className="px-4 py-3 font-semibold">Project</th><th className="px-4 py-3 font-semibold">Amount</th><th className="px-4 py-3 font-semibold">Term</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Receipt</th><th className="px-4 py-3 font-semibold">Action</th></tr></thead><tbody>{paginatedProjects.map((project) => { const meta = getStatusMeta(project.status); return <tr key={project.id} className="border-t border-stone-100 align-top"><td className="px-4 py-4"><p className="font-semibold text-[var(--brand-900)]">{project.name}</p><p className="mt-1 text-xs text-stone-500">{formatDate(project.date)}</p><p className="mt-2 max-w-xl text-xs text-stone-500">{project.description}</p></td><td className="px-4 py-4 text-[var(--brand-700)]">{formatCurrency(project.amount)}</td><td className="px-4 py-4 text-stone-600">{project.term}</td><td className="px-4 py-4"><Badge tone={meta.tone}>{meta.label}</Badge></td><td className="px-4 py-4">{project.receiptUrl ? <a href={project.receiptUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-[var(--brand-600)] hover:underline"><Eye className="h-4 w-4" />View</a> : <span className="text-stone-400">None</span>}</td><td className="px-4 py-4"><Button variant="secondary" onClick={() => openProjectEdit(project)}><Edit3 className="h-4 w-4" />Edit</Button></td></tr>; })}</tbody></table></TableShell><Pagination page={safePage} totalPages={totalPages} onPageChange={setProjectPage} /></>}
      </Card> : null}

      <Modal open={sourceOpen} onClose={() => !saving && setSourceOpen(false)} closeDisabled={saving} title={sourceForm.id ? "Edit Fund Source" : "Add Fund Source"} description="Review the source, term and allocation before saving because these values affect public transparency totals.">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={requestSourceSave}><TextInput label="Source Name" required maxLength={120} value={sourceForm.name} onChange={(event) => setSourceForm((current) => ({ ...current, name: event.target.value }))} /><SelectInput label="Administration Term" required value={sourceForm.term} onChange={(event) => setSourceForm((current) => ({ ...current, term: event.target.value }))}><option value="">Select term</option>{termOptions.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</SelectInput><TextInput label="Allocated Amount" required type="number" min="0" step="0.01" className="sm:col-span-2" value={sourceForm.allocatedAmount} onChange={(event) => setSourceForm((current) => ({ ...current, allocatedAmount: event.target.value }))} /><div className="sm:col-span-2 flex gap-3"><Button type="submit">Review & Save</Button><Button type="button" variant="ghost" onClick={() => setSourceOpen(false)}>Cancel</Button></div></form>
      </Modal>

      <Modal open={projectOpen} onClose={() => !saving && setProjectOpen(false)} closeDisabled={saving} title={projectForm.id ? "Edit Fund Project" : "Add Fund Project"} description="Verify the project amount, status and receipt before publishing the financial record.">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={requestProjectSave}><TextInput label="Project Name" required maxLength={120} value={projectForm.name} onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))} /><TextInput label="Date" required type="date" value={projectForm.date} onChange={(event) => setProjectForm((current) => ({ ...current, date: event.target.value }))} /><TextInput label="Amount" required type="number" min="0" step="0.01" value={projectForm.amount} onChange={(event) => setProjectForm((current) => ({ ...current, amount: event.target.value }))} /><SelectInput label="Administration Term" required value={projectForm.term} onChange={(event) => setProjectForm((current) => ({ ...current, term: event.target.value }))}><option value="">Select term</option>{termOptions.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</SelectInput><SelectInput label="Status" required value={projectForm.status} onChange={(event) => setProjectForm((current) => ({ ...current, status: event.target.value }))}><option value="ongoing">Ongoing</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></SelectInput><label className="flex flex-col gap-2 text-sm font-medium text-stone-700"><span>Receipt Upload</span><input type="file" accept="image/*,.pdf" onChange={(event) => { const file = event.target.files?.[0]; setProjectForm((current) => ({ ...current, receipt: file || null, preview: file && file.type.startsWith("image/") ? URL.createObjectURL(file) : file?.name || current.receiptUrl || "" })); }} /></label><TextArea label="Description" required maxLength={1500} className="sm:col-span-2" value={projectForm.description} onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))} />{projectForm.preview ? <div className="sm:col-span-2 rounded-3xl border border-stone-200 p-4"><p className="mb-3 text-sm font-semibold text-stone-700">Receipt preview</p>{projectForm.receipt?.type?.startsWith("image/") || (!projectForm.receipt && projectForm.receiptUrl?.match(/\.(png|jpe?g|webp)$/i)) ? <img src={projectForm.preview} alt="Receipt preview" className="max-h-60 rounded-2xl object-cover" /> : <p className="break-all text-sm text-stone-500">{projectForm.receipt?.name || projectForm.receiptUrl}</p>}</div> : null}<div className="sm:col-span-2 flex gap-3"><Button type="submit">Review & Save</Button><Button type="button" variant="ghost" onClick={() => setProjectOpen(false)}>Cancel</Button></div></form>
      </Modal>

      <ConfirmDialog open={Boolean(confirmSave)} onClose={() => !saving && setConfirmSave(null)} onConfirm={commitSave} loading={saving} tone="info" title={confirmSave === "source" ? "Save this fund source?" : "Save this project spending record?"} description={confirmSave === "source" ? `${sourceForm.name || "Fund source"} · ${sourceForm.term || "No term selected"} · ${formatCurrency(sourceForm.allocatedAmount)}` : `${projectForm.name || "Fund project"} · ${formatCurrency(projectForm.amount)} · ${projectForm.status}`} confirmLabel="Confirm Financial Record" />
    </div>
  );
};

export default AdminFunds;
