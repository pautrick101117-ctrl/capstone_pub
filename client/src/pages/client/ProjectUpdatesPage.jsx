import { ArrowLeft, CalendarDays, CheckCircle2, Clock3, MapPin, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { formatDate, formatDateTime } from "../../lib/format";
import { getStatusMeta } from "../../lib/status";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, Pagination, SegmentedTabs } from "../../components/ui";

const pageSize = 6;
const filterItems = [
  { value: "all", label: "All" },
  { value: "planned", label: "Planned" },
  { value: "ongoing", label: "Ongoing" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
];

const ProgressBar = ({ value = 0 }) => (
  <div className="h-2.5 overflow-hidden rounded-full bg-stone-100" aria-label={`${value}% complete`}>
    <div className="h-full rounded-full bg-[var(--brand-500)] transition-all" style={{ width: `${Math.max(0, Math.min(100, Number(value || 0)))}%` }} />
  </div>
);

const ProjectDetail = ({ projectId }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api(`/public/projects/${projectId}`));
    } catch (loadError) {
      setError(loadError.message || "Unable to load this project.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [projectId]);

  if (loading) return <div className="section-shell py-10"><LoadingState rows={5} /></div>;
  if (error) return <div className="section-shell py-10"><ErrorState description={error} onRetry={load} /></div>;

  const project = data?.project;
  if (!project) return <div className="section-shell py-10"><EmptyState title="Project not found" description="This community project is not available." /></div>;
  const meta = getStatusMeta(project.status);
  const updates = data?.updates || [];

  return (
    <div className="section-shell space-y-8 py-8 sm:py-12">
      <NavLink to="/project-updates" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--brand-700)] hover:underline"><ArrowLeft className="h-4 w-4" />Back to Project Updates</NavLink>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <Card className="overflow-hidden p-0">
          {project.cover_image_url ? <img src={project.cover_image_url} alt={project.title} className="h-72 w-full object-cover sm:h-96" /> : null}
          <div className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-2"><Badge tone={meta.tone}>{meta.label}</Badge>{project.election_id ? <Badge tone="success">Selected by Community Vote</Badge> : null}</div>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-[var(--brand-900)] sm:text-4xl">{project.title}</h1>
            <p className="mt-4 text-base leading-8 text-stone-600">{project.description}</p>
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between text-sm"><span className="font-semibold text-stone-600">Implementation progress</span><span className="font-black text-[var(--brand-800)]">{project.progress_percentage || 0}%</span></div>
              <ProgressBar value={project.progress_percentage} />
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <h2 className="text-lg font-bold text-[var(--brand-900)]">Project Overview</h2>
            <div className="mt-4 space-y-4 text-sm text-stone-600">
              {data?.election ? <div className="flex items-start gap-3"><Trophy className="mt-0.5 h-5 w-5 text-amber-600" /><div><p className="font-semibold text-stone-900">{data.election.title}</p><p className="mt-1">{data.voting?.votes || 0} votes · {data.voting?.share || 0}% of votes</p></div></div> : null}
              {project.planned_start_date ? <div className="flex items-center gap-3"><CalendarDays className="h-5 w-5 text-[var(--brand-600)]" /><span>Planned start: {formatDate(project.planned_start_date)}</span></div> : null}
              {project.actual_start_date ? <div className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5 text-[var(--brand-600)]" /><span>Started: {formatDate(project.actual_start_date)}</span></div> : null}
              {project.expected_completion_date ? <div className="flex items-center gap-3"><Clock3 className="h-5 w-5 text-[var(--brand-600)]" /><span>Expected completion: {formatDate(project.expected_completion_date)}</span></div> : null}
              {project.completed_at ? <div className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5 text-emerald-600" /><span>Completed: {formatDate(project.completed_at)}</span></div> : null}
            </div>
          </Card>
          <Card className="bg-[var(--brand-50)]">
            <p className="text-sm font-bold text-[var(--brand-900)]">Public implementation record</p>
            <p className="mt-2 text-sm leading-6 text-stone-600">Updates below are published by barangay administrators so residents can follow what is actually happening after a winning proposal moves into implementation.</p>
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
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={getStatusMeta(update.project_status || project.status).tone}>{getStatusMeta(update.project_status || project.status).label}</Badge><span className="text-xs font-semibold text-stone-400">{formatDate(update.update_date || update.created_at)}</span></div>
                  <h3 className="mt-3 text-xl font-bold text-[var(--brand-900)]">{update.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-stone-600">{update.description}</p>
                  {update.progress_percentage !== null && update.progress_percentage !== undefined ? <div className="mt-5"><div className="mb-2 flex justify-between text-xs font-semibold text-stone-500"><span>Progress after this update</span><span>{update.progress_percentage}%</span></div><ProgressBar value={update.progress_percentage} /></div> : null}
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
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, limit: pageSize });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
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
  };

  useEffect(() => { load(); }, [projectId, page, filter]);
  useEffect(() => { setPage(1); }, [filter]);

  if (projectId) return <ProjectDetail projectId={projectId} />;

  const totalPages = Math.max(1, Math.ceil((pagination.total || 0) / (pagination.limit || pageSize)));

  return (
    <div className="section-shell space-y-8 py-10 sm:py-14">
      <PageHeader eyebrow="Community Transparency" title="Project Updates" description="Follow winning community-voted projects from planning through implementation and completion." />
      <SegmentedTabs value={filter} onChange={setFilter} items={filterItems} />

      {loading ? <LoadingState rows={6} /> : error ? <ErrorState description={error} onRetry={load} /> : !items.length ? <EmptyState title="No projects in this status" description="Winning community projects and implementation updates will appear here." /> : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {items.map((project) => {
            const meta = getStatusMeta(project.status);
            return (
              <Card key={project.id} className="overflow-hidden p-0">
                {project.cover_image_url ? <img src={project.cover_image_url} alt={project.title} className="h-52 w-full object-cover" /> : <div className="h-52 bg-gradient-to-br from-[var(--brand-100)] to-stone-100" />}
                <div className="p-5">
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={meta.tone}>{meta.label}</Badge>{project.election_id ? <Badge tone="success">Community Vote Winner</Badge> : null}</div>
                  <h2 className="mt-3 text-xl font-bold text-[var(--brand-900)]">{project.title}</h2>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-stone-600">{project.description}</p>
                  <div className="mt-5"><div className="mb-2 flex justify-between text-xs font-semibold text-stone-500"><span>Implementation</span><span>{project.progress_percentage || 0}%</span></div><ProgressBar value={project.progress_percentage} /></div>
                  <NavLink to={`/project-updates/${project.id}`} className="mt-5 inline-flex text-sm font-bold text-[var(--brand-700)] hover:underline">View Project Updates →</NavLink>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {!loading && !error && totalPages > 1 ? <Pagination page={page} totalPages={totalPages} onPageChange={setPage} /> : null}
    </div>
  );
};

export default ProjectUpdatesPage;
