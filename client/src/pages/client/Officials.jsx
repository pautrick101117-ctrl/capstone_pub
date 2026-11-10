import { ShieldCheck, ArrowUpRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui";

const LEADER_POSITION = /punong\s+barangay|barangay\s+(captain|chairman|chairperson)/i;

/** Keep portraits visible even when source photos have different dimensions. */
function OfficialPortrait({ official, featured = false }) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [official.photo_url]);

  return (
    <div
      className={`relative flex items-end justify-center overflow-hidden bg-[#e7f0e5] ${
        featured ? "h-64 w-full sm:h-[310px] md:h-[340px]" : "h-52 w-full sm:h-56"
      }`}
    >
      {official.photo_url && !imageFailed ? (
        <img
          src={official.photo_url}
          alt={`Portrait of ${official.name}`}
          className="h-full w-full object-contain object-bottom"
          loading={featured ? "eager" : "lazy"}
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--brand-600)]">
          <ShieldCheck className={featured ? "h-11 w-11" : "h-9 w-9"} aria-hidden="true" />
          <span className="text-xs font-medium">Photo unavailable</span>
        </div>
      )}
    </div>
  );
}

function OfficialCard({ official }) {
  return (
    <article className="group flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm shadow-stone-200/40 transition-shadow duration-200 hover:shadow-md">
      <OfficialPortrait official={official} />
      <div className="flex flex-1 flex-col px-5 py-5 sm:px-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-[var(--brand-700)]">
          {official.position || "Barangay official"}
        </p>
        <h3 className="mt-2 break-words text-lg font-extrabold leading-snug text-[var(--brand-900)]">
          {official.name}
        </h3>
        {official.term ? (
          <p className="mt-auto pt-4 text-sm text-stone-500">Term: {official.term}</p>
        ) : null}
      </div>
    </article>
  );
}

function OfficialsLoading() {
  return (
    <div className="mt-9 space-y-7" role="status" aria-label="Loading barangay officials">
      <div className="grid overflow-hidden rounded-2xl border border-stone-200 bg-white md:grid-cols-[310px_minmax(0,1fr)]">
        <Skeleton className="h-64 w-full rounded-none md:h-[340px]" />
        <div className="flex flex-col justify-center gap-4 p-7 sm:p-10">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-9 w-64 max-w-full" />
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
            <Skeleton className="h-56 w-full rounded-none" />
            <div className="space-y-3 p-5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-6 w-3/4" />
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Loading officials...</span>
    </div>
  );
}

export default function Officials() {
  const [officials, setOfficials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      const response = await api("/public/officials", { signal });
      if (!signal?.aborted) {
        setOfficials(Array.isArray(response?.officials) ? response.officials : []);
      }
    } catch (loadError) {
      if (!signal?.aborted) {
        setError(loadError.message || "Unable to load officials at this time.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const { leader, remainingOfficials } = useMemo(() => {
    const matchingIndex = officials.findIndex((official) =>
      LEADER_POSITION.test(String(official.position || "")),
    );
    const leaderIndex = matchingIndex >= 0 ? matchingIndex : 0;
    return {
      leader: officials[leaderIndex] || null,
      remainingOfficials: officials.filter((_, index) => index !== leaderIndex),
    };
  }, [officials]);

  return (
    <section className="section-shell py-9 sm:py-12 lg:py-14" aria-labelledby="officials-title">
      <header className="max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--brand-600)]">
          Public Directory
        </p>
        <h1 id="officials-title" className="mt-2 text-3xl font-black tracking-tight text-[var(--brand-900)] sm:text-4xl">
          Barangay Officials
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-stone-600 sm:text-base">
          Meet the officials serving Barangay Iba, Silang, Cavite.
        </p>
      </header>

      {loading ? (
        <OfficialsLoading />
      ) : error ? (
        <div className="mt-8">
          <ErrorState title="Unable to load barangay officials" description={error} onRetry={() => load()} />
        </div>
      ) : !leader ? (
        <div className="mt-8">
          <EmptyState title="No officials available" description="Profiles will appear here once the barangay publishes them." />
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          <section aria-labelledby="featured-official-title">
            <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm shadow-stone-200/50">
              <div className="grid md:grid-cols-[minmax(260px,310px)_minmax(0,1fr)]">
                <OfficialPortrait official={leader} featured />
                <div className="flex flex-col justify-center px-6 py-7 sm:px-9 md:px-10 md:py-10">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--brand-600)]">
                    Barangay Leadership
                  </p>
                  <h2 id="featured-official-title" className="mt-3 break-words text-2xl font-black leading-tight tracking-tight text-[var(--brand-900)] sm:text-3xl lg:text-4xl">
                    {leader.name}
                  </h2>
                  <p className="mt-3 text-base font-semibold text-[var(--brand-700)] sm:text-lg">
                    {leader.position}
                  </p>
                  {leader.term ? (
                    <p className="mt-5 inline-flex w-fit rounded-full bg-[var(--brand-50)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-700)]">
                      Term: {leader.term}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          {remainingOfficials.length ? (
            <section aria-labelledby="other-officials-title">
              <div className="mb-5 border-b border-stone-200 pb-4">
                <h2 id="other-officials-title" className="text-xl font-extrabold text-[var(--brand-900)] sm:text-2xl">
                  Other Barangay Officials
                </h2>
                <p className="mt-1 text-sm text-stone-600">Officials currently listed in the public directory.</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {remainingOfficials.map((official) => (
                  <OfficialCard key={official.id} official={official} />
                ))}
              </div>
            </section>
          ) : null}

          <aside className="flex flex-col gap-3 rounded-xl border border-[var(--brand-100)] bg-[var(--brand-50)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Contact the barangay">
            <p className="max-w-2xl text-sm leading-6 text-[var(--brand-800)]">
              Need help from a barangay official? Please use the official barangay contact channels instead of personal contact information.
            </p>
            <Link to="/help-center" className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-bold text-[var(--brand-700)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand-500)]">
              Visit Help Center <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </aside>
        </div>
      )}
    </section>
  );
}
