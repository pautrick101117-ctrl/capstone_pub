import { Edit3, Plus, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Card, Modal, PageHeader, Pagination, TableShell, TextInput } from "../../components/ui";

const pageSize = 8;

const emptyForm = { id: "", name: "", position: "", term: "", contact: "", isActive: true, photo: null, preview: "" };

const Admin_Officials = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [officials, setOfficials] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);

  const load = async () => {
    const data = await api("/admin/officials", { token });
    setOfficials(data.officials || []);
  };

  useEffect(() => {
    if (token) load();
  }, [token]);

  const openCreate = () => {
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (official) => {
    setForm({
      id: official.id,
      name: official.name,
      position: official.position,
      term: official.term,
      contact: official.contact || "",
      isActive: official.is_active ?? official.isActive ?? true,
      photo: null,
      preview: official.photo_url || "",
    });
    setOpen(true);
  };

  const save = async (event) => {
    event.preventDefault();
    const formData = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (key === "preview") return;
      if (key === "photo" && value) formData.append("photo", value);
      else if (key !== "photo") formData.append(key, value);
    });
    if (form.preview && !form.photo) formData.append("photoUrl", form.preview);

    try {
      if (form.id) {
        await api(`/admin/officials/${form.id}`, { method: "PATCH", token, body: formData });
        toast.success("Official updated.");
      } else {
        await api("/admin/officials", { method: "POST", token, body: formData });
        toast.success("Official saved.");
      }
      setForm(emptyForm);
      setOpen(false);
      await load();
    } catch (error) {
      toast.error(error.message);
    }
  };

  const toggle = async (official) => {
    try {
      const formData = new FormData();
      formData.append("name", official.name);
      formData.append("position", official.position);
      formData.append("term", official.term);
      formData.append("contact", official.contact || "");
      formData.append("photoUrl", official.photo_url || "");
      formData.append("isActive", `${!(official.is_active ?? official.isActive)}`);
      await api(`/admin/officials/${official.id}`, { method: "PATCH", token, body: formData });
      toast.success("Official status updated.");
      await load();
    } catch (error) {
      toast.error(error.message);
    }
  };

  const totalPages = Math.max(1, Math.ceil(officials.length / pageSize));
  const paginatedOfficials = officials.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Officials"
        title="Manage public official profiles"
        description="Upload photos, maintain terms and positions, and edit records in a modal so the directory can stay full width."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add Official
          </Button>
        }
      />

      <Card>
        <div className="mb-5">
          <h2 className="text-xl font-bold text-[var(--brand-900)]">Official Directory</h2>
          <p className="mt-1 text-sm text-stone-500">The list stays spacious, while create and edit actions open in a focused modal.</p>
        </div>

        <TableShell>
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-stone-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Official</th>
                <th className="px-4 py-3 font-semibold">Position</th>
                <th className="px-4 py-3 font-semibold">Term</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedOfficials.map((official) => {
                const isActive = official.is_active ?? official.isActive;
                return (
                  <tr key={official.id} className="border-t border-stone-100 transition hover:bg-stone-50/70">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        {official.photo_url ? (
                          <img src={official.photo_url} alt={official.name} className="h-14 w-14 rounded-2xl object-cover" />
                        ) : (
                          <div className="h-14 w-14 rounded-2xl bg-[var(--brand-50)]" />
                        )}
                        <div>
                          <p className="font-semibold text-[var(--brand-900)]">{official.name}</p>
                          <p className="text-xs text-stone-500">{official.contact || "No contact listed"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-stone-600">{official.position}</td>
                    <td className="px-4 py-4 text-stone-600">{official.term}</td>
                    <td className="px-4 py-4">
                      <Badge tone={isActive ? "success" : "danger"}>{isActive ? "Active" : "Inactive"}</Badge>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" onClick={() => openEdit(official)}>
                          <Edit3 className="h-4 w-4" />
                          Edit
                        </Button>
                        <Button variant="ghost" onClick={() => toggle(official)}>
                          {isActive ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`${form.id ? "Edit" : "Add"} Official`}
        description="Update official details, upload a profile image, and keep the main table uncluttered."
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
          <TextInput label="Name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          <TextInput label="Position" value={form.position} onChange={(event) => setForm((current) => ({ ...current, position: event.target.value }))} />
          <TextInput label="Term" value={form.term} onChange={(event) => setForm((current) => ({ ...current, term: event.target.value }))} />
          <TextInput label="Contact" value={form.contact} onChange={(event) => setForm((current) => ({ ...current, contact: event.target.value }))} />
          <label className="sm:col-span-2 flex flex-col gap-2 text-sm font-medium text-stone-700">
            <span>Photo Upload</span>
            <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-stone-300 px-4 py-5 text-sm text-stone-500">
              <Upload className="h-4 w-4" />
              <span>{form.photo ? form.photo.name : "Choose photo"}</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  setForm((current) => ({
                    ...current,
                    photo: file || null,
                    preview: file ? URL.createObjectURL(file) : current.preview,
                  }));
                }}
              />
            </label>
          </label>
          {form.preview ? <img src={form.preview} alt="Official preview" className="sm:col-span-2 h-56 w-full rounded-3xl object-cover" /> : null}
          <div className="sm:col-span-2 flex gap-3">
            <Button type="submit">{form.id ? "Save Changes" : "Save Official"}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default Admin_Officials;
