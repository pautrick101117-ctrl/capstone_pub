import { History, Search, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { Badge, Card, EmptyState, ErrorState, LoadingState, Modal, PageHeader, Pagination, SelectInput, TextInput } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

const titleCase = (value = "") => `${value || ""}`.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const pageSize = 25;

const AdminAuditLogs = () => {
  const { token } = useAuth();
  const [logs, setLogs] = useState([]);
  const [modules, setModules] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ module: "all", outcome: "all", search: "" });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(pageSize), module: filters.module, outcome: filters.outcome });
      if (filters.search) params.set("search", filters.search);
      const data = await api(`/admin/audit-logs?${params.toString()}`, { token });
      setLogs(data.logs || []); setPagination(data.pagination || { total: 0, totalPages: 1 });
      setModules((current) => [...new Set([...current, ...(data.modules || [])])].sort());
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  useEffect(() => { if (token) load(); }, [token, page, filters.module, filters.outcome, filters.search]);
  useEffect(() => { setPage(1); }, [filters.module, filters.outcome]);

  const search = (event) => { event.preventDefault(); setPage(1); setFilters((value) => ({ ...value, search: query.trim() })); };
  const outcomeTone = (value) => value === "failed" ? "danger" : value === "success" ? "success" : "neutral";

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="System Accountability" title="Audit Logs" description="Read-only history of meaningful activity across the Admin Portal, including page access, record changes, imports, exports, voting, project updates and security-sensitive operations." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card><p className="text-sm font-semibold text-stone-500">Events on this page</p><p className="mt-2 text-3xl font-black text-[var(--brand-900)]">{logs.length}</p></Card>
        <Card><p className="text-sm font-semibold text-stone-500">Total matching</p><p className="mt-2 text-3xl font-black text-[var(--brand-900)]">{pagination.total || 0}</p></Card>
        <Card><p className="text-sm font-semibold text-stone-500">Failed on this page</p><p className="mt-2 text-3xl font-black text-rose-700">{logs.filter((item) => item.outcome === "failed").length}</p></Card>
        <Card><p className="text-sm font-semibold text-stone-500">Modules seen</p><p className="mt-2 text-3xl font-black text-[var(--brand-900)]">{modules.length}</p></Card>
      </div>

      <Card>
        <div className="flex items-start gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><ShieldCheck className="h-5 w-5" /></div><div><h2 className="font-bold text-[var(--brand-900)]">Comprehensive admin activity</h2><p className="mt-1 text-sm leading-6 text-stone-600">The server records admin API activity and the Admin Portal records page navigation. Passwords, tokens, verification codes and other secrets are redacted before audit data is stored.</p></div></div>
        <form onSubmit={search} className="mt-5 grid gap-4 lg:grid-cols-[1fr_220px_180px_auto] lg:items-end">
          <TextInput label="Search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Action, module, record type..." />
          <SelectInput label="Module" value={filters.module} onChange={(event) => setFilters((value) => ({ ...value, module: event.target.value }))}><option value="all">All modules</option>{modules.map((module) => <option key={module} value={module}>{titleCase(module)}</option>)}</SelectInput>
          <SelectInput label="Outcome" value={filters.outcome} onChange={(event) => setFilters((value) => ({ ...value, outcome: event.target.value }))}><option value="all">All outcomes</option><option value="success">Success</option><option value="failed">Failed</option></SelectInput>
          <button type="submit" className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[var(--brand-500)] px-5 text-sm font-bold text-white"><Search className="h-4 w-4" /> Search</button>
        </form>
      </Card>

      {loading ? <LoadingState rows={8} compact /> : error ? <ErrorState description={error} onRetry={load} /> : !logs.length ? <EmptyState title="No audit events found" description="Try changing the filters or search term." /> : (
        <div className="space-y-3">
          {logs.map((item) => <button key={item.id} type="button" onClick={() => setSelected(item)} className="block w-full text-left"><Card className="p-4 transition hover:border-[var(--brand-200)] hover:shadow-md"><div className="grid gap-3 xl:grid-cols-[180px_1fr_180px_140px]"><div><p className="text-xs text-stone-400">{formatDateTime(item.created_at)}</p><p className="mt-1 text-sm font-bold text-stone-700">{item.actor_name || titleCase(item.actor_role || "system")}</p></div><div><div className="flex flex-wrap gap-2"><Badge tone="info">{titleCase(item.module || item.entity_type || "system")}</Badge><Badge tone={outcomeTone(item.outcome)}>{titleCase(item.outcome || "success")}</Badge></div><p className="mt-2 font-bold text-[var(--brand-900)]">{titleCase(item.action || "activity")}</p><p className="mt-1 text-xs text-stone-500">{titleCase(item.entity_type || "record")} · {item.entity_id || "—"}</p></div><div className="text-xs text-stone-500"><p>{item.http_method || "—"}</p><p className="mt-1 break-all">{item.route || "—"}</p></div><div className="text-xs text-stone-400">Click for details</div></div></Card></button>)}
        </div>
      )}
      {!loading && !error && pagination.totalPages > 1 ? <Pagination page={page} totalPages={pagination.totalPages} onPageChange={setPage} /> : null}

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Audit Event Details" description={selected ? `${titleCase(selected.action)} · ${formatDateTime(selected.created_at)}` : ""} widthClass="max-w-5xl">
        {selected ? <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Actor", selected.actor_name || selected.actor_role],["Role", titleCase(selected.actor_role)],["Module", titleCase(selected.module)],["Outcome", titleCase(selected.outcome || "success")],["Method", selected.http_method],["Route", selected.route],["IP Address", selected.ip_address],["Record", `${titleCase(selected.entity_type)} · ${selected.entity_id || "—"}`]].map(([label,value]) => <div key={label} className="rounded-2xl bg-stone-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-stone-400">{label}</p><p className="mt-2 break-words text-sm font-semibold text-stone-700">{value || "—"}</p></div>)}</div>{[["Before", selected.before_data],["After", selected.after_data],["Details", selected.details]].map(([label,value]) => <div key={label}><h3 className="font-bold text-[var(--brand-900)]">{label}</h3><pre className="mt-2 max-h-72 overflow-auto rounded-2xl bg-stone-950 p-4 text-xs text-stone-100">{value ? JSON.stringify(value, null, 2) : "No data"}</pre></div>)}</div> : null}
      </Modal>
    </div>
  );
};
export default AdminAuditLogs;
