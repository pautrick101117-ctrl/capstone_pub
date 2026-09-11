import { CalendarDays, MapPin } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { Card, EmptyState, ErrorState, Modal, PageHeader, Pagination, SegmentedTabs, SelectInput, Skeleton } from "../../components/ui";
import { formatDate } from "../../lib/format";
import { useMasterData } from "../../hooks/useMasterData";

const pageSize = 9;

const CalendarPage = () => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [category, setCategory] = useState("all");
  const [view, setView] = useState("list");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const { options: categoryOptions } = useMasterData("event_category");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const typeQuery = category === "all" ? "" : `&type=${encodeURIComponent(category)}`;
      const data = await api(`/public/events?upcomingOnly=true&page=${page}&limit=${pageSize}${typeQuery}`);
      setEvents(data.items || []); setTotal(data.pagination?.total || 0);
    } catch (err) { setError(err.message); setEvents([]); setTotal(0); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [page, category]);
  useEffect(() => { setPage(1); }, [category]);

  const grouped = useMemo(() => events.reduce((acc, event) => { (acc[event.date] ||= []).push(event); return acc; }, {}), [events]);

  return <section className="section-shell py-10 sm:py-14">
    <PageHeader eyebrow="Community Calendar" title="Upcoming Barangay Events" description="Find barangay meetings, outreach activities, health drives, clean-up programs and other public events." />
    <div className="mt-8 flex flex-col gap-4 rounded-3xl border border-stone-200 bg-white p-4 sm:flex-row sm:items-end sm:justify-between"><SelectInput className="w-full sm:max-w-sm" label="Event Category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categoryOptions.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</SelectInput><SegmentedTabs value={view} onChange={setView} items={[{ value: "list", label: "List" }, { value: "calendar", label: "By Date" }]} /></div>
    {error ? <div className="mt-6"><ErrorState description={error} onRetry={load} /></div> : null}

    {loading ? <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Card key={index} className="space-y-4"><Skeleton className="h-6 w-32" /><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-full" /></Card>)}</div> : !events.length ? <div className="mt-8"><EmptyState title="No upcoming events" description={category === "all" ? "The public calendar is clear right now." : "No upcoming events match this category."} /></div> : view === "list" ? (
      <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{events.map((event) => <button key={event.id} type="button" onClick={() => setSelected(event)} className="text-left"><Card className="h-full space-y-4 hover:-translate-y-1 hover:border-[var(--brand-200)] hover:shadow-md"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-500)]"><CalendarDays className="h-4 w-4" />{event.type}</div><h2 className="text-xl font-bold text-[var(--brand-900)]">{event.title}</h2><p className="text-sm text-stone-500">{formatDate(event.date)}{event.time ? ` · ${event.time}` : ""}</p><div className="inline-flex items-center gap-2 rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-700"><MapPin className="h-3.5 w-3.5" />{event.location || "Barangay Hall"}</div><p className="line-clamp-3 text-sm leading-6 text-stone-600">{event.description || "Details will be announced soon."}</p></Card></button>)}</div>
    ) : (
      <div className="mt-8 space-y-6">{Object.entries(grouped).map(([date, items]) => <div key={date} className="grid gap-4 lg:grid-cols-[180px_1fr]"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--brand-500)]">Date</p><h2 className="mt-1 text-xl font-black text-[var(--brand-900)]">{formatDate(date)}</h2></div><div className="space-y-3">{items.map((event) => <button key={event.id} type="button" onClick={() => setSelected(event)} className="w-full rounded-2xl border border-stone-200 bg-white p-4 text-left hover:border-[var(--brand-200)]"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-bold text-[var(--brand-900)]">{event.title}</h3><p className="mt-1 text-sm text-stone-500">{event.time || "Time TBA"} · {event.location || "Barangay Hall"}</p></div><span className="rounded-full bg-[var(--brand-50)] px-3 py-1 text-xs font-semibold text-[var(--brand-700)]">{event.type}</span></div></button>)}</div></div>)}</div>
    )}
    {!loading && !error ? <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} onPageChange={setPage} className="mt-8" /> : null}

    <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.title || "Event Details"} description={selected ? `${formatDate(selected.date)}${selected.time ? ` · ${selected.time}` : ""}` : ""}>{selected ? <div className="space-y-4"><div className="inline-flex items-center gap-2 rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-700"><MapPin className="h-3.5 w-3.5" />{selected.location || "Barangay Hall"}</div><p className="text-sm uppercase tracking-[0.2em] text-[var(--brand-500)]">{selected.type}</p><p className="text-sm leading-7 text-stone-700">{selected.description || "Details will be announced soon."}</p></div> : null}</Modal>
  </section>;
};
export default CalendarPage;
