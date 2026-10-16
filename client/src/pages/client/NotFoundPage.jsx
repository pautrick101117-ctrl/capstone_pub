import { Home } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { ButtonLink, Card } from "../../components/ui";

const NotFoundPage = () => {
  const { isAuthenticated, user } = useAuth();
  const destination = !isAuthenticated ? "/" : ["admin", "super_admin"].includes(user?.role) ? "/admin" : "/portal";
  return <main className="section-shell flex min-h-[60vh] items-center justify-center py-12">
    <Card className="w-full max-w-xl text-center">
      <p className="text-xs font-bold uppercase tracking-[0.25em] text-[var(--brand-500)]">Page not found</p>
      <h1 className="mt-3 text-3xl font-black text-[var(--brand-900)]">This page isn't available.</h1>
      <p className="mt-3 text-sm leading-7 text-stone-600">The address may have changed or the page may no longer exist. Use the navigation menu or return to the dashboard.</p>
      <ButtonLink to={destination} className="mt-6"><Home className="h-4 w-4" /> {destination === "/" ? "Return Home" : "Return to Dashboard"}</ButtonLink>
    </Card>
  </main>;
};

export default NotFoundPage;
