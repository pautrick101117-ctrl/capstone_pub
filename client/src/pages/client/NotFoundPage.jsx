import { ClipboardList, Home } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../context/auth";
import { ButtonLink, Card } from "../../components/ui";
import { isResidentSession } from "../../lib/residentAccess";

const NotFoundPage = () => {
  const auth = useAuth();
  const { pathname } = useLocation();
  const staff = ["admin", "super_admin"].includes(auth.user?.role);
  const adminRequestPath = pathname.startsWith("/admin/requests/");
  const destination = staff
    ? (adminRequestPath ? "/admin/requests" : "/admin")
    : isResidentSession(auth) ? "/portal" : "/";
  const label = staff
    ? (adminRequestPath ? "Back to Requests" : "Return to Admin Dashboard")
    : destination === "/" ? "Return Home" : "Return to Dashboard";
  const Icon = staff && adminRequestPath ? ClipboardList : Home;
  return (
    <main className="section-shell flex min-h-[60vh] items-center justify-center py-12">
      <Card className="w-full max-w-xl text-center">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-[var(--brand-500)]">Page not found</p>
        <h1 className="mt-3 text-3xl font-black text-[var(--brand-900)]">This page isn't available.</h1>
        <p className="mt-3 text-sm leading-7 text-stone-600">
          The address may have changed. Use the navigation menu or return to the previous section.
        </p>
        <ButtonLink to={destination} className="mt-6"><Icon className="h-4 w-4" /> {label}</ButtonLink>
      </Card>
    </main>
  );
};

export default NotFoundPage;

