import { LOGO_URL } from "../../lib/assets";
import {
  Banknote,
  BellRing,
  CalendarDays,
  CircleAlert,
  ClipboardList,
  Gauge,
  History,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Newspaper,
  PackageCheck,
  Send,
  Settings,
  ShieldCheck,
  Users,
  Vote,
  X,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Button } from "../ui";
import SessionExpiryBanner from "../SessionExpiryBanner";

const groups = [
  { label: "Overview", items: [{ to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true }] },
  {
    label: "Resident Services",
    items: [
      { to: "/admin/residents", label: "Residents", icon: Users },
      { to: "/admin/requests", label: "Requests", icon: ClipboardList },
      { to: "/admin/complaints", label: "Community Concerns", icon: CircleAlert },
      { to: "/admin/borrowing", label: "Borrowing", icon: PackageCheck },
    ],
  },
  {
    label: "Community Records",
    items: [
      { to: "/admin/census", label: "Census", icon: Gauge },
      { to: "/admin/officials", label: "Officials", icon: Landmark },
    ],
  },
  {
    label: "Community Content",
    items: [
      { to: "/admin/news", label: "News", icon: Newspaper },
      { to: "/admin/announcements", label: "Announcements", icon: BellRing },
      { to: "/admin/events", label: "Events & ID Slots", icon: CalendarDays },
    ],
  },
  {
    label: "Governance & Transparency",
    items: [
      { to: "/admin/voting", label: "Project Voting", icon: Vote },
      { to: "/admin/funds", label: "Funds", icon: Banknote },
    ],
  },
  {
    label: "Communication",
    items: [{ to: "/admin/broadcasts", label: "Broadcasts", icon: Send }],
  },
  {
    label: "System",
    items: [{ to: "/admin/settings", label: "Settings", icon: Settings }],
  },
];

const itemClass = ({ isActive }) =>
  `flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
    isActive ? "bg-[var(--brand-500)] text-white shadow-lg shadow-emerald-900/15" : "text-stone-600 hover:bg-[var(--brand-50)] hover:text-[var(--brand-600)]"
  }`;

const AdminPageLayout = () => {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";

  const finalGroups = groups.map((group) => ({ ...group, items: [...group.items] }));
  if (isSuperAdmin) {
    const system = finalGroups.find((group) => group.label === "System");
    system.items.push(
      { to: "/admin/user-maintenance", label: "User Maintenance", icon: ShieldCheck },
      { to: "/admin/audit-logs", label: "Audit Logs", icon: History }
    );
  }

  return (
    <div className="min-h-screen bg-[var(--surface)]">
      <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="flex w-full items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8 2xl:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" aria-label="Toggle admin navigation" onClick={() => setOpen((value) => !value)} className="rounded-2xl border border-stone-200 p-2 lg:hidden">
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <img src={LOGO_URL} alt="Barangay Iba" className="h-12 w-12 rounded-2xl border border-[var(--brand-100)] bg-white p-1" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--brand-500)]">{isSuperAdmin ? "Super Admin Portal" : "Admin Portal"}</p>
              <h1 className="truncate text-lg font-black text-[var(--brand-900)] sm:text-xl">{user?.fullName || "Barangay Admin"}</h1>
            </div>
          </div>
          <Button variant="secondary" onClick={logout}><LogOut className="h-4 w-4" /><span className="hidden sm:inline">Logout</span></Button>
        </div>
      </header>

      <div className="flex gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">
        <aside className={`${open ? "fixed inset-0 z-50 bg-black/20 lg:static lg:bg-transparent" : "hidden lg:block"} lg:w-72 xl:w-80`} onClick={() => setOpen(false)}>
          <div className={`${open ? "absolute left-4 top-4 h-[calc(100vh-2rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto" : "sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto"} rounded-[2rem] border border-stone-200 bg-white p-4 shadow-sm transition`} onClick={(event) => event.stopPropagation()}>
            <div className="mb-5 flex items-start justify-between gap-3 px-2 pt-1">
              <div>
                <p className="text-sm font-semibold text-stone-500">Navigation</p>
                <h2 className="text-lg font-bold text-[var(--brand-900)]">Administrative tools</h2>
              </div>
              {open ? <button type="button" aria-label="Close navigation" onClick={() => setOpen(false)} className="rounded-full border border-stone-200 p-2 lg:hidden"><X className="h-4 w-4" /></button> : null}
            </div>
            {finalGroups.map((group) => (
              <div key={group.label} className="mb-5">
                <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.22em] text-stone-400">{group.label}</p>
                <nav className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <NavLink key={item.to} to={item.to} end={item.end} className={itemClass} onClick={() => setOpen(false)}>
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </NavLink>
                    );
                  })}
                </nav>
              </div>
            ))}
          </div>
        </aside>

        <main className="min-w-0 flex-1 animate-[fadeIn_.25s_ease]">
          <div className="mx-auto w-full max-w-[1600px]"><div className="mb-6"><SessionExpiryBanner /></div><Outlet /></div>
        </main>
      </div>
    </div>
  );
};

export default AdminPageLayout;
