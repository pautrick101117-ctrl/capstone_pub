import { FileText, ReceiptText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { Badge, Card, EmptyState, PageHeader, TableShell } from "../../components/ui";
import { formatCurrency, formatDate } from "../../lib/format";

const FundTransparency = () => {
  const [data, setData] = useState({ sources: [], projects: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("/public/funds")
      .then((payload) => {
        const hasData = (payload.sources || []).length || (payload.projects || []).length;
        setData(hasData ? payload : { sources: [], projects: [] });
      })
      .catch(() => setData({ sources: [], projects: [] }))
      .finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => {
    const total = (data.sources || []).reduce((sum, item) => sum + Number(item.allocated_amount || 0), 0);
    const spent = (data.projects || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return {
      total,
      spent,
      remaining: Math.max(total - spent, 0),
    };
  }, [data]);

  return (
    <section className="section-shell py-10 sm:py-14">
      <PageHeader
        eyebrow="Fund Transparency"
        title="Where barangay funds go"
        description="Review allocated fund sources, project spending, receipt files, and administration terms tied to each public project entry."
      />

      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        {[
          ["Total Funds", totals.total],
          ["Spent", totals.spent],
          ["Remaining", totals.remaining],
        ].map(([label, value]) => (
          <Card key={label}>
            <p className="text-sm font-medium text-stone-500">{label}</p>
            <p className="mt-3 text-3xl font-black text-[var(--brand-900)]">{formatCurrency(value)}</p>
          </Card>
        ))}
      </div>

      <div className="mt-8 grid gap-8 xl:grid-cols-[0.7fr_1.3fr]">
        <Card>
          <div className="flex items-center gap-3">
            <ReceiptText className="h-5 w-5 text-[var(--brand-600)]" />
            <h2 className="text-xl font-bold text-[var(--brand-900)]">Fund Sources</h2>
          </div>
          <div className="mt-5 space-y-4">
            {!data.sources.length && !loading ? (
              <EmptyState title="No fund sources yet" description="Allocated fund pools will appear here once encoded by the barangay administration." />
            ) : (
              data.sources.map((source) => (
                <div key={source.id} className="rounded-2xl border border-stone-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--brand-900)]">{source.name}</p>
                      <p className="mt-1 text-sm text-stone-500">Administration term: {source.term}</p>
                    </div>
                    <p className="font-bold text-[var(--brand-700)]">{formatCurrency(source.allocated_amount)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-[var(--brand-600)]" />
            <h2 className="text-xl font-bold text-[var(--brand-900)]">Project History</h2>
          </div>
          {loading ? (
            <p className="mt-5 text-sm text-stone-500">Loading fund projects...</p>
          ) : !data.projects.length ? (
            <div className="mt-5">
              <EmptyState title="No project entries yet" description="Funded projects will appear here once they are recorded." />
            </div>
          ) : (
            <div className="mt-5 space-y-5">
              <TableShell>
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-stone-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Project</th>
                      <th className="px-4 py-3 font-semibold">Date</th>
                      <th className="px-4 py-3 font-semibold">Amount</th>
                      <th className="px-4 py-3 font-semibold">Term</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Receipt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.projects.map((project) => (
                      <tr key={project.id} className="border-t border-stone-100">
                        <td className="px-4 py-4">
                          <p className="font-semibold text-[var(--brand-900)]">{project.name}</p>
                          <p className="mt-1 text-xs text-stone-500">{project.description}</p>
                        </td>
                        <td className="px-4 py-4 text-stone-600">{formatDate(project.date)}</td>
                        <td className="px-4 py-4 font-semibold text-[var(--brand-700)]">{formatCurrency(project.amount)}</td>
                        <td className="px-4 py-4 text-stone-600">{project.term}</td>
                        <td className="px-4 py-4">
                          <Badge tone={project.status === "completed" ? "success" : project.status === "cancelled" ? "danger" : "warning"}>
                            {project.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-4">
                          {project.receiptUrl ? (
                            <a href={project.receiptUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-[var(--brand-600)] hover:underline">
                              View file
                            </a>
                          ) : (
                            <span className="text-stone-400">None</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
            </div>
          )}
        </Card>
      </div>
    </section>
  );
};

export default FundTransparency;
