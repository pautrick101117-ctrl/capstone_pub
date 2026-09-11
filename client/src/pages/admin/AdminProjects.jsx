import { CalendarDays, CheckCircle2, Construction, ImagePlus, Pencil, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, Modal, PageHeader, Pagination, SegmentedTabs, SelectInput, TextArea, TextInput } from "../../components/ui";
import { formatDate, formatDateTime } from "../../lib/format";
import { getStatusMeta } from "../../lib/status";

const pageSize = 9;
const filters = [
  { value: "all", label: "All" },
  { value: "planned", label: "Planned" },
  { value: "ongoing", label: "Ongoing" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
];
const statuses = ["planned", "ongoing", "on_hold", "completed", "cancelled"];
const blankUpdate = { title: "", description: "", progressPercentage: "", projectStatus: "", updateDate: new Date().toISOString().slice(0, 10), image: null, preview: "" };

const Progress = ({ value = 0 }) => <div className="h-2.5 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-[var(--brand-500)]" style={{ width: `${Math.max(0, Math.min(100, Number(value || 0)))}%` }} /></div>;

const AdminProjects = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [edit, setEdit] = useState(null);
  const [updateForm, setUpdateForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const data = await api(`/admin/projects?status=${status}&page=${page}&limit=${pageSize}`, { token });
      setItems(data.projects || []); setPagination(data.pagination || { total: 0 });
    } catch (loadError) { setError(loadError.message || "Unable to load community projects."); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (token) load(); }, [token, status, page]);
  useEffect(() => { setPage(1); }, [status]);

  const openProject = async (project) => {
    setSelected(project); setUpdates([]);
    try { const data = await api(`/admin/projects/${project.id}`, { token }); setSelected(data.project); setUpdates(data.updates || []); }
    catch (err) { toast.error(err.message); }
  };

  const openEdit = () => setEdit({
    title: selected.title || "", description: selected.description || "", status: selected.status || "planned",
    progressPercentage: selected.progress_percentage ?? 0, plannedStartDate: selected.planned_start_date || "",
    actualStartDate: selected.actual_start_date || "", expectedCompletionDate: selected.expected_completion_date || "",
  });

  const saveProject = async () => {
    setSaving(true);
    try {
      const data = await api(`/admin/projects/${selected.id}`, { method: "PATCH", token, body: edit });
      toast.success(data.message || "Project updated."); setEdit(null); setSelected(data.project); await load();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  const publishUpdate = async () => {
    if (!updateForm?.title.trim() || !updateForm?.description.trim()) return toast.error("Update title and description are required.");
    setSaving(true);
    try {
      const body = new FormData();
      body.append("title", updateForm.title); body.append("description", updateForm.description);
      body.append("progressPercentage", updateForm.progressPercentage); body.append("projectStatus", updateForm.projectStatus);
      body.append("updateDate", updateForm.updateDate); if (updateForm.image) body.append("image", updateForm.image);
      const data = await api(`/admin/projects/${selected.id}/updates`, { method: "POST", token, body });
      toast.success(data.message || "Project update published."); setUpdateForm(null); setSelected(data.project);
      const detail = await api(`/admin/projects/${selected.id}`, { token }); setUpdates(detail.updates || []); await load();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  const totalPages = Math.max(1, Math.ceil((pagination.total || 0) / pageSize));
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Governance & Transparency" title="Community Projects" description="Manage the real implementation lifecycle of projects that won community voting and publish progress updates residents can verify." />
      <SegmentedTabs value={status} onChange={setStatus} items={filters} />

      {loading ? <LoadingState rows={6} /> : error ? <ErrorState description={error} onRetry={load} /> : !items.length ? <EmptyState title="No community projects found" description="A project is created when a closed community election has a winning option with votes." /> : (
        <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
          {items.map((project) => {
            const meta = getStatusMeta(project.status);
            return <Card key={project.id} className="cursor-pointer transition hover:-translate-y-0.5 hover:shadow-lg" onClick={() => openProject(project)}>
              {project.cover_image_url ? <img src={project.cover_image_url} alt={project.title} className="mb-4 h-48 w-full rounded-2xl object-cover" /> : <div className="mb-4 flex h-48 items-center justify-center rounded-2xl bg-[var(--brand-50)]"><Construction className="h-10 w-10 text-[var(--brand-400)]" /></div>}
              <div className="flex flex-wrap gap-2"><Badge tone={meta.tone}>{meta.label}</Badge>{project.election_id ? <Badge tone="success">Voting Winner</Badge> : null}</div>
              <h2 className="mt-3 text-xl font-bold text-[var(--brand-900)]">{project.title}</h2>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-stone-600">{project.description}</p>
              <div className="mt-5"><div className="mb-2 flex justify-between text-xs font-bold text-stone-500"><span>Implementation</span><span>{project.progress_percentage || 0}%</span></div><Progress value={project.progress_percentage} /></div>
              <p className="mt-4 text-xs text-stone-400">Updated {formatDateTime(project.updated_at)}</p>
            </Card>;
          })}
        </div>
      )}
      {!loading && !error && totalPages > 1 ? <Pagination page={page} totalPages={totalPages} onPageChange={setPage} /> : null}

      <Modal open={Boolean(selected)} onClose={() => { if (!saving) { setSelected(null); setEdit(null); setUpdateForm(null); } }} title={selected?.title || "Community Project"} description="Project implementation record and updates visible to residents." widthClass="max-w-5xl" closeDisabled={saving}>
        {selected ? <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start"><div><div className="flex flex-wrap gap-2"><Badge tone={getStatusMeta(selected.status).tone}>{getStatusMeta(selected.status).label}</Badge><Badge tone="success">{selected.progress_percentage || 0}% complete</Badge></div><p className="mt-4 text-sm leading-7 text-stone-600">{selected.description}</p></div><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={openEdit}><Pencil className="h-4 w-4" /> Edit Project</Button><Button onClick={() => setUpdateForm({ ...blankUpdate, progressPercentage: String(selected.progress_percentage ?? 0), projectStatus: selected.status })}><Plus className="h-4 w-4" /> Post Update</Button></div></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
            ["Planned Start", selected.planned_start_date], ["Actual Start", selected.actual_start_date], ["Expected Completion", selected.expected_completion_date], ["Completed", selected.completed_at]
          ].map(([label, value]) => <div key={label} className="rounded-2xl bg-stone-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-stone-400">{label}</p><p className="mt-2 text-sm font-semibold text-stone-700">{value ? formatDate(value) : "Not set"}</p></div>)}</div>
          <div><h3 className="text-lg font-bold text-[var(--brand-900)]">Implementation updates</h3><div className="mt-4 space-y-3">{updates.length ? updates.map((item) => <div key={item.id} className="rounded-2xl border border-stone-200 p-4"><div className="flex flex-wrap items-center gap-2"><Badge tone={getStatusMeta(item.project_status || selected.status).tone}>{getStatusMeta(item.project_status || selected.status).label}</Badge><span className="text-xs text-stone-400">{formatDate(item.update_date || item.created_at)}</span></div><h4 className="mt-2 font-bold text-[var(--brand-900)]">{item.title}</h4><p className="mt-2 text-sm leading-6 text-stone-600">{item.description}</p>{item.image_url ? <img src={item.image_url} alt={item.title} className="mt-3 h-48 w-full rounded-2xl object-cover" /> : null}</div>) : <p className="rounded-2xl bg-stone-50 p-5 text-sm text-stone-500">No implementation updates published yet.</p>}</div></div>
        </div> : null}
      </Modal>

      <Modal open={Boolean(edit)} onClose={() => !saving && setEdit(null)} title="Edit community project" description="Update the official implementation status, progress and schedule." closeDisabled={saving}>
        {edit ? <div className="space-y-4"><TextInput label="Project Title" value={edit.title} onChange={(e) => setEdit((v) => ({ ...v, title: e.target.value }))} /><TextArea label="Description" value={edit.description} onChange={(e) => setEdit((v) => ({ ...v, description: e.target.value }))} /><div className="grid gap-4 sm:grid-cols-2"><SelectInput label="Status" value={edit.status} onChange={(e) => setEdit((v) => ({ ...v, status: e.target.value }))}>{statuses.map((value) => <option key={value} value={value}>{getStatusMeta(value).label}</option>)}</SelectInput><TextInput label="Progress %" type="number" min="0" max="100" value={edit.progressPercentage} onChange={(e) => setEdit((v) => ({ ...v, progressPercentage: e.target.value }))} /><TextInput label="Planned Start" type="date" value={edit.plannedStartDate} onChange={(e) => setEdit((v) => ({ ...v, plannedStartDate: e.target.value }))} /><TextInput label="Actual Start" type="date" value={edit.actualStartDate} onChange={(e) => setEdit((v) => ({ ...v, actualStartDate: e.target.value }))} /><TextInput label="Expected Completion" type="date" value={edit.expectedCompletionDate} onChange={(e) => setEdit((v) => ({ ...v, expectedCompletionDate: e.target.value }))} /></div><div className="flex gap-3"><Button loading={saving} onClick={saveProject}>Save Project</Button><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div></div> : null}
      </Modal>

      <Modal open={Boolean(updateForm)} onClose={() => !saving && setUpdateForm(null)} title="Publish project update" description="This update will appear on the public Project Updates timeline and residents will be notified." closeDisabled={saving}>
        {updateForm ? <div className="space-y-4"><TextInput label="Update Title" required value={updateForm.title} onChange={(e) => setUpdateForm((v) => ({ ...v, title: e.target.value }))} placeholder="Example: Installation phase started" /><TextArea label="Update Description" required value={updateForm.description} onChange={(e) => setUpdateForm((v) => ({ ...v, description: e.target.value }))} /><div className="grid gap-4 sm:grid-cols-2"><TextInput label="Update Date" type="date" value={updateForm.updateDate} onChange={(e) => setUpdateForm((v) => ({ ...v, updateDate: e.target.value }))} /><TextInput label="Progress %" type="number" min="0" max="100" value={updateForm.progressPercentage} onChange={(e) => setUpdateForm((v) => ({ ...v, progressPercentage: e.target.value }))} /><SelectInput label="Project Status" value={updateForm.projectStatus} onChange={(e) => setUpdateForm((v) => ({ ...v, projectStatus: e.target.value }))}>{statuses.map((value) => <option key={value} value={value}>{getStatusMeta(value).label}</option>)}</SelectInput></div><label className="block text-sm font-medium text-stone-700"><span>Update Photo <span className="font-normal text-stone-400">(optional)</span></span><div className="mt-2 rounded-2xl border border-dashed border-stone-300 p-4"><input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0] || null; setUpdateForm((v) => ({ ...v, image: file, preview: file ? URL.createObjectURL(file) : "" })); }} />{updateForm.preview ? <div className="relative mt-3"><img src={updateForm.preview} alt="Update preview" className="h-52 w-full rounded-2xl object-cover" /><button type="button" className="absolute right-2 top-2 rounded-full bg-white p-2 shadow" onClick={() => setUpdateForm((v) => ({ ...v, image: null, preview: "" }))}><X className="h-4 w-4" /></button></div> : <div className="mt-3 flex items-center gap-2 text-xs text-stone-500"><ImagePlus className="h-4 w-4" /> Add visual proof of implementation when available.</div>}</div></label><div className="flex gap-3"><Button loading={saving} onClick={publishUpdate}><CheckCircle2 className="h-4 w-4" /> Publish Update</Button><Button variant="ghost" onClick={() => setUpdateForm(null)}>Cancel</Button></div></div> : null}
      </Modal>
    </div>
  );
};

export default AdminProjects;
