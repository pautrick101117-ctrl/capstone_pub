import { FileText, ReceiptText, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, Pagination, SelectInput, TableShell } from "../../components/ui";
import { formatCurrency, formatDate } from "../../lib/format";
import { getStatusMeta } from "../../lib/status";

const sourcePageSize = 5;
const projectPageSize = 8;

const FundTransparency = () => {
  const [data, setData] = useState({ sources: [], projects: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [term, setTerm] = useState("all");
  const [sourcePage, setSourcePage] = useState(1);
  const [projectPage, setProjectPage] = useState(1);

  const load = async () => {
    setLoading(true);
    setError("");
    try { setData(await api("/public/funds")); }
    catch (err) { setError(err.message); setData({ sources: [], projects: [] }); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const terms = useMemo(() => ["all", ...Array.from(new Set([...(data.sources || []).map((item) => item.term), ...(data.projects || []).map((item) => item.term)].filter(Boolean)))], [data]);
  const sources = useMemo(() => term === "all" ? data.sources || [] : (data.sources || []).filter((item) => item.term === term), [data, term]);
  const projects = useMemo(() => term === "all" ? data.projects || [] : (data.projects || []).filter((item) => item.term === term), [data, term]);
  useEffect(() => { setSourcePage(1); setProjectPage(1); }, [term]);
  const visibleSources = useMemo(() => sources.slice((sourcePage - 1) * sourcePageSize, sourcePage * sourcePageSize), [sources, sourcePage]);
  const visibleProjects = useMemo(() => projects.slice((projectPage - 1) * projectPageSize, projectPage * projectPageSize), [projects, projectPage]);
  const totals = useMemo(() => {
    const total = sources.reduce((sum, item) => sum + Number(item.allocated_amount || 0), 0);
    const spent = projects.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return { total, spent, remaining: Math.max(total - spent, 0) };
  }, [sources, projects]);

  return (
    <section className="section-shell py-10 sm:py-14">
      <PageHeader eyebrow="Public Transparency" title="Barangay Fund Transparency" description="Review recorded fund sources, project spending and supporting receipts by administration term." actions={<SelectInput label="Administration Term" value={term} onChange={(event) => setTerm(event.target.value)}>{terms.map((item) => <option key={item} value={item}>{item === "all" ? "All administration terms" : item}</option>)}</SelectInput>} />

      {loading ? <div className="mt-8"><LoadingState rows={4} /></div> : error ? <div className="mt-8"><ErrorState description={error} onRetry={load} /></div> : (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[{ label: "Allocated Funds", value: formatCurrency(totals.total) }, { label: "Recorded Spending", value: formatCurrency(totals.spent) }, { label: "Remaining", value: formatCurrency(totals.remaining) }, { label: "Projects Recorded", value: projects.length }].map((item) => <Card key={item.label} className="bg-gradient-to-br from-white to-[var(--brand-50)]"><div className="rounded-2xl bg-[var(--brand-500)]/10 p-3 text-[var(--brand-600)] w-fit"><WalletCards className="h-5 w-5" /></div><p className="mt-4 text-sm font-medium text-stone-500">{item.label}</p><p className="mt-2 text-2xl font-black text-[var(--brand-900)]">{item.value}</p></Card>)}
          </div>

          <div className="mt-8 grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
            <Card>
              <div className="flex items-center gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><ReceiptText className="h-5 w-5" /></div><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Fund Sources</h2><p className="mt-1 text-sm text-stone-500">Recorded allocations for the selected term.</p></div></div>
              <div className="mt-5 space-y-3">{!sources.length ? <EmptyState title="No fund sources recorded" description="Fund source records will appear here once they are published." /> : visibleSources.map((source) => <div key={source.id} className="rounded-2xl border border-stone-200 p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-[var(--brand-900)]">{source.name}</p><p className="mt-1 text-sm text-stone-500">Administration term: {source.term}</p></div><p className="font-bold text-[var(--brand-700)]">{formatCurrency(source.allocated_amount)}</p></div></div>)}</div><Pagination page={sourcePage} totalPages={Math.max(1, Math.ceil(sources.length / sourcePageSize))} onPageChange={setSourcePage} />
            </Card>

            <Card>
              <div className="flex items-center gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><FileText className="h-5 w-5" /></div><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Project Spending</h2><p className="mt-1 text-sm text-stone-500">Public project expense records and available receipts.</p></div></div>
              {!projects.length ? <div className="mt-5"><EmptyState title="No project entries yet" description="Funded projects will appear here once they are recorded." /></div> : <div className="mt-5"><TableShell><table className="min-w-full text-sm"><thead className="bg-stone-50 text-left text-stone-500"><tr><th className="px-4 py-3 font-semibold">Project</th><th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 font-semibold">Amount</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Receipt</th></tr></thead><tbody>{visibleProjects.map((project) => { const meta = getStatusMeta(project.status); return <tr key={project.id} className="border-t border-stone-100 align-top"><td className="px-4 py-4"><p className="font-semibold text-[var(--brand-900)]">{project.name}</p><p className="mt-1 max-w-md text-xs leading-5 text-stone-500">{project.description}</p><p className="mt-1 text-xs text-stone-400">{project.term}</p></td><td className="px-4 py-4 text-stone-600">{formatDate(project.date)}</td><td className="px-4 py-4 font-semibold text-[var(--brand-700)]">{formatCurrency(project.amount)}</td><td className="px-4 py-4"><Badge tone={meta.tone}>{meta.label}</Badge></td><td className="px-4 py-4">{project.receiptUrl ? <a href={project.receiptUrl} target="_blank" rel="noreferrer" className="font-semibold text-[var(--brand-600)] hover:underline">View file</a> : <span className="text-stone-400">None</span>}</td></tr>; })}</tbody></table></TableShell><Pagination page={projectPage} totalPages={Math.max(1, Math.ceil(projects.length / projectPageSize))} onPageChange={setProjectPage} /></div>}
            </Card>
          </div>
        </>
      )}
    </section>
  );
};
export default FundTransparency;
