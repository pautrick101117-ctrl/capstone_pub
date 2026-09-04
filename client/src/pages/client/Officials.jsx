import { Phone, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Card, EmptyState, PageHeader, Skeleton } from "../../components/ui";

const Officials = () => {
  const [officials, setOfficials] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("/public/officials")
      .then((data) => setOfficials(data.officials || []))
      .catch(() => setOfficials([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="section-shell py-10 sm:py-14">
      <PageHeader
        eyebrow="Public Directory"
        title="Barangay Officials"
        description="Meet the currently active barangay officials, their positions, terms, and available contact information."
      />

      <div className="mt-8 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {loading
          ? Array.from({ length: 6 }).map((_, index) => (
              <Card key={index} className="space-y-4">
                <Skeleton className="h-56 w-full" />
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </Card>
            ))
          : officials.map((official) => (
              <Card key={official.id} className="overflow-hidden p-0">
                <div className="h-56 bg-[linear-gradient(135deg,#dfeedd,#ffffff)]">
                  {official.photo_url ? (
                    <img src={official.photo_url} alt={official.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--brand-600)]">
                      <ShieldCheck className="h-10 w-10" />
                      <p className="text-sm font-semibold">Official Photo</p>
                    </div>
                  )}
                </div>
                <div className="space-y-3 p-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--brand-500)]">{official.term}</p>
                    <h2 className="mt-2 text-xl font-bold text-[var(--brand-900)]">{official.name}</h2>
                    <p className="mt-1 text-sm text-stone-500">{official.position}</p>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-700">
                    <Phone className="h-3.5 w-3.5" />
                    {official.contact || "Contact not listed"}
                  </div>
                </div>
              </Card>
            ))}
      </div>

      {!loading && !officials.length ? (
        <div className="mt-8">
          <EmptyState title="No active officials found" description="Public official profiles will appear here once published." />
        </div>
      ) : null}
    </section>
  );
};

export default Officials;
