import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Clock3, Trophy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { NavLink, useLocation, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { formatDate, formatDateTime } from "../../lib/format";
import { getStatusMeta } from "../../lib/status";
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, Pagination, SegmentedTabs } from "../../components/ui";
import ProjectStatus from "../../components/ProjectStatus";
import { projectStatusFilters } from "../../lib/projectStatus";

const pageSize = 6;
const ProjectDetail = ({ projectId, basePath }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api(`/public/projects/${projectId}`));
    } catch (loadError) {
      setError(loadError.message || "Unable to load this project.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load, projectId]);

  if (loading) return <div className="section-shell py-10"><LoadingState rows={5} /></div>;
  if (error) return <div className="section-shell py-10"><ErrorState description={error} onRetry={load} /></div>;

  const project = data?.project;
  if (!project) return <div className="section-shell py-10"><EmptyState title="Project not found" description="This community project is not available." /></div>;
  const updates = data?.updates || [];

  return (
    <div className="section-shell space-y-8 py-8 sm:py-12">
      <NavLink to={basePath} className="inline-flex items-center gap-2 text-sm font-bold text-[var(--brand-700)] hover:underline"><ArrowLeft className="h-4 w-4" />Back to Project Updates</NavLink>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <Card className="overflow-hidden p-0">
          {project.cover_image_url ? <img src={project.cover_image_url} alt={project.title} className="h-72 w-full object-cover sm:h-96" /> : null}
          <div className="p-6 sm:p-8">
            {project.election_id ? <Badge tone="success">Selected by Community Vote</Badge> : null}
            <h1 className="mt-4 text-3xl font-black tracking-tight text-[var(--brand-900)] sm:text-4xl">{project.title}</h1>
            <p className="mt-4 text-base leading-8 text-stone-600">{project.description}</p>
            <div className="mt-6">
              <ProjectStatus status={project.status} />
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <h2 className="text-lg font-bold text-[var(--brand-900)]">Project Overview</h2>
            <div className="mt-4 space-y-4 text-sm text-stone-600">
              {data?.election ? <div className="flex items-start gap-3"><Trophy className="mt-0.5 h-5 w-5 text-amber-600" /><div><p className="font-semibold text-stone-900">{data.election.title}</p><p className="mt-1">{data.voting?.votes || 0} votes · {data.voting?.share || 0}% of votes</p><NavLink to={`/voting-result/${data.election.id}`} className="mt-2 inline-flex text-xs font-bold text-[var(--brand-700)] hover:underline">View this voting round's results →</NavLink></div></div> : null}
              {project.planned_start_date ? <div className="flex items-center gap-3"><CalendarDays className="h-5 w-5 text-[var(--brand-600)]" /><span>Planned start: {formatDate(project.planned_start_date)}</span></div> : null}
              {project.actual_start_date ? <div className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5 text-[var(--brand-600)]" /><span>Started: {formatDate(project.actual_start_date)}</span></div> : null}
              {project.expected_completion_date ? <div className="flex items-center gap-3"><Clock3 className="h-5 w-5 text-[var(--brand-600)]" /><span>Expected completion: {formatDate(project.expected_completion_date)}</span></div> : null}
              {project.completed_at ? <div className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5 text-emerald-600" /><span>Completed: {formatDate(project.completed_at)}</span></div> : null}
            </div>
          </Card>
          <Card className="bg-[var(--brand-50)]">
            <p className="text-sm font-bold text-[var(--brand-900)]">Public implementation record</p>
            <p className="mt-2 text-sm leading-6 text-stone-600">Barangay administrators publish status changes and implementation updates here. These records remain available for public reference.</p>
          </Card>
        </div>
      </div>

      <div>
        <PageHeader eyebrow="Implementation Timeline" title="Project updates" description="Newest implementation updates appear first." />
        <div className="mt-6 space-y-4">
          {updates.length ? updates.map((update) => (
            <Card key={update.id}>
              <div className="grid gap-5 md:grid-cols-[0.7fr_1.3fr]">
                {update.image_url ? <img src={update.image_url} alt={update.title} className="h-56 w-full rounded-2xl object-cover" /> : <div className="flex h-56 items-center justify-center rounded-2xl bg-stone-100 text-sm text-stone-400">No update photo</div>}
                <div>
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={getStatusMeta(update.project_status).tone}>{update.project_status ? getStatusMeta(update.project_status).label : "Status Not Recorded"}</Badge><span className="text-xs font-semibold text-stone-400">{formatDate(update.update_date || update.created_at)}</span></div>
                  <h3 className="mt-3 text-xl font-bold text-[var(--brand-900)]">{update.title} {update.corrected_at ? <Badge tone="neutral">Corrected</Badge> : null}</h3>
                  <p className="mt-3 whitespace-pre-line text-sm leading-7 text-stone-600">{update.description}</p>
                  <p className="mt-4 text-xs text-stone-400">Published {formatDateTime(update.created_at)}</p>
                </div>
              </div>
            </Card>
          )) : <EmptyState title="No implementation updates yet" description="The project has been recorded, but the barangay has not published an implementation update yet." />}
        </div>
      </div>
    </div>
  );
};

const ProjectUpdatesPage = () => {
  const { projectId } = useParams();
  const { pathname } = useLocation();
  const basePath = pathname.startsWith("/portal/") ? "/portal/project-updates" : "/project-updates";
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, limit: pageSize });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (projectId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api(`/public/projects?page=${page}&limit=${pageSize}&status=${filter}`);
      setItems(data.items || []);
      setPagination(data.pagination || { total: 0, limit: pageSize });
    } catch (loadError) {
      setError(loadError.message || "Unable to load project updates.");
    } finally {
      setLoading(false);
    }
  }, [filter, page, projectId]);

  useEffect(() => { load(); }, [projectId, page, filter, load]);

  if (projectId) return <ProjectDetail key={projectId} projectId={projectId} basePath={basePath} />;

  const totalPages = Math.max(1, Math.ceil((pagination.total || 0) / (pagination.limit || pageSize)));

  return (
    <div className="section-shell space-y-8 py-10 sm:py-14">
      <PageHeader eyebrow="Community Transparency" title="Project Updates" description="View the current status and official updates for projects selected through community voting." />
      <SegmentedTabs value={filter} onChange={(value) => { setFilter(value); setPage(1); }} items={projectStatusFilters} />

      {loading ? <LoadingState rows={6} /> : error ? <ErrorState description={error} onRetry={load} /> : !items.length ? <EmptyState title="No projects in this status" description="Winning community projects and implementation updates will appear here." /> : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {items.map((project) => {
            return (
              <NavLink key={project.id} to={`${basePath}/${project.id}`} aria-label={`View project: ${project.title}`} className="group flex h-full flex-col overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--brand-300)] hover:shadow-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--brand-200)]">
                {project.cover_image_url ? <img src={project.cover_image_url} alt={project.title} className="h-52 w-full object-cover" /> : <div className="h-52 bg-gradient-to-br from-[var(--brand-100)] to-stone-100" />}
                <div className="flex flex-1 flex-col p-5">
                  {project.election_id ? <div><Badge tone="success">Selected by Community Vote</Badge></div> : null}
                  <h2 className="mt-3 text-xl font-bold text-[var(--brand-900)]">{project.title}</h2>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-stone-600">{project.description}</p>
                  <div className="mt-auto pt-5"><ProjectStatus status={project.status} compact /></div>
                  <span className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[var(--brand-700)]">View Project Updates <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" aria-hidden="true" /></span>
                </div>
              </NavLink>
            );
          })}
        </div>
      )}
      {!loading && !error && totalPages > 1 ? <Pagination page={page} totalPages={totalPages} onPageChange={setPage} /> : null}
    </div>
  );
};

export default ProjectUpdatesPage;


