import { Edit3, ImageUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Button, Card, Modal, PageHeader, Pagination, TableShell, TextArea, TextInput } from "../../components/ui";
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
  const [page, setPage] = useState(1);

  const label = type === "news" ? "News" : "Announcements";

  const load = async () => {
    try {
      const data = await api("/admin/announcements", { token });
      setItems((data.announcements || []).filter((item) => item.type === type));
    } catch (error) {
      setItems([]);
      toast.error(error.message || `Unable to load ${label.toLowerCase()}.`);
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
        toast.success(`${label.slice(0, -1)} updated.`);
      } else {
        await api("/admin/announcements", { method: "POST", token, body: formData });
        toast.success(`${label.slice(0, -1)} posted successfully.`);
      }
      setOpen(false);
      setForm(emptyForm);
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      await api(`/admin/announcements/${id}`, { method: "DELETE", token });
      toast.success("Entry deleted.");
      await load();
    } catch (error) {
      toast.error(error.message);
    }
  };

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const paginatedItems = items.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={type === "news" ? "Public News" : "Public Announcements"}
        title={`Manage ${label}`}
        description={`Create, edit, and publish ${type === "news" ? "community stories and updates" : "official notices and alerts"} with a cleaner, wider workspace.`}
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Create {label.slice(0, -1)}
          </Button>
        }
      />

      <Card>
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-[var(--brand-900)]">Published {label}</h2>
            <p className="mt-1 text-sm text-stone-500">Use the table for quick review, then open a modal only when you need to edit content.</p>
          </div>
        </div>

        <TableShell>
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-stone-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Title</th>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Image</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedItems.map((item) => (
                <tr key={item.id} className="border-t border-stone-100 align-top transition hover:bg-stone-50/70">
                  <td className="px-4 py-4">
                    <p className="font-semibold text-[var(--brand-900)]">{item.title}</p>
                    <p className="mt-1 line-clamp-3 max-w-2xl text-xs text-stone-500">{item.body}</p>
                  </td>
                  <td className="px-4 py-4 text-stone-600">{formatDate(item.created_at)}</td>
                  <td className="px-4 py-4">
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.title} className="h-14 w-14 rounded-2xl object-cover" />
                    ) : (
                      <span className="text-stone-400">None</span>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => openEdit(item)}>
                        <Edit3 className="h-4 w-4" />
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => remove(item.id)}>
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`${form.id ? "Edit" : "Create"} ${label.slice(0, -1)}`}
        description="Use the modal for focused editing while keeping the listing area spacious."
      >
        <form className="space-y-4" onSubmit={save}>
          <TextInput label="Title" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
          <TextInput label="Date (optional)" type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} />
          <TextArea label="Body" value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} />
          <label className="flex flex-col gap-2 text-sm font-medium text-stone-700">
            <span>Image Upload</span>
            <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-stone-300 px-4 py-5 text-sm text-stone-500">
              <ImageUp className="h-4 w-4" />
              <span>{form.image ? form.image.name : "Choose image"}</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  setForm((current) => ({
                    ...current,
                    image: file || null,
                    preview: file ? URL.createObjectURL(file) : current.preview,
                  }));
                }}
              />
            </label>
          </label>
          {form.preview ? <img src={form.preview} alt="Preview" className="h-56 w-full rounded-3xl object-cover" /> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={saving}>
              {form.id ? "Save Changes" : "Publish"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default AdminContentPage;
