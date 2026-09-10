import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Button, Card, PageHeader, TextInput } from "../../components/ui";

const ChangePassword = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { changePassword, isPasswordChangeRequired } = useAuth();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [saving, setSaving] = useState(false);

  const onChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const onSubmit = async (event) => {
    event.preventDefault();
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
      navigate("/portal");
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
            ? "Your temporary password must be replaced before you can use the resident portal."
            : "Keep your account secure with a fresh password."
        }
      />

      <Card className="mx-auto mt-8 max-w-xl">
        <form className="space-y-4" onSubmit={onSubmit}>
          {!isPasswordChangeRequired ? (
            <TextInput
              label="Current Password"
              type="password"
              name="currentPassword"
              value={form.currentPassword}
              onChange={onChange}
            />
          ) : null}
          <TextInput label="New Password" type="password" name="newPassword" value={form.newPassword} onChange={onChange} />
          <TextInput
            label="Confirm New Password"
            type="password"
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
