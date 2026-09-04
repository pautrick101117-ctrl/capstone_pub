import {
  Bell,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  Ellipsis,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  MessageSquareWarning,
  Settings,
  Vote,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Button, Card } from "../ui";
import { formatDateTime } from "../../lib/format";

const links = [
  { to: "/portal", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/portal/requests", label: "Requests", icon: ClipboardList },
  { to: "/portal/complaints", label: "Complaints", icon: MessageSquareWarning },
  { to: "/portal/voting", label: "Voting", icon: Vote },
  { to: "/portal/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/portal/suggestions", label: "Suggestions", icon: Lightbulb },
  { to: "/portal/voting-result", label: "Results", icon: CheckSquare },
  { to: "/portal/settings", label: "Settings", icon: Settings },
];

const mobilePrimary = links.slice(0, 4);
const mobileMore = links.slice(4);

const navClass = ({ isActive }) =>
  `inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
    isActive ? "bg-[var(--brand-500)] text-white" : "bg-white text-stone-600 hover:bg-[var(--brand-50)] hover:text-[var(--brand-600)]"
  }`;

const NotificationCenter = ({ open, onClose }) => {
  const { notifications, markNotificationRead, markAllNotificationsRead } = useAuth();
  const ordered = useMemo(() => [...notifications], [notifications]);
  if (!open) return null;

  return (
    <div className="fixed inset-x-3 top-24 z-50 sm:absolute sm:inset-x-auto sm:right-0 sm:top-14 sm:w-[min(28rem,calc(100vw-2rem))]">
      <Card className="max-h-[70vh] overflow-y-auto p-0">
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <div><p className="text-sm font-semibold text-stone-500">Notifications</p><h3 className="text-lg font-bold text-[var(--brand-900)]">Updates for you</h3></div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" className="px-3 py-2" onClick={markAllNotificationsRead}>Mark all read</Button>
            <button type="button" onClick={onClose} className="rounded-full p-2 text-stone-500 hover:bg-stone-100" aria-label="Close notifications"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="divide-y divide-stone-100">
          {ordered.length === 0 ? <p className="px-5 py-8 text-sm text-stone-500">No notifications yet.</p> : ordered.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => { if (!note.is_read) markNotificationRead(note.id); onClose(); }}
              className={`w-full px-5 py-4 text-left transition hover:bg-stone-50 ${note.is_read ? "bg-white" : "bg-[var(--brand-50)]"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-semibold text-[var(--brand-900)]">{note.title}</p><p className="mt-1 text-sm text-stone-600">{note.body}</p></div>
                {!note.is_read ? <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--brand-500)]" /> : null}
              </div>
              <p className="mt-2 text-xs text-stone-400">{formatDateTime(note.created_at)}</p>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
};

const UserPortalLayout = () => {
  const { user, logout, unreadCount } = useAuth();
  const [showNotifications, setShowNotifications] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--surface)] pb-24 sm:pb-0">
      <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="section-shell flex flex-col gap-4 py-4 sm:py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <img src="/logo.png" alt="Barangay Iba" className="h-11 w-11 rounded-2xl border border-[var(--brand-100)] bg-white p-1 sm:h-12 sm:w-12" />
              <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--brand-500)] sm:text-xs">Resident Portal</p><h1 className="truncate text-base font-black text-[var(--brand-900)] sm:text-xl">{user?.fullName || "Resident"}</h1></div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="relative">
                <button type="button" onClick={() => setShowNotifications((value) => !value)} className="relative rounded-full border border-stone-200 bg-white p-2.5 text-stone-700 transition hover:border-[var(--brand-200)] sm:p-3" aria-label="Notifications">
                  <Bell className="h-5 w-5" />
                  {unreadCount ? <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{unreadCount}</span> : null}
                </button>
                <NotificationCenter open={showNotifications} onClose={() => setShowNotifications(false)} />
              </div>
              <Button variant="secondary" onClick={logout} className="hidden sm:inline-flex"><LogOut className="h-4 w-4" />Logout</Button>
              <button type="button" onClick={logout} className="rounded-full border border-stone-200 p-2.5 text-stone-600 sm:hidden" aria-label="Logout"><LogOut className="h-5 w-5" /></button>
            </div>
          </div>

          <nav className="hidden flex-wrap gap-2 sm:flex">
            {links.map((link) => { const Icon = link.icon; return <NavLink key={link.to} to={link.to} end={link.end} className={navClass}><Icon className="h-4 w-4" />{link.label}</NavLink>; })}
          </nav>
        </div>
      </header>

      <main className="section-shell py-6 sm:py-8"><Outlet /></main>

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-stone-200 bg-white/95 px-2 py-2 backdrop-blur sm:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5 gap-1">
          {mobilePrimary.map((link) => {
            const Icon = link.icon;
            return (
              <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => `flex flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[10px] font-semibold ${isActive ? "bg-[var(--brand-50)] text-[var(--brand-700)]" : "text-stone-500"}`}>
                <Icon className="h-5 w-5" />{link.label}
              </NavLink>
            );
          })}
          <button type="button" onClick={() => setMoreOpen(true)} className="flex flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[10px] font-semibold text-stone-500"><Ellipsis className="h-5 w-5" />More</button>
        </div>
      </nav>

      {moreOpen ? (
        <div className="fixed inset-0 z-[80] flex items-end bg-stone-950/40 sm:hidden" onClick={() => setMoreOpen(false)}>
          <div className="w-full rounded-t-[2rem] bg-white p-5" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-500)]">More</p><h2 className="text-xl font-black text-[var(--brand-900)]">Resident services</h2></div><button type="button" onClick={() => setMoreOpen(false)} className="rounded-full border border-stone-200 p-2"><X className="h-4 w-4" /></button></div>
            <div className="grid grid-cols-2 gap-3">
              {mobileMore.map((link) => { const Icon = link.icon; return <NavLink key={link.to} to={link.to} onClick={() => setMoreOpen(false)} className="flex items-center gap-3 rounded-2xl border border-stone-200 p-4 text-sm font-semibold text-stone-700"><Icon className="h-5 w-5 text-[var(--brand-600)]" />{link.label}</NavLink>; })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default UserPortalLayout;
