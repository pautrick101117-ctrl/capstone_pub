import { History } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, TextInput } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

const titleCase = (value = "") => `${value}`.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const AdminAuditLogs = () => {
  const { token } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api("/admin/audit-logs", { token });
      setLogs(data.logs || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (token) load(); }, [token]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return logs;
    return logs.filter((item) => JSON.stringify(item).toLowerCase().includes(needle));
  }, [logs, search]);

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="System" title="Audit logs" description="Review security-sensitive and administrative actions across the barangay portal. Audit records are read-only." />

      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><History className="h-5 w-5" /></div><div><h2 className="font-bold text-[var(--brand-900)]">Latest activity</h2><p className="text-sm text-stone-500">Showing up to the latest 100 audit events from the server.</p></div></div>
          <div className="w-full sm:max-w-sm"><TextInput label="Search audit logs" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Action, role, record..." /></div>
        </div>
      </Card>

      {loading ? <LoadingState rows={5} compact /> : error ? <ErrorState description={error} onRetry={load} /> : !filtered.length ? <EmptyState title="No audit events found" description={search ? "Try a different search term." : "Administrative actions will appear here as the portal is used."} /> : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <Card key={item.id} className="p-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><Badge tone="info">{titleCase(item.entity_type || "record")}</Badge><span className="text-xs text-stone-400">{formatDateTime(item.created_at)}</span></div>
                  <h3 className="mt-2 font-bold text-[var(--brand-900)]">{titleCase(item.action || "activity")}</h3>
                  <p className="mt-1 text-sm text-stone-500">Actor: {item.actor_name || titleCase(item.actor_role || "system")}{item.actor_role ? ` · ${titleCase(item.actor_role)}` : ""}</p>
                </div>
                <div className="max-w-2xl rounded-2xl bg-stone-50 px-4 py-3 text-xs text-stone-600"><pre className="whitespace-pre-wrap break-words font-sans">{Object.keys(item.details || {}).length ? JSON.stringify(item.details, null, 2) : "No additional details"}</pre></div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminAuditLogs;
