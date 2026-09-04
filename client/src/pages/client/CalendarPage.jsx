import { CalendarDays, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Card, EmptyState, Modal, PageHeader, Pagination, Skeleton } from "../../components/ui";
import { formatDate } from "../../lib/format";

const CalendarPage = () => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 9;

  useEffect(() => {
    setLoading(true);
    api(`/public/events?upcomingOnly=true&page=${page}&limit=${pageSize}`)
      .then((data) => {
        setEvents(data.items || []);
        setTotal(data.pagination?.total || 0);
      })
      .catch(() => {
        setEvents([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <section className="section-shell py-10 sm:py-14">
      <PageHeader
        eyebrow="Public Calendar"
        title="Upcoming Barangay Events"
        description="Keep track of barangay meetings, outreach activities, health drives, clean-up programs, and other community events."
      />

      <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {loading
          ? Array.from({ length: 6 }).map((_, index) => (
              <Card key={index} className="space-y-4">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </Card>
            ))
          : events.map((event) => (
              <button key={event.id} type="button" onClick={() => setSelected(event)} className="text-left">
                <Card className="space-y-4 transition hover:-translate-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--brand-500)]">
                    <CalendarDays className="h-4 w-4" />
                    {event.type}
                  </div>
                  <h2 className="text-xl font-bold text-[var(--brand-900)]">{event.title}</h2>
                  <p className="text-sm text-stone-500">
                    {formatDate(event.date)}
                    {event.time ? ` - ${event.time}` : ""}
                  </p>
                  <div className="inline-flex items-center gap-2 rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-700">
                    <MapPin className="h-3.5 w-3.5" />
                    {event.location || "Barangay Hall"}
                  </div>
                  <p className="text-sm leading-6 text-stone-600">{event.description || "Details will be announced soon."}</p>
                </Card>
              </button>
            ))}
      </div>

      {!loading && !events.length ? (
        <div className="mt-8">
          <EmptyState title="No upcoming events" description="The public calendar is clear right now." />
        </div>
      ) : null}

      {!loading && total > 0 ? (
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} className="mt-8" />
      ) : null}

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.title || "Event Details"}
        description={selected ? `${formatDate(selected.date)}${selected.time ? ` - ${selected.time}` : ""}` : ""}
      >
        {selected ? (
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-700">
              <MapPin className="h-3.5 w-3.5" />
              {selected.location || "Barangay Hall"}
            </div>
            <p className="text-sm uppercase tracking-[0.24em] text-[var(--brand-500)]">{selected.type}</p>
            <p className="text-sm leading-7 text-stone-700">{selected.description || "Details will be announced soon."}</p>
          </div>
        ) : null}
      </Modal>
    </section>
  );
};

export default CalendarPage;
