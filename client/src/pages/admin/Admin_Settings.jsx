import { BellRing, FileClock, Globe2, Save, Settings, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { AlertBanner, Button, Card, EmptyState, PageError, PageHeader, Pagination, SelectInput, Tabs, TextArea, TextInput } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

const auditPageSize = 12;

const tabs = [
  { value: "content", label: "Portal Content" },
  { value: "preferences", label: "Preferences" },
  { value: "notifications", label: "Notifications" },
  { value: "audit", label: "Audit Logs" },
];

const Admin_Settings = () => {
  const { token, user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState("content");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState([]);
  const [auditPage, setAuditPage] = useState(1);
  const [content, setContent] = useState({ heroTitle: "", heroDescription: "", phone: "", email: "", address: "", facebook: "" });
  const [settings, setSettings] = useState({ resident_login_enabled: true, maintenance_mode: false, timezone: "Asia/Manila", date_format: "MM-DD-YYYY", complaint_email_alerts: true, notification_email: "" });

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [contentData, settingsData, logsData] = await Promise.all([
        api("/admin/content", { token }),
        api("/admin/settings", { token }),
        api("/admin/audit-logs", { token }),
      ]);
      const hero = contentData.content?.hero || {};
      const contact = contentData.content?.contact || {};
      setContent({ heroTitle: hero.title || "", heroDescription: hero.description || "", phone: contact.phone || "", email: contact.email || "", address: contact.address || "", facebook: contact.facebook || "" });
      setSettings((current) => ({ ...current, ...(settingsData.settings || {}) }));
      setLogs(logsData.logs || []);
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (token) load(); }, [token]);

  const auditTotalPages = Math.max(1, Math.ceil(logs.length / auditPageSize));
  useEffect(() => { if (auditPage > auditTotalPages) setAuditPage(auditTotalPages); }, [auditPage, auditTotalPages]);
  const paginatedLogs = logs.slice((auditPage - 1) * auditPageSize, auditPage * auditPageSize);

  const saveContent = async () => {
    setSaving(true);
    try {
      await api("/admin/content", { method: "PUT", token, body: { hero: { title: content.heroTitle, description: content.heroDescription }, contact: { phone: content.phone, email: content.email, address: content.address, facebook: content.facebook } } });
      toast.success("Portal content saved.");
    } catch (saveError) { toast.error(saveError.message); }
    finally { setSaving(false); }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const data = await api("/admin/settings", { method: "PUT", token, body: settings });
      setSettings((current) => ({ ...current, ...(data.settings || {}) }));
      toast.success("Portal settings saved.");
    } catch (saveError) { toast.error(saveError.message); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="text-sm text-stone-500">Loading portal settings...</div>;

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Administration" title="Portal settings" description="Manage public content, resident access, portal preferences, alert delivery, and audit history from one place." />
      {error ? <PageError message={error} onRetry={load} /> : null}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === "content" ? (
        <Card className="space-y-5">
          <div className="flex items-center gap-3"><Globe2 className="h-5 w-5 text-[var(--brand-600)]" /><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Public landing page</h2><p className="text-sm text-stone-500">These fields are stored in Supabase and immediately feed the public portal.</p></div></div>
          <TextInput label="Hero Title" value={content.heroTitle} onChange={(event) => setContent((current) => ({ ...current, heroTitle: event.target.value }))} />
          <TextArea label="Hero Description" value={content.heroDescription} onChange={(event) => setContent((current) => ({ ...current, heroDescription: event.target.value }))} />
          <div className="grid gap-4 sm:grid-cols-2"><TextInput label="Phone" value={content.phone} onChange={(event) => setContent((current) => ({ ...current, phone: event.target.value }))} /><TextInput label="Email" type="email" value={content.email} onChange={(event) => setContent((current) => ({ ...current, email: event.target.value }))} /><TextInput label="Address" value={content.address} onChange={(event) => setContent((current) => ({ ...current, address: event.target.value }))} /><TextInput label="Facebook" value={content.facebook} onChange={(event) => setContent((current) => ({ ...current, facebook: event.target.value }))} /></div>
          <Button onClick={saveContent} loading={saving}><Save className="h-4 w-4" />Save Public Content</Button>
        </Card>
      ) : null}

      {tab === "preferences" ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card className="space-y-5"><div className="flex items-center gap-3"><Settings className="h-5 w-5 text-[var(--brand-600)]" /><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Portal preferences</h2><p className="text-sm text-stone-500">These settings persist in the database.</p></div></div>
            <SelectInput label="Time Zone" value={settings.timezone} onChange={(event) => setSettings((current) => ({ ...current, timezone: event.target.value }))}><option value="Asia/Manila">Asia/Manila (GMT+8)</option></SelectInput>
            <SelectInput label="Date Format" value={settings.date_format} onChange={(event) => setSettings((current) => ({ ...current, date_format: event.target.value }))}><option value="MM-DD-YYYY">MM-DD-YYYY</option><option value="DD-MM-YYYY">DD-MM-YYYY</option><option value="YYYY-MM-DD">YYYY-MM-DD</option></SelectInput>
          </Card>
          <Card className="space-y-5"><div className="flex items-center gap-3"><ShieldCheck className="h-5 w-5 text-[var(--brand-600)]" /><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Resident access</h2><p className="text-sm text-stone-500">Changes are enforced by the Express login endpoint.</p></div></div>
            <label className="flex items-center justify-between gap-4 rounded-2xl border border-stone-200 p-4"><div><p className="font-semibold text-stone-800">Resident Login</p><p className="text-sm text-stone-500">Allow approved residents to sign in.</p></div><input type="checkbox" checked={Boolean(settings.resident_login_enabled)} onChange={(event) => setSettings((current) => ({ ...current, resident_login_enabled: event.target.checked }))} className="h-5 w-5 accent-emerald-700" /></label>
            <label className="flex items-center justify-between gap-4 rounded-2xl border border-stone-200 p-4"><div><p className="font-semibold text-stone-800">Maintenance Mode</p><p className="text-sm text-stone-500">Temporarily block resident logins while admins keep access.</p></div><input type="checkbox" checked={Boolean(settings.maintenance_mode)} onChange={(event) => setSettings((current) => ({ ...current, maintenance_mode: event.target.checked }))} className="h-5 w-5 accent-emerald-700" /></label>
            {settings.maintenance_mode ? <AlertBanner tone="warning" title="Maintenance mode is enabled">Resident logins will be blocked until this is disabled.</AlertBanner> : null}
          </Card>
          <div className="xl:col-span-2"><Button onClick={saveSettings} loading={saving}><Save className="h-4 w-4" />Save Preferences</Button></div>
        </div>
      ) : null}

      {tab === "notifications" ? (
        <Card className="max-w-3xl space-y-5">
          <div className="flex items-center gap-3"><BellRing className="h-5 w-5 text-[var(--brand-600)]" /><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Complaint alerts</h2><p className="text-sm text-stone-500">New resident complaints can send an email alert to the barangay office.</p></div></div>
          <TextInput label="Notification Email" type="email" value={settings.notification_email || ""} onChange={(event) => setSettings((current) => ({ ...current, notification_email: event.target.value }))} />
          <label className="flex items-center justify-between gap-4 rounded-2xl border border-stone-200 p-4"><div><p className="font-semibold text-stone-800">Email New Complaint Alerts</p><p className="text-sm text-stone-500">Uses the Gmail App Password configured on the server.</p></div><input type="checkbox" checked={Boolean(settings.complaint_email_alerts)} onChange={(event) => setSettings((current) => ({ ...current, complaint_email_alerts: event.target.checked }))} className="h-5 w-5 accent-emerald-700" /></label>
          <Button onClick={saveSettings} loading={saving}><Save className="h-4 w-4" />Save Notification Settings</Button>
        </Card>
      ) : null}

      {tab === "audit" ? (
        <Card>
          <div className="mb-5 flex items-center gap-3"><FileClock className="h-5 w-5 text-[var(--brand-600)]" /><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Recent audit activity</h2><p className="text-sm text-stone-500">Latest server-recorded administrative and resident actions.</p></div></div>
          {!logs.length ? <EmptyState title="No audit logs" description="Activity will appear here as the system records actions." /> : <div className="divide-y divide-stone-100 rounded-2xl border border-stone-200">{paginatedLogs.map((log) => <div key={log.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1.2fr_1fr_auto]"><div><p className="font-semibold text-stone-800">{log.action?.replaceAll("_", " ")}</p><p className="text-xs text-stone-500">{log.entity_type} • {String(log.entity_id || "").slice(0, 18)}</p></div><p className="text-sm text-stone-500">Role: {log.actor_role || "system"}</p><p className="text-xs text-stone-400">{formatDateTime(log.created_at)}</p></div>)}</div>}
          <Pagination page={auditPage} totalPages={auditTotalPages} onPageChange={setAuditPage} />
          {user?.role !== "super_admin" ? <p className="mt-4 text-xs text-stone-400">Full user maintenance remains restricted to the Super Admin module.</p> : null}
        </Card>
      ) : null}
    </div>
  );
};

export default Admin_Settings;
