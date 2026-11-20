import { useReviewAction, useUnsavedForm, useUnsavedNavigation } from "../../hooks/useActionReview";
import { ArrowRight, CheckCircle2, Construction, ImagePlus, Pencil, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../context/auth";
import { useToast } from "../../context/toast";
import { Alert, Badge, Button, EmptyState, ErrorState, LoadingState, Modal, PageHeader, Pagination, SegmentedTabs, SelectInput, TextArea, TextInput } from "../../components/ui";
import ProjectStatus from "../../components/ProjectStatus";
import { projectStatuses, projectStatusFilters, projectStatusNeedsReason } from "../../lib/projectStatus";
import { formatDate, formatDateTime } from "../../lib/format";
import { getStatusMeta } from "../../lib/status";

const pageSize = 9;
const updatePageSize = 5;
const blankUpdate = { id: "", title: "", description: "", projectStatus: "", updateDate: "", reason: "", image: null, preview: "" };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const AdminProjects = () => {
  const { token } = useAuth();
  const reviewAction = useReviewAction();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [updatePage, setUpdatePage] = useState(1);
  const [edit, setEdit] = useState(null);
  const [editSnapshot, setEditSnapshot] = useState(null);
  const [updateForm, setUpdateForm] = useState(null);
  const [updateSnapshot, setUpdateSnapshot] = useState(null);
  const [statusForm, setStatusForm] = useState(null);
  const [statusSnapshot, setStatusSnapshot] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [saving, setSaving] = useState(false);
  const detailRequest = useRef(0);

  const editGuard = useUnsavedForm({ initial: editSnapshot, current: edit, enabled: Boolean(edit) });
  const updateGuard = useUnsavedForm({ initial: updateSnapshot, current: updateForm, enabled: Boolean(updateForm) });
  const statusGuard = useUnsavedForm({ initial: statusSnapshot, current: statusForm, enabled: Boolean(statusForm) });
  useUnsavedNavigation(editGuard.dirty || updateGuard.dirty || statusGuard.dirty);
  const closeEdit = () => editGuard.closeSafely(() => setEdit(null));
  const closeUpdate = () => updateGuard.closeSafely(() => setUpdateForm(null));
  const closeStatus = () => statusGuard.closeSafely(() => setStatusForm(null));

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const data = await api(`/admin/projects?status=${status}&page=${page}&limit=${pageSize}`, { token });
      setItems(data.projects || []); setPagination(data.pagination || { total: 0 });
    } catch (loadError) { setError(loadError.message || "Unable to load community projects."); }
    finally { setLoading(false); }
  }, [page, status, token]);
  useEffect(() => { if (token) load(); }, [token, status, page, load]);
  useEffect(() => {
    const targetId = searchParams.get("recordId");
    if (!targetId || !token) return;
    api(`/admin/projects/${targetId}`, { token }).then((data) => {
      setSelected(data.project); setUpdates(data.updates || []); setUpdatePage(1); setDetailError("");
    }).catch((err) => toast.error(`Unable to open this project: ${err.message}`));
  }, [token, searchParams, toast]);

  const refreshSelected = async (projectId = selected?.id) => {
    if (!projectId) return;
    const data = await api(`/admin/projects/${projectId}`, { token });
    setSelected(data.project);
    setUpdates(data.updates || []);
  };

  const openProject = async (project) => {
    const request = ++detailRequest.current;
    setSelected(project); setUpdates([]); setUpdatePage(1); setDetailLoading(true); setDetailError("");
    try {
      const data = await api(`/admin/projects/${project.id}`, { token });
      if (request === detailRequest.current) { setSelected(data.project); setUpdates(data.updates || []); }
    }
    catch (err) { if (request === detailRequest.current) setDetailError(err.message || "Unable to load the project record."); }
    finally { if (request === detailRequest.current) setDetailLoading(false); }
  };

  const openEdit = () => { const value = {
    title: selected.title || "",
    description: selected.description || "",
    plannedStartDate: selected.planned_start_date || "",
    actualStartDate: selected.actual_start_date || "",
    expectedCompletionDate: selected.expected_completion_date || "",
  }; setEditSnapshot(value); setEdit(value); };

  const saveProject = async () => {
    if (!selected || !edit || saving) return;
    if (!edit.title.trim() || !edit.description.trim()) return toast.error("Enter the project title and description.");
    if (!await reviewAction({ title: "Confirm Project Changes", subject: selected.title, before: selected, after: edit, confirmLabel: "Save Changes" })) return;
    setSaving(true);
    try {
      const data = await api(`/admin/projects/${selected.id}`, { method: "PATCH", token, body: edit });
      toast.success(data.message || "Project updated."); setEdit(null); setSelected(data.project); await load();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  const openNewUpdate = () => { const value = { ...blankUpdate, projectStatus: selected.status, updateDate: today() }; setUpdateSnapshot(value); setUpdateForm(value); };
  const openEditUpdate = (item) => { const value = {
    id: item.id,
    title: item.title || "",
    description: item.description || "",
    projectStatus: item.project_status || "",
    updateDate: item.update_date ? `${item.update_date}`.slice(0, 10) : today(),
    image: null,
    reason: "",
    preview: item.image_url || "",
  }; setUpdateSnapshot(value); setUpdateForm(value); };

  const saveUpdate = async () => {
    if (saving) return;
    if (updateForm?.title.trim().length < 3 || updateForm?.description.trim().length < 3) return toast.error("Enter an update title and description with at least 3 characters each.");
    if (!updateForm.updateDate) return toast.error("Select an update date.");
    if (!updateForm.id && updateForm.projectStatus === "completed" && updateForm.description.trim().length < 10) return toast.error("Describe the completed work using at least 10 characters.");
    if (!updateForm.id && (projectStatusNeedsReason(selected.status, updateForm.projectStatus) || ["on_hold", "cancelled"].includes(updateForm.projectStatus)) && updateForm.reason.trim().length < 5) return toast.error("Explain the status change using at least 5 characters.");
    if (!await reviewAction({ title: updateForm.id ? "Confirm Update Correction" : "Publish Project Update?", subject: updateForm.title, description: updateForm.id ? "This correction will appear in the project timeline. The current project status will remain unchanged." : "The update and selected project status will be visible to residents.", after: { ...updateForm, projectStatus: getStatusMeta(updateForm.projectStatus).label }, confirmLabel: updateForm.id ? "Save Correction" : "Publish Update" })) return;
    setSaving(true);
    try {
      const body = new FormData();
      body.append("title", updateForm.title); body.append("description", updateForm.description);
      body.append("projectStatus", updateForm.projectStatus);
      body.append("updateDate", updateForm.updateDate); body.append("reason", updateForm.reason || ""); if (updateForm.image) body.append("image", updateForm.image);
      const isEdit = Boolean(updateForm.id);
      const data = await api(
        isEdit ? `/admin/projects/${selected.id}/updates/${updateForm.id}` : `/admin/projects/${selected.id}/updates`,
        { method: isEdit ? "PATCH" : "POST", token, body }
      );
      toast.success(data.message || (isEdit ? "Project update corrected." : "Project update published."));
      setUpdateForm(null); setSelected(data.project); setUpdatePage(1);
      await refreshSelected(selected.id); await load();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  const openStatus = () => { const value = { status: selected.status, reason: "" }; setStatusSnapshot(value); setStatusForm(value); };
  const saveStatus = async () => {
    if (!statusForm || !selected || saving) return;
    if (statusForm.status === selected.status) return toast.error("Select a different project status.");
    if (projectStatusNeedsReason(selected.status, statusForm.status) && statusForm.reason.trim().length < 5) return toast.error("Explain the status change using at least 5 characters.");
    if (!await reviewAction({ title: "Confirm Project Status Change", subject: selected.title, description: "The new status and explanation will appear in the public project record. Residents will be notified.", before: { status: getStatusMeta(selected.status).label }, after: { status: getStatusMeta(statusForm.status).label, reason: statusForm.reason }, confirmLabel: "Save Status", tone: statusForm.status === "cancelled" ? "danger" : "primary" })) return;
    setSaving(true);
    try {
      const data = await api(`/admin/projects/${selected.id}`, { method: "PATCH", token, body: { status: statusForm.status, reason: statusForm.reason.trim() } });
      toast.success("Project status updated successfully.");
      setSelected(data.project); setStatusForm(null); await refreshSelected(data.project.id); await load();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  const totalPages = Math.max(1, Math.ceil((pagination.total || 0) / pageSize));
  const updateTotalPages = Math.max(1, Math.ceil(updates.length / updatePageSize));
  const visibleUpdates = useMemo(() => updates.slice((updatePage - 1) * updatePageSize, updatePage * updatePageSize), [updates, updatePage]);

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Governance & Transparency" title="Community Projects" description="Manage project status, implementation schedules, and official updates for community-selected projects." />
      <Alert tone="info" title="Managing community projects">Select a project to review its details, update its status, or publish an update. Projects usually move from Planned to Ongoing to Completed and may be placed On Hold or Cancelled when necessary. Project records and published updates are retained for transparency.</Alert>
      <SegmentedTabs value={status} onChange={(value) => { setStatus(value); setPage(1); }} items={projectStatusFilters} />

      {loading ? <LoadingState rows={6} /> : error ? <ErrorState description={error} onRetry={load} /> : !items.length ? <EmptyState title="No community projects found" description="A project is created when a closed community election has a winning option with votes." /> : (
        <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
          {items.map((project) => {
            return <button key={project.id} type="button" aria-label={`Manage project: ${project.title}`} className="group flex h-full w-full flex-col rounded-3xl border border-stone-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--brand-300)] hover:shadow-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--brand-200)]" onClick={() => openProject(project)}>
              {project.cover_image_url ? <img src={project.cover_image_url} alt={project.title} className="mb-4 h-48 w-full rounded-2xl object-cover" /> : <div className="mb-4 flex h-48 items-center justify-center rounded-2xl bg-[var(--brand-50)]"><Construction className="h-10 w-10 text-[var(--brand-400)]" /></div>}
              {project.election_id ? <div><Badge tone="success">Selected by Community Vote</Badge></div> : null}
              <h2 className="mt-3 text-xl font-bold text-[var(--brand-900)]">{project.title}</h2>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-stone-600">{project.description}</p>
              <div className="mt-auto w-full pt-5"><ProjectStatus status={project.status} compact /></div>
              <div className="mt-4 flex w-full flex-wrap items-center justify-between gap-2"><span className="text-xs text-stone-500">Last Updated {formatDateTime(project.updated_at)}</span><span className="inline-flex items-center gap-1 text-sm font-bold text-[var(--brand-700)]">Manage Project <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" aria-hidden="true" /></span></div>
            </button>;
          })}
        </div>
      )}
      {!loading && !error ? <Pagination page={page} totalPages={totalPages} onPageChange={setPage} /> : null}

      <Modal open={Boolean(selected) && !edit && !updateForm && !statusForm} onClose={() => { if (!saving) { detailRequest.current += 1; setSelected(null); if (searchParams.has("recordId")) setSearchParams({}, { replace: true }); } }} title={selected?.title || "Community Project"} description="Review the official project record and published implementation updates." widthClass="max-w-5xl" closeDisabled={saving}>
        {detailLoading ? <LoadingState rows={3} /> : detailError ? <ErrorState description={detailError} onRetry={() => openProject(selected)} /> : selected ? <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start"><div><ProjectStatus status={selected.status} /><p className="mt-4 text-sm leading-7 text-stone-600">{selected.description}</p></div><div className="flex flex-wrap gap-2"><Button onClick={openStatus}><Pencil className="h-4 w-4" /> Update Status</Button><Button variant="secondary" onClick={openEdit}>Edit Details</Button>{!["completed", "cancelled"].includes(selected.status) ? <Button variant="secondary" onClick={openNewUpdate}><Plus className="h-4 w-4" /> Publish Update</Button> : null}</div></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
            ["Planned Start", selected.planned_start_date], ["Actual Start", selected.actual_start_date], ["Expected Completion", selected.expected_completion_date], ["Completed", selected.completed_at]
          ].map(([fieldLabel, value]) => <div key={fieldLabel} className="rounded-2xl bg-stone-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-stone-400">{fieldLabel}</p><p className="mt-2 text-sm font-semibold text-stone-700">{value ? formatDate(value) : "Not set"}</p></div>)}</div>
          <div><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-lg font-bold text-[var(--brand-900)]">Implementation updates</h3><p className="mt-1 text-sm text-stone-500">Published updates are retained for transparency. Use Edit to correct an inaccurate post instead of deleting history.</p></div><p className="text-xs font-semibold text-stone-400">{updates.length} update{updates.length === 1 ? "" : "s"}</p></div><div className="mt-4 space-y-3">{visibleUpdates.length ? visibleUpdates.map((item) => <div key={item.id} className="rounded-2xl border border-stone-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><Badge tone={getStatusMeta(item.project_status).tone}>{item.project_status ? getStatusMeta(item.project_status).label : "Status Not Recorded"}</Badge><span className="text-xs text-stone-400">{formatDate(item.update_date || item.created_at)}</span></div><h4 className="mt-2 font-bold text-[var(--brand-900)]">{item.title}</h4></div><Button variant="ghost" onClick={() => openEditUpdate(item)}><Pencil className="h-4 w-4" /> Edit Update</Button></div><p className="mt-2 whitespace-pre-line text-sm leading-6 text-stone-600">{item.description}</p>{item.image_url ? <img src={item.image_url} alt={item.title} className="mt-3 h-48 w-full rounded-2xl object-cover" /> : null}</div>) : <p className="rounded-2xl bg-stone-50 p-5 text-sm text-stone-500">No implementation updates published yet.</p>}</div><Pagination page={updatePage} totalPages={updateTotalPages} onPageChange={setUpdatePage} /></div>
        </div> : null}
      </Modal>

      <Modal open={Boolean(edit)} onClose={() => !saving && closeEdit()} title="Edit Project Details" description="Update the project title, description, and implementation schedule." closeDisabled={saving}>
        {edit ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); saveProject(); }}><TextInput label="Project Title" required value={edit.title} onChange={(e) => setEdit((v) => ({ ...v, title: e.target.value }))} /><TextArea label="Project Description" required value={edit.description} onChange={(e) => setEdit((v) => ({ ...v, description: e.target.value }))} /><div className="grid gap-4 sm:grid-cols-2"><TextInput label="Planned Start Date" type="date" value={edit.plannedStartDate} onChange={(e) => setEdit((v) => ({ ...v, plannedStartDate: e.target.value }))} /><TextInput label="Actual Start Date" type="date" value={edit.actualStartDate} onChange={(e) => setEdit((v) => ({ ...v, actualStartDate: e.target.value }))} /><TextInput label="Expected Completion Date" type="date" value={edit.expectedCompletionDate} onChange={(e) => setEdit((v) => ({ ...v, expectedCompletionDate: e.target.value }))} /></div><div className="flex gap-3"><Button type="submit" loading={saving}>Save Changes</Button><Button type="button" variant="ghost" disabled={saving} onClick={closeEdit}>Cancel</Button></div></form> : null}
      </Modal>

      <Modal open={Boolean(updateForm)} onClose={() => !saving && closeUpdate()} title={updateForm?.id ? "Edit Project Update" : "Publish Project Update"} description={updateForm?.id ? "Correct a published update. This does not change the current project status. All corrections are recorded." : "Publish an official update and its project status for residents."} closeDisabled={saving}>
        {updateForm ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); saveUpdate(); }}>
          <TextInput label="Update Title" required minLength={3} value={updateForm.title} onChange={(e) => setUpdateForm((v) => ({ ...v, title: e.target.value }))} placeholder="Example: Installation work has started" />
          <TextArea label="Update Description" required minLength={updateForm.projectStatus === "completed" && !updateForm.id ? 10 : 3} value={updateForm.description} onChange={(e) => setUpdateForm((v) => ({ ...v, description: e.target.value }))} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput label="Update Date" required type="date" value={updateForm.updateDate} onChange={(e) => setUpdateForm((v) => ({ ...v, updateDate: e.target.value }))} />
            <SelectInput label={updateForm.id ? "Status at This Update" : "Project Status"} value={updateForm.projectStatus} onChange={(e) => setUpdateForm((v) => ({ ...v, projectStatus: e.target.value }))}>
              {updateForm.id ? <option value="">Not Recorded</option> : null}
              {projectStatuses.map((value) => <option key={value} value={value}>{getStatusMeta(value).label}</option>)}
            </SelectInput>
          </div>
          {!updateForm.id ? <TextArea label="Reason for Status Change" required={projectStatusNeedsReason(selected.status, updateForm.projectStatus) || ["on_hold", "cancelled"].includes(updateForm.projectStatus)} minLength={5} hint="Required when placing a project on hold, cancelling, completing, or reopening it. This explanation will be part of the public record." value={updateForm.reason} onChange={(e) => setUpdateForm((v) => ({ ...v, reason: e.target.value }))} /> : null}
          <div className="rounded-2xl border border-dashed border-stone-300 p-4">
            <label className="block text-sm font-medium text-stone-700">Update Photo (Optional)<input type="file" accept="image/*" className="mt-2 block w-full text-sm" onChange={(e) => { const file = e.target.files?.[0] || null; setUpdateForm((v) => ({ ...v, image: file, preview: file ? URL.createObjectURL(file) : v.preview })); }} /></label>
            {updateForm.preview ? <div className="relative mt-3"><img src={updateForm.preview} alt="Selected project update photo" className="h-52 w-full rounded-2xl object-cover" />{updateForm.image ? <button type="button" aria-label="Discard selected photo" className="absolute right-2 top-2 rounded-full bg-white p-2 shadow" onClick={() => setUpdateForm((v) => ({ ...v, image: null, preview: updateSnapshot?.preview || "" }))}><X className="h-4 w-4" /></button> : null}</div> : <p className="mt-3 flex items-center gap-2 text-xs text-stone-500"><ImagePlus className="h-4 w-4" /> Include a photo of the project work when available.</p>}
          </div>
          <div className="flex gap-3"><Button type="submit" loading={saving}><CheckCircle2 className="h-4 w-4" /> {updateForm.id ? "Save Correction" : "Publish Update"}</Button><Button type="button" variant="ghost" disabled={saving} onClick={closeUpdate}>Cancel</Button></div>
        </form> : null}
      </Modal>

      <Modal open={Boolean(statusForm)} onClose={() => !saving && closeStatus()} title="Update Project Status" description="Select the current implementation status. The change will appear on the public website and resident portal." closeDisabled={saving} widthClass="max-w-xl">
        {statusForm ? <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); saveStatus(); }}>
          <p className="font-semibold text-[var(--brand-900)]">{selected.title}</p>
          <SelectInput label="Project Status" required value={statusForm.status} onChange={(event) => setStatusForm((value) => ({ ...value, status: event.target.value }))}>{projectStatuses.map((value) => <option key={value} value={value}>{getStatusMeta(value).label}</option>)}</SelectInput>
          <ProjectStatus status={statusForm.status} />
          <TextArea label="Reason for Status Change" required={projectStatusNeedsReason(selected.status, statusForm.status)} minLength={5} hint="Required when placing a project on hold, cancelling, completing, or reopening it. This explanation will be visible to residents." value={statusForm.reason} onChange={(event) => setStatusForm((value) => ({ ...value, reason: event.target.value }))} placeholder="Explain the status change or describe the completed work." />
          <div className="flex flex-wrap gap-3"><Button type="submit" loading={saving} disabled={statusForm.status === selected.status}>Save Status</Button><Button type="button" variant="ghost" onClick={closeStatus} disabled={saving}>Cancel</Button></div>
        </form> : null}
      </Modal>
    </div>
  );
};

export default AdminProjects;


