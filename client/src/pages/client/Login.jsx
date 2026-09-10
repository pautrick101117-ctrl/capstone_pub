import { MailCheck, UserRound } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { Button, Card, Modal, PasswordInput, TextInput } from "../../components/ui";

const initialResetForm = {
  usernameOrEmail: "",
  code: "",
  newPassword: "",
};

const isAdminRole = (role) => role === "admin" || role === "super_admin";

const Login = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { login, loading, isAuthenticated, user } = useAuth();
  const [form, setForm] = useState({ username: "", password: "" });
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [resetForm, setResetForm] = useState(initialResetForm);
  const [codeRequested, setCodeRequested] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();
    try {
      const loggedInUser = await login({
        usernameOrEmail: form.username,
        password: form.password,
      });
      navigate(loggedInUser.mustChangePassword ? "/change-password" : "/portal");
    } catch (error) {
      toast.error(error.message);
    }
  };

  const requestResetCode = async () => {
    setResetLoading(true);
    try {
      const data = await api("/auth/forgot-password/request-code", {
        method: "POST",
        body: { usernameOrEmail: resetForm.usernameOrEmail, portal: "resident" },
      });
      setCodeRequested(true);
      toast.success(data.message);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setResetLoading(false);
    }
  };

  const submitReset = async (event) => {
    event.preventDefault();
    setResetLoading(true);
    try {
      const data = await api("/auth/forgot-password/reset", {
        method: "POST",
        body: { ...resetForm, portal: "resident" },
      });
      toast.success(data.message);
      setResetForm(initialResetForm);
      setShowForgotModal(false);
      setCodeRequested(false);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setResetLoading(false);
    }
  };

  if (isAuthenticated) {
    return <Navigate to={isAdminRole(user?.role) ? "/admin" : "/portal"} replace />;
  }

  return (
    <section className="relative overflow-hidden bg-[radial-gradient(circle_at_top_right,_rgba(45,122,58,0.25),_transparent_35%),linear-gradient(135deg,#103219_0%,#266a33_42%,#dfeedd_100%)] py-14 sm:py-20">
      <div className="section-shell grid gap-10 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6 text-white">
          <div className="inline-flex rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em]">
            Resident Access
          </div>
          <h1 className="max-w-2xl text-4xl font-black tracking-tight sm:text-5xl">Access your Barangay Iba resident portal.</h1>
          <p className="max-w-xl text-base leading-7 text-emerald-50/85 sm:text-lg">
            Track requests, view voting updates, receive announcements, and manage your resident account in one place.
          </p>
          <div className="glass-card max-w-xl border-white/20 bg-white/10 p-5 text-emerald-50">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-100">Account notice</p>
            <p className="mt-3 text-sm leading-6 text-emerald-50/85">
              No account yet? Contact your Barangay admin. Resident accounts are created by barangay staff and first-time credentials are sent to the resident email on file. A password change is required on first login.
            </p>
          </div>
        </div>

        <Card className="mx-auto w-full max-w-lg p-6 sm:p-8">
          <div className="mb-6 text-center">
            <img src="/logo.png" alt="Barangay Iba" className="mx-auto h-20 w-20 rounded-3xl border border-[var(--brand-100)] bg-white p-2" />
            <h2 className="mt-4 text-3xl font-black text-[var(--brand-900)]">Sign in</h2>
            <p className="mt-2 text-sm text-stone-500">Use your username, email, or registered contact number.</p>
          </div>

          <form className="space-y-4" onSubmit={onSubmit}>
            <label className="flex flex-col gap-2 text-sm font-medium text-stone-700">
              <span>Username, Email, or Contact Number</span>
              <div className="flex items-center rounded-2xl border border-stone-200 px-4 py-3 focus-within:border-[var(--brand-400)] focus-within:ring-4 focus-within:ring-[var(--brand-100)]">
                <UserRound className="h-4 w-4 text-stone-400" />
                <input
                  type="text"
                  value={form.username}
                  onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                  className="ml-3 w-full outline-none placeholder:text-stone-400"
                  placeholder="juan.delacruz"
                />
              </div>
            </label>

            <PasswordInput
              label="Password"
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              placeholder="Enter your password"
            />

            <div className="flex justify-end">
              <button type="button" onClick={() => setShowForgotModal(true)} className="text-sm font-semibold text-[var(--brand-600)] hover:underline">
                Forgot password?
              </button>
            </div>

            <Button type="submit" className="w-full justify-center py-3" loading={loading}>
              Login to Portal
            </Button>
          </form>
        </Card>
      </div>

      <Modal
        open={showForgotModal}
        onClose={() => {
          setShowForgotModal(false);
          setCodeRequested(false);
          setResetForm(initialResetForm);
        }}
        title="Forgot Password"
        description="Request a verification code first. The OTP will be sent to the resident email on file."
      >
        <form className="space-y-4" onSubmit={submitReset}>
          <TextInput
            label="Username, Email, or Contact Number"
            value={resetForm.usernameOrEmail}
            onChange={(event) => setResetForm((current) => ({ ...current, usernameOrEmail: event.target.value }))}
            placeholder="Enter your login identifier"
          />

          {!codeRequested ? (
            <Button type="button" onClick={requestResetCode} loading={resetLoading}>
              <MailCheck className="h-4 w-4" />
              Send Verification Code
            </Button>
          ) : (
            <>
              <TextInput
                label="Verification Code"
                value={resetForm.code}
                onChange={(event) => setResetForm((current) => ({ ...current, code: event.target.value }))}
                placeholder="6-digit code"
              />
              <PasswordInput
                label="New Password"
                value={resetForm.newPassword}
                onChange={(event) => setResetForm((current) => ({ ...current, newPassword: event.target.value }))}
                placeholder="At least 8 characters"
              />
              <div className="flex flex-wrap gap-3">
                <Button type="submit" loading={resetLoading}>
                  Reset Password
                </Button>
                <Button type="button" variant="secondary" onClick={requestResetCode} loading={resetLoading}>
                  Resend Code
                </Button>
              </div>
            </>
          )}
        </form>
      </Modal>
    </section>
  );
};

export default Login;
