import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, Card, PasswordInput, TextInput } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";

const isAdminRole = (role) => role === "admin" || role === "super_admin";

const AdminLogin = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { login, loading, isAuthenticated, user } = useAuth();
  const [form, setForm] = useState({ username: "", password: "" });

  const submit = async (event) => {
    event.preventDefault();
    try {
      const loggedInUser = await login({
        usernameOrEmail: form.username,
        password: form.password,
        adminOnly: true,
      });
      navigate(isAdminRole(loggedInUser.role) ? "/admin" : "/");
    } catch (error) {
      toast.error(error.message);
    }
  };

  if (isAuthenticated && isAdminRole(user?.role)) {
    return <Navigate to="/admin" replace />;
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
            <img src="/logo.png" alt="Barangay Iba" className="mx-auto h-20 w-20 rounded-3xl border border-[var(--brand-100)] bg-white p-2" />
            <h2 className="mt-4 text-3xl font-black text-[var(--brand-900)]">Admin Sign In</h2>
          </div>
          <form className="space-y-4" onSubmit={submit}>
            <TextInput label="Username or Email" required autoComplete="username" maxLength={180} value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} placeholder="admin username" />
            <PasswordInput label="Password" required autoComplete="current-password" maxLength={128} value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="Enter your password" />
            <Button type="submit" className="w-full justify-center py-3" loading={loading}>
              Access Admin Portal
            </Button>
          </form>
        </Card>
      </div>
    </section>
  );
};

export default AdminLogin;
