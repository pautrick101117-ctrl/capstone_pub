import {
  Bell,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  CircleAlert,
  PackageCheck,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  Settings,
  Vote,
} from "lucide-react";
import { useMemo, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Button, Card } from "../ui";
import { formatDateTime } from "../../lib/format";

const links = [
  { to: "/portal", label: "Dashboard", icon: LayoutDashboard },
  { to: "/portal/requests", label: "Requests", icon: ClipboardList },
  { to: "/portal/voting", label: "Voting Center", icon: Vote },
  { to: "/portal/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/portal/suggestions", label: "Project Suggestions", icon: Lightbulb },
  { to: "/portal/complaints", label: "Community Concerns", icon: CircleAlert },
  { to: "/portal/borrowing", label: "Borrow Facilities & Items", icon: PackageCheck },
  { to: "/portal/voting-result", label: "Voting Results", icon: CheckSquare },
  { to: "/portal/settings", label: "Settings", icon: Settings },
];

const navClass = ({ isActive }) =>
  `inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
    isActive ? "bg-[var(--brand-500)] text-white" : "bg-white text-stone-600 hover:bg-[var(--brand-50)] hover:text-[var(--brand-600)]"
  }`;

const NotificationCenter = ({ open, onClose }) => {
  const { notifications, markNotificationRead, markAllNotificationsRead } = useAuth();
  const ordered = useMemo(() => [...notifications], [notifications]);

  if (!open) return null;

  return (
    <div className="absolute right-0 top-14 z-30 w-[min(28rem,calc(100vw-2rem))]">
      <Card className="max-h-[32rem] overflow-y-auto p-0">
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-stone-500">Notifications</p>
            <h3 className="text-lg font-bold text-[var(--brand-900)]">Updates for you</h3>
          </div>
          <Button variant="ghost" className="px-3 py-2" onClick={markAllNotificationsRead}>
            Mark all read
          </Button>
        </div>
        <div className="divide-y divide-stone-100">
          {ordered.length === 0 ? (
            <p className="px-5 py-8 text-sm text-stone-500">No notifications yet.</p>
          ) : (
            ordered.map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => {
                  if (!note.is_read) {
                    markNotificationRead(note.id);
                  }
                  onClose();
                }}
                className={`w-full px-5 py-4 text-left transition hover:bg-stone-50 ${note.is_read ? "bg-white" : "bg-[var(--brand-50)]"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--brand-900)]">{note.title}</p>
                    <p className="mt-1 text-sm text-stone-600">{note.body}</p>
                  </div>
                  {!note.is_read ? <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[var(--brand-500)]" /> : null}
                </div>
                <p className="mt-2 text-xs text-stone-400">{formatDateTime(note.created_at)}</p>
              </button>
            ))
          )}
        </div>
      </Card>
    </div>
  );
};

const UserPortalLayout = () => {
  const { user, logout, unreadCount } = useAuth();
  const [showNotifications, setShowNotifications] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--surface)]">
      <header className="border-b border-stone-200 bg-white">
        <div className="section-shell flex flex-col gap-4 py-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Barangay Iba" className="h-12 w-12 rounded-2xl border border-[var(--brand-100)] bg-white p-1" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--brand-500)]">Resident Portal</p>
                <h1 className="text-xl font-black text-[var(--brand-900)]">{user?.fullName || "Resident"}</h1>
              </div>
            </div>
            <div className="flex items-center gap-3 self-start md:self-auto">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowNotifications((value) => !value)}
                  className="relative rounded-full border border-stone-200 bg-white p-3 text-stone-700 transition hover:border-[var(--brand-200)]"
                >
                  <Bell className="h-5 w-5" />
                  {unreadCount ? (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                      {unreadCount}
                    </span>
                  ) : null}
                </button>
                <NotificationCenter open={showNotifications} onClose={() => setShowNotifications(false)} />
              </div>
              <Button variant="secondary" onClick={logout}>
                <LogOut className="h-4 w-4" />
                Logout
              </Button>
            </div>
          </div>

          <nav className="flex flex-wrap gap-3">
            {links.map((link) => {
              const Icon = link.icon;
              return (
                <NavLink key={link.to} to={link.to} end={link.to === "/portal"} className={navClass}>
                  <Icon className="h-4 w-4" />
                  {link.label}
                </NavLink>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="section-shell py-8">
        <Outlet />
      </main>
    </div>
  );
};

export default UserPortalLayout;
