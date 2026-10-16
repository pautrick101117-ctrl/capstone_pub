import { useReviewAction, useUnsavedForm, useUnsavedNavigation, reviewChanges } from "../../components/ActionReviewProvider";
import { Pencil, Phone, Plus, Save, ShieldCheck, ClipboardList } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { Badge, Button, Card, ConfirmDialog, ErrorState, LoadingState, Modal, PageHeader, Pagination, SegmentedTabs, SelectInput, TextArea, TextInput } from "../../components/ui";

const categories = [
  ["purok", "Puroks", "Used by resident accounts, census records, filtering, and reports."],
  ["administration_term", "Administration Terms", "Used by officials, fund sources, and project spending records."],
  ["concern_category", "Community Concern Categories", "Shown when residents report a community concern."],
  ["event_category", "Event Categories", "Used when admins publish public events."],
  ["official_position", "Official Positions", "Used when creating or editing barangay official profiles."],
];

const blankOption = { id: "", category: "purok", label: "", value: "", sortOrder: 0, isActive: true };
const optionPageSize = 9;
const initialConcernLimits = { enabled: false, rolling_window: { max_submissions: 3, period_days: 7 }, unresolved_limit: { enabled: true, max_concerns: 5 } };

const Admin_Settings = () => {
  const { token } = useAuth();
  const reviewAction = useReviewAction();
  const toast = useToast();
  const [hotlines, setHotlines] = useState([]);
  const [concernLimits, setConcernLimits] = useState(initialConcernLimits);
  const [concernLimitsSnapshot, setConcernLimitsSnapshot] = useState(null);
  const [concernLimitsVersion, setConcernLimitsVersion] = useState(null);
  const [hotlinesSnapshot, setHotlinesSnapshot] = useState(null);
  const [hotlinesVersion, setHotlinesVersion] = useState(null);
  const [contact, setContact] = useState({ phone: "", email: "", address: "", facebook: "" });
  const [masterItems, setMasterItems] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("purok");
  const [optionForm, setOptionForm] = useState(null);
  const [optionSnapshot, setOptionSnapshot] = useState(null);
  const [publicSnapshot, setPublicSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("public");
  const [toggleTarget, setToggleTarget] = useState(null);
  const [optionPage, setOptionPage] = useState(1);

  const optionGuard = useUnsavedForm({ initial: optionSnapshot, current: optionForm, enabled: Boolean(optionForm) });
  const publicGuard = useUnsavedForm({ initial: publicSnapshot, current: contact, enabled: activeTab === "public" && Boolean(publicSnapshot) });
  const hotlinesGuard = useUnsavedForm({ initial: hotlinesSnapshot, current: hotlines, enabled: activeTab === "system" && Boolean(hotlinesSnapshot) });
  const concernLimitsGuard = useUnsavedForm({ initial: concernLimitsSnapshot, current: concernLimits, enabled: activeTab === "system" && Boolean(concernLimitsSnapshot) });
  useUnsavedNavigation(optionGuard.dirty || publicGuard.dirty || hotlinesGuard.dirty || concernLimitsGuard.dirty);
  const closeOption = () => optionGuard.closeSafely(() => setOptionForm(null));
  const switchTab = async (nextTab) => {
    if (nextTab === activeTab) return;
    if (activeTab === "public" && publicGuard.dirty) {
      const discard = await reviewAction({ title: "Discard unsaved settings?", description: "Your edits to public contact information have not been saved.", tone: "danger", confirmLabel: "Discard Changes", cancelLabel: "Keep Editing" });
      if (!discard) return;
      setContact({ ...publicSnapshot });
    }
    if (activeTab === "system" && hotlinesGuard.dirty) {
      const discard = await reviewAction({ title: "Discard unsaved hotline changes?", description: "Your edits to the community hotlines have not been saved.", tone: "danger", confirmLabel: "Discard Changes", cancelLabel: "Keep Editing" });
      if (!discard) return;
      setHotlines(hotlinesSnapshot.map((item) => ({ ...item })));
    }
    if (activeTab === "system" && concernLimitsGuard.dirty) {
      const discard = await reviewAction({ title: "Discard unsaved concern limits?", description: "Your concern submission policy changes have not been saved.", tone: "danger", confirmLabel: "Discard Changes", cancelLabel: "Keep Editing" });
      if (!discard) return;
      setConcernLimits(structuredClone(concernLimitsSnapshot));
    }
    setActiveTab(nextTab);
  };

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [contentData, masterData, systemData, concernData] = await Promise.all([
        api("/admin/content", { token }),
        api("/master-data/admin", { token }),
        api("/admin/system-setup/hotlines", { token }),
        api("/admin/system-setup/concern-limits", { token }),
      ]);
      const nextContact = { phone: "", email: "", address: "", facebook: "", ...(contentData.content?.contact || {}) };
      setContact(nextContact);
      setPublicSnapshot({ ...nextContact });
      const nextHotlines = (systemData.hotlines || []).map((item) => ({ ...item }));
      setHotlines(nextHotlines);
      setHotlinesSnapshot(nextHotlines.map((item) => ({ ...item })));
      setHotlinesVersion(systemData.updated_at);
      setConcernLimits(structuredClone(concernData.policy));
      setConcernLimitsSnapshot(structuredClone(concernData.policy));
      setConcernLimitsVersion(concernData.updated_at);
      setMasterItems(masterData.items || []);
    } catch (loadError) {
      setError(loadError.message || "Unable to load portal settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const savePortalSettings = async (event) => {
    event.preventDefault();
    if (!await reviewAction({ title: "Save Public Contact Settings?", description: "Update the barangay general office contact details.", before: publicSnapshot, after: contact, confirmLabel: "Save Settings" })) return;
    setSaving(true);
    try {
      const data = await api("/admin/content", { method: "PUT", token, body: { contact } });
      setPublicSnapshot({ ...contact });
      toast.success(data.message || "Portal settings saved successfully.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const changeHotline = (index, name, value) => setHotlines((items) =>
    items.map((item, i) => i === index ? { ...item, [name]: value } : item)
  );

  const saveHotlines = async (event) => {
    event.preventDefault();
    if (!hotlinesGuard.dirty) return;
    if (!await reviewAction({ title: "Save Community Hotlines?", description: "The new contact numbers will appear on resident and public pages.", before: hotlinesSnapshot, after: hotlines, confirmLabel: "Save Hotlines" })) return;
    setSaving(true);
    try {
      const result = await api("/admin/system-setup/hotlines", { method: "PUT", token,
        body: { hotlines, expectedUpdatedAt: hotlinesVersion } });
      const saved = result.hotlines.map((item) => ({ ...item }));
      setHotlines(saved);
      setHotlinesSnapshot(saved.map((item) => ({ ...item })));
      setHotlinesVersion(result.updated_at);
      toast.success(result.message || "Community hotlines updated.");
    } catch (saveError) {
      toast.error(saveError.message || "Unable to save community hotlines.");
    } finally { setSaving(false); }
  };

  const changeConcernLimit = (section, key, value) => setConcernLimits((current) => ({
    ...current, [section]: { ...current[section], [key]: value },
  }));

  const saveConcernLimits = async (event) => {
    event.preventDefault();
    if (!concernLimitsGuard.dirty) return;
    if (!await reviewAction({ title: "Update Concern Submission Limits?", description: "These settings affect future resident concern submissions. Existing concerns will not be changed.", before: concernLimitsSnapshot, after: concernLimits, confirmLabel: "Save Concern Limits" })) return;
    setSaving(true);
    try {
      const result = await api("/admin/system-setup/concern-limits", { method: "PUT", token,
        body: { policy: concernLimits, expectedUpdatedAt: concernLimitsVersion } });
      setConcernLimits(structuredClone(result.policy));
      setConcernLimitsSnapshot(structuredClone(result.policy));
      setConcernLimitsVersion(result.updated_at);
      toast.success(result.message || "Concern limits saved.");
    } catch (saveError) {
      toast.error(saveError.message || "Unable to save concern limits.");
    } finally { setSaving(false); }
  };

  const visibleOptions = useMemo(
    () => masterItems.filter((item) => item.category === selectedCategory),
    [masterItems, selectedCategory]
  );
  const optionTotalPages = Math.max(1, Math.ceil(visibleOptions.length / optionPageSize));
  const pagedOptions = useMemo(
    () => visibleOptions.slice((optionPage - 1) * optionPageSize, optionPage * optionPageSize),
    [visibleOptions, optionPage]
  );

  useEffect(() => {
    setOptionPage(1);
  }, [selectedCategory]);

  useEffect(() => {
    if (optionPage > optionTotalPages) setOptionPage(optionTotalPages);
  }, [optionPage, optionTotalPages]);

  const openCreate = () => { setOptionSnapshot({ ...blankOption, category: selectedCategory }); setOptionForm({ ...blankOption, category: selectedCategory }); };
  const openEdit = (item) => { const value = { id: item.id, category: item.category, label: item.label, value: item.value, sortOrder: item.sort_order, isActive: item.is_active }; setOptionSnapshot(value); setOptionForm(value); };

  const saveOption = async (event) => {
    event.preventDefault();
    if (!optionForm?.label.trim()) return toast.error("Option label is required.");
    if (!await reviewAction({ title: optionForm.id ? "Confirm List Option Changes" : "Add List Option?", subject: optionForm.label, before: masterItems.find((item) => item.id === optionForm.id) || {}, after: optionForm, confirmLabel: "Save Option" })) return;
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

  const toggleOption = async () => {
    if (!toggleTarget) return;
    setSaving(true);
    try {
      await api(`/master-data/admin/${toggleTarget.id}`, { method: "PATCH", token, body: { isActive: !toggleTarget.is_active } });
      toast.success(`${toggleTarget.label} ${toggleTarget.is_active ? "disabled" : "enabled"}. Historical records are unchanged.`);
      setToggleTarget(null);
      await load();
    } catch (toggleError) {
      toast.error(toggleError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Portal Configuration" title="Settings" description="Manage public contacts, community hotlines and controlled options for resident services." />
      <SegmentedTabs value={activeTab} onChange={switchTab} items={[{ value: "public", label: "Public Information" }, { value: "system", label: "System Setup" }, { value: "master", label: "Master Data" }]} />
      {loading ? <LoadingState rows={5} /> : error ? <ErrorState description={error} onRetry={load} /> : (
        <>
          {activeTab === "public" ? <form className="grid gap-6" onSubmit={savePortalSettings}>
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
            <div className="flex justify-end"><Button type="submit" loading={saving} disabled={!publicGuard.dirty}><Save className="h-4 w-4" /> Save Contact Settings</Button></div>
          </form> : null}

          {activeTab === "system" ? <form className="space-y-5" onSubmit={saveHotlines}>
            <Card>
              <div className="mb-5 flex items-start gap-3">
                <div className="rounded-2xl bg-rose-100 p-3 text-rose-700"><Phone className="h-5 w-5" /></div>
                <div><h2 className="text-xl font-bold text-[var(--brand-900)]">Community Hotline Settings</h2>
                  <p className="mt-1 text-sm text-stone-500">These contact numbers appear in Community Concerns, Help Center and the public website. Add operating hours only when confirmed.</p>
                </div>
              </div>
              <div className="grid gap-5 xl:grid-cols-2">
                {hotlines.map((item, index) => <div key={item.id} className="space-y-4 rounded-2xl border border-stone-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-bold text-[var(--brand-900)]">Hotline {index + 1}</h3>
                    <label className="flex items-center gap-2 text-sm font-semibold text-stone-700">
                      <input type="checkbox" checked={item.is_active} onChange={(event) => changeHotline(index, "is_active", event.target.checked)} className="h-4 w-4 accent-emerald-700" /> Active
                    </label>
                  </div>
                  <TextInput label="Display Name" required maxLength={80} value={item.label} onChange={(event) => changeHotline(index, "label", event.target.value)} />
                  <TextInput label="Phone Number" required={item.is_active} type="tel" inputMode="tel" maxLength={24} hint="09XXXXXXXXX or +639XXXXXXXXX" value={item.phone} onChange={(event) => changeHotline(index, "phone", event.target.value)} />
                  <TextInput label="Hours / Availability (Optional)" maxLength={100} placeholder="Leave blank if unconfirmed" value={item.hours} onChange={(event) => changeHotline(index, "hours", event.target.value)} />
                  <TextArea label="Resident Instructions (Optional)" maxLength={300} value={item.note} onChange={(event) => changeHotline(index, "note", event.target.value)} />
                </div>)}
              </div>
              <p className="mt-4 text-xs text-stone-500">At least one hotline must remain active. General office contact information stays under Public Information. Concern submission limits can be configured independently below.</p>
            </Card>
            <div className="flex justify-end"><Button type="submit" loading={saving} disabled={!hotlinesGuard.dirty}><Save className="h-4 w-4" /> Save Hotline Settings</Button></div>
          </form> : null}

          {activeTab === "system" ? <form className="space-y-5" onSubmit={saveConcernLimits}>
            <Card>
              <div className="mb-5 flex items-start gap-3">
                <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-700"><ClipboardList className="h-5 w-5" /></div>
                <div><h2 className="text-xl font-bold text-[var(--brand-900)]">Community Concern Submission Limits</h2>
                  <p className="mt-1 text-sm text-stone-500">Limit new concern submissions per resident. Existing concerns and hotline access always remain available.</p></div>
              </div>
              <label className="flex items-center gap-3 rounded-2xl bg-stone-50 p-4 text-sm font-semibold text-stone-800">
                <input type="checkbox" checked={concernLimits.enabled} onChange={(event) => setConcernLimits((v) => ({ ...v, enabled: event.target.checked }))} className="h-5 w-5 accent-emerald-700" />
                Enable concern submission limits
              </label>
              {!concernLimits.enabled ? <p className="mt-3 text-sm text-stone-500">Currently disabled: residents can submit concerns using the normal form validation. Enable only after testing.</p> : null}
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <TextInput label="Maximum New Submissions" required type="number" min="1" max="100" step="1" value={concernLimits.rolling_window.max_submissions} onChange={(e) => changeConcernLimit("rolling_window", "max_submissions", Number(e.target.value))} hint="Per resident, within the rolling period." />
                <TextInput label="Rolling Period (Days)" required type="number" min="1" max="365" step="1" value={concernLimits.rolling_window.period_days} onChange={(e) => changeConcernLimit("rolling_window", "period_days", Number(e.target.value))} hint="For example, 7 means the preceding 168 hours." />
              </div>
              <label className="mt-5 flex items-center gap-3 text-sm font-semibold text-stone-800">
                <input type="checkbox" checked={concernLimits.unresolved_limit.enabled} onChange={(e) => changeConcernLimit("unresolved_limit", "enabled", e.target.checked)} className="h-5 w-5 accent-emerald-700" />
                Also limit unresolved concerns (Pending and Under Review)
              </label>
              <div className="mt-4 max-w-sm"><TextInput label="Maximum Unresolved Concerns" required type="number" min="1" max="100" step="1" disabled={!concernLimits.unresolved_limit.enabled} value={concernLimits.unresolved_limit.max_concerns} onChange={(e) => changeConcernLimit("unresolved_limit", "max_concerns", Number(e.target.value))} hint="Resolved concerns no longer count as unresolved." /></div>
              <p className="mt-4 text-sm text-stone-500">Limits apply only to future submissions. Lowering them never deletes, closes, or edits existing concerns.</p>
            </Card>
            <div className="flex justify-end"><Button type="submit" loading={saving} disabled={!concernLimitsGuard.dirty}><Save className="h-4 w-4" /> Save Concern Limits</Button></div>
          </form> : null}

          {activeTab === "master" ? <Card>
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
              {pagedOptions.map((item) => (
                <div key={item.id} className="rounded-2xl border border-stone-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="font-semibold text-[var(--brand-900)]">{item.label}</p><p className="mt-1 text-xs text-stone-400">Order {item.sort_order}</p></div>
                    <Badge tone={item.is_active ? "success" : "neutral"}>{item.is_active ? "Active" : "Disabled"}</Badge>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button type="button" variant="secondary" onClick={() => openEdit(item)}><Pencil className="h-4 w-4" /> Edit</Button>
                    <Button type="button" variant="ghost" onClick={() => setToggleTarget(item)}>{item.is_active ? "Disable" : "Enable"}</Button>
                  </div>
                </div>
              ))}
              {!visibleOptions.length ? <p className="text-sm text-stone-500">No options configured for this list yet.</p> : null}
            </div>
            {optionTotalPages > 1 ? <div className="mt-5"><Pagination page={optionPage} totalPages={optionTotalPages} onPageChange={setOptionPage} /></div> : null}
          </Card> : null}
        </>
      )}

      <Modal open={Boolean(optionForm)} onClose={() => !saving && closeOption()} title={optionForm?.id ? "Edit controlled option" : "Add controlled option"} description="The label is what residents and admins see. Existing records are preserved if an option is later disabled." widthClass="max-w-xl">
        {optionForm ? (
          <form className="space-y-4" onSubmit={saveOption}>
            <SelectInput label="List" value={optionForm.category} disabled={Boolean(optionForm.id)} onChange={(e) => setOptionForm((v) => ({ ...v, category: e.target.value }))}>
              {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </SelectInput>
            <TextInput label="Display Label" required maxLength={100} value={optionForm.label} onChange={(e) => setOptionForm((v) => ({ ...v, label: e.target.value }))} hint="Example: Purok 1 or Barangay Captain." />
            <TextInput label="Sort Order" type="number" step="1" min="0" value={optionForm.sortOrder} onChange={(e) => setOptionForm((v) => ({ ...v, sortOrder: e.target.value }))} />
            <label className="flex items-center gap-3 rounded-2xl border border-stone-200 p-4 text-sm font-medium text-stone-700"><input type="checkbox" checked={optionForm.isActive} onChange={(e) => setOptionForm((v) => ({ ...v, isActive: e.target.checked }))} /> Available in new forms</label>
            <div className="flex gap-3"><Button type="submit" loading={saving}>Save Option</Button><Button type="button" variant="ghost" onClick={closeOption} disabled={saving}>Cancel</Button></div>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(toggleTarget)}
        onClose={() => !saving && setToggleTarget(null)}
        onConfirm={toggleOption}
        loading={saving}
        tone={toggleTarget?.is_active ? "danger" : "info"}
        title={toggleTarget?.is_active ? `Disable ${toggleTarget?.label || "this option"}?` : `Enable ${toggleTarget?.label || "this option"}?`}
        description={toggleTarget?.is_active ? "It will disappear from new forms, while historical records that already use it will remain unchanged." : "This option will become available in new forms again."}
        confirmLabel={toggleTarget?.is_active ? "Disable Option" : "Enable Option"}
      />
    </div>
  );
};

export default Admin_Settings;


