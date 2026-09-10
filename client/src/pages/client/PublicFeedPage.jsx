import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../../lib/api";
import { Card, EmptyState, Modal, PageHeader, Skeleton } from "../../components/ui";
import { formatDate } from "../../lib/format";

const PublicFeedPage = ({ type = "news" }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState(null);

  useEffect(() => {

    setLoading(true);
    api(`/public/announcements?type=${type}&page=${page}&limit=6`)
      .then((data) => {
        setItems((data.items || []).length ? data.items : fallback);
        setTotal(data.pagination?.total || fallback.length || 0);
      })
      .catch(() => {
        setItems(fallback);
        setTotal(fallback.length);
      })
      .finally(() => setLoading(false));
  }, [type, page]);

  const isNews = type === "news";
  const pages = Math.max(1, Math.ceil(total / 6));

  return (
    <section className="section-shell py-10 sm:py-14">
      <PageHeader
        eyebrow={isNews ? "Community News" : "Public Notice Board"}
        title={isNews ? "Barangay News" : "Barangay Announcements"}
        description={
          isNews
            ? "Stories, updates, and milestones from Barangay Iba."
            : "Official notices, schedules, and alerts for residents."
        }
      />

      <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {loading
          ? Array.from({ length: 6 }).map((_, index) => (
              <Card key={index} className="space-y-4">
                <Skeleton className="h-48 w-full" />
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-20 w-full" />
              </Card>
            ))
          : items.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelected(item)} className="text-left">
                <Card className="overflow-hidden p-0 transition hover:-translate-y-1">
                  <div className="h-48 bg-[var(--brand-50)]">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-gradient-to-br from-[var(--brand-100)] to-white text-sm font-semibold text-[var(--brand-600)]">
                        Barangay Iba Update
                      </div>
                    )}
                  </div>
                  <div className="space-y-4 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--brand-500)]">{formatDate(item.createdAt || item.created_at)}</p>
                    <h2 className="text-xl font-bold text-[var(--brand-900)]">{item.title}</h2>
                    <p className="line-clamp-5 text-sm leading-6 text-stone-600">{item.body}</p>
                  </div>
                </Card>
              </button>
            ))}
      </div>

      {!loading && !items.length ? <EmptyState title={`No ${type} yet`} description="Please check back again soon." /> : null}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-stone-500">
          Page {page} of {pages}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="rounded-full border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-700"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(pages, current + 1))}
            className="rounded-full bg-[var(--brand-500)] px-4 py-2 text-sm font-semibold text-white"
          >
            Next
          </button>
        </div>
      </div>

      <div className="mt-8 text-sm text-stone-500">
        <NavLink to="/" className="font-semibold text-[var(--brand-600)] hover:underline">
          Back to home
        </NavLink>
      </div>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.title || "Update Details"}
        description={selected ? formatDate(selected.createdAt || selected.created_at) : ""}
        widthClass="max-w-4xl"
      >
        {selected ? (
          <div className="space-y-5">
            {selected.imageUrl ? <img src={selected.imageUrl} alt={selected.title} className="h-72 w-full rounded-3xl object-cover" /> : null}
            <div className="prose max-w-none text-sm leading-7 text-stone-700">
              <p>{selected.body}</p>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
};

export default PublicFeedPage;
