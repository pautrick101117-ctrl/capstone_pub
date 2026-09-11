import { Clock3, KeyRound, Mail, UserCircle2 } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Alert, Button, Card, PageHeader } from "../../components/ui";

const SettingsPage = () => {
  const { user } = useAuth();
  const recoveryEmail = user?.email || "No email on file";

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Account" title="Settings" description="Review the resident information held by the barangay and manage your account security." />

      <Alert tone="info" title="Need to correct your personal information?"><p>Resident identity, address and purok records are controlled by the barangay. Contact the barangay office if any information below needs to be corrected.</p></Alert>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <div className="flex items-center gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><UserCircle2 className="h-5 w-5" /></div><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Resident Profile</h2><p className="mt-1 text-sm text-stone-500">Read-only information currently on file.</p></div></div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">{[["Full Name", user?.fullName || "Not set"], ["Username", user?.username || "Not set"], ["Purok", user?.purok || "Not set"], ["Address", user?.address || "Not set"], ["Contact Number", user?.contactNumber || "Not set"], ["Email", recoveryEmail], ["Birthdate", user?.birthdate || "Not set"], ["Account Status", user?.isActive ? "Active" : "Inactive"]].map(([label, value]) => <div key={label} className="rounded-2xl bg-[var(--brand-50)] p-4"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-500)]">{label}</p><p className="mt-2 break-words text-sm font-semibold text-[var(--brand-900)]">{value}</p></div>)}</div>
        </Card>

        <div className="space-y-6">
          <Card><div className="flex items-center gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><KeyRound className="h-5 w-5" /></div><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Password</h2><p className="mt-1 text-sm text-stone-500">Update your password any time.</p></div></div><NavLink to="/change-password" className="mt-5 inline-block"><Button>Change Password</Button></NavLink></Card>
          <Card><div className="flex items-center gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><Mail className="h-5 w-5" /></div><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Password Recovery</h2><p className="mt-1 text-sm text-stone-500">Forgot-password verification codes are sent to your resident email.</p></div></div><p className="mt-4 rounded-2xl bg-stone-50 p-4 text-sm font-semibold text-stone-700">{recoveryEmail}</p></Card>
          <Card><div className="flex items-center gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><Clock3 className="h-5 w-5" /></div><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Session Security</h2><p className="mt-1 text-sm leading-6 text-stone-500">For security, your portal session automatically expires after 30 minutes of inactivity. Activity extends the session.</p></div></div></Card>
        </div>
      </div>
    </div>
  );
};
export default SettingsPage;
