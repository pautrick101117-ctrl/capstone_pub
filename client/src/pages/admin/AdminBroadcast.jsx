import { CheckCircle2, Send } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Alert, Button, Card, ConfirmDialog, PageHeader, TextArea, TextInput } from "../../components/ui";

const AdminBroadcast = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ title: "", body: "" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [lastSent, setLastSent] = useState(null);

  const requestSend = (event) => {
    event.preventDefault();
    if (!form.title.trim() || !form.body.trim()) return toast.error("Title and message are required.");
    setConfirmOpen(true);
  };

  const sendBroadcast = async () => {
    setSending(true);
    try {
      const payload = { title: form.title.trim(), body: form.body.trim() };
      const data = await api("/admin/broadcast", { method: "POST", token, body: payload });
      setLastSent({ ...payload, sentAt: new Date().toISOString() });
      setForm({ title: "", body: "" });
      setConfirmOpen(false);
      toast.success(data.message || "Broadcast sent.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Communication" title="Broadcast notifications" description="Send an in-app notification to all active residents. Use broadcasts for important barangay-wide updates that residents should see inside the portal." />

      {lastSent ? (
        <Alert tone="success" title="Broadcast sent successfully">
          <p><strong>{lastSent.title}</strong> was sent to active resident accounts.</p>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><Send className="h-5 w-5" /></div>
            <div><h2 className="text-xl font-bold text-[var(--brand-900)]">Compose broadcast</h2><p className="mt-1 text-sm leading-6 text-stone-500">Keep the title specific and the message short enough to understand quickly from the notification center.</p></div>
          </div>
          <form className="mt-6 space-y-4" onSubmit={requestSend}>
            <TextInput label="Title" required maxLength={120} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Example: Water interruption advisory" />
            <TextArea label="Message" required minLength={5} maxLength={1000} value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} placeholder="Write the resident notification..." />
            <Button type="submit"><Send className="h-4 w-4" /> Review & Send</Button>
          </form>
        </Card>

        <Card className="bg-gradient-to-br from-white to-[var(--brand-50)]">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand-500)]">Resident preview</p>
          <h2 className="mt-2 text-xl font-bold text-[var(--brand-900)]">How this will appear</h2>
          <div className="mt-6 rounded-3xl border border-[var(--brand-100)] bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--brand-500)]" />
              <div>
                <p className="font-bold text-[var(--brand-900)]">{form.title.trim() || "Broadcast title"}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-600">{form.body.trim() || "Your broadcast message will preview here before sending."}</p>
                <p className="mt-3 text-xs text-stone-400">Just now</p>
              </div>
            </div>
          </div>
          <div className="mt-6 flex items-start gap-3 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /><p>Residents will see the broadcast in their notification center. Sending is intentionally confirmed before delivery.</p></div>
        </Card>
      </div>

      <ConfirmDialog open={confirmOpen} onClose={() => setConfirmOpen(false)} onConfirm={sendBroadcast} loading={sending} tone="primary" title="Send this broadcast?" description="This notification will be sent to all active residents and cannot be recalled." confirmLabel="Send Broadcast">
        <div className="rounded-2xl bg-stone-50 p-4"><p className="font-semibold text-stone-900">{form.title}</p><p className="mt-2 text-stone-600">{form.body}</p></div>
      </ConfirmDialog>
    </div>
  );
};

export default AdminBroadcast;
