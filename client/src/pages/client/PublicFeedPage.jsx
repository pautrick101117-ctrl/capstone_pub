import { BellRing, Newspaper } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../../lib/api";
import { Card, EmptyState, ErrorState, Modal, PageHeader, Pagination, Skeleton } from "../../components/ui";
import { formatDate } from "../../lib/format";

const PublicFeedPage = ({ type = "news" }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState(null);
  const isNews = type === "news";

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api(`/public/announcements?type=${type}&page=${page}&limit=6`);
      setItems(data.items || []);
      setTotal(data.pagination?.total || 0);
    } catch (err) {
      setItems([]);
      setTotal(0);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [type, page]);
  useEffect(() => { setPage(1); }, [type]);
  const pages = Math.max(1, Math.ceil(total / 6));

  return (
    <section className="section-shell py-10 sm:py-14">
      <PageHeader eyebrow={isNews ? "Community News" : "Public Notice Board"} title={isNews ? "Barangay News" : "Barangay Announcements"} description={isNews ? "Stories, programs and community updates from Barangay Iba." : "Official notices, schedules and resident advisories from the barangay."} />

      {error ? <div className="mt-8"><ErrorState description={error} onRetry={load} /></div> : null}

      {isNews ? (
        <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {loading ? Array.from({ length: 6 }, (_, index) => <Card key={index} className="space-y-4"><Skeleton className="h-48 w-full" /><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-24" /><Skeleton className="h-16 w-full" /></Card>) : items.map((item) => <NavLink key={item.id} to={`/news/${item.id}`} className="text-left"><Card className="h-full overflow-hidden p-0 hover:-translate-y-1 hover:border-[var(--brand-200)] hover:shadow-md"><div className="h-48 bg-[var(--brand-50)]">{item.imageUrl ? <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center bg-gradient-to-br from-[var(--brand-100)] to-white text-[var(--brand-600)]"><Newspaper className="h-9 w-9" /></div>}</div><div className="space-y-3 p-5"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-500)]">{formatDate(item.createdAt || item.created_at)}</p><h2 className="text-xl font-bold text-[var(--brand-900)]">{item.title}</h2><p className="line-clamp-4 text-sm leading-6 text-stone-600">{item.body}</p><span className="inline-block text-sm font-bold text-[var(--brand-600)]">Read Article →</span></div></Card></NavLink>)}
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          {loading ? Array.from({ length: 5 }, (_, index) => <Card key={index}><Skeleton className="h-5 w-40" /><Skeleton className="mt-3 h-4 w-full" /><Skeleton className="mt-2 h-4 w-4/5" /></Card>) : items.map((item) => <button key={item.id} type="button" onClick={() => setSelected(item)} className="w-full text-left"><Card className="hover:border-[var(--brand-200)] hover:shadow-sm"><div className="flex items-start gap-4"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><BellRing className="h-5 w-5" /></div><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-500)]">{formatDate(item.createdAt || item.created_at)}</p><h2 className="mt-1 text-lg font-bold text-[var(--brand-900)]">{item.title}</h2><p className="mt-2 line-clamp-3 text-sm leading-6 text-stone-600">{item.body}</p></div></div></Card></button>)}
        </div>
      )}

      {!loading && !error && !items.length ? <div className="mt-8"><EmptyState title={isNews ? "No news published yet" : "No announcements published yet"} description={isNews ? "Community stories will appear here when published." : "Official resident notices will appear here when published."} /></div> : null}
      {!loading && !error ? <Pagination page={page} totalPages={pages} onPageChange={setPage} className="mt-8" /> : null}
      <div className="mt-8 text-sm text-stone-500"><NavLink to="/" className="font-semibold text-[var(--brand-600)] hover:underline">Back to home</NavLink></div>

      <Modal open={!isNews && Boolean(selected)} onClose={() => setSelected(null)} title={selected?.title || "Update Details"} description={selected ? formatDate(selected.createdAt || selected.created_at) : ""} widthClass="max-w-4xl">{selected ? <div className="space-y-5">{selected.imageUrl ? <img src={selected.imageUrl} alt={selected.title} className="h-72 w-full rounded-3xl object-cover" /> : null}<p className="whitespace-pre-wrap text-sm leading-7 text-stone-700">{selected.body}</p></div> : null}</Modal>
    </section>
  );
};

export default PublicFeedPage;
