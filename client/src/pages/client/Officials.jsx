import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from "../../components/ui";

const Officials = () => {
  const [officials, setOfficials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try { const data = await api("/public/officials"); setOfficials(data.officials || []); }
    catch (err) { setError(err.message); setOfficials([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const [head, ...rest] = officials;
  return (
    <section className="section-shell py-10 sm:py-14">
      <PageHeader eyebrow="Public Directory" title="Barangay Officials" description="Meet the officials currently serving Barangay Iba. Direct personal contact information is kept private; residents should use the official Barangay contact channels for assistance." />
      {error ? <div className="mt-8"><ErrorState description={error} onRetry={load} /></div> : null}
      {loading ? <div className="mt-8 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Card key={index} className="space-y-4"><Skeleton className="h-56 w-full" /><Skeleton className="h-6 w-2/3" /><Skeleton className="h-4 w-1/2" /></Card>)}</div> : !officials.length ? <div className="mt-8"><EmptyState title="No active officials found" description="Public official profiles will appear here once published." /></div> : (
        <div className="mt-8 space-y-8">
          {head ? <Card className="overflow-hidden p-0"><div className="grid md:grid-cols-[0.8fr_1.2fr]"><div className="min-h-72 bg-[linear-gradient(135deg,#dfeedd,#ffffff)]">{head.photo_url ? <img src={head.photo_url} alt={head.name} className="h-full w-full object-cover" /> : <div className="flex h-full min-h-72 flex-col items-center justify-center gap-3 text-[var(--brand-600)]"><ShieldCheck className="h-12 w-12" /><p className="font-semibold">Official Photo</p></div>}</div><div className="flex flex-col justify-center p-6 sm:p-8"><p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand-500)]">{head.term}</p><h2 className="mt-2 text-3xl font-black text-[var(--brand-900)]">{head.name}</h2><p className="mt-2 text-lg font-semibold text-stone-600">{head.position}</p></div></div></Card> : null}
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">{rest.map((official) => <Card key={official.id} className="overflow-hidden p-0"><div className="h-56 bg-[linear-gradient(135deg,#dfeedd,#ffffff)]">{official.photo_url ? <img src={official.photo_url} alt={official.name} className="h-full w-full object-cover" /> : <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--brand-600)]"><ShieldCheck className="h-10 w-10" /><p className="text-sm font-semibold">Official Photo</p></div>}</div><div className="space-y-3 p-5"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-500)]">{official.term}</p><h2 className="mt-2 text-xl font-bold text-[var(--brand-900)]">{official.name}</h2><p className="mt-1 text-sm text-stone-500">{official.position}</p></div></div></Card>)}</div>
        </div>
      )}
    </section>
  );
};
export default Officials;
