import { Edit3, ImageUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, Modal, PageHeader, Pagination, Skeleton, TableShell, TextArea, TextInput } from "../../components/ui";
import { formatDate } from "../../lib/format";

const emptyForm = { id: "", title: "", body: "", date: "", image: null, preview: "" };
const pageSize = 6;

const AdminContentPage = ({ type = "news" }) => {
  const { token } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const label = type === "news" ? "News" : "Announcements";
  const singular = type === "news" ? "News Post" : "Announcement";

  const load = async () => {
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
  };

  useEffect(() => {
    if (token) load();
  }, [token, type]);

  useEffect(() => {
    setPage(1);
  }, [type]);

  const openCreate = () => {
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (item) => {
    setForm({
      id: item.id,
      title: item.title || "",
      body: item.body || "",
      date: item.created_at ? `${item.created_at}`.slice(0, 10) : "",
      image: null,
      preview: item.image_url || "",
    });
    setOpen(true);
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);

    const formData = new FormData();
    formData.append("title", form.title);
    formData.append("body", form.body);
    formData.append("type", type);
    if (form.date) formData.append("date", form.date);
    if (form.image) formData.append("image", form.image);
    if (form.preview && !form.image) formData.append("imageUrl", form.preview);

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
              action={<Button onClick={openCreate}><Plus className="h-4 w-4" />Create {singular}</Button>}
            />
          ) : (
            <>
              <TableShell>
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-stone-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Title</th>
                      <th className="px-4 py-3 font-semibold">Published</th>
                      <th className="px-4 py-3 font-semibold">Image</th>
                      <th className="px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedItems.map((item) => (
                      <tr key={item.id} className="border-t border-stone-100 align-top transition hover:bg-stone-50/70">
                        <td className="px-4 py-4"><p className="font-semibold text-[var(--brand-900)]">{item.title}</p><p className="mt-1 line-clamp-3 max-w-2xl text-xs text-stone-500">{item.body}</p></td>
                        <td className="px-4 py-4 text-stone-600">{formatDate(item.created_at)}</td>
                        <td className="px-4 py-4">{item.image_url ? <img src={item.image_url} alt="" className="h-14 w-14 rounded-2xl object-cover" /> : <span className="text-stone-400">None</span>}</td>
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

      <Modal open={open} onClose={() => !saving && setOpen(false)} title={`${form.id ? "Edit" : "Create"} ${singular}`} description={form.id ? "Update the content, then save the changes." : "Review the title, message and image before publishing."}>
        <form className="space-y-4" onSubmit={save}>
          <TextInput label="Title" required maxLength={140} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
          <TextInput label="Date (optional)" type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} />
          <TextArea label="Body" required maxLength={3000} value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} />
          <label className="flex flex-col gap-2 text-sm font-medium text-stone-700">
            <span>Image Upload</span>
            <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-stone-300 px-4 py-5 text-sm text-stone-500">
              <ImageUp className="h-4 w-4" /><span>{form.image ? form.image.name : "Choose image"}</span>
              <input type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; setForm((current) => ({ ...current, image: file || null, preview: file ? URL.createObjectURL(file) : current.preview })); }} />
            </label>
          </label>
          {form.preview ? <img src={form.preview} alt="Preview" className="h-56 w-full rounded-3xl object-cover" /> : null}
          <div className="flex flex-wrap gap-3"><Button type="submit" loading={saving}>{form.id ? "Save Changes" : "Publish"}</Button><Button type="button" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button></div>
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
