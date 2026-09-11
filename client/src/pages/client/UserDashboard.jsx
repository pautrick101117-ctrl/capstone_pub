import { BellRing, CalendarClock, CircleAlert, ClipboardList, PackageCheck, Plus, Vote } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { getStatusMeta } from "../../lib/status";

const destinationForNotification = (note) => {
  const text = `${note?.title || ""} ${note?.body || ""}`.toLowerCase();
  if (text.includes("borrow")) return "/portal/borrowing";
  if (text.includes("concern") || text.includes("complaint")) return "/portal/complaints";
  if (text.includes("vote") || text.includes("voting") || text.includes("election")) return "/portal/voting";
  if (text.includes("suggest")) return "/portal/suggestions";
  return "/portal/requests";
};

const Status = ({ status, feature }) => {
  const meta = getStatusMeta(status, feature);
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
};

const UserDashboard = () => {
  const { token, user, notifications } = useAuth();
  const [data, setData] = useState({ requests: [], idRequests: [], complaints: [], borrowing: [], election: null, hasVoted: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    const calls = await Promise.allSettled([
      api("/requests/mine", { token }),
      api("/requests/id-mine", { token }),
      api("/complaints/mine", { token }),
      api("/borrowing/mine", { token }),
      api("/voting/current", { token }),
      api("/voting/my-status", { token }),
    ]);

    const failed = calls.filter((result) => result.status === "rejected");
    if (failed.length === calls.length) {
      setError(failed[0]?.reason?.message || "Unable to load your resident dashboard.");
    }

    const value = (index, fallback = {}) => calls[index].status === "fulfilled" ? calls[index].value : fallback;
    setData({
      requests: value(0).requests || [],
      idRequests: value(1).requests || [],
      complaints: value(2).complaints || [],
      borrowing: value(3).requests || [],
      election: value(4).election || null,
      hasVoted: Boolean(value(5).hasVoted),
    });
    setLoading(false);
  };

  useEffect(() => { load(); }, [token]);

  const activeRequests = data.requests.filter((item) => item.status !== "completed");
  const activeIds = data.idRequests.filter((item) => !["completed", "cancelled"].includes(item.status));
  const activeConcerns = data.complaints.filter((item) => item.status !== "resolved");
  const activeBorrowing = data.borrowing.filter((item) => !["returned", "rejected", "cancelled"].includes(item.status));
  const overdue = activeBorrowing.filter((item) => item.isLate || (item.status === "borrowed" && item.due_at && new Date(item.due_at).getTime() < Date.now()));
  const unread = (notifications || []).filter((item) => !item.is_read);

  const attentionItems = useMemo(() => {
    const items = [];
    overdue.slice(0, 2).forEach((item) => items.push({ tone: "danger", title: `${item.asset?.name || "Borrowed resource"} is overdue`, body: item.due_at ? `Return deadline: ${formatDateTime(item.due_at)}` : "Please contact the barangay office as soon as possible.", to: "/portal/borrowing", cta: "View Borrowing" }));
    activeIds.filter((item) => ["confirmed", "rescheduled"].includes(item.status)).slice(0, 2).forEach((item) => items.push({ tone: "info", title: `Barangay ID schedule ${item.status}`, body: `${item.preferred_date || "Date pending"}${item.time_slot ? ` · ${item.time_slot}` : ""}`, to: "/portal/requests", cta: "View Appointment" }));
    if (data.election?.status === "live" && !data.hasVoted) items.push({ tone: "success", title: "Community project voting is open", body: `Review the current project choices and submit your final vote before ${formatDateTime(data.election.endsAt)}.`, to: "/portal/voting", cta: "Vote Now" });
    return items;
  }, [data, overdue, activeIds]);

  const activeTransactions = [
    ...activeRequests.map((item) => ({ id: `request-${item.id}`, title: item.request_type, detail: item.details, status: item.status, feature: "request", to: "/portal/requests", createdAt: item.created_at })),
    ...activeIds.map((item) => ({ id: `id-${item.id}`, title: "Barangay ID", detail: item.purpose, status: item.status, feature: "id_request", to: "/portal/requests", createdAt: item.created_at })),
    ...activeConcerns.map((item) => ({ id: `concern-${item.id}`, title: item.complaint_type, detail: item.details, status: item.status, feature: "complaint", to: "/portal/complaints", createdAt: item.created_at })),
    ...activeBorrowing.map((item) => ({ id: `borrow-${item.id}`, title: item.asset?.name || "Borrowing request", detail: item.purpose, status: item.isLate ? "overdue" : item.status, feature: "borrowing", to: "/portal/borrowing", createdAt: item.created_at })),
  ].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 6);

  if (loading) {
    return <div className="space-y-8"><PageHeader eyebrow="Resident Overview" title={`Welcome back, ${user?.firstName || "Resident"}`} description="Loading your requests, schedules and barangay updates." /><LoadingState rows={4} /></div>;
  }

  if (error) return <ErrorState title="We couldn't load your dashboard." description={error} onRetry={load} />;

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Resident Overview" title={`Welcome back, ${user?.firstName || "Resident"}`} description="See what needs your attention, start a barangay service, and continue active transactions from one place." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <NavLink to="/portal/requests"><Card className="h-full hover:border-[var(--brand-200)] hover:shadow-md"><div className="flex items-center gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><ClipboardList className="h-5 w-5" /></div><div><p className="text-sm text-stone-500">Open Requests</p><p className="text-2xl font-black text-[var(--brand-900)]">{activeRequests.length + activeIds.length}</p></div></div></Card></NavLink>
        <NavLink to="/portal/complaints"><Card className="h-full hover:border-[var(--brand-200)] hover:shadow-md"><div className="flex items-center gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><CircleAlert className="h-5 w-5" /></div><div><p className="text-sm text-stone-500">Open Concerns</p><p className="text-2xl font-black text-[var(--brand-900)]">{activeConcerns.length}</p></div></div></Card></NavLink>
        <NavLink to="/portal/borrowing"><Card className="h-full hover:border-[var(--brand-200)] hover:shadow-md"><div className="flex items-center gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><PackageCheck className="h-5 w-5" /></div><div><p className="text-sm text-stone-500">Active Borrowing</p><p className="text-2xl font-black text-[var(--brand-900)]">{activeBorrowing.length}</p></div></div></Card></NavLink>
        <Card><div className="flex items-center gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><BellRing className="h-5 w-5" /></div><div><p className="text-sm text-stone-500">Unread Updates</p><p className="text-2xl font-black text-[var(--brand-900)]">{unread.length}</p></div></div></Card>
      </div>

      <Card className="bg-gradient-to-br from-white to-[var(--brand-50)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand-500)]">Quick Actions</p><h2 className="mt-2 text-2xl font-black text-[var(--brand-900)]">What would you like to do?</h2></div><p className="max-w-xl text-sm leading-6 text-stone-500">Start the most common resident services without searching through the portal.</p></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <NavLink to="/portal/requests" className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-white p-4 font-semibold text-[var(--brand-900)] transition hover:-translate-y-0.5 hover:border-[var(--brand-200)] hover:shadow-sm"><Plus className="h-5 w-5 text-[var(--brand-600)]" /> Request Document</NavLink>
          <NavLink to="/portal/complaints" className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-white p-4 font-semibold text-[var(--brand-900)] transition hover:-translate-y-0.5 hover:border-[var(--brand-200)] hover:shadow-sm"><CircleAlert className="h-5 w-5 text-[var(--brand-600)]" /> Report Concern</NavLink>
          <NavLink to="/portal/borrowing" className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-white p-4 font-semibold text-[var(--brand-900)] transition hover:-translate-y-0.5 hover:border-[var(--brand-200)] hover:shadow-sm"><PackageCheck className="h-5 w-5 text-[var(--brand-600)]" /> Borrow Resource</NavLink>
          <NavLink to="/portal/voting" className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-white p-4 font-semibold text-[var(--brand-900)] transition hover:-translate-y-0.5 hover:border-[var(--brand-200)] hover:shadow-sm"><Vote className="h-5 w-5 text-[var(--brand-600)]" /> Community Voting</NavLink>
        </div>
      </Card>

      <section className="space-y-4">
        <div><p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand-500)]">Needs Your Attention</p><h2 className="mt-1 text-2xl font-black text-[var(--brand-900)]">Important next steps</h2></div>
        {!attentionItems.length ? <Alert tone="success" title="You're all caught up">There are no urgent resident tasks waiting for you right now.</Alert> : attentionItems.map((item, index) => <Alert key={`${item.title}-${index}`} tone={item.tone} title={item.title} actions={<NavLink to={item.to}><Button variant="secondary">{item.cta}</Button></NavLink>}><p>{item.body}</p></Alert>)}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Active transactions</h2><p className="mt-1 text-sm text-stone-500">Only unfinished requests and services are shown here.</p></div></div>
          <div className="mt-5 space-y-3">
            {!activeTransactions.length ? <EmptyState title="No active transactions" description="Start a request, report a concern or borrow a barangay resource when you need a service." /> : activeTransactions.map((item) => <NavLink key={item.id} to={item.to} className="flex flex-col gap-3 rounded-2xl border border-stone-200 p-4 transition hover:border-[var(--brand-200)] hover:bg-[var(--brand-50)] sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="font-semibold text-[var(--brand-900)]">{item.title}</p><p className="mt-1 line-clamp-1 text-sm text-stone-500">{item.detail}</p></div><Status status={item.status} feature={item.feature} /></NavLink>)}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><CalendarClock className="h-5 w-5" /></div><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Latest notifications</h2><p className="mt-1 text-sm text-stone-500">Your newest barangay updates.</p></div></div>
          <div className="mt-5 space-y-3">
            {!(notifications || []).length ? <EmptyState title="No notifications yet" description="Updates will appear here when barangay staff changes a request, concern, borrowing record or voting activity." /> : (notifications || []).slice(0, 4).map((note) => <NavLink key={note.id} to={destinationForNotification(note)} className={`block rounded-2xl border p-4 transition hover:border-[var(--brand-200)] ${note.is_read ? "border-stone-200 bg-white" : "border-[var(--brand-100)] bg-[var(--brand-50)]"}`}><div className="flex items-start justify-between gap-3"><p className="font-semibold text-[var(--brand-900)]">{note.title}</p>{!note.is_read ? <Badge tone="info">New</Badge> : null}</div><p className="mt-2 line-clamp-2 text-sm leading-6 text-stone-600">{note.body}</p><p className="mt-2 text-xs text-stone-400">{formatDateTime(note.created_at)}</p></NavLink>)}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default UserDashboard;
