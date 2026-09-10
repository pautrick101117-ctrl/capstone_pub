import { Phone, Save, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { Button, Card, PageHeader, TextArea, TextInput } from "../../components/ui";

const defaultHotline = {
  title: "Barangay Iba Hotline",
  phone: "0917 123 4567",
  hours: "24/7 for urgent community concerns",
  note: "Sample hotline number — update this in Admin Portal > Settings.",
};

const Admin_Settings = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [hotline, setHotline] = useState(defaultHotline);
  const [contact, setContact] = useState({ phone: "", email: "", address: "", facebook: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    api("/admin/content", { token })
      .then((data) => {
        setHotline({ ...defaultHotline, ...(data.content?.hotline || {}) });
        setContact({ phone: "", email: "", address: "", facebook: "", ...(data.content?.contact || {}) });
      })
      .catch((error) => toast.error(error.message))
      .finally(() => setLoading(false));
  }, [token]);

  const save = async (event) => {
    event.preventDefault();
    if (!hotline.title.trim() || !hotline.phone.trim()) {
      toast.error("Hotline title and phone number are required.");
      return;
    }
    setSaving(true);
    try {
      const data = await api("/admin/content", { method: "PUT", token, body: { hotline, contact } });
      toast.success(data.message || "Portal settings saved successfully.");
    } catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Portal Configuration"
        title="Settings"
        description="Only settings that are stored in the database and used by the live portal are shown here."
      />
      {loading ? <Card><p className="text-sm text-stone-500">Loading settings...</p></Card> : (
        <form className="grid gap-6 xl:grid-cols-2" onSubmit={save}>
          <Card>
            <div className="mb-5 flex items-center gap-3"><div className="rounded-2xl bg-rose-100 p-3 text-rose-700"><Phone className="h-5 w-5" /></div><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Community Hotline</h2><p className="text-sm text-stone-500">Shown on Resident Portal → Community Concerns.</p></div></div>
            <div className="space-y-4">
              <TextInput label="Hotline Name" value={hotline.title} onChange={(e) => setHotline((v) => ({ ...v, title: e.target.value }))} />
              <TextInput label="Phone Number" value={hotline.phone} onChange={(e) => setHotline((v) => ({ ...v, phone: e.target.value }))} />
              <TextInput label="Hours / Availability" value={hotline.hours} onChange={(e) => setHotline((v) => ({ ...v, hours: e.target.value }))} />
              <TextArea label="Resident Note" value={hotline.note} onChange={(e) => setHotline((v) => ({ ...v, note: e.target.value }))} />
            </div>
          </Card>
          <Card>
            <div className="mb-5 flex items-center gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><ShieldCheck className="h-5 w-5" /></div><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Barangay Contact</h2><p className="text-sm text-stone-500">General public contact information stored with landing content.</p></div></div>
            <div className="space-y-4">
              <TextInput label="Phone" value={contact.phone || ""} onChange={(e) => setContact((v) => ({ ...v, phone: e.target.value }))} />
              <TextInput label="Email" type="email" value={contact.email || ""} onChange={(e) => setContact((v) => ({ ...v, email: e.target.value }))} />
              <TextInput label="Address" value={contact.address || ""} onChange={(e) => setContact((v) => ({ ...v, address: e.target.value }))} />
              <TextInput label="Facebook" value={contact.facebook || ""} onChange={(e) => setContact((v) => ({ ...v, facebook: e.target.value }))} />
            </div>
          </Card>
          <div className="xl:col-span-2 flex justify-end"><Button type="submit" loading={saving}><Save className="h-4 w-4" /> Save Settings</Button></div>
        </form>
      )}
    </div>
  );
};
export default Admin_Settings;
