import {
  Activity,
  BellRing,
  ClipboardList,
  Landmark,
  Users,
  Vote,
  CircleAlert,
  Lightbulb,
  IdCard,
  ArrowRight,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { Card, EmptyState, PageHeader, Pagination, StatCard, TableShell } from "../../components/ui";
import { formatDate, formatDateTime } from "../../lib/format";

const doughnutColors = ["#2d7a3a", "#a3c76d", "#f59e0b"];
const activityPageSize = 4;

const titleCase = (value = "") =>
  `${value}`
    .replace(/_/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const describeEntity = (item) =>
  item.details?.title ||
  item.details?.username ||
  item.details?.name ||
  item.details?.status ||
  item.entity_id ||
  "Record";

const describeActor = (item) => item.actor_name || titleCase(item.actor_role || "system");

const formatActivityMessage = (item) => {
  const action = `${item.action || ""}`.toLowerCase();

  if (action.includes("resident")) return `Created resident account ${describeEntity(item)}`;
  if (action.includes("announcement")) return `Published announcement ${describeEntity(item)}`;
  if (action.includes("election")) return `Updated election ${describeEntity(item)}`;
  if (action.includes("request")) return `Updated request ${describeEntity(item)}`;
  if (action.includes("official")) return `Updated official profile ${describeEntity(item)}`;
  if (action === "login") return "User login";

  return `${titleCase(item.action || "Activity")} - ${describeEntity(item)}`;
};

const AdminDashboard = () => {
  const { token } = useAuth();
  const emptyDashboard = {
    stats: { totalResidents: 0, pendingRequests: 0, activeOfficials: 0, openElections: 0 },
    actionCenter: { pendingRequests: 0, needsInformation: 0, readyForRelease: 0, complaints: 0, urgentComplaints: 0, pendingSuggestions: 0, pickupsToday: 0, nextElection: null },
    charts: { requestsByType: [], residentStatusBreakdown: [], votingParticipation: [] },
    recentActivity: [],
  };

  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [activityPage, setActivityPage] = useState(1);

  useEffect(() => {
    if (!token) return;

    api("/admin/dashboard", { token })
      .then((data) => setDashboard({ ...emptyDashboard, ...(data || {}), stats: { ...emptyDashboard.stats, ...(data?.stats || {}) }, actionCenter: { ...emptyDashboard.actionCenter, ...(data?.actionCenter || {}) }, charts: { ...emptyDashboard.charts, ...(data?.charts || {}) } }))
      .catch(() => setDashboard(emptyDashboard));
  }, [token]);

  const requestsByType = dashboard?.charts?.requestsByType?.length
    ? dashboard.charts.requestsByType
    : emptyDashboard.charts.requestsByType;

  const residentStatusBreakdown = dashboard?.charts?.residentStatusBreakdown?.length
    ? dashboard.charts.residentStatusBreakdown
    : emptyDashboard.charts.residentStatusBreakdown;

  const votingParticipation = dashboard?.charts?.votingParticipation?.length
    ? dashboard.charts.votingParticipation
    : emptyDashboard.charts.votingParticipation;

  const recentActivity = useMemo(() => {
    const items = dashboard?.recentActivity || [];
    const filtered = items.filter((item) => item.action !== "login");
    return filtered.length ? filtered : items;
  }, [dashboard]);

  const activityTotalPages = Math.max(1, Math.ceil(recentActivity.length / activityPageSize));
  const paginatedActivity = useMemo(
    () => recentActivity.slice((activityPage - 1) * activityPageSize, activityPage * activityPageSize),
    [recentActivity, activityPage]
  );

  useEffect(() => {
    if (activityPage > activityTotalPages) setActivityPage(activityTotalPages);
  }, [activityPage, activityTotalPages]);

  const requestKeys = useMemo(() => {
    const firstRow = requestsByType[0] || {};
    return Object.keys(firstRow).filter((key) => key !== "date");
  }, [requestsByType]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin Dashboard"
        title="Overview of barangay operations"
        description="Track residents, requests, officials, elections, and the latest activity from one wider command view."
      />

      <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-4">
        <StatCard icon={Users} label="Total Residents" value={dashboard.stats?.totalResidents ?? 0} />
        <StatCard icon={ClipboardList} label="Pending Requests" value={dashboard.stats?.pendingRequests ?? 0} />
        <StatCard icon={Landmark} label="Active Officials" value={dashboard.stats?.activeOfficials ?? 0} />
        <StatCard icon={Vote} label="Open Elections" value={dashboard.stats?.openElections ?? 0} />
      </div>

      <Card>
        <div className="mb-5 flex items-center gap-3">
          <div className="rounded-2xl bg-amber-100 p-3 text-amber-700"><CircleAlert className="h-5 w-5" /></div>
          <div>
            <h2 className="text-xl font-bold text-[var(--brand-900)]">Action Center</h2>
            <p className="mt-1 text-sm text-stone-500">Work that needs staff attention now, with direct links to the right filtered module.</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            { to: "/admin/requests", icon: ClipboardList, label: "Requests to process", value: dashboard.actionCenter?.pendingRequests || 0, note: `${dashboard.actionCenter?.readyForRelease || 0} ready for release` },
            { to: "/admin/complaints", icon: CircleAlert, label: "Open complaints", value: dashboard.actionCenter?.complaints || 0, note: dashboard.actionCenter?.urgentComplaints ? `${dashboard.actionCenter.urgentComplaints} urgent` : "No urgent complaints" },
            { to: "/admin/voting", icon: Lightbulb, label: "Suggestions to review", value: dashboard.actionCenter?.pendingSuggestions || 0, note: dashboard.actionCenter?.nextElection ? `${dashboard.actionCenter.nextElection.status}: ${dashboard.actionCenter.nextElection.title}` : "No upcoming voting" },
            { to: "/admin/requests", icon: IdCard, label: "ID pickups today", value: dashboard.actionCenter?.pickupsToday || 0, note: `${dashboard.actionCenter?.needsInformation || 0} requests need resident info` },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.label} to={item.to} className="group rounded-3xl border border-stone-200 bg-stone-50 p-4 transition hover:border-[var(--brand-200)] hover:bg-[var(--brand-50)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="rounded-2xl bg-white p-2.5 text-[var(--brand-600)] shadow-sm"><Icon className="h-5 w-5" /></div>
                  <ArrowRight className="h-4 w-4 text-stone-400 transition group-hover:translate-x-1 group-hover:text-[var(--brand-600)]" />
                </div>
                <p className="mt-4 text-3xl font-black text-[var(--brand-900)]">{item.value}</p>
                <p className="mt-1 text-sm font-semibold text-stone-700">{item.label}</p>
                <p className="mt-2 text-xs text-stone-500">{item.note}</p>
              </NavLink>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-6 2xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--brand-900)]">Requests by type over time</h2>
              <p className="mt-1 text-sm text-stone-500">Monitor which resident services are driving the current workload.</p>
            </div>
          </div>
          <div className="mt-6 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={requestsByType}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis dataKey="date" tickFormatter={(value) => formatDate(value, { month: "short", day: "numeric" })} tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                {requestKeys.map((key, index) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    fill={["#2d7a3a", "#6e9b51", "#f59e0b", "#3b82f6", "#a855f7"][index % 5]}
                    radius={[10, 10, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--brand-900)]">Resident status breakdown</h2>
              <p className="mt-1 text-sm text-stone-500">A quick picture of active, inactive, and pending resident records.</p>
            </div>
          </div>
          <div className="mt-6 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={residentStatusBreakdown}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={72}
                  outerRadius={110}
                  paddingAngle={3}
                >
                  {residentStatusBreakdown.map((item, index) => (
                    <Cell key={item.name} fill={doughnutColors[index % doughnutColors.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 2xl:grid-cols-[0.92fr_1.08fr]">
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]">
              <BellRing className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--brand-900)]">Voting participation per election</h2>
              <p className="mt-1 text-sm text-stone-500">See how resident turnout is changing across elections.</p>
            </div>
          </div>
          <div className="mt-6 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={votingParticipation}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis dataKey="election" tick={{ fontSize: 12 }} />
                <YAxis unit="%" />
                <Tooltip />
                <Line type="monotone" dataKey="participationRate" stroke="#2d7a3a" strokeWidth={3} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--brand-900)]">Recent activity</h2>
              <p className="mt-1 text-sm text-stone-500">Meaningful changes are surfaced here first instead of low-signal login noise.</p>
            </div>
          </div>

          {!recentActivity.length ? (
            <div className="mt-6">
              <EmptyState title="No recent activity yet" description="Admin actions will appear here as work starts moving through the portal." />
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {paginatedActivity.map((item) => (
                <div key={item.id} className="rounded-3xl border border-stone-200 p-5 transition hover:border-[var(--brand-200)] hover:shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--brand-500)]">
                        {titleCase(item.entity_type || "activity")}
                      </p>
                      <h3 className="mt-2 text-lg font-bold text-[var(--brand-900)]">{formatActivityMessage(item)}</h3>
                      <p className="mt-2 text-sm text-stone-500">
                        {describeActor(item)} - {formatDateTime(item.created_at)}
                      </p>
                    </div>
                    <div className="rounded-full bg-[var(--brand-50)] px-4 py-2 text-xs font-semibold text-[var(--brand-700)]">
                      {titleCase(item.action || "activity")}
                    </div>
                  </div>

                  {item.details && Object.keys(item.details).length ? (
                    <div className="mt-4">
                      <TableShell>
                        <table className="min-w-full text-sm">
                          <tbody>
                            {Object.entries(item.details)
                              .slice(0, 3)
                              .map(([key, value]) => (
                                <tr key={key} className="border-t border-stone-100">
                                  <td className="px-4 py-3 font-semibold text-stone-500">{titleCase(key)}</td>
                                  <td className="px-4 py-3 text-[var(--brand-900)]">{`${value ?? "-"}`}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </TableShell>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          <Pagination
            page={activityPage}
            totalPages={activityTotalPages}
            onPageChange={setActivityPage}
          />
        </Card>
      </div>
    </div>
  );
};

export default AdminDashboard;
