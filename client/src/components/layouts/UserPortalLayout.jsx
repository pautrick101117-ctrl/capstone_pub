import { LOGO_URL } from "../../lib/assets";
import {
  Bell,
  CalendarDays,
  CheckSquare,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  HelpCircle,
  Home,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  MoreHorizontal,
  PackageCheck,
  Settings,
  Vote,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Button, Card } from "../ui";
import SessionExpiryBanner from "../SessionExpiryBanner";
import { formatDateTime } from "../../lib/format";

const groups = [
  {
    label: "Overview",
    links: [{ to: "/portal", label: "Dashboard", icon: LayoutDashboard, end: true }],
  },
  {
    label: "My Services",
    links: [
      { to: "/portal/requests", label: "Requests & Documents", icon: ClipboardList },
      { to: "/portal/complaints", label: "Community Concerns", icon: CircleAlert },
      { to: "/portal/borrowing", label: "Borrow Resources", icon: PackageCheck },
    ],
  },
  {
    label: "Community",
    links: [
      { to: "/portal/voting", label: "Project Voting", icon: Vote },
      { to: "/portal/suggestions", label: "Project Suggestions", icon: Lightbulb },
      { to: "/project-updates", label: "Project Updates", icon: CheckSquare },
      { to: "/portal/calendar", label: "Calendar", icon: CalendarDays },
      { to: "/portal/voting-result", label: "Voting Results", icon: CheckSquare },
    ],
  },
  {
    label: "Account",
    links: [
      { to: "/portal/settings", label: "Settings", icon: Settings },
      { to: "/help-center", label: "Help Center", icon: HelpCircle },
    ],
  },
];

const allLinks = groups.flatMap((group) => group.links);

const notificationDestination = (note) => {
  if (note?.destination && `${note.destination}`.startsWith("/")) return note.destination;
  const text = `${note?.title || ""} ${note?.body || ""}`.toLowerCase();
  if (text.includes("borrow")) return "/portal/borrowing";
  if (text.includes("concern") || text.includes("complaint")) return "/portal/complaints";
  if (text.includes("project update") || text.includes("implementation")) return "/project-updates";
  if (text.includes("suggest")) return "/portal/suggestions";
  if (text.includes("vote") || text.includes("voting") || text.includes("election")) return "/portal/voting";
  if (text.includes("request") || text.includes("clearance") || text.includes("barangay id")) return "/portal/requests";
  return "/portal";
};

const navClass = ({ isActive }) =>
  `flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
    isActive
      ? "bg-[var(--brand-500)] text-white shadow-lg shadow-emerald-900/10"
      : "text-stone-600 hover:bg-[var(--brand-50)] hover:text-[var(--brand-700)]"
  }`;

const NotificationCenter = ({ open, onClose }) => {
  const navigate = useNavigate();
  const { notifications, markNotificationRead, markAllNotificationsRead } = useAuth();
  const ordered = useMemo(
    () => [...notifications].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [notifications]
  );

  if (!open) return null;

  const openNotification = async (note) => {
    if (!note.is_read) await markNotificationRead(note.id);
    onClose();
    navigate(notificationDestination(note));
  };

  return (
    <div className="absolute right-0 top-14 z-50 w-[min(29rem,calc(100vw-2rem))]">
      <Card className="max-h-[34rem] overflow-y-auto p-0 shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-stone-500">Notifications</p>
            <h3 className="text-lg font-bold text-[var(--brand-900)]">Updates for you</h3>
          </div>
          {ordered.some((note) => !note.is_read) ? (
            <Button variant="ghost" className="px-3 py-2" onClick={markAllNotificationsRead}>Mark all read</Button>
          ) : null}
        </div>
        <div className="divide-y divide-stone-100">
          {ordered.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="font-semibold text-stone-700">You're all caught up.</p>
              <p className="mt-1 text-sm text-stone-500">Request, voting and barangay updates will appear here.</p>
            </div>
          ) : (
            ordered.map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => openNotification(note)}
                className={`w-full px-5 py-4 text-left transition hover:bg-stone-50 ${note.is_read ? "bg-white" : "bg-[var(--brand-50)]"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--brand-900)]">{note.title}</p>
                    <p className="mt-1 line-clamp-3 text-sm leading-6 text-stone-600">{note.body}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!note.is_read ? <span className="h-2.5 w-2.5 rounded-full bg-[var(--brand-500)]" /> : null}
                    <ChevronRight className="h-4 w-4 text-stone-400" />
                  </div>
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--surface)] pb-20 lg:pb-0">
      <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur lg:pl-72 xl:pl-80">
        <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <img src={LOGO_URL} alt="Barangay Iba" className="h-11 w-11 rounded-2xl border border-[var(--brand-100)] bg-white p-1" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--brand-500)]">Resident Portal</p>
              <h1 className="truncate text-lg font-black text-[var(--brand-900)]">{user?.fullName || "Resident"}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                type="button"
                aria-label="Open notifications"
                onClick={() => setShowNotifications((value) => !value)}
                className="relative rounded-full border border-stone-200 bg-white p-3 text-stone-700 transition hover:border-[var(--brand-200)] hover:bg-[var(--brand-50)]"
              >
                <Bell className="h-5 w-5" />
                {unreadCount ? (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>
                ) : null}
              </button>
              <NotificationCenter open={showNotifications} onClose={() => setShowNotifications(false)} />
            </div>
            <Button variant="secondary" className="hidden sm:inline-flex" onClick={logout}><LogOut className="h-4 w-4" /> Logout</Button>
          </div>
        </div>
      </header>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-stone-200 bg-white lg:flex lg:flex-col xl:w-80">
        <div className="flex items-center gap-3 border-b border-stone-100 px-6 py-5">
          <img src={LOGO_URL} alt="Barangay Iba" className="h-12 w-12 rounded-2xl border border-[var(--brand-100)] bg-white p-1" />
          <div>
            <p className="text-base font-black tracking-[0.12em] text-[var(--brand-900)]">BARANGAY IBA</p>
            <p className="text-xs text-stone-500">Resident services</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {groups.map((group) => (
            <div key={group.label} className="mb-5">
              <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.24em] text-stone-400">{group.label}</p>
              <nav className="space-y-1">
                {group.links.map((link) => {
                  const Icon = link.icon;
                  return (
                    <NavLink key={link.to} to={link.to} end={link.end} className={navClass}>
                      <Icon className="h-4 w-4" />
                      {link.label}
                    </NavLink>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>
        <div className="border-t border-stone-100 p-4">
          <Button variant="ghost" className="w-full justify-start" onClick={logout}><LogOut className="h-4 w-4" /> Logout</Button>
        </div>
      </aside>

      <main className="px-4 py-6 sm:px-6 sm:py-8 lg:ml-72 lg:px-8 xl:ml-80 2xl:px-10">
        <div className="mx-auto w-full max-w-[1500px] animate-[fadeIn_.25s_ease]">
          <div className="mb-6"><SessionExpiryBanner /></div>
          <Outlet />
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-stone-200 bg-white px-1 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1.5 shadow-[0_-10px_30px_rgba(0,0,0,0.06)] lg:hidden">
        {[
          { to: "/portal", label: "Home", icon: Home, end: true },
          { to: "/portal/requests", label: "Requests", icon: ClipboardList },
          { to: "/portal/complaints", label: "Concerns", icon: CircleAlert },
          { to: "/portal/borrowing", label: "Borrow", icon: PackageCheck },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `flex flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[10px] font-semibold ${isActive ? "text-[var(--brand-600)]" : "text-stone-500"}`}>
              <Icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          );
        })}
        <button type="button" onClick={() => setMobileMenuOpen(true)} className="flex flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[10px] font-semibold text-stone-500">
          <MoreHorizontal className="h-5 w-5" />
          More
        </button>
      </nav>

      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-[80] bg-stone-950/35 lg:hidden" onClick={() => setMobileMenuOpen(false)}>
          <div className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto rounded-t-[2rem] bg-white p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <div><p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--brand-500)]">Resident Portal</p><h2 className="mt-1 text-2xl font-black text-[var(--brand-900)]">More</h2></div>
              <button type="button" aria-label="Close menu" onClick={() => setMobileMenuOpen(false)} className="rounded-full border border-stone-200 p-2"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-2">
              {allLinks.filter((link) => !["/portal", "/portal/requests", "/portal/complaints", "/portal/borrowing"].includes(link.to)).map((link) => {
                const Icon = link.icon;
                return <NavLink key={link.to} to={link.to} onClick={() => setMobileMenuOpen(false)} className={navClass}><Icon className="h-4 w-4" />{link.label}</NavLink>;
              })}
              <button type="button" onClick={logout} className="mt-2 flex items-center gap-3 rounded-2xl bg-stone-100 px-4 py-3 text-sm font-semibold text-stone-700"><LogOut className="h-4 w-4" />Logout</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default UserPortalLayout;
