import {
  Activity,
  Archive,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  FileClock,
  Flag,
  ImagePlus,
  ListChecks,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Square,
  StopCircle,
  Trash2,
  Trophy,
  Users,
  Vote,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import {
  AlertBanner,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Modal,
  PageError,
  PageHeader,
  Pagination,
  ResponsiveListTable,
  SelectInput,
  StatCard,
  StatusBadge,
  Tabs,
  TextArea,
  TextInput,
} from "../../components/ui";
import { formatDateTime } from "../../lib/format";

const mainTabs = [
  { value: "overview", label: "Overview" },
  { value: "suggestions", label: "Suggestions" },
  { value: "elections", label: "Elections" },
  { value: "monitoring", label: "Live Monitoring" },
  { value: "results", label: "Results" },
  { value: "projects", label: "Community Projects" },
  { value: "audit", label: "Voting Audit" },
];

const suggestionStatuses = ["all", "submitted", "under_review", "needs_revision", "approved", "rejected", "included_in_voting", "selected"];
const electionStatuses = ["all", "active", "past", "draft", "scheduled", "live", "closed", "finalized", "archived", "cancelled"];
const listPageSize = 6;
const electionPageSize = 8;
const auditPageSize = 12;

const emptyElection = () => ({
  id: "",
  title: "Community Project Voting",
  description: "Choose the recommended barangay project you want the barangay to prioritize.",
  status: "draft",
  startsAt: "",
  endsAt: "",
  resultsVisibility: "after_close",
  image: null,
  preview: "",
  imageUrl: "",
});

const toDateTimeLocal = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const serializeDateTime = (value) => (value ? new Date(value).toISOString() : "");
const residentName = (suggestion) => suggestion.users?.full_name || [suggestion.users?.first_name, suggestion.users?.last_name].filter(Boolean).join(" ") || "Resident";

const matchesSearch = (search, values = []) => {
  const query = `${search || ""}`.trim().toLowerCase();
  if (!query) return true;
  return values.filter((value) => value !== null && value !== undefined).join(" ").toLowerCase().includes(query);
};

const Admin_VotingResult = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState("overview");
  const [suggestions, setSuggestions] = useState([]);
  const [elections, setElections] = useState([]);
  const [projects, setProjects] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [viewElection, setViewElection] = useState(null);

  const [suggestionFilter, setSuggestionFilter] = useState("all");
  const [electionFilter, setElectionFilter] = useState("all");
  const [reviewItem, setReviewItem] = useState(null);
  const [reviewForm, setReviewForm] = useState({ status: "under_review", adminFeedback: "" });

  const [builderOpen, setBuilderOpen] = useState(false);
  const [draftElection, setDraftElection] = useState(emptyElection());
  const [draftOptions, setDraftOptions] = useState([]);
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState([]);
  const [saving, setSaving] = useState(false);

  const [confirm, setConfirm] = useState(null);
  const [selectedMonitorId, setSelectedMonitorId] = useState("");
  const [monitoring, setMonitoring] = useState(null);
  const [monitorLoading, setMonitorLoading] = useState(false);

  const [projectEdit, setProjectEdit] = useState(null);
  const [projectForm, setProjectForm] = useState({ status: "planned", progressPercentage: 0, location: "", purok: "", plannedStartDate: "", actualStartDate: "", targetCompletionDate: "", actualCompletionDate: "", allocatedBudget: "", actualCost: "", description: "" });
  const [updateProject, setUpdateProject] = useState(null);
  const [updateForm, setUpdateForm] = useState({ title: "", description: "", progressPercentage: "", image: null });

  const [suggestionPage, setSuggestionPage] = useState(1);
  const [electionPage, setElectionPage] = useState(1);
  const [resultPage, setResultPage] = useState(1);
  const [projectPage, setProjectPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [suggestionData, electionData, projectData, auditData] = await Promise.all([
        api("/admin/suggestions", { token }),
        api("/admin/elections", { token }),
        api("/admin/community-projects", { token }),
        api("/admin/voting-audit", { token }),
      ]);
      const nextElections = electionData.elections || [];
      setSuggestions(suggestionData.suggestions || []);
      setElections(nextElections);
      setProjects(projectData.projects || []);
      setLogs(auditData.logs || []);
      const live = nextElections.find((item) => item.status === "live") || nextElections[0];
      setSelectedMonitorId((current) => current && nextElections.some((item) => item.id === current) ? current : live?.id || "");
    } catch (loadError) { setError(loadError.message || "Unable to load voting management data."); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (token) load(); }, [token]);

  const liveElections = elections.filter((item) => item.status === "live");
  const scheduled = elections.filter((item) => item.status === "scheduled");
  const pendingSuggestions = suggestions.filter((item) => ["submitted", "under_review", "needs_revision"].includes(item.status));
  const finalized = elections.filter((item) => ["closed", "finalized", "archived"].includes(item.status));

  const filteredSuggestions = useMemo(
    () =>
      suggestions.filter((item) => {
        const statusMatches = suggestionFilter === "all" || item.status === suggestionFilter;
        const searchMatches = matchesSearch(search, [
          item.title,
          item.description,
          item.status,
          item.admin_feedback,
          item.purok,
          item.users?.purok,
          residentName(item),
        ]);
        return statusMatches && searchMatches;
      }),
    [suggestions, suggestionFilter, search]
  );

  const filteredElections = useMemo(
    () =>
      elections.filter((item) => {
        const statusMatches =
          electionFilter === "all"
            ? true
            : electionFilter === "active"
              ? ["draft", "scheduled", "live"].includes(item.status)
              : electionFilter === "past"
                ? ["closed", "finalized", "archived", "cancelled"].includes(item.status)
                : item.status === electionFilter;
        const searchMatches = matchesSearch(search, [
          item.title,
          item.description,
          item.status,
          item.resultStatus,
          item.winner?.name,
          item.runoffOfElectionId ? "runoff" : "",
          formatDateTime(item.startsAt),
          formatDateTime(item.endsAt),
        ]);
        return statusMatches && searchMatches;
      }),
    [elections, electionFilter, search]
  );

  const filteredResults = useMemo(
    () =>
      finalized.filter((item) =>
        matchesSearch(search, [
          item.title,
          item.description,
          item.status,
          item.resultStatus,
          item.winner?.name,
          ...(item.options || []).map((option) => option.name),
        ])
      ),
    [finalized, search]
  );

  const filteredProjects = useMemo(
    () =>
      projects.filter((item) =>
        matchesSearch(search, [
          item.title,
          item.description,
          item.status,
          item.location,
          item.purok,
        ])
      ),
    [projects, search]
  );

  const filteredLogs = useMemo(
    () =>
      logs.filter((item) =>
        matchesSearch(search, [
          item.action,
          item.entity_type,
          item.entity_id,
          item.actor_role,
          JSON.stringify(item.details || {}),
          formatDateTime(item.created_at),
        ])
      ),
    [logs, search]
  );

  const approvedSuggestions = useMemo(
    () => suggestions.filter((item) => ["approved", "included_in_voting"].includes(item.status)),
    [suggestions]
  );

  const monitorableElections = useMemo(
    () =>
      elections.filter(
        (item) =>
          ["live", "closed", "finalized", "archived"].includes(item.status) &&
          matchesSearch(search, [item.title, item.description, item.status])
      ),
    [elections, search]
  );

  const overviewMatches = useMemo(() => {
    if (!search.trim()) return [];
    const items = [];
    suggestions.forEach((item) => {
      if (matchesSearch(search, [item.title, item.description, item.status, residentName(item)])) {
        items.push({ id: `suggestion-${item.id}`, type: "Suggestion", title: item.title, subtitle: item.status, target: "suggestions" });
      }
    });
    elections.forEach((item) => {
      if (matchesSearch(search, [item.title, item.description, item.status, item.resultStatus])) {
        items.push({ id: `election-${item.id}`, type: "Election", title: item.title, subtitle: item.status, target: "elections" });
      }
    });
    projects.forEach((item) => {
      if (matchesSearch(search, [item.title, item.description, item.status, item.location, item.purok])) {
        items.push({ id: `project-${item.id}`, type: "Project", title: item.title, subtitle: item.status, target: "projects" });
      }
    });
    return items.slice(0, 12);
  }, [search, suggestions, elections, projects]);

  useEffect(() => { setSuggestionPage(1); }, [suggestionFilter, search]);
  useEffect(() => { setElectionPage(1); }, [electionFilter, search]);
  useEffect(() => { setResultPage(1); setProjectPage(1); setAuditPage(1); }, [search]);

  const suggestionTotalPages = Math.max(1, Math.ceil(filteredSuggestions.length / listPageSize));
  const electionTotalPages = Math.max(1, Math.ceil(filteredElections.length / electionPageSize));
  const resultTotalPages = Math.max(1, Math.ceil(filteredResults.length / listPageSize));
  const projectTotalPages = Math.max(1, Math.ceil(filteredProjects.length / listPageSize));
  const auditTotalPages = Math.max(1, Math.ceil(filteredLogs.length / auditPageSize));

  useEffect(() => { if (suggestionPage > suggestionTotalPages) setSuggestionPage(suggestionTotalPages); }, [suggestionPage, suggestionTotalPages]);
  useEffect(() => { if (electionPage > electionTotalPages) setElectionPage(electionTotalPages); }, [electionPage, electionTotalPages]);
  useEffect(() => { if (resultPage > resultTotalPages) setResultPage(resultTotalPages); }, [resultPage, resultTotalPages]);
  useEffect(() => { if (projectPage > projectTotalPages) setProjectPage(projectTotalPages); }, [projectPage, projectTotalPages]);
  useEffect(() => { if (auditPage > auditTotalPages) setAuditPage(auditTotalPages); }, [auditPage, auditTotalPages]);

  useEffect(() => {
    if (tab !== "monitoring") return;
    if (selectedMonitorId && monitorableElections.some((item) => item.id === selectedMonitorId)) return;
    setSelectedMonitorId(monitorableElections[0]?.id || "");
  }, [tab, search, monitorableElections, selectedMonitorId]);

  const paginatedSuggestions = filteredSuggestions.slice((suggestionPage - 1) * listPageSize, suggestionPage * listPageSize);
  const paginatedElections = filteredElections.slice((electionPage - 1) * electionPageSize, electionPage * electionPageSize);
  const paginatedResults = filteredResults.slice((resultPage - 1) * listPageSize, resultPage * listPageSize);
  const paginatedProjects = filteredProjects.slice((projectPage - 1) * listPageSize, projectPage * listPageSize);
  const paginatedLogs = filteredLogs.slice((auditPage - 1) * auditPageSize, auditPage * auditPageSize);


  const openReview = (item) => {
    setReviewItem(item);
    setReviewForm({ status: item.status === "submitted" ? "under_review" : item.status, adminFeedback: item.admin_feedback || "" });
  };

  const saveReview = async () => {
    setSaving(true);
    try {
      await api(`/admin/suggestions/${reviewItem.id}`, { method: "PATCH", token, body: reviewForm });
      toast.success("Suggestion review saved and resident notified.");
      setReviewItem(null);
      await load();
    } catch (saveError) { toast.error(saveError.message); }
    finally { setSaving(false); }
  };

  const openNewElection = () => {
    setDraftElection(emptyElection());
    setDraftOptions([]);
    setSelectedSuggestionIds([]);
    setBuilderOpen(true);
  };

  const openEditElection = (election) => {
    setDraftElection({
      id: election.id,
      title: election.title || "",
      description: election.description || "",
      status: ["draft", "scheduled", "live", "cancelled"].includes(election.status) ? election.status : "draft",
      startsAt: toDateTimeLocal(election.startsAt),
      endsAt: toDateTimeLocal(election.endsAt),
      resultsVisibility: election.resultsVisibility || "after_close",
      image: null,
      preview: election.imageUrl || "",
      imageUrl: election.imageUrl || "",
    });
    const options = (election.options || []).map((option) => ({ name: option.name, description: option.description || "", sourceSuggestionId: option.sourceSuggestionId || "", imageUrl: option.imageUrl || "" }));
    setDraftOptions(options);
    setSelectedSuggestionIds(options.map((option) => option.sourceSuggestionId).filter(Boolean));
    setBuilderOpen(true);
  };

  const toggleSuggestion = (suggestion) => {
    const selected = selectedSuggestionIds.includes(suggestion.id);
    if (selected) {
      setSelectedSuggestionIds((current) => current.filter((id) => id !== suggestion.id));
      setDraftOptions((current) => current.filter((option) => option.sourceSuggestionId !== suggestion.id));
    } else {
      setSelectedSuggestionIds((current) => [...current, suggestion.id]);
      setDraftOptions((current) => [...current, { name: suggestion.title, description: suggestion.description, sourceSuggestionId: suggestion.id, imageUrl: suggestion.image_url || "" }]);
    }
  };

  const saveElection = async (event) => {
    event.preventDefault();
    if (["scheduled", "live"].includes(draftElection.status) && draftOptions.length < 2) {
      toast.error("Select at least two approved suggestions before publishing voting.");
      return;
    }
    setSaving(true);
    try {
      const formData = new FormData();
      if (draftElection.image) formData.append("image", draftElection.image);
      formData.append("election", JSON.stringify({
        id: draftElection.id,
        title: draftElection.title,
        description: draftElection.description,
        status: draftElection.status,
        startsAt: serializeDateTime(draftElection.startsAt),
        endsAt: serializeDateTime(draftElection.endsAt),
        resultsVisibility: draftElection.resultsVisibility,
        imageUrl: draftElection.image ? null : draftElection.imageUrl || draftElection.preview || null,
      }));
      formData.append("options", JSON.stringify(draftOptions));
      await api("/admin/election", { method: "PUT", token, body: formData });
      toast.success(draftElection.status === "scheduled" ? "Voting scheduled." : draftElection.status === "live" ? "Voting is now live." : "Election saved.");
      setBuilderOpen(false);
      await load();
    } catch (saveError) { toast.error(saveError.message); }
    finally { setSaving(false); }
  };

  const runAction = async (action, item) => {
    setSaving(true);
    try {
      if (action === "start") await api(`/admin/elections/${item.id}/start`, { method: "POST", token, body: {} });
      if (action === "close") await api(`/admin/elections/${item.id}/close`, { method: "POST", token, body: { reason: "Closed by administrator" } });
      if (action === "delete") await api(`/admin/elections/${item.id}`, { method: "DELETE", token });
      if (action === "finalize") await api(`/admin/elections/${item.id}/finalize`, { method: "POST", token, body: {} });
      if (action === "runoff") await api(`/admin/elections/${item.id}/runoff`, { method: "POST", token, body: {} });
      if (action === "project") await api(`/admin/elections/${item.id}/project`, { method: "POST", token, body: {} });
      if (action === "archive") await api(`/admin/elections/${item.id}/archive`, { method: "POST", token, body: {} });
      toast.success({ start: "Voting started.", close: "Voting closed.", delete: "Draft deleted.", finalize: "Results finalized.", runoff: "Runoff draft created.", project: "Community project created.", archive: "Election archived." }[action] || "Action completed.");
      setConfirm(null);
      await load();
    } catch (actionError) { toast.error(actionError.message); }
    finally { setSaving(false); }
  };

  const loadMonitoring = async (id = selectedMonitorId) => {
    if (!id) return;
    setMonitorLoading(true);
    try { const data = await api(`/admin/elections/${id}/monitor`, { token }); setMonitoring(data.monitoring || null); }
    catch (monitorError) { toast.error(monitorError.message); setMonitoring(null); }
    finally { setMonitorLoading(false); }
  };
  useEffect(() => { if (tab === "monitoring" && selectedMonitorId) loadMonitoring(selectedMonitorId); }, [tab, selectedMonitorId]);

  const openProjectEdit = (project) => {
    setProjectEdit(project);
    setProjectForm({
      status: project.status || "planned", progressPercentage: project.progress_percentage ?? 0,
      location: project.location || "", purok: project.purok || "", plannedStartDate: project.planned_start_date || "", actualStartDate: project.actual_start_date || "",
      targetCompletionDate: project.target_completion_date || "", actualCompletionDate: project.actual_completion_date || "", allocatedBudget: project.allocated_budget ?? "", actualCost: project.actual_cost ?? "", description: project.description || "",
    });
  };

  const saveProject = async () => {
    setSaving(true);
    try {
      await api(`/admin/community-projects/${projectEdit.id}`, { method: "PATCH", token, body: projectForm });
      toast.success("Community project updated."); setProjectEdit(null); await load();
    } catch (projectError) { toast.error(projectError.message); }
    finally { setSaving(false); }
  };

  const saveProjectUpdate = async () => {
    setSaving(true);
    try {
      const formData = new FormData();
      Object.entries(updateForm).forEach(([key, value]) => { if (key === "image" && value) formData.append("image", value); else if (key !== "image") formData.append(key, value); });
      await api(`/admin/community-projects/${updateProject.id}/updates`, { method: "POST", token, body: formData });
      toast.success("Project progress update posted."); setUpdateProject(null); setUpdateForm({ title: "", description: "", progressPercentage: "", image: null }); await load();
    } catch (updateError) { toast.error(updateError.message); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="text-sm text-stone-500">Loading voting management...</div>;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Voting & Community Projects"
        title="Manage the full participation lifecycle"
        description="Review resident suggestions, schedule elections, monitor participation, finalize ties or winners, and track winning projects through completion."
        actions={<><Button variant="secondary" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</Button><Button onClick={openNewElection}><Plus className="h-4 w-4" />Create Election</Button></>}
      />
      {error ? <PageError message={error} onRetry={load} /> : null}
      <Tabs tabs={mainTabs} value={tab} onChange={setTab} />
      <Card className="p-4">
        <TextInput
          label="Search this voting module"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search suggestions, elections, results, projects, or audit activity..."
        />
      </Card>

      {tab === "overview" ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={Vote}
              label="Live Elections"
              value={liveElections.length}
              hint={liveElections.length ? `${liveElections.length} currently open` : "No voting currently open"}
            />
            <StatCard icon={CalendarClock} label="Scheduled" value={scheduled.length} hint="Will open automatically" />
            <StatCard icon={Sparkles} label="Suggestions Needing Review" value={pendingSuggestions.length} />
            <StatCard icon={Flag} label="Projects In Progress" value={projects.filter((project) => ["preparation", "in_progress"].includes(project.status)).length} />
          </div>

          {search.trim() ? (
            <Card>
              <h2 className="text-xl font-bold text-[var(--brand-900)]">Search Results</h2>
              <p className="mt-1 text-sm text-stone-500">Matching records across Voting & Community Projects.</p>
              {!overviewMatches.length ? (
                <div className="mt-5"><EmptyState title="No matching voting records" description={`Nothing matched “${search}”.`} /></div>
              ) : (
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {overviewMatches.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTab(item.target)}
                      className="rounded-2xl border border-stone-200 p-4 text-left transition hover:border-[var(--brand-200)] hover:bg-stone-50"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-500)]">{item.type}</p>
                      <p className="mt-2 font-semibold text-[var(--brand-900)]">{item.title}</p>
                      <p className="mt-1 text-xs capitalize text-stone-500">{String(item.subtitle || "").replaceAll("_", " ")}</p>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          ) : null}

          <Card>
            <h2 className="text-xl font-bold text-[var(--brand-900)]">Action Center</h2>
            <div className="mt-5 grid gap-3 lg:grid-cols-2">
              {pendingSuggestions.length ? <button type="button" onClick={() => setTab("suggestions")} className="rounded-2xl border border-stone-200 p-4 text-left hover:border-[var(--brand-200)]"><p className="font-semibold text-[var(--brand-900)]">{pendingSuggestions.length} suggestion{pendingSuggestions.length === 1 ? "" : "s"} need review</p><p className="mt-1 text-sm text-stone-500">Open Suggestions to approve, request revision, or reject.</p></button> : null}
              {liveElections.map((liveElection) => (
                <button
                  key={liveElection.id}
                  type="button"
                  onClick={() => { setSelectedMonitorId(liveElection.id); setTab("monitoring"); }}
                  className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left"
                >
                  <p className="font-semibold text-amber-950">{liveElection.title} is live</p>
                  <p className="mt-1 text-sm text-amber-800">{liveElection.totalVotes || 0} votes • {liveElection.participationRate || 0}% participation • closes {formatDateTime(liveElection.endsAt)}</p>
                </button>
              ))}
              {elections.some((item) => item.status === "closed") ? <button type="button" onClick={() => setTab("results")} className="rounded-2xl border border-stone-200 p-4 text-left"><p className="font-semibold text-[var(--brand-900)]">Closed election awaiting finalization</p><p className="mt-1 text-sm text-stone-500">Review tie/winner state before making the result official.</p></button> : null}
              {!pendingSuggestions.length && !liveElections.length && !elections.some((item) => item.status === "closed") ? <EmptyState title="Nothing urgent" description="The voting workflow has no pending action right now." /> : null}
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "suggestions" ? (
        <Card>
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Resident Project Suggestions</h2><p className="mt-1 text-sm text-stone-500">Give clear feedback so residents can understand every review decision.</p></div><SelectInput label="Status" value={suggestionFilter} onChange={(event) => setSuggestionFilter(event.target.value)} className="lg:w-64">{suggestionStatuses.map((value) => <option key={value} value={value}>{value === "all" ? "All statuses" : value.replaceAll("_", " ")}</option>)}</SelectInput></div>
          {!filteredSuggestions.length ? <EmptyState title="No suggestions in this view" description="Resident submissions will appear here." /> : <div className="grid gap-4 xl:grid-cols-2">{paginatedSuggestions.map((item) => (
            <div key={item.id} className="rounded-3xl border border-stone-200 p-5">
              {item.image_url ? <img src={item.image_url} alt={item.title} className="mb-4 h-44 w-full rounded-2xl object-cover" /> : null}
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-bold text-[var(--brand-900)]">{item.title}</h3><p className="mt-1 text-xs text-stone-500">{residentName(item)} • {item.purok || item.users?.purok || "No purok"} • {formatDateTime(item.created_at)}</p></div><StatusBadge status={item.status} /></div>
              <p className="mt-3 text-sm leading-6 text-stone-600">{item.description}</p>
              {item.admin_feedback ? <div className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900"><span className="font-semibold">Feedback:</span> {item.admin_feedback}</div> : null}
              {!['included_in_voting','selected'].includes(item.status) ? <div className="mt-4"><Button variant="secondary" onClick={() => openReview(item)}><Pencil className="h-4 w-4" />Review</Button></div> : null}
            </div>
          ))}</div>}
          <Pagination page={suggestionPage} totalPages={suggestionTotalPages} onPageChange={setSuggestionPage} />
        </Card>
      ) : null}

      {tab === "elections" ? (
        <Card>
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Election Lifecycle</h2><p className="mt-1 text-sm text-stone-500">Draft → Scheduled → Live → Closed → Finalized → Archived.</p></div><div className="flex flex-col gap-3 sm:flex-row"><SelectInput label="Status" value={electionFilter} onChange={(event) => setElectionFilter(event.target.value)}>{electionStatuses.map((value) => (
  <option key={value} value={value}>
    {value === "all" ? "All statuses" : value === "active" ? "Active / Upcoming" : value === "past" ? "Past / History" : value}
  </option>
))}</SelectInput><Button onClick={openNewElection} className="self-end"><Plus className="h-4 w-4" />New Election</Button></div></div>
          {!filteredElections.length ? <EmptyState title="No elections" description="Create a draft election to begin." /> : (
            <ResponsiveListTable
              headers={["Election", "Schedule", "Participation", "Status", "Actions"]}
              rows={paginatedElections}
              renderDesktopRow={(item) => (
                <tr key={item.id} className="border-t border-stone-100 align-top hover:bg-stone-50/70">
                  <td className="px-4 py-4"><p className="font-bold text-[var(--brand-900)]">{item.title}</p><p className="mt-1 max-w-sm text-xs text-stone-500">{item.description}</p>{item.runoffOfElectionId ? <span className="mt-2 inline-block text-xs font-semibold text-amber-700">Runoff election</span> : null}</td>
                  <td className="px-4 py-4 text-xs text-stone-600"><p>Opens: {formatDateTime(item.startsAt)}</p><p className="mt-1">Closes: {formatDateTime(item.endsAt)}</p></td>
                  <td className="px-4 py-4 text-sm text-stone-600">{item.totalVotes ?? 0} / {item.eligibleVoters ?? 0}<p className="text-xs text-stone-400">{item.participationRate ?? 0}%</p></td>
                  <td className="px-4 py-4"><StatusBadge status={item.status} /></td>
                  <td className="px-4 py-4"><div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setViewElection(item)}><ListChecks className="h-4 w-4" />View</Button>{["draft", "scheduled", "live"].includes(item.status) ? <Button variant="secondary" onClick={() => openEditElection(item)}><Pencil className="h-4 w-4" />Edit</Button> : null}{["draft", "scheduled"].includes(item.status) ? <Button onClick={() => setConfirm({ action: "start", item, title: "Start voting now?", description: "This opens voting immediately and freezes the eligible voter list." })}><Play className="h-4 w-4" />Start</Button> : null}{item.status === "live" ? <Button variant="danger" onClick={() => setConfirm({ action: "close", item, title: "Close voting now?", description: "Residents will no longer be able to cast votes. You can finalize results afterward." })}><StopCircle className="h-4 w-4" />Close</Button> : null}{item.status === "draft" ? <Button variant="ghost" onClick={() => setConfirm({ action: "delete", item, title: "Delete this draft?", description: "This cannot be undone." })}><Trash2 className="h-4 w-4" /></Button> : null}</div></td>
                </tr>
              )}
              renderMobileCard={(item) => <Card className="p-4"><div className="flex items-start justify-between gap-3"><h3 className="font-bold text-[var(--brand-900)]">{item.title}</h3><StatusBadge status={item.status} /></div><p className="mt-2 text-xs text-stone-500">{formatDateTime(item.startsAt)} → {formatDateTime(item.endsAt)}</p><p className="mt-3 text-sm text-stone-600">{item.totalVotes ?? 0} of {item.eligibleVoters ?? 0} voted ({item.participationRate ?? 0}%)</p><div className="mt-4 flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setViewElection(item)}>View</Button>{["draft","scheduled","live"].includes(item.status) ? <Button variant="secondary" onClick={() => openEditElection(item)}>Edit</Button> : null}{["draft","scheduled"].includes(item.status) ? <Button onClick={() => setConfirm({ action: "start", item, title: "Start voting now?", description: "This opens voting immediately." })}>Start</Button> : null}{item.status === "live" ? <Button variant="danger" onClick={() => setConfirm({ action: "close", item, title: "Close voting now?", description: "Voting will stop immediately." })}>Close</Button> : null}</div></Card>}
            />
          )}
          <Pagination page={electionPage} totalPages={electionTotalPages} onPageChange={setElectionPage} />
        </Card>
      ) : null}

      {tab === "monitoring" ? (
        <div className="space-y-6">
          <Card><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><SelectInput label="Election" value={selectedMonitorId} onChange={(event) => setSelectedMonitorId(event.target.value)} className="sm:min-w-80">{monitorableElections.map((item) => <option key={item.id} value={item.id}>{item.title} — {item.status}</option>)}</SelectInput><Button variant="secondary" onClick={() => loadMonitoring()} loading={monitorLoading}><RefreshCw className="h-4 w-4" />Refresh Monitoring</Button></div></Card>
          {!selectedMonitorId ? <EmptyState title="No election to monitor" description="Start or select an election first." /> : monitorLoading && !monitoring ? <p className="text-sm text-stone-500">Loading monitoring...</p> : monitoring ? <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard icon={Users} label="Eligible Voters" value={monitoring.eligibleVoters || 0} /><StatCard icon={Vote} label="Votes Cast" value={monitoring.totalVotes || 0} /><StatCard icon={Activity} label="Participation" value={`${monitoring.participationRate || 0}%`} /><StatCard label="Not Yet Voted" value={monitoring.notVotedCount || 0} /></div>
            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <Card><h2 className="text-xl font-bold text-[var(--brand-900)]">Option Counts</h2><p className="mt-1 text-sm text-stone-500">Admin-only live counts. Residents follow the configured results visibility policy.</p><div className="mt-5 h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={monitoring.options || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="votes" fill="var(--brand-500)" radius={[6,6,0,0]} /></BarChart></ResponsiveContainer></div></Card>
              <Card><h2 className="text-xl font-bold text-[var(--brand-900)]">Participation by Purok</h2><div className="mt-5 space-y-3">{(monitoring.purokBreakdown || []).length ? monitoring.purokBreakdown.map((row) => <div key={row.purok} className="rounded-2xl border border-stone-200 p-4"><div className="flex items-center justify-between gap-3"><p className="font-semibold text-stone-800">{row.purok}</p><p className="text-sm font-bold text-[var(--brand-700)]">{row.participationRate}%</p></div><p className="mt-1 text-xs text-stone-500">{row.voted} of {row.eligible} voted</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-[var(--brand-500)]" style={{ width: `${Math.min(100, row.participationRate)}%` }} /></div></div>) : <p className="text-sm text-stone-500">Purok breakdown is unavailable until the voter roll is created.</p>}</div></Card>
            </div>
          </> : null}
        </div>
      ) : null}

      {tab === "results" ? (
        <div className="space-y-4">
          {!filteredResults.length ? <EmptyState title="No closed results yet" description="Closed and finalized elections will appear here." /> : paginatedResults.map((item) => (
            <Card key={item.id}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-bold text-[var(--brand-900)]">{item.title}</h2><StatusBadge status={item.status} /></div><p className="mt-2 text-sm text-stone-500">{item.totalVotes || 0} votes • {item.participationRate || 0}% participation</p></div><div className="flex flex-wrap gap-2">{item.status === "closed" ? <Button onClick={() => setConfirm({ action: "finalize", item, title: "Finalize these results?", description: item.isTie ? "The system detected a tie. Finalizing will record a tied result so a runoff can be created." : "This records the official winner and locks the result snapshot." })}><CheckCircle2 className="h-4 w-4" />Finalize</Button> : null}{item.status === "finalized" && item.resultStatus === "tie" ? <Button onClick={() => setConfirm({ action: "runoff", item, title: "Create runoff election?", description: "A new draft will be created containing only the tied top options." })}><RefreshCw className="h-4 w-4" />Create Runoff</Button> : null}{item.status === "finalized" && item.resultStatus === "winner" ? <Button onClick={() => setConfirm({ action: "project", item, title: "Create community project?", description: "The finalized winning option will become a trackable community project." })}><Flag className="h-4 w-4" />Create Project</Button> : null}{item.status === "finalized" ? <Button variant="secondary" onClick={() => setConfirm({ action: "archive", item, title: "Archive election?", description: "The result remains available in history." })}><Archive className="h-4 w-4" />Archive</Button> : null}</div></div>
              {item.isTie || item.resultStatus === "tie" ? <AlertBanner tone="warning" title="Tied result"><span>{(item.options || []).filter((option) => option.isTiedLeader).map((option) => option.name).join(" and ") || "Multiple options are tied."}</span></AlertBanner> : item.winner ? <AlertBanner tone="success" title={`Winner: ${item.winner.name}`}><span>{item.winner.votes} votes • {item.winner.percentage || 0}%</span></AlertBanner> : <AlertBanner tone="info" title="No winning option">No votes were recorded or the result is not finalized yet.</AlertBanner>}
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{(item.options || []).map((option) => <div key={option.id} className="rounded-2xl border border-stone-200 p-4"><div className="flex items-start justify-between gap-3"><p className="font-semibold text-stone-800">{option.name}</p>{option.isWinner ? <Trophy className="h-5 w-5 text-amber-600" /> : option.isTiedLeader ? <CircleAlert className="h-5 w-5 text-amber-600" /> : null}</div><p className="mt-2 text-sm text-stone-500">{option.votes || 0} votes • {option.percentage || 0}%</p></div>)}</div>
            </Card>
          ))}
          <Pagination page={resultPage} totalPages={resultTotalPages} onPageChange={setResultPage} />
        </div>
      ) : null}

      {tab === "projects" ? (
        <div className="space-y-4">
          {!filteredProjects.length ? <EmptyState title="No community projects yet" description="Finalize a winning election and choose Create Project from Results." /> : paginatedProjects.map((project) => (
            <Card key={project.id}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-bold text-[var(--brand-900)]">{project.title}</h2><StatusBadge status={project.status} /></div><p className="mt-2 max-w-3xl text-sm text-stone-600">{project.description}</p><p className="mt-2 text-xs text-stone-500">{project.location || project.purok ? [project.location, project.purok].filter(Boolean).join(" • ") : "Location not set"} • {project.confirmation_count || 0} resident completion confirmation(s)</p></div><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => openProjectEdit(project)}><Pencil className="h-4 w-4" />Manage</Button><Button onClick={() => { setUpdateProject(project); setUpdateForm({ title: "", description: "", progressPercentage: project.progress_percentage ?? "", image: null }); }}><Plus className="h-4 w-4" />Post Update</Button></div></div>
              <div className="mt-5"><div className="flex items-center justify-between text-xs font-semibold text-stone-500"><span>Project Progress</span><span>{project.progress_percentage || 0}%</span></div><div className="mt-2 h-3 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-[var(--brand-500)]" style={{ width: `${Math.min(100, project.progress_percentage || 0)}%` }} /></div></div>
              {(project.project_updates || []).length ? <div className="mt-5 grid gap-3 md:grid-cols-2">{project.project_updates.slice(0,4).map((update) => <div key={update.id} className="rounded-2xl bg-stone-50 p-4">{update.image_url ? <img src={update.image_url} alt={update.title} className="mb-3 h-32 w-full rounded-xl object-cover" /> : null}<p className="font-semibold text-stone-800">{update.title}</p><p className="mt-1 text-sm text-stone-600">{update.description}</p><p className="mt-2 text-xs text-stone-400">{formatDateTime(update.created_at)}</p></div>)}</div> : null}
            </Card>
          ))}
          <Pagination page={projectPage} totalPages={projectTotalPages} onPageChange={setProjectPage} />
        </div>
      ) : null}

      {tab === "audit" ? (
        <Card>
          <div className="mb-5 flex items-center gap-3"><FileClock className="h-5 w-5 text-[var(--brand-600)]" /><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Voting Audit</h2><p className="text-sm text-stone-500">Participation is logged without exposing which option a resident selected.</p></div></div>
          {!filteredLogs.length ? <EmptyState title="No voting audit activity" description="Voting and project actions will appear here." /> : <div className="divide-y divide-stone-100 rounded-2xl border border-stone-200">{paginatedLogs.map((log) => <div key={log.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1.3fr_1fr_auto]"><div><p className="font-semibold capitalize text-stone-800">{log.action?.replaceAll("_", " ")}</p><p className="text-xs text-stone-500">{log.entity_type} • {String(log.entity_id || "").slice(0, 18)}</p></div><p className="text-sm text-stone-500">{log.actor_role || "system"}</p><p className="text-xs text-stone-400">{formatDateTime(log.created_at)}</p></div>)}</div>}
          <Pagination page={auditPage} totalPages={auditTotalPages} onPageChange={setAuditPage} />
        </Card>
      ) : null}

      <Modal
        open={Boolean(viewElection)}
        onClose={() => setViewElection(null)}
        title="Election Details"
        description={viewElection?.title || ""}
        widthClass="max-w-4xl"
      >
        {viewElection ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl bg-stone-50 p-4"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Status</p><div className="mt-2"><StatusBadge status={viewElection.status} /></div></div>
              <div className="rounded-2xl bg-stone-50 p-4"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Votes Cast</p><p className="mt-2 text-xl font-bold text-[var(--brand-900)]">{viewElection.totalVotes ?? 0}</p></div>
              <div className="rounded-2xl bg-stone-50 p-4"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Eligible</p><p className="mt-2 text-xl font-bold text-[var(--brand-900)]">{viewElection.eligibleVoters ?? 0}</p></div>
              <div className="rounded-2xl bg-stone-50 p-4"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Participation</p><p className="mt-2 text-xl font-bold text-[var(--brand-900)]">{viewElection.participationRate ?? 0}%</p></div>
            </div>
            <div className="rounded-2xl border border-stone-200 p-4">
              <p className="text-sm leading-6 text-stone-600">{viewElection.description || "No election description."}</p>
              <div className="mt-4 grid gap-2 text-sm text-stone-500 sm:grid-cols-2">
                <p><span className="font-semibold text-stone-700">Opens:</span> {formatDateTime(viewElection.startsAt)}</p>
                <p><span className="font-semibold text-stone-700">Closes:</span> {formatDateTime(viewElection.endsAt)}</p>
                <p><span className="font-semibold text-stone-700">Results visibility:</span> {String(viewElection.resultsVisibility || "after_close").replaceAll("_", " ")}</p>
                <p><span className="font-semibold text-stone-700">Result:</span> {String(viewElection.resultStatus || "pending").replaceAll("_", " ")}</p>
              </div>
            </div>
            <div>
              <h3 className="font-bold text-[var(--brand-900)]">Voting Options</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {(viewElection.options || []).map((option) => (
                  <div key={option.id} className="rounded-2xl border border-stone-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-stone-800">{option.name}</p>
                        <p className="mt-1 text-sm text-stone-500">{option.description || "No description."}</p>
                      </div>
                      {option.isWinner ? <Trophy className="h-5 w-5 shrink-0 text-amber-600" /> : option.isTiedLeader ? <CircleAlert className="h-5 w-5 shrink-0 text-amber-600" /> : null}
                    </div>
                    <p className="mt-3 text-sm font-semibold text-[var(--brand-700)]">{option.votes ?? 0} votes • {option.percentage ?? 0}%</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              {["draft", "scheduled", "live"].includes(viewElection.status) ? <Button variant="secondary" onClick={() => { const item = viewElection; setViewElection(null); openEditElection(item); }}><Pencil className="h-4 w-4" />Edit Election</Button> : null}
              {["closed", "finalized", "archived"].includes(viewElection.status) ? <Button variant="secondary" onClick={() => { setViewElection(null); setTab("results"); }}>Open Results</Button> : null}
              <Button variant="ghost" onClick={() => setViewElection(null)}>Close</Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={Boolean(reviewItem)} onClose={() => setReviewItem(null)} title="Review Project Suggestion" description={reviewItem?.title || ""} widthClass="max-w-2xl">
        {reviewItem ? <div className="space-y-5"><div className="rounded-2xl bg-stone-50 p-4"><p className="text-sm text-stone-600">{reviewItem.description}</p></div><SelectInput label="Review Status" value={reviewForm.status} onChange={(event) => setReviewForm((current) => ({ ...current, status: event.target.value }))}><option value="under_review">Under Review</option><option value="needs_revision">Needs Revision</option><option value="approved">Approved</option><option value="rejected">Rejected</option></SelectInput><TextArea label="Resident Feedback" value={reviewForm.adminFeedback} onChange={(event) => setReviewForm((current) => ({ ...current, adminFeedback: event.target.value }))} placeholder="Required for Needs Revision or Rejected. Explain the decision clearly." /><div className="flex gap-3"><Button onClick={saveReview} loading={saving}>Save Review</Button><Button variant="ghost" onClick={() => setReviewItem(null)}>Cancel</Button></div></div> : null}
      </Modal>

      <Modal open={builderOpen} onClose={() => setBuilderOpen(false)} title={draftElection.id ? "Edit Election" : "Create Election"} description="Draft an election, select approved suggestions, and schedule it. Multiple elections may run at the same time; each election keeps its own eligible-voter snapshot and one-vote-per-resident rule." widthClass="max-w-5xl">
        <form className="space-y-6" onSubmit={saveElection}>
          <div className="grid gap-4 sm:grid-cols-2"><TextInput label="Election Title" value={draftElection.title} onChange={(event) => setDraftElection((current) => ({ ...current, title: event.target.value }))} className="sm:col-span-2" /><TextArea label="Description" value={draftElection.description} onChange={(event) => setDraftElection((current) => ({ ...current, description: event.target.value }))} className="sm:col-span-2" /><SelectInput label="Status" value={draftElection.status} onChange={(event) => setDraftElection((current) => ({ ...current, status: event.target.value }))}><option value="draft">Draft</option><option value="scheduled">Scheduled</option>{draftElection.status === "live" ? <option value="live">Live</option> : null}<option value="cancelled">Cancelled</option></SelectInput><SelectInput label="Resident Results Visibility" value={draftElection.resultsVisibility} onChange={(event) => setDraftElection((current) => ({ ...current, resultsVisibility: event.target.value }))}><option value="after_close">After Voting Closes</option><option value="after_vote">After Resident Votes</option><option value="live">Live Results</option></SelectInput><TextInput label="Opens" type="datetime-local" value={draftElection.startsAt} onChange={(event) => setDraftElection((current) => ({ ...current, startsAt: event.target.value }))} /><TextInput label="Closes" type="datetime-local" value={draftElection.endsAt} onChange={(event) => setDraftElection((current) => ({ ...current, endsAt: event.target.value }))} /></div>
          <label className="block rounded-2xl border border-dashed border-stone-300 p-4 text-sm font-medium text-stone-700"><span>Election Cover Image (optional)</span><input type="file" accept="image/*" className="mt-3 block w-full text-sm" onChange={(event) => { const file = event.target.files?.[0] || null; setDraftElection((current) => ({ ...current, image: file, preview: file ? URL.createObjectURL(file) : current.imageUrl })); }} />{draftElection.preview ? <div className="relative mt-4 overflow-hidden rounded-2xl"><img src={draftElection.preview} alt="Election preview" className="h-48 w-full object-cover" /><button type="button" onClick={() => setDraftElection((current) => ({ ...current, image: null, preview: "", imageUrl: "" }))} className="absolute right-3 top-3 rounded-full bg-white p-2"><X className="h-4 w-4" /></button></div> : <div className="mt-3 flex items-center gap-2 text-stone-500"><ImagePlus className="h-4 w-4" />No image selected</div>}</label>
          <div><div className="mb-3"><h3 className="font-bold text-[var(--brand-900)]">Voting Options from Approved Suggestions</h3><p className="text-sm text-stone-500">Options are locked after the first vote is recorded.</p></div>{!approvedSuggestions.length ? <AlertBanner tone="warning" title="No approved suggestions">Approve resident project suggestions before scheduling this election.</AlertBanner> : <div className="grid gap-3 md:grid-cols-2">{approvedSuggestions.map((suggestion) => { const selected = selectedSuggestionIds.includes(suggestion.id); return <button key={suggestion.id} type="button" onClick={() => toggleSuggestion(suggestion)} className={`rounded-2xl border p-4 text-left transition ${selected ? "border-[var(--brand-500)] bg-[var(--brand-50)]" : "border-stone-200 hover:border-[var(--brand-200)]"}`}><div className="flex items-start gap-3">{selected ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--brand-600)]" /> : <Square className="mt-0.5 h-5 w-5 shrink-0 text-stone-400" />}<div><p className="font-semibold text-stone-800">{suggestion.title}</p><p className="mt-1 text-xs text-stone-500">{suggestion.description}</p></div></div></button>; })}</div>}</div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row"><Button type="button" variant="ghost" onClick={() => setBuilderOpen(false)}>Cancel</Button><Button type="submit" loading={saving}>{draftElection.status === "scheduled" ? "Schedule Voting" : draftElection.status === "live" ? "Save Live Election" : "Save Election"}</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(projectEdit)} onClose={() => setProjectEdit(null)} title="Manage Community Project" description={projectEdit?.title || ""} widthClass="max-w-3xl">
        {projectEdit ? <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><SelectInput label="Status" value={projectForm.status} onChange={(event) => setProjectForm((current) => ({ ...current, status: event.target.value }))}><option value="planned">Planned</option><option value="preparation">Preparation</option><option value="in_progress">In Progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></SelectInput><TextInput label="Progress %" type="number" min="0" max="100" value={projectForm.progressPercentage} onChange={(event) => setProjectForm((current) => ({ ...current, progressPercentage: event.target.value }))} /><TextInput label="Location" value={projectForm.location} onChange={(event) => setProjectForm((current) => ({ ...current, location: event.target.value }))} /><SelectInput label="Purok" value={projectForm.purok} onChange={(event) => setProjectForm((current) => ({ ...current, purok: event.target.value }))}>
  <option value="">Barangay-wide / Not set</option>
  {["Purok 1", "Purok 2", "Purok 3", "Purok 4", "Purok 5", "Purok 6"].map((purok) => <option key={purok} value={purok}>{purok}</option>)}
</SelectInput><TextInput label="Planned Start" type="date" value={projectForm.plannedStartDate} onChange={(event) => setProjectForm((current) => ({ ...current, plannedStartDate: event.target.value }))} /><TextInput label="Target Completion" type="date" value={projectForm.targetCompletionDate} onChange={(event) => setProjectForm((current) => ({ ...current, targetCompletionDate: event.target.value }))} /><TextInput label="Allocated Budget" type="number" min="0" value={projectForm.allocatedBudget} onChange={(event) => setProjectForm((current) => ({ ...current, allocatedBudget: event.target.value }))} /><TextInput label="Actual Cost" type="number" min="0" value={projectForm.actualCost} onChange={(event) => setProjectForm((current) => ({ ...current, actualCost: event.target.value }))} /></div><TextArea label="Project Description" value={projectForm.description} onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))} /><div className="flex gap-3"><Button onClick={saveProject} loading={saving}>Save Project</Button><Button variant="ghost" onClick={() => setProjectEdit(null)}>Cancel</Button></div></div> : null}
      </Modal>

      <Modal open={Boolean(updateProject)} onClose={() => setUpdateProject(null)} title="Post Project Update" description={updateProject?.title || ""} widthClass="max-w-2xl">
        {updateProject ? <div className="space-y-4"><TextInput label="Update Title" value={updateForm.title} onChange={(event) => setUpdateForm((current) => ({ ...current, title: event.target.value }))} placeholder="Example: Drainage excavation completed" /><TextArea label="Update Details" value={updateForm.description} onChange={(event) => setUpdateForm((current) => ({ ...current, description: event.target.value }))} /><TextInput label="Progress %" type="number" min="0" max="100" value={updateForm.progressPercentage} onChange={(event) => setUpdateForm((current) => ({ ...current, progressPercentage: event.target.value }))} /><label className="block text-sm font-medium text-stone-700">Photo (optional)<input type="file" accept="image/*" className="mt-2 block w-full text-sm" onChange={(event) => setUpdateForm((current) => ({ ...current, image: event.target.files?.[0] || null }))} /></label><div className="flex gap-3"><Button onClick={saveProjectUpdate} loading={saving}>Post Update</Button><Button variant="ghost" onClick={() => setUpdateProject(null)}>Cancel</Button></div></div> : null}
      </Modal>

      <ConfirmDialog open={Boolean(confirm)} onClose={() => setConfirm(null)} onConfirm={() => runAction(confirm?.action, confirm?.item)} title={confirm?.title || "Confirm action"} description={confirm?.description || ""} confirmLabel={{ start: "Start Voting", close: "Close Voting", delete: "Delete Draft", finalize: "Finalize Results", runoff: "Create Runoff", project: "Create Project", archive: "Archive" }[confirm?.action] || "Confirm"} danger={["close","delete"].includes(confirm?.action)} loading={saving} />
    </div>
  );
};

export default Admin_VotingResult;
