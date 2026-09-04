import { KeyRound, ShieldCheck, UserCircle2 } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Card, PageHeader } from "../../components/ui";

const SettingsPage = () => {
  const { user } = useAuth();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Settings"
        title="Account and security settings"
        description="Your profile overview now lives here so the dashboard can stay focused on requests, notifications, and voting activity."
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]">
              <UserCircle2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--brand-900)]">Account Snapshot</h2>
              <p className="mt-1 text-sm text-stone-500">Resident details on file with the barangay administration.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {[
              ["Full Name", user?.fullName || "Not set"],
              ["Username", user?.username || "Not set"],
              ["Purok", user?.purok || "Not set"],
              ["Address", user?.address || "Not set"],
              ["Contact Number", user?.contactNumber || "Not set"],
              ["Email", user?.email || "No email on file"],
              ["Birthdate", user?.birthdate || "Not set"],
              ["Status", user?.isActive ? "Active" : "Inactive"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-[var(--brand-50)] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--brand-500)]">{label}</p>
                <p className="mt-2 text-sm font-semibold text-[var(--brand-900)]">{value}</p>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-[var(--brand-900)]">Password</h2>
                <p className="mt-1 text-sm text-stone-500">Change your password any time from the secure password page.</p>
              </div>
            </div>
            <NavLink to="/change-password" className="mt-5 inline-flex rounded-full bg-[var(--brand-500)] px-4 py-2 text-sm font-semibold text-white">
              Open Change Password
            </NavLink>
          </Card>

          <Card>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-[var(--brand-900)]">Recovery Method</h2>
                <p className="mt-1 text-sm text-stone-500">
                  Forgot password codes are sent to your resident email.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
