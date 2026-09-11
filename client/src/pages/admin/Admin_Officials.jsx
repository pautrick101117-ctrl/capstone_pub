import { Edit3, Plus, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useMasterData } from "../../hooks/useMasterData";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingState, Modal, PageHeader, Pagination, SelectInput, TableShell, TextInput } from "../../components/ui";

const pageSize = 8;

const emptyForm = { id: "", name: "", position: "", term: "", contact: "", isActive: true, photo: null, preview: "" };

const Admin_Officials = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [officials, setOfficials] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [toggleTarget, setToggleTarget] = useState(null);
  const { options: positionOptions } = useMasterData("official_position");
  const { options: termOptions } = useMasterData("administration_term");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api("/admin/officials", { token });
      setOfficials(data.officials || []);
    } catch (loadError) {
      setError(loadError.message || "Unable to load officials.");
    } finally {
      setLoading(false);
    }
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
    setSaving(true);
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
    } catch (saveError) {
      toast.error(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async () => {
    if (!toggleTarget) return;
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("name", toggleTarget.name);
      formData.append("position", toggleTarget.position);
      formData.append("term", toggleTarget.term);
      formData.append("contact", toggleTarget.contact || "");
      formData.append("photoUrl", toggleTarget.photo_url || "");
      formData.append("isActive", `${!(toggleTarget.is_active ?? toggleTarget.isActive)}`);
      await api(`/admin/officials/${toggleTarget.id}`, { method: "PATCH", token, body: formData });
      toast.success("Official status updated.");
      setToggleTarget(null);
      await load();
    } catch (toggleError) {
      toast.error(toggleError.message);
    } finally {
      setSaving(false);
    }
  };

  const paginatedOfficials = officials.slice((page - 1) * pageSize, page * pageSize);

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

      {error ? <ErrorState description={error} onRetry={load} /> : null}
      {!error && loading ? <LoadingState rows={5} /> : null}
      {!error && !loading ? <Card>
        <div className="mb-5">
          <h2 className="text-xl font-bold text-[var(--brand-900)]">Official Directory</h2>
          <p className="mt-1 text-sm text-stone-500">The list stays spacious, while create and edit actions open in a focused modal.</p>
        </div>

        {officials.length === 0 ? <EmptyState title="No officials configured" description="Add the first official profile to publish the barangay directory." action={<Button onClick={openCreate}>Add Official</Button>} /> : <>
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
                        <Button variant="ghost" onClick={() => setToggleTarget(official)}>
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
        <Pagination page={page} totalPages={Math.max(1, Math.ceil(officials.length / pageSize))} onPageChange={setPage} />
        </>}
      </Card> : null}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`${form.id ? "Edit" : "Add"} Official`}
        description="Update official details, upload a profile image, and keep the main table uncluttered."
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
          <TextInput label="Name" required maxLength={120} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          <SelectInput label="Position" required value={form.position} onChange={(event) => setForm((current) => ({ ...current, position: event.target.value }))}><option value="">Select position</option>{positionOptions.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</SelectInput>
          <SelectInput label="Administration Term" required value={form.term} onChange={(event) => setForm((current) => ({ ...current, term: event.target.value }))}><option value="">Select term</option>{termOptions.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</SelectInput>
          <TextInput label="Contact" type="tel" inputMode="tel" maxLength={20} value={form.contact} onChange={(event) => setForm((current) => ({ ...current, contact: event.target.value }))} />
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
            <Button type="submit" loading={saving}>{form.id ? "Save Changes" : "Save Official"}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={Boolean(toggleTarget)} onClose={() => !saving && setToggleTarget(null)} onConfirm={toggle} loading={saving} tone={(toggleTarget?.is_active ?? toggleTarget?.isActive) ? "danger" : "info"} title={(toggleTarget?.is_active ?? toggleTarget?.isActive) ? `Deactivate ${toggleTarget?.name || "this official"}?` : `Activate ${toggleTarget?.name || "this official"}?`} description={(toggleTarget?.is_active ?? toggleTarget?.isActive) ? "This profile will no longer appear as an active official on the public directory. Historical records remain unchanged." : "This profile will become active and visible in the public directory again."} confirmLabel={(toggleTarget?.is_active ?? toggleTarget?.isActive) ? "Deactivate Official" : "Activate Official"} />
    </div>
  );
};

export default Admin_Officials;

