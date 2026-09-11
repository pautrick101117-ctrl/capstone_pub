import { Activity, BellRing, CalendarCheck, CircleAlert, ClipboardList, Landmark, PackageCheck, Users, Vote } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, Pagination, StatCard } from "../../components/ui";
import { formatDate, formatDateTime } from "../../lib/format";

const doughnutColors = ["#2d7a3a", "#a3c76d", "#f59e0b"];
const activityPageSize = 5;
const titleCase = (value = "") => `${value}`.replace(/_/g, " ").trim().replace(/\b\w/g, (letter) => letter.toUpperCase());
const describeEntity = (item) => item.details?.title || item.details?.username || item.details?.name || item.details?.status || item.entity_id || "Record";
const describeActor = (item) => item.actor_name || titleCase(item.actor_role || "system");
const formatActivityMessage = (item) => {
  const action = `${item.action || ""}`.toLowerCase();
  if (action.includes("resident")) return `Resident account activity · ${describeEntity(item)}`;
  if (action.includes("announcement")) return `Content updated · ${describeEntity(item)}`;
  if (action.includes("election")) return `Election updated · ${describeEntity(item)}`;
  if (action.includes("borrowing")) return `Borrowing updated · ${describeEntity(item)}`;
  if (action.includes("request")) return `Request updated · ${describeEntity(item)}`;
  if (action.includes("official")) return `Official profile updated · ${describeEntity(item)}`;
  return `${titleCase(item.action || "Activity")} · ${describeEntity(item)}`;
};

const AdminDashboard = () => {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState({ stats: {}, charts: {}, recentActivity: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activityPage, setActivityPage] = useState(1);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api("/admin/dashboard", { token });
      setDashboard(data || { stats: {}, charts: {}, recentActivity: [] });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (token) load(); }, [token]);

  const requestsByType = dashboard?.charts?.requestsByType || [];
  const residentStatusBreakdown = dashboard?.charts?.residentStatusBreakdown || [];
  const votingParticipation = dashboard?.charts?.votingParticipation || [];
  const recentActivity = useMemo(() => dashboard?.recentActivity || [], [dashboard]);
  const paginatedActivity = useMemo(() => recentActivity.slice((activityPage - 1) * activityPageSize, activityPage * activityPageSize), [recentActivity, activityPage]);
  const requestKeys = useMemo(() => Object.keys(requestsByType[0] || {}).filter((key) => key !== "date"), [requestsByType]);

  if (loading) return <div className="space-y-8"><PageHeader eyebrow="Admin Dashboard" title="Barangay operations" description="Loading service queues, resident activity and operational metrics." /><LoadingState rows={5} /></div>;
  if (error) return <ErrorState title="We couldn't load the admin dashboard." description={error} onRetry={load} />;

  const queueCards = [
    { icon: ClipboardList, label: "Requests Waiting", value: dashboard.stats?.pendingRequests ?? 0, hint: "Document requests not yet completed", to: "/admin/requests" },
    { icon: CircleAlert, label: "Pending Concerns", value: dashboard.stats?.pendingConcerns ?? 0, hint: "Community concerns awaiting review", to: "/admin/complaints" },
    { icon: PackageCheck, label: "Borrowing Requests", value: dashboard.stats?.pendingBorrowing ?? 0, hint: "Requests waiting for approval", to: "/admin/borrowing" },
    { icon: PackageCheck, label: "Overdue Resources", value: dashboard.stats?.overdueBorrowing ?? 0, hint: "Released resources past due", to: "/admin/borrowing" },
    { icon: CalendarCheck, label: "ID Pickups Today", value: dashboard.stats?.idPickupsToday ?? 0, hint: "Confirmed or rescheduled pickups", to: "/admin/requests" },
  ];

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Admin Dashboard" title="Barangay operations" description="Start with work that needs attention, then review service trends, resident participation and recent administrative activity." />

      <section className="space-y-4">
        <div><p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand-500)]">Needs Attention</p><h2 className="mt-1 text-2xl font-black text-[var(--brand-900)]">Operational queues</h2></div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {queueCards.map((item) => <StatCard key={item.label} icon={item.icon} label={item.label} value={item.value} hint={item.hint} onClick={() => navigate(item.to)} />)}
        </div>
      </section>

      <section className="space-y-4">
        <div><p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand-500)]">System Snapshot</p><h2 className="mt-1 text-2xl font-black text-[var(--brand-900)]">Community records</h2></div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Users} label="Total Residents" value={dashboard.stats?.totalResidents ?? 0} onClick={() => navigate("/admin/residents")} />
          <StatCard icon={Landmark} label="Active Officials" value={dashboard.stats?.activeOfficials ?? 0} onClick={() => navigate("/admin/officials")} />
          <StatCard icon={Vote} label="Open Elections" value={dashboard.stats?.openElections ?? 0} onClick={() => navigate("/admin/voting")} />
          <StatCard icon={BellRing} label="Recent Audit Events" value={recentActivity.length} hint="Latest meaningful admin actions" />
        </div>
      </section>

      <div className="grid gap-6 2xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <div className="flex items-center gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><ClipboardList className="h-5 w-5" /></div><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Requests by type over time</h2><p className="mt-1 text-sm text-stone-500">See which resident services are driving workload.</p></div></div>
          {requestsByType.length && requestKeys.length ? <div className="mt-6 h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={requestsByType}><CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" /><XAxis dataKey="date" tickFormatter={(value) => formatDate(value, { month: "short", day: "numeric" })} tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} /><Tooltip /><Legend />{requestKeys.map((key, index) => <Bar key={key} dataKey={key} fill={["#2d7a3a", "#6e9b51", "#f59e0b", "#3b82f6", "#a855f7"][index % 5]} radius={[10, 10, 0, 0]} />)}</BarChart></ResponsiveContainer></div> : <div className="mt-6"><EmptyState title="No request trend data yet" description="Charts will appear after residents begin submitting document requests." /></div>}
        </Card>

        <Card>
          <div className="flex items-center gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><Users className="h-5 w-5" /></div><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Resident account status</h2><p className="mt-1 text-sm text-stone-500">Active, inactive and pending resident records.</p></div></div>
          {residentStatusBreakdown.some((item) => item.value > 0) ? <div className="mt-6 h-80"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={residentStatusBreakdown} dataKey="value" nameKey="name" innerRadius={72} outerRadius={110} paddingAngle={3}>{residentStatusBreakdown.map((item, index) => <Cell key={item.name} fill={doughnutColors[index % doughnutColors.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div> : <div className="mt-6"><EmptyState title="No resident records yet" description="Resident account status will appear here after accounts are created." /></div>}
        </Card>
      </div>

      <div className="grid gap-6 2xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <div className="flex items-center gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><Vote className="h-5 w-5" /></div><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Voting participation</h2><p className="mt-1 text-sm text-stone-500">Resident turnout across published elections.</p></div></div>
          {votingParticipation.length ? <div className="mt-6 h-80"><ResponsiveContainer width="100%" height="100%"><LineChart data={votingParticipation}><CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" /><XAxis dataKey="election" tick={{ fontSize: 12 }} /><YAxis unit="%" /><Tooltip /><Line type="monotone" dataKey="participationRate" stroke="#2d7a3a" strokeWidth={3} dot={{ r: 4 }} /></LineChart></ResponsiveContainer></div> : <div className="mt-6"><EmptyState title="No voting participation yet" description="Participation data will appear after a community election receives votes." /></div>}
        </Card>

        <Card>
          <div className="flex items-center gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><Activity className="h-5 w-5" /></div><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Recent activity</h2><p className="mt-1 text-sm text-stone-500">Meaningful administrative changes, excluding routine login noise.</p></div></div>
          {!recentActivity.length ? <div className="mt-6"><EmptyState title="No recent activity yet" description="Administrative actions will appear here as work moves through the portal." /></div> : <div className="mt-6 space-y-3">{paginatedActivity.map((item) => <div key={item.id} className="rounded-2xl border border-stone-200 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><Badge tone="info">{titleCase(item.entity_type || "activity")}</Badge><span className="text-xs text-stone-400">{formatDateTime(item.created_at)}</span></div><h3 className="mt-2 font-bold text-[var(--brand-900)]">{formatActivityMessage(item)}</h3><p className="mt-1 text-sm text-stone-500">{describeActor(item)}</p></div></div></div>)}</div>}
          <Pagination page={activityPage} totalPages={Math.max(1, Math.ceil(recentActivity.length / activityPageSize))} onPageChange={setActivityPage} />
        </Card>
      </div>
    </div>
  );
};

export default AdminDashboard;
