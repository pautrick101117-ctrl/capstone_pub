import { LOGO_URL } from "../../lib/assets";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, Card, Modal, PasswordInput, TextInput } from "../../components/ui";
import { api } from "../../lib/api";
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from "../../lib/password";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";

const isAdminRole = (role) => role === "admin" || role === "super_admin";

const AdminLogin = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { login, loading, isAuthenticated, user } = useAuth();
  const [form, setForm] = useState({ username: "", password: "" });
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recovery, setRecovery] = useState({ usernameOrEmail: "", code: "", newPassword: "" });
  const [recoveryStep, setRecoveryStep] = useState("request");
  const [recovering, setRecovering] = useState(false);

  const requestCode = async (event) => {
    event.preventDefault(); setRecovering(true);
    try {
      const response = await api("/auth/forgot-password/request-code", { method: "POST", body: { usernameOrEmail: recovery.usernameOrEmail, portal: "admin" } });
      setRecoveryStep("reset"); toast.success(response.message);
    } catch (error) { toast.error(error.message); }
    finally { setRecovering(false); }
  };
  const submitReset = async (event) => {
    event.preventDefault();
    if (!isStrongPassword(recovery.newPassword)) return toast.error(PASSWORD_POLICY_MESSAGE);
    setRecovering(true);
    try {
      const response = await api("/auth/forgot-password/reset", { method: "POST", body: { ...recovery, portal: "admin" } });
      toast.success(response.message);
      setRecovery({ usernameOrEmail: "", code: "", newPassword: "" });
      setRecoveryStep("request"); setRecoveryOpen(false);
    } catch (error) { toast.error(error.message); }
    finally { setRecovering(false); }
  };

  const submit = async (event) => {
    event.preventDefault();
    try {
      const loggedInUser = await login({
        usernameOrEmail: form.username,
        password: form.password,
        adminOnly: true,
      });
      navigate(loggedInUser.mustChangePassword ? "/change-password" : isAdminRole(loggedInUser.role) ? "/admin" : "/");
    } catch (error) {
      toast.error(error.message);
    }
  };

  if (isAuthenticated && isAdminRole(user?.role)) {
    return <Navigate to={user?.mustChangePassword ? "/change-password" : "/admin"} replace />;
  }

  return (
    <section className="min-h-screen bg-[linear-gradient(135deg,#103219_0%,#266a33_42%,#dfeedd_100%)] py-14 sm:py-20">
      <div className="section-shell grid gap-10 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6 text-white">
          <div className="inline-flex rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em]">
            Administrative Access
          </div>
          <h1 className="max-w-2xl text-4xl font-black tracking-tight sm:text-5xl">Manage services, accounts, and public updates.</h1>
          <p className="max-w-xl text-base leading-7 text-emerald-50/85 sm:text-lg">
            This portal is reserved for authorized barangay administrators and staff managing resident accounts, requests, elections, funds, and official notices.
          </p>
        </div>

        <Card className="mx-auto w-full max-w-lg p-6 sm:p-8">
          <div className="mb-6 text-center">
            <img src={LOGO_URL} alt="Barangay Iba" className="mx-auto h-20 w-20 rounded-3xl border border-[var(--brand-100)] bg-white p-2" />
            <h2 className="mt-4 text-3xl font-black text-[var(--brand-900)]">Admin Sign In</h2>
          </div>
          <form className="space-y-4" onSubmit={submit}>
            <TextInput label="Username or Email" required autoComplete="username" maxLength={180} value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} placeholder="admin username" />
            <PasswordInput label="Password" required autoComplete="current-password" maxLength={128} value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="Enter your password" />
            <div className="flex justify-end"><button type="button" onClick={() => { setRecovery({ usernameOrEmail: form.username, code: "", newPassword: "" }); setRecoveryStep("request"); setRecoveryOpen(true); }} className="text-sm font-semibold text-[var(--brand-600)] hover:underline">Forgot password?</button></div>
            <Button type="submit" className="w-full justify-center py-3" loading={loading}>
              Access Admin Portal
            </Button>
          </form>
        </Card>
      </div>
      <Modal open={recoveryOpen} onClose={() => !recovering && setRecoveryOpen(false)} title="Recover Admin Password" description="A verification code will be emailed to the address registered on an active administrative account.">
        <form className="space-y-4" onSubmit={recoveryStep === "request" ? requestCode : submitReset}>
          <TextInput required label="Username or Email" maxLength={180} value={recovery.usernameOrEmail} onChange={(event) => setRecovery((old) => ({ ...old, usernameOrEmail: event.target.value }))} />
          {recoveryStep === "reset" ? <>
            <TextInput required label="Verification Code" inputMode="numeric" maxLength={6} value={recovery.code} onChange={(event) => setRecovery((old) => ({ ...old, code: event.target.value }))} />
            <PasswordInput required label="New Password" minLength={8} maxLength={128} hint={PASSWORD_POLICY_MESSAGE} autoComplete="new-password" value={recovery.newPassword} onChange={(event) => setRecovery((old) => ({ ...old, newPassword: event.target.value }))} />
          </> : null}
          <div className="flex justify-end gap-3"><Button variant="ghost" type="button" onClick={() => setRecoveryOpen(false)} disabled={recovering}>Cancel</Button><Button loading={recovering} type="submit">{recoveryStep === "request" ? "Email Verification Code" : "Reset Password"}</Button></div>
        </form>
      </Modal>
    </section>
  );
};

export default AdminLogin;


