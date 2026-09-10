import { Menu, X } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const navItems = [
  { label: "Home", to: "/" },
  { label: "News", to: "/news" },
  { label: "Announcements", to: "/announcements" },
  { label: "Funds", to: "/fund_transparency" },
  { label: "Officials", to: "/officials" },
  { label: "Calendar", to: "/calendar" },
  { label: "Voting Result", to: "/voting-result" },
];

const navClass = ({ isActive }) =>
  `text-sm font-semibold transition ${isActive ? "text-[var(--brand-600)]" : "text-stone-600 hover:text-[var(--brand-500)]"}`;

const LandingPageLayout = () => {
  const [open, setOpen] = useState(false);
  const { isAuthenticated, user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-[var(--surface)]">
      <header className="sticky top-0 z-50 border-b border-stone-200/80 bg-white/90 backdrop-blur">
        <div className="section-shell flex items-center justify-between gap-4 py-4">
          <NavLink to="/" className="flex items-center gap-3">
            <img src="/logo.png" alt="Barangay Iba" className="h-12 w-12 rounded-2xl border border-[var(--brand-100)] bg-white p-1" />
            <div>
              <p className="text-base font-black tracking-[0.2em] text-[var(--brand-900)]">BARANGAY IBA</p>
              <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Silang, Cavite</p>
            </div>
          </NavLink>

          <nav className="hidden items-center gap-6 lg:flex">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === "/"} className={navClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            {isAuthenticated ? (
              <>
                <NavLink to={["admin", "super_admin"].includes(user?.role) ? "/admin" : "/portal"} className="rounded-full bg-[var(--brand-500)] px-4 py-2 text-sm font-semibold text-white">
                  Open Portal
                </NavLink>
                <button onClick={logout} className="rounded-full border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-700">
                  Logout
                </button>
              </>
            ) : (
              <NavLink to="/login" className="rounded-full bg-[var(--brand-500)] px-4 py-2 text-sm font-semibold text-white">
                Resident Login
              </NavLink>
            )}
          </div>

          <button type="button" onClick={() => setOpen((value) => !value)} className="rounded-2xl border border-stone-200 p-2 text-stone-700 lg:hidden">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {open ? (
          <div className="section-shell flex flex-col gap-4 border-t border-stone-200 py-4 lg:hidden">
            <div className="grid gap-3">
              {navItems.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === "/"} className={navClass} onClick={() => setOpen(false)}>
                  {item.label}
                </NavLink>
              ))}
            </div>
            <div className="flex flex-col gap-3">
              {isAuthenticated ? (
                <>
                  <NavLink to={["admin", "super_admin"].includes(user?.role) ? "/admin" : "/portal"} onClick={() => setOpen(false)} className="rounded-full bg-[var(--brand-500)] px-4 py-2 text-center text-sm font-semibold text-white">
                    Open Portal
                  </NavLink>
                  <button onClick={logout} className="rounded-full border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-700">
                    Logout
                  </button>
                </>
              ) : (
                <NavLink to="/login" onClick={() => setOpen(false)} className="rounded-full bg-[var(--brand-500)] px-4 py-2 text-center text-sm font-semibold text-white">
                  Resident Login
                </NavLink>
              )}
            </div>
          </div>
        ) : null}
      </header>

      <main className="min-h-[calc(100vh-200px)]">
        <Outlet />
      </main>

      <footer className="border-t border-stone-200 bg-white">
        <div className="section-shell grid gap-8 py-10 md:grid-cols-3">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--brand-500)]">Barangay Iba</p>
            <p className="text-sm leading-6 text-stone-600">
              A resident-centered portal for requests, updates, voting, and public transparency across barangay services.
            </p>
          </div>
          <div className="space-y-2 text-sm text-stone-600">
            <p className="font-semibold text-stone-900">Quick Links</p>
            <NavLink to="/help-center" className="block hover:text-[var(--brand-500)]">Help Center</NavLink>
            <NavLink to="/terms-of-use" className="block hover:text-[var(--brand-500)]">Terms of Use</NavLink>
            <NavLink to="/privacy-policy" className="block hover:text-[var(--brand-500)]">Privacy Policy</NavLink>
          </div>
          <div className="space-y-2 text-sm text-stone-600">
            <p className="font-semibold text-stone-900">Contact</p>
            <p>Barangay Iba, Silang, Cavite</p>
            <p>Phone: 0912 345 6789</p>
            <p>Email: barangayiba@gmail.com</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPageLayout;
