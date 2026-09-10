import { Pencil, Phone, Plus, Save, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { Badge, Button, Card, Modal, PageHeader, SelectInput, TextArea, TextInput } from "../../components/ui";

const defaultHotline = {
  title: "Barangay Iba Hotline",
  phone: "0917 123 4567",
  hours: "24/7 for urgent community concerns",
  note: "Sample hotline number — update this in Admin Portal > Settings.",
};

const categories = [
  ["purok", "Puroks", "Used by resident accounts, census records, filtering, and reports."],
  ["administration_term", "Administration Terms", "Used by officials, fund sources, and project spending records."],
  ["concern_category", "Community Concern Categories", "Shown when residents report a community concern."],
  ["event_category", "Event Categories", "Used when admins publish public events."],
  ["official_position", "Official Positions", "Used when creating or editing barangay official profiles."],
];

const blankOption = { id: "", category: "purok", label: "", value: "", sortOrder: 0, isActive: true };

const Admin_Settings = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [hotline, setHotline] = useState(defaultHotline);
  const [contact, setContact] = useState({ phone: "", email: "", address: "", facebook: "" });
  const [masterItems, setMasterItems] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("purok");
  const [optionForm, setOptionForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [contentData, masterData] = await Promise.all([
        api("/admin/content", { token }),
        api("/master-data/admin", { token }),
      ]);
      setHotline({ ...defaultHotline, ...(contentData.content?.hotline || {}) });
      setContact({ phone: "", email: "", address: "", facebook: "", ...(contentData.content?.contact || {}) });
      setMasterItems(masterData.items || []);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const savePortalSettings = async (event) => {
    event.preventDefault();
    if (!hotline.title.trim() || !hotline.phone.trim()) return toast.error("Hotline title and phone number are required.");
    setSaving(true);
    try {
      const data = await api("/admin/content", { method: "PUT", token, body: { hotline, contact } });
      toast.success(data.message || "Portal settings saved successfully.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const visibleOptions = useMemo(
    () => masterItems.filter((item) => item.category === selectedCategory),
    [masterItems, selectedCategory]
  );

  const openCreate = () => setOptionForm({ ...blankOption, category: selectedCategory });
  const openEdit = (item) => setOptionForm({ id: item.id, category: item.category, label: item.label, value: item.value, sortOrder: item.sort_order, isActive: item.is_active });

  const saveOption = async (event) => {
    event.preventDefault();
    if (!optionForm?.label.trim()) return toast.error("Option label is required.");
    setSaving(true);
    try {
      const path = optionForm.id ? `/master-data/admin/${optionForm.id}` : "/master-data/admin";
      const method = optionForm.id ? "PATCH" : "POST";
      const data = await api(path, { method, token, body: optionForm });
      toast.success(data.message || "Option saved.");
      setOptionForm(null);
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleOption = async (item) => {
    try {
      await api(`/master-data/admin/${item.id}`, { method: "PATCH", token, body: { isActive: !item.is_active } });
      toast.success(`${item.label} ${item.is_active ? "disabled" : "enabled"}. Historical records are unchanged.`);
      await load();
    } catch (error) {
      toast.error(error.message);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Portal Configuration" title="Settings" description="Manage the contact information and controlled lists used by live portal forms. Disable options instead of deleting them so historical records remain readable." />

      {loading ? <Card><p className="text-sm text-stone-500">Loading settings...</p></Card> : (
        <>
          <form className="grid gap-6 xl:grid-cols-2" onSubmit={savePortalSettings}>
            <Card>
              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-2xl bg-rose-100 p-3 text-rose-700"><Phone className="h-5 w-5" /></div>
                <div><h2 className="text-xl font-bold text-[var(--brand-900)]">Community Hotline</h2><p className="text-sm text-stone-500">Shown on Resident Portal → Community Concerns.</p></div>
              </div>
              <div className="space-y-4">
                <TextInput label="Hotline Name" required maxLength={80} value={hotline.title} onChange={(e) => setHotline((v) => ({ ...v, title: e.target.value }))} />
                <TextInput label="Phone Number" required type="tel" inputMode="tel" maxLength={30} value={hotline.phone} onChange={(e) => setHotline((v) => ({ ...v, phone: e.target.value }))} />
                <TextInput label="Hours / Availability" maxLength={100} value={hotline.hours} onChange={(e) => setHotline((v) => ({ ...v, hours: e.target.value }))} />
                <TextArea label="Resident Note" maxLength={300} value={hotline.note} onChange={(e) => setHotline((v) => ({ ...v, note: e.target.value }))} />
              </div>
            </Card>
            <Card>
              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><ShieldCheck className="h-5 w-5" /></div>
                <div><h2 className="text-xl font-bold text-[var(--brand-900)]">Barangay Contact</h2><p className="text-sm text-stone-500">General contact details used by public/help pages.</p></div>
              </div>
              <div className="space-y-4">
                <TextInput label="Phone" type="tel" inputMode="tel" maxLength={30} value={contact.phone || ""} onChange={(e) => setContact((v) => ({ ...v, phone: e.target.value }))} />
                <TextInput label="Email" type="email" maxLength={180} value={contact.email || ""} onChange={(e) => setContact((v) => ({ ...v, email: e.target.value }))} />
                <TextInput label="Address" maxLength={180} value={contact.address || ""} onChange={(e) => setContact((v) => ({ ...v, address: e.target.value }))} />
                <TextInput label="Facebook" maxLength={180} value={contact.facebook || ""} onChange={(e) => setContact((v) => ({ ...v, facebook: e.target.value }))} />
              </div>
            </Card>
            <div className="xl:col-span-2 flex justify-end"><Button type="submit" loading={saving}><Save className="h-4 w-4" /> Save Contact Settings</Button></div>
          </form>

          <Card>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-xl font-bold text-[var(--brand-900)]">Controlled Form Options</h2>
                <p className="mt-1 max-w-3xl text-sm text-stone-500">These lists prevent inconsistent free-text values such as “Purok1”, “purok 1”, or different spellings of the same category.</p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <SelectInput label="Manage list" value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
                  {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </SelectInput>
                <Button type="button" onClick={openCreate}><Plus className="h-4 w-4" /> Add Option</Button>
              </div>
            </div>

            <p className="mt-4 text-sm text-stone-500">{categories.find(([value]) => value === selectedCategory)?.[2]}</p>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleOptions.map((item) => (
                <div key={item.id} className="rounded-2xl border border-stone-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="font-semibold text-[var(--brand-900)]">{item.label}</p><p className="mt-1 text-xs text-stone-400">Order {item.sort_order}</p></div>
                    <Badge tone={item.is_active ? "success" : "neutral"}>{item.is_active ? "Active" : "Disabled"}</Badge>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button type="button" variant="secondary" onClick={() => openEdit(item)}><Pencil className="h-4 w-4" /> Edit</Button>
                    <Button type="button" variant="ghost" onClick={() => toggleOption(item)}>{item.is_active ? "Disable" : "Enable"}</Button>
                  </div>
                </div>
              ))}
              {!visibleOptions.length ? <p className="text-sm text-stone-500">No options configured for this list yet.</p> : null}
            </div>
          </Card>
        </>
      )}

      <Modal open={Boolean(optionForm)} onClose={() => !saving && setOptionForm(null)} title={optionForm?.id ? "Edit controlled option" : "Add controlled option"} description="The label is what residents and admins see. Existing records are preserved if an option is later disabled." widthClass="max-w-xl">
        {optionForm ? (
          <form className="space-y-4" onSubmit={saveOption}>
            <SelectInput label="List" value={optionForm.category} disabled={Boolean(optionForm.id)} onChange={(e) => setOptionForm((v) => ({ ...v, category: e.target.value }))}>
              {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </SelectInput>
            <TextInput label="Display Label" required maxLength={100} value={optionForm.label} onChange={(e) => setOptionForm((v) => ({ ...v, label: e.target.value }))} hint="Example: Purok 1 or Barangay Captain." />
            <TextInput label="Sort Order" type="number" step="1" min="0" value={optionForm.sortOrder} onChange={(e) => setOptionForm((v) => ({ ...v, sortOrder: e.target.value }))} />
            <label className="flex items-center gap-3 rounded-2xl border border-stone-200 p-4 text-sm font-medium text-stone-700"><input type="checkbox" checked={optionForm.isActive} onChange={(e) => setOptionForm((v) => ({ ...v, isActive: e.target.checked }))} /> Available in new forms</label>
            <div className="flex gap-3"><Button type="submit" loading={saving}>Save Option</Button><Button type="button" variant="ghost" onClick={() => setOptionForm(null)} disabled={saving}>Cancel</Button></div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
};

export default Admin_Settings;
