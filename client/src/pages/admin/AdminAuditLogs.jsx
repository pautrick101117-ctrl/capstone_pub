import { Download, ExternalLink, FileDiff, History, Search, ShieldAlert, Eye } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { api, API_URL } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, Modal, PageHeader, Pagination, SelectInput, TextInput } from "../../components/ui";

const PER_PAGE = 25;
const categories = [{ value: "change", label: "Changes", icon: FileDiff }, { value: "activity", label: "Activity", icon: Eye }, { value: "security", label: "Security", icon: ShieldAlert }, { value: "legacy", label: "Legacy", icon: History }];
const modules = ["users","requests","request_timeline","id_requests","complaints","borrowable_assets","borrowing_requests","project_suggestions","elections","election_options","votes","community_projects","project_updates","officials","announcements","events","fund_sources","fund_projects","census_households","master_data_values","landing_content","admin","admin_portal","super_admin","auth"];
const titleCase = (v = "") => `${v || ""}`.replace(/[._]/g, " ").replace(/\b\w/g, (x) => x.toUpperCase());
const eventTime = (value) => value ? new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
const stringify = (v) => v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v, null, 2) : String(v);
const outcomeTone = (v) => ["failed", "denied"].includes(v) ? "danger" : v === "success" ? "success" : "neutral";
const labelAction = (entry) => {
  if (entry.action === "user.deactivated") return "Resident/staff account deactivated";
  if (entry.action === "user.activated") return "Resident/staff account reactivated";
  if (entry.action?.endsWith(".status_changed")) return `${titleCase(entry.entity_type)} status changed`;
  if (entry.action?.endsWith(".INSERT")) return `${titleCase(entry.entity_type)} created`;
  if (entry.action?.endsWith(".UPDATE")) return `${titleCase(entry.entity_type)} updated`;
  if (entry.action?.endsWith(".DELETE")) return `${titleCase(entry.entity_type)} deleted`;
  return titleCase(entry.action);
};

// Only offer a deep link where the destination has been taught to open exact IDs.
const recordLink = (entry) => {
  const id = entry.entity_id;
  if (!id || id === "system" || id === "unknown") return null;
  const base = ({ users: "/admin/residents", community_projects: "/admin/projects", complaints: "/admin/complaints" })[entry.entity_type];
  return base ? `${base}?recordId=${encodeURIComponent(id)}` : null;
};

const dataRows = (entry) => {
  const explicit = entry.changed_fields && typeof entry.changed_fields === "object" ? entry.changed_fields : null;
  if (explicit) return Object.entries(explicit).map(([field, value]) => ({
    field, before: value && typeof value === "object" && "before" in value ? value.before : entry.before_data?.[field],
    after: value && typeof value === "object" && "after" in value ? value.after : entry.after_data?.[field],
  }));
  const before = entry.before_data || {}, after = entry.after_data || {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((field) => ({ field, before: before[field], after: after[field] }));
};

const AdminAuditLogs = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [category, setCategory] = useState("change");
  const [filters, setFilters] = useState({ module: "all", outcome: "all", from: "", to: "", actor: "", action: "", search: "" });
  const [pendingSearch, setPendingSearch] = useState("");
  const [page, setPage] = useState(1);
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const params = useMemo(() => {
    const p = new URLSearchParams({ category, page: String(page), limit: String(PER_PAGE) });
    for (const [key, val] of Object.entries(filters)) if (val && val !== "all") p.set(key, val);
    return p;
  }, [category, page, filters]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError("");
    try {
      const data = await api(`/admin/audit-logs?${params.toString()}`, { token });
      setLogs(data.logs || []);
      setPagination(data.pagination || { total: 0, totalPages: 1 });
    } catch (err) { setError(err.message || "Could not load audit events."); }
    finally { setLoading(false); }
  }, [params, token]);
  useEffect(() => { load(); }, [load]);
  const changeFilter = (key, value) => { setFilters((old) => ({ ...old, [key]: value })); setPage(1); };
  const startSearch = (event) => { event.preventDefault(); changeFilter("search", pendingSearch.trim()); };
  const exportWorkbook = async () => {
    if (!filters.from || !filters.to) return toast.error("Select From and To dates before exporting the report.");
    setExporting(true);
    try {
      const downloadParams = new URLSearchParams(params);
      downloadParams.delete("page"); downloadParams.delete("limit");
      const result = await fetch(`${API_URL}/admin/audit-logs/export?${downloadParams}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      if (!result.ok) {
        const payload = await result.json().catch(() => ({}));
        throw new Error(payload.message || `Export failed (${result.status}).`);
      }
      const url = URL.createObjectURL(await result.blob());
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `barangayiba-audit-${filters.from}-to-${filters.to}.xlsx`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Audit report downloaded. Export activity has been logged.");
      load();
    } catch (err) { toast.error(err.message); }
    finally { setExporting(false); }
  };
  const differences = selected ? dataRows(selected) : [];
  return <div className="space-y-7">
    <PageHeader eyebrow="System Accountability" title="Audit & Activity Logs" description="Trace changes to barangay records with actor identity, before-and-after values and the outcome of each action." actions={<Button type="button" variant="secondary" onClick={exportWorkbook} loading={exporting}><Download className="h-4 w-4" /> Export Excel</Button>} />
    <div className="grid gap-3 sm:grid-cols-4" role="tablist" aria-label="Audit event category">
      {categories.map((tab) => { const Icon = tab.icon; return <button key={tab.value} type="button" role="tab" aria-selected={category === tab.value} onClick={() => { setCategory(tab.value); setPage(1); }} className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${category === tab.value ? "border-[var(--brand-500)] bg-[var(--brand-50)] text-[var(--brand-800)]" : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"}`}><Icon className="h-4 w-4" />{tab.label}</button>; })}
    </div>
    <Card className="space-y-4">
      <form onSubmit={startSearch} className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end"><TextInput label="Search event / actor / record" placeholder="Deactivate, resident name, record ID..." value={pendingSearch} onChange={(e) => setPendingSearch(e.target.value)} /><Button type="submit"><Search className="h-4 w-4" /> Search</Button></form>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SelectInput label="Module" value={filters.module} onChange={(e) => changeFilter("module", e.target.value)}><option value="all">All modules</option>{modules.map((m) => <option value={m} key={m}>{titleCase(m)}</option>)}</SelectInput>
        <SelectInput label="Outcome" value={filters.outcome} onChange={(e) => changeFilter("outcome", e.target.value)}><option value="all">All outcomes</option><option value="success">Success</option><option value="failed">Failed</option><option value="denied">Denied</option><option value="partial">Partial</option></SelectInput>
        <TextInput type="date" label="From (PH date)" value={filters.from} onChange={(e) => changeFilter("from", e.target.value)} />
        <TextInput type="date" label="To (PH date)" value={filters.to} min={filters.from || undefined} onChange={(e) => changeFilter("to", e.target.value)} />
      </div>
      <p className="text-xs text-stone-500">Dates use Philippine time (UTC+8). Excel export includes Event Summary and Field Changes sheets. A date range is required for export.</p>
    </Card>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold text-stone-500">{pagination.total.toLocaleString()} matching events · {category === "change" ? "Changes are recorded transactionally" : titleCase(category) + " history"}</p><p className="text-xs text-stone-500">Newest first · {PER_PAGE} per page</p></div>
    {loading ? <LoadingState compact rows={6} /> : error ? <ErrorState description={error} onRetry={load} /> : !logs.length ? <EmptyState title="No matching audit records" description="Try another date range, category or search term." /> : <div className="space-y-3">
      {logs.map((item) => <button key={item.id} type="button" onClick={() => setSelected(item)} className="block w-full text-left"><Card className="p-4 transition hover:border-[var(--brand-200)] hover:shadow-md"><div className="grid gap-3 lg:grid-cols-[170px_1fr_230px] lg:items-center"><div className="space-y-1"><p className="text-xs text-stone-500">{eventTime(item.created_at)}</p><p className="text-sm font-semibold text-stone-700">{item.actor_name || item.actor_role || "System / Database"}</p></div><div><div className="flex flex-wrap gap-2"><Badge tone="info">{titleCase(item.module || item.entity_type)}</Badge><Badge tone={outcomeTone(item.outcome)}>{titleCase(item.outcome || "success")}</Badge></div><p className="mt-2 font-bold text-[var(--brand-900)]">{labelAction(item)}</p><p className="mt-1 text-xs text-stone-500">{item.target_label || titleCase(item.entity_type)} · {item.entity_id}</p></div><span className="text-xs text-stone-500 lg:text-right">{Object.keys(item.changed_fields || {}).length || 0} field(s) tracked · View Details</span></div></Card></button>)}
    </div>}
    {!loading && !error && pagination.totalPages > 1 ? <Pagination page={page} totalPages={pagination.totalPages} onPageChange={setPage} /> : null}
    <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected ? labelAction(selected) : "Audit Event"} description={selected ? `${eventTime(selected.created_at)} · Event ${selected.id}` : ""} widthClass="max-w-5xl">
      {selected ? <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[["Performed by", selected.actor_name || selected.actor_role || "System / Database"],["Role", titleCase(selected.actor_role)],["Module", titleCase(selected.module)],["Target", `${selected.target_label || titleCase(selected.entity_type)} (${selected.entity_id})`],["Outcome", titleCase(selected.outcome || "success")],["Source", titleCase(selected.event_source || "legacy")]].map(([label,value]) => <div key={label} className="rounded-2xl bg-stone-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-stone-400">{label}</p><p className="mt-2 break-words text-sm font-semibold text-stone-700">{value || "—"}</p></div>)}</div>
        {recordLink(selected) && selected.action?.endsWith(".DELETE") !== true ? <NavLink to={recordLink(selected)} className="inline-flex items-center gap-2 rounded-full bg-[var(--brand-500)] px-4 py-2 text-sm font-bold text-white"><ExternalLink className="h-4 w-4" /> Open affected record</NavLink> : <p className="text-sm text-stone-500">{selected.action?.endsWith(".DELETE") ? "The record was deleted; its historical values remain below." : "No direct record view is available for this event. Its audit details remain available here."}</p>}
        <div><h3 className="mb-3 font-bold text-[var(--brand-900)]">Changes to fields</h3>{differences.length ? <div className="overflow-auto rounded-2xl border border-stone-200"><table className="min-w-full divide-y divide-stone-200 text-sm"><thead className="bg-stone-50"><tr>{["Field","Before","After"].map((t) => <th key={t} className="px-4 py-3 text-left font-semibold text-stone-600">{t}</th>)}</tr></thead><tbody className="divide-y divide-stone-100">{differences.map((diff) => <tr key={diff.field}><td className="px-4 py-3 font-semibold text-stone-800">{titleCase(diff.field)}</td><td className="max-w-sm whitespace-pre-wrap break-words px-4 py-3 text-stone-500">{stringify(diff.before)}</td><td className="max-w-sm whitespace-pre-wrap break-words px-4 py-3 text-stone-900">{stringify(diff.after)}</td></tr>)}</tbody></table></div> : <p className="rounded-2xl bg-stone-50 p-4 text-sm text-stone-500">No field differences were captured for this event. Activity entries may not modify data.</p>}</div>
        {selected.details && Object.keys(selected.details).length ? <section className="space-y-2"><h3 className="font-bold text-[var(--brand-900)]">Action details / response</h3><pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-stone-50 p-4 text-xs text-stone-700">{JSON.stringify(selected.details, null, 2)}</pre></section> : null}
        <details className="rounded-2xl border border-stone-200 p-4"><summary className="cursor-pointer text-sm font-semibold text-stone-700">Technical metadata</summary><div className="mt-3 space-y-1 text-xs text-stone-600">{[["IP address",selected.ip_address],["HTTP method",selected.http_method],["Route",selected.route],["Correlation ID",selected.correlation_id],["User agent",selected.user_agent]].map(([label,value]) => <p key={label} className="break-all"><strong>{label}:</strong> {value || "—"}</p>)}</div></details>
      </div> : null}
    </Modal>
  </div>;
};
export default AdminAuditLogs;
