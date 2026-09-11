import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Button, Card, PageHeader, PasswordInput } from "../../components/ui";
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from "../../lib/password";

const ChangePassword = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { changePassword, isPasswordChangeRequired, user } = useAuth();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [saving, setSaving] = useState(false);

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

    setSaving(true);
    try {
      await changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      toast.success("Password updated successfully.");
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
          <Button type="submit" loading={saving}>
            Save Password
          </Button>
        </form>
      </Card>
    </section>
  );
};

export default ChangePassword;

