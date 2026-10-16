import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { KeyRound, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api";
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from "../../lib/password";
import { Button, Card, ErrorState, LoadingState, PageHeader, PasswordInput } from "../../components/ui";

const AdminSetup = () => {
  const [token] = useState(() => new URLSearchParams(window.location.search).get("token") || "");
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({ password: "", confirm: "" });
  useEffect(() => {
    // Remove the secret from visible URL/history before making network requests.
    window.history.replaceState(window.history.state, "", "/admin/setup");
    if (!token) { setError("This invitation link is missing its setup token."); setLoading(false); return; }
    api("/auth/admin-invitation/verify", { method: "POST", body: { token } })
      .then(setInvite).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, [token]);
  const submit = async (event) => {
    event.preventDefault();
    if (!isStrongPassword(form.password)) return setError(PASSWORD_POLICY_MESSAGE);
    if (form.password !== form.confirm) return setError("Passwords do not match.");
    setSubmitting(true); setError("");
    try { await api("/auth/admin-invitation/accept", { method: "POST", body: { token, password: form.password } }); setForm({ password: "", confirm: "" }); setDone(true); }
    catch (err) { setError(err.message); }
    finally { setSubmitting(false); }
  };
  return <section className="section-shell min-h-screen py-10 sm:py-16">
    <PageHeader eyebrow="Administrative Access" title="Set up your Admin account" description="Use your personal invitation to create a password before signing in." />
    <Card className="mx-auto mt-8 max-w-xl space-y-5">
      <div className="flex items-center gap-3"><ShieldCheck className="h-6 w-6 text-[var(--brand-600)]"/><span className="font-semibold text-[var(--brand-900)]">Barangay Iba Administration</span></div>
      {loading ? <LoadingState rows={3} /> : done ? <div className="space-y-4"><h2 className="text-xl font-bold text-green-800">Your Admin account is ready</h2><p className="text-stone-600">Sign in at the shared Admin Portal using your username and new password.</p><NavLink className="inline-flex rounded-full bg-[var(--brand-500)] px-5 py-3 font-semibold text-white" to="/admin/login">Go to Admin Login</NavLink></div> : error && !invite ? <ErrorState description={error} /> : invite ? <form className="space-y-4" onSubmit={submit}>
        <p className="text-stone-600">Invitation for <strong>{invite.fullName}</strong> (@{invite.username})</p>
        <p className="text-sm text-stone-500">This invitation can be used once, before its expiration date.</p>
        <PasswordInput label="New Password" required minLength={8} maxLength={128} autoComplete="new-password" hint={PASSWORD_POLICY_MESSAGE} value={form.password} onChange={(e) => setForm((old) => ({ ...old, password: e.target.value }))}/>
        <PasswordInput label="Confirm Password" required minLength={8} maxLength={128} autoComplete="new-password" value={form.confirm} onChange={(e) => setForm((old) => ({ ...old, confirm: e.target.value }))}/>
        {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
        <Button type="submit" loading={submitting}><KeyRound className="h-4 w-4"/> Activate Admin Account</Button>
      </form> : null}
      <NavLink to="/admin/login" className="block text-sm font-semibold text-[var(--brand-600)]">Back to Admin Login</NavLink>
    </Card>
  </section>;
};
export default AdminSetup;
