import { LOGO_URL } from "../../lib/assets";
import { ChevronDown, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";

const menuGroups = [
  {
    label: "Services",
    items: [
      { label: "Request Documents", to: "/login" },
      { label: "Barangay ID", to: "/login" },
      { label: "Report a Community Concern", to: "/login" },
      { label: "Borrow Facilities & Equipment", to: "/login" },
      { label: "Community Project Voting", to: "/login" },
    ],
  },
  { label: "Updates", items: [{ label: "Announcements", to: "/announcements" }, { label: "News", to: "/news" }, { label: "Calendar", to: "/calendar" }] },
  { label: "Transparency", items: [{ label: "Fund Transparency", to: "/fund_transparency" }, { label: "Voting Results", to: "/voting-result" }] },
  { label: "Community", items: [{ label: "Barangay Officials", to: "/officials" }, { label: "Project Suggestions", to: "/login" }] },
];

const navClass = ({ isActive }) => `text-sm font-semibold transition ${isActive ? "text-[var(--brand-600)]" : "text-stone-600 hover:text-[var(--brand-500)]"}`;

const LandingPageLayout = () => {
  const [open, setOpen] = useState(false);
  const [support, setSupport] = useState(null);
  const { isAuthenticated, user, logout } = useAuth();

  useEffect(() => {
    api("/public/community-support").then(setSupport).catch(() => {});
  }, []);

  const portalPath = ["admin", "super_admin"].includes(user?.role) ? "/admin" : "/portal";
  const contact = support?.contact || {};

  return (
    <div className="min-h-screen bg-[var(--surface)]">
      <header className="sticky top-0 z-50 border-b border-stone-200/80 bg-white/95 backdrop-blur">
        <div className="section-shell flex items-center justify-between gap-4 py-4">
          <NavLink to="/" className="flex items-center gap-3">
            <img src={LOGO_URL} alt="Barangay Iba" className="h-12 w-12 rounded-2xl border border-[var(--brand-100)] bg-white p-1" />
            <div>
              <p className="text-base font-black tracking-[0.2em] text-[var(--brand-900)]">BARANGAY IBA</p>
              <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Silang, Cavite</p>
            </div>
          </NavLink>

          <nav className="hidden items-center gap-5 lg:flex">
            <NavLink to="/" end className={navClass}>Home</NavLink>
            {menuGroups.map((group) => (
              <div key={group.label} className="group relative">
                <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-stone-600 transition hover:text-[var(--brand-500)]">
                  {group.label}<ChevronDown className="h-4 w-4" />
                </button>
                <div className="invisible absolute left-1/2 top-full z-50 mt-3 w-72 -translate-x-1/2 rounded-3xl border border-stone-200 bg-white p-2 opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                  {group.items.map((item) => <NavLink key={`${group.label}-${item.label}`} to={item.to} className="block rounded-2xl px-4 py-3 text-sm font-semibold text-stone-600 hover:bg-[var(--brand-50)] hover:text-[var(--brand-700)]">{item.label}</NavLink>)}
                </div>
              </div>
            ))}
            <NavLink to="/help-center" className={navClass}>Help</NavLink>
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            {isAuthenticated ? (
              <>
                <NavLink to={portalPath} className="rounded-full bg-[var(--brand-500)] px-4 py-2 text-sm font-semibold text-white">Open Portal</NavLink>
                <button onClick={logout} className="rounded-full border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-700">Logout</button>
              </>
            ) : (
              <NavLink to="/login" className="rounded-full bg-[var(--brand-500)] px-4 py-2 text-sm font-semibold text-white">Resident Login</NavLink>
            )}
          </div>

          <button type="button" aria-label="Toggle public navigation" onClick={() => setOpen((value) => !value)} className="rounded-2xl border border-stone-200 p-2 text-stone-700 lg:hidden">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {open ? (
          <div className="section-shell max-h-[calc(100vh-5rem)] overflow-y-auto border-t border-stone-200 py-4 lg:hidden">
            <NavLink to="/" end onClick={() => setOpen(false)} className="block rounded-2xl px-3 py-3 text-sm font-bold text-[var(--brand-800)]">Home</NavLink>
            {menuGroups.map((group) => (
              <div key={group.label} className="mt-4">
                <p className="px-3 text-[10px] font-bold uppercase tracking-[0.22em] text-stone-400">{group.label}</p>
                <div className="mt-1 grid">
                  {group.items.map((item) => <NavLink key={`${group.label}-${item.label}`} to={item.to} onClick={() => setOpen(false)} className="rounded-2xl px-3 py-2.5 text-sm font-semibold text-stone-600 hover:bg-[var(--brand-50)]">{item.label}</NavLink>)}
                </div>
              </div>
            ))}
            <NavLink to="/help-center" onClick={() => setOpen(false)} className="mt-3 block rounded-2xl px-3 py-3 text-sm font-bold text-[var(--brand-800)]">Help Center</NavLink>
            <div className="mt-4 border-t border-stone-200 pt-4">
              {isAuthenticated ? (
                <div className="grid gap-2">
                  <NavLink to={portalPath} onClick={() => setOpen(false)} className="rounded-full bg-[var(--brand-500)] px-4 py-3 text-center text-sm font-semibold text-white">Open Portal</NavLink>
                  <button onClick={logout} className="rounded-full border border-stone-200 px-4 py-3 text-sm font-semibold text-stone-700">Logout</button>
                </div>
              ) : <NavLink to="/login" onClick={() => setOpen(false)} className="block rounded-full bg-[var(--brand-500)] px-4 py-3 text-center text-sm font-semibold text-white">Resident Login</NavLink>}
            </div>
          </div>
        ) : null}
      </header>

      <main className="min-h-[calc(100vh-200px)]"><Outlet /></main>

      <footer className="border-t border-stone-200 bg-white">
        <div className="section-shell grid gap-8 py-10 md:grid-cols-3">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--brand-500)]">Barangay Iba</p>
            <p className="text-sm leading-6 text-stone-600">A resident-centered portal for barangay services, community updates, project voting and public transparency.</p>
          </div>
          <div className="space-y-2 text-sm text-stone-600">
            <p className="font-semibold text-stone-900">Quick Links</p>
            <NavLink to="/help-center" className="block hover:text-[var(--brand-500)]">Help Center</NavLink>
            <NavLink to="/terms-of-use" className="block hover:text-[var(--brand-500)]">Terms of Use</NavLink>
            <NavLink to="/privacy-policy" className="block hover:text-[var(--brand-500)]">Privacy Policy</NavLink>
          </div>
          <div className="space-y-2 text-sm text-stone-600">
            <p className="font-semibold text-stone-900">Contact</p>
            <p>{contact.address || "Barangay Iba, Silang, Cavite"}</p>
            {contact.phone ? <p>Phone: {contact.phone}</p> : null}
            {contact.email ? <p>Email: {contact.email}</p> : null}
            {contact.facebook ? <p>Facebook: {contact.facebook}</p> : null}
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPageLayout;
