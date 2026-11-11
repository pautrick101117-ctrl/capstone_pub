import { useReviewAction, useUnsavedForm, useUnsavedNavigation } from "../../hooks/useActionReview";
import { Edit3, ImageUp, Plus, Trash2 } from "lucide-react";
import PostImage from "../../components/PostImage";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/auth";
import { useToast } from "../../context/toast";
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, Modal, PageHeader, Pagination, Skeleton, TableShell, TextArea, TextInput } from "../../components/ui";
import { formatDateTime, toManilaDateTimeInput, fromManilaDateTimeInput } from "../../lib/format";

const emptyForm = { id: "", title: "", body: "", date: "", eventAt: "", image: null, preview: "", removeImage:false };
const pageSize = 6;

const AdminContentPage = ({ type = "news" }) => {
  const { token } = useAuth();
  const reviewAction = useReviewAction();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [formSnapshot, setFormSnapshot] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const label = type === "news" ? "News" : "Announcements";
  const singular = type === "news" ? "News Post" : "Announcement";

  const formGuard = useUnsavedForm({ initial: formSnapshot, current: form, enabled: open });
  useUnsavedNavigation(formGuard.dirty);
  const closeEditor = () => formGuard.closeSafely(() => { setOpen(false); setForm(emptyForm); });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api("/admin/announcements", { token });
      setItems((data.announcements || []).filter((item) => item.type === type));
    } catch (loadError) {
      setError(loadError.message || `Unable to load ${label.toLowerCase()}.`);
    } finally {
      setLoading(false);
    }
  }, [label, token, type]);

  useEffect(() => {
    if (token) load();
  }, [load, token, type]);

  useEffect(() => {
    setPage(1);
  }, [type]);

  // Clean up temporary browser previews after replacement or editor dismissal.
  useEffect(() => {
    const preview = form.preview;
    return () => { if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview); };
  }, [form.preview]);

  const openCreate = () => {
    setForm(emptyForm);
    setFormSnapshot(emptyForm);
    setOpen(true);
  };

  const openEdit = (item) => {
    setFormSnapshot({ id: item.id, title: item.title || "", body: item.body || "", date: toManilaDateTimeInput(item.published_at || item.created_at), eventAt: toManilaDateTimeInput(item.event_at), image: null, preview: item.image_url || "", removeImage:false });
    setForm({
      id: item.id,
      title: item.title || "",
      body: item.body || "",
      date: toManilaDateTimeInput(item.published_at || item.created_at),
      eventAt: toManilaDateTimeInput(item.event_at),
      image: null,
      preview: item.image_url || "",
      removeImage: false,
    });
    setOpen(true);
  };

  const save = async (event) => {
    event.preventDefault();
    if (type === "announcement" && form.eventAt && !fromManilaDateTimeInput(form.eventAt)) {
      toast.error("Enter a valid activity date and time.");
      return;
    }
    if (!await reviewAction({ title: form.id ? `Confirm ${singular} Changes` : `Publish ${singular}?`, subject: form.title, before: items.find((item) => item.id === form.id) || {}, after: { title: form.title, body: form.body, ...(type === "announcement" ? { activityDate: form.eventAt || "None", publishing: "Publish now" } : { date: form.date }), photo: form.image }, confirmLabel: form.id ? "Save Changes" : "Publish" })) return;
    setSaving(true);

    const formData = new FormData();
    formData.append("title", form.title);
    formData.append("body", form.body);
    formData.append("type", type);
    if (type === "news" && form.date) formData.append("publishedAt", fromManilaDateTimeInput(form.date));
    if (type === "announcement") formData.append("eventAt", form.eventAt ? fromManilaDateTimeInput(form.eventAt) : "");
    if (form.image) formData.append("image", form.image);
    if (form.preview && !form.image) formData.append("imageUrl", form.preview);
    if (form.removeImage) formData.append("removeImage", "true");

    try {
      if (form.id) {
        await api(`/admin/announcements/${form.id}`, { method: "PATCH", token, body: formData });
        toast.success(`${singular} updated.`);
      } else {
        await api("/admin/announcements", { method: "POST", token, body: formData });
        toast.success(`${singular} published successfully.`);
      }
      setOpen(false);
      setForm(emptyForm);
      await load();
    } catch (saveError) {
      toast.error(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/admin/announcements/${deleteTarget.id}`, { method: "DELETE", token });
      toast.success(`${singular} deleted.`);
      setDeleteTarget(null);
      await load();
    } catch (deleteError) {
      toast.error(deleteError.message);
    } finally {
      setDeleting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedItems = items.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={type === "news" ? "Public News" : "Public Announcements"}
        title={`Manage ${label}`}
        description={type === "news" ? "Publish community stories and updates residents can browse publicly." : "Publish official notices and time-sensitive barangay information."}
        actions={<Button onClick={openCreate}><Plus className="h-4 w-4" />Create {singular}</Button>}
      />

      {error ? <ErrorState title={`Couldn't load ${label.toLowerCase()}`} description={error} onRetry={load} /> : null}

      {!error ? (
        <Card>
          <div className="mb-5">
            <h2 className="text-xl font-bold text-[var(--brand-900)]">Published {label}</h2>
            <p className="mt-1 text-sm text-stone-500">Review existing content here. Editing and publishing happen in a focused form.</p>
          </div>

          {loading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20" />)}</div>
          ) : items.length === 0 ? (
            <EmptyState
              title={`No ${label.toLowerCase()} published yet`}
              description={`Create the first ${singular.toLowerCase()} when there is something residents should see.`}
            />
          ) : (
            <>
              <TableShell>
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-stone-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Title</th>
                      <th className="px-4 py-3 font-semibold">Published</th>
                      {type === "announcement" ? <th className="px-4 py-3 font-semibold">Activity Schedule</th> : null}
                      <th className="px-4 py-3 font-semibold">Image</th>
                      <th className="px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedItems.map((item) => (
                      <tr key={item.id} className="border-t border-stone-100 align-top transition hover:bg-stone-50/70">
                        <td className="px-4 py-4"><p className="font-semibold text-[var(--brand-900)]">{item.title}</p><p className="mt-1 line-clamp-3 max-w-2xl text-xs text-stone-500">{item.body}</p></td>
                        <td className="px-4 py-4 text-stone-600">{formatDateTime(item.published_at || item.created_at)}</td>
                        {type === "announcement" ? <td className="px-4 py-4 text-stone-600">{item.event_at ? formatDateTime(item.event_at) : "Not scheduled"}</td> : null}
                        <td className="px-4 py-4">{item.image_url ? <PostImage src={item.image_url} alt={item.title} frameClassName="h-20 w-24" imageClassName="p-1" compact /> : <span className="text-stone-400">None</span>}</td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-2">
                            <Button variant="secondary" onClick={() => openEdit(item)}><Edit3 className="h-4 w-4" />Edit</Button>
                            <Button variant="ghost" onClick={() => setDeleteTarget(item)}><Trash2 className="h-4 w-4" />Delete</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
              <Pagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </Card>
      ) : null}

      <Modal open={open} onClose={() => !saving && closeEditor()} title={`${form.id ? "Edit" : "Create"} ${singular}`} description={form.id ? "Update the content, then save the changes." : "Review the title, message and image before publishing."}>
        <form className="space-y-4" onSubmit={save}>
          <TextInput label="Title" required maxLength={140} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
          {type === "announcement" ? (
            <>
              <p className="rounded-xl bg-green-50 px-3 py-2 text-sm text-green-900">This announcement will be published immediately. You can announce activities happening in the future.</p>
              <TextInput label="Activity Date & Time (optional, Philippine time)" type="datetime-local" hint="When will the announced activity happen? Future dates are allowed. Leave blank for general notices, or clear it to remove a schedule." value={form.eventAt} onChange={(event) => setForm((current) => ({ ...current, eventAt: event.target.value }))} />
            </>
          ) : (
            <TextInput label="News Publication Date & Time (Philippine time)" type="datetime-local" max={toManilaDateTimeInput(new Date())} hint="Leave blank to publish now. Future publication dates are not supported for news." value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} />
          )}
          <TextArea label="Body" required maxLength={3000} value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} />
          <div className="space-y-2">
            <p className="text-sm font-medium text-stone-700">Image Upload (optional)</p>
            <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-stone-300 px-4 py-5 text-sm text-stone-600 hover:border-[var(--brand-400)]">
              <ImageUp className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-all">{form.image ? form.image.name : "Choose an image"}</span>
              <input type="file" accept="image/*" className="sr-only" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  const localPreview = URL.createObjectURL(file);
                  setForm((current) => ({ ...current, image: file, preview: localPreview, removeImage: false }));
                }
                event.target.value = "";
              }} />
            </label>
          </div>
          {form.preview ? <div className="space-y-2">
            <p className="text-xs text-stone-600">Entire image preview. Click to see it larger.</p>
            <PostImage src={form.preview} alt={form.title || "Selected news image"} frameClassName="h-72 sm:h-96 w-full" imageClassName="p-2" />
            <Button type="button" variant="secondary" onClick={() => setForm((current) => ({ ...current, image: null, preview: "", removeImage: true }))}>Remove selected picture</Button>
          </div> : null}
          <div className="flex flex-wrap gap-3"><Button type="submit" loading={saving}>{form.id ? "Save Changes" : "Publish"}</Button><Button type="button" variant="ghost" disabled={saving} onClick={closeEditor}>Cancel</Button></div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => !deleting && setDeleteTarget(null)}
        onConfirm={remove}
        loading={deleting}
        tone="danger"
        title={`Delete this ${singular.toLowerCase()}?`}
        description={deleteTarget ? `“${deleteTarget.title}” will be permanently removed from the public portal. This cannot be undone.` : ""}
        confirmLabel="Delete Permanently"
      />
    </div>
  );
};

export default AdminContentPage;



