import { useReviewAction } from "../../components/ActionReviewProvider";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Button, Card, PageHeader, PasswordInput } from "../../components/ui";
import { isStrongPassword, passwordPolicyChecks, PASSWORD_POLICY_MESSAGE } from "../../lib/password";

const ChangePassword = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const reviewAction = useReviewAction();
  const { changePassword, isPasswordChangeRequired, user } = useAuth();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [saving, setSaving] = useState(false);
  const checks = passwordPolicyChecks(form.newPassword);
  const passwordsMatch = Boolean(form.confirmPassword) && form.newPassword === form.confirmPassword;

  const onChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!isStrongPassword(form.newPassword)) {
      toast.error(PASSWORD_POLICY_MESSAGE);
      return;
    }

    if (form.newPassword !== form.confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    if (!await reviewAction({ title: "Change your account password?", description: "Your current password will be replaced. For security, neither password will be displayed in this review.", confirmLabel: "Change Password", tone: "primary" })) return;
    setSaving(true);
    try {
      await changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      toast.success("Your new personal password is ready.");
      navigate(["admin", "super_admin"].includes(user?.role) ? "/admin" : "/portal");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="section-shell py-10 sm:py-14">
      <PageHeader
        eyebrow="Security"
        title="Change your password"
        description={
          isPasswordChangeRequired
            ? "Your temporary password must be replaced before you can continue to the portal."
            : "Keep your account secure with a fresh password."
        }
      />

      <Card className="mx-auto mt-8 max-w-xl">
        {isPasswordChangeRequired ? <p className="mb-6 rounded-2xl bg-[var(--brand-50)] p-4 text-sm leading-6 text-[var(--brand-900)]">You've signed in with your temporary password. Choose a personal password below to unlock resident services. You do not need to type the temporary password again.</p> : null}
        <form className="space-y-4" onSubmit={onSubmit}>
          {!isPasswordChangeRequired ? (
            <PasswordInput
              label="Current Password"
              required
              autoComplete="current-password"
              name="currentPassword"
              value={form.currentPassword}
              onChange={onChange}
            />
          ) : null}
          <PasswordInput label="New Password" required minLength={8} maxLength={128} autoComplete="new-password" hint={PASSWORD_POLICY_MESSAGE} name="newPassword" value={form.newPassword} onChange={onChange} />
          <PasswordInput
            label="Confirm New Password"
            required
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            name="confirmPassword"
            value={form.confirmPassword}
            onChange={onChange}
          />
          <div className="space-y-2 rounded-2xl bg-stone-50 p-4 text-sm" aria-live="polite">
            <p className={checks.length ? "font-semibold text-emerald-700" : "text-stone-500"}>{checks.length ? "✓" : "○"} At least 8 characters</p>
            <p className={checks.uppercase ? "font-semibold text-emerald-700" : "text-stone-500"}>{checks.uppercase ? "✓" : "○"} At least one uppercase letter</p>
            <p className={checks.number ? "font-semibold text-emerald-700" : "text-stone-500"}>{checks.number ? "✓" : "○"} At least one number</p>
            <p className={passwordsMatch ? "font-semibold text-emerald-700" : "text-stone-500"}>{passwordsMatch ? "✓" : "○"} Both passwords match</p>
          </div>
          <Button type="submit" loading={saving} disabled={!isStrongPassword(form.newPassword) || !passwordsMatch}>
            Save My Password
          </Button>
        </form>
      </Card>
    </section>
  );
};

export default ChangePassword;


