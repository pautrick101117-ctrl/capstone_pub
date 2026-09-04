import {
  BadgePlus,
  Banknote,
  BellRing,
  CalendarDays,
  ClipboardList,
  Gauge,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareWarning,
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

const groups = [
  {
    label: "Operations",
    items: [
      { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/admin/residents", label: "Residents", icon: Users },
      { to: "/admin/requests", label: "Requests", icon: ClipboardList },
      { to: "/admin/complaints", label: "Complaints", icon: MessageSquareWarning },
    ],
  },
  {
    label: "Community",
    items: [
      { to: "/admin/officials", label: "Officials", icon: Landmark },
      { to: "/admin/news", label: "News", icon: BadgePlus },
      { to: "/admin/announcements", label: "Announcements", icon: BellRing },
      { to: "/admin/events", label: "Events", icon: CalendarDays },
    ],
  },
  {
    label: "Governance",
    items: [
      { to: "/admin/funds", label: "Funds & Transparency", icon: Banknote },
      { to: "/admin/voting", label: "Voting & Projects", icon: Vote },
      { to: "/admin/census", label: "Census", icon: Gauge },
    ],
  },
  {
    label: "System",
    items: [{ to: "/admin/settings", label: "Portal Settings", icon: Settings }],
  },
];

const itemClass = ({ isActive }) =>
  `flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
    isActive ? "bg-[var(--brand-500)] text-white shadow-lg shadow-emerald-900/15" : "text-stone-600 hover:bg-[var(--brand-50)] hover:text-[var(--brand-600)]"
  }`;

const AdminPageLayout = () => {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-[var(--surface)]">
      <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="flex w-full items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8 2xl:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => setOpen((value) => !value)} className="rounded-2xl border border-stone-200 p-2 lg:hidden" aria-label="Open admin navigation">
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <img src="/logo.png" alt="Barangay Iba" className="h-11 w-11 rounded-2xl border border-[var(--brand-100)] bg-white p-1 sm:h-12 sm:w-12" />
            <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--brand-500)] sm:text-xs">Admin Portal</p><h1 className="truncate text-base font-black text-[var(--brand-900)] sm:text-xl">{user?.fullName || "Barangay Admin"}</h1></div>
          </div>
          <Button variant="secondary" onClick={logout}><LogOut className="h-4 w-4" /><span className="hidden sm:inline">Logout</span></Button>
        </div>
      </header>

      <div className="flex gap-6 px-4 py-6 sm:px-6 lg:gap-8 lg:px-8 lg:py-8 2xl:px-10">
        <aside className={`${open ? "fixed inset-0 z-50 bg-black/30 lg:static lg:bg-transparent" : "hidden lg:block"} lg:w-72 xl:w-80`} onClick={() => open && setOpen(false)}>
          <div className={`${open ? "absolute left-3 top-3 h-[calc(100vh-1.5rem)] w-[min(19rem,calc(100vw-1.5rem))] overflow-y-auto" : "sticky top-28"} rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm`} onClick={(event) => event.stopPropagation()}>
            <div className="mb-6 flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-stone-500">Navigation</p><h2 className="text-lg font-bold text-[var(--brand-900)]">Administrative tools</h2></div>{open ? <button type="button" onClick={() => setOpen(false)} className="rounded-full border border-stone-200 p-2 lg:hidden"><X className="h-4 w-4" /></button> : null}</div>
            <nav className="space-y-6">
              {groups.map((group) => (
                <div key={group.label}>
                  <p className="mb-2 px-4 text-[10px] font-bold uppercase tracking-[0.22em] text-stone-400">{group.label}</p>
                  <div className="space-y-1">
                    {group.items.map((item) => { const Icon = item.icon; return <NavLink key={item.to} to={item.to} end={item.end} className={itemClass} onClick={() => setOpen(false)}><Icon className="h-4 w-4" />{item.label}</NavLink>; })}
                    {group.label === "System" && user?.role === "super_admin" ? (
                      <NavLink to="/admin/user-maintenance" className={itemClass} onClick={() => setOpen(false)}><ShieldCheck className="h-4 w-4" />User Maintenance</NavLink>
                    ) : null}
                  </div>
                </div>
              ))}
            </nav>
          </div>
        </aside>

        <main className="min-w-0 flex-1 animate-[fadeIn_.35s_ease]"><Outlet /></main>
      </div>
    </div>
  );
};

export default AdminPageLayout;
