import { useReviewAction } from "../../components/ActionReviewProvider";
import { Clock3, Send } from "lucide-react";
import HotlineContacts from "../../components/HotlineContacts";
import CaseHistory from "../../components/CaseHistory";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, Pagination, SegmentedTabs, SelectInput, TextArea, TextInput } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useMasterData } from "../../hooks/useMasterData";
import { getStatusMeta } from "../../lib/status";

const INITIAL_FORM = { complaint_type: "", details: "",incidentPurok:"",incidentLocation:"",incidentAt:"",respondentName:"" };
const pageSize = 6;
const formatPhilippineDateTime = (value) => value ? new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
}).format(new Date(value)) : "Not set";

const Complaints = () => {
  const { token, refreshNotifications } = useAuth();
  const reviewAction = useReviewAction();
  const toast = useToast();
  const [form, setForm] = useState(INITIAL_FORM);
  const [incidentPhoto,setIncidentPhoto] = useState(null);
  const [complaints, setComplaints] = useState([]);
  const [hotlines, setHotlines] = useState([]);
  const [eligibility, setEligibility] = useState(null);
  const [eligibilityError, setEligibilityError] = useState("");
  const operationIdRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState("mine");
  const [success, setSuccess] = useState(null);
  const [page, setPage] = useState(1);
  const { options: concernOptions } = useMasterData("concern_category");

  const loadEligibility = async () => {
    try {
      const data = await api("/complaints/eligibility", { token });
      setEligibility(data);
      setEligibilityError("");
    } catch (problem) {
      setEligibility(null);
      setEligibilityError(problem.message || "Unable to check your submission allowance.");
    }
  };

  const updateForm = (updates) => {
    operationIdRef.current = null;
    setForm((previous) => ({ ...previous, ...updates }));
  };

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [mine, support] = await Promise.all([api("/complaints/mine", { token }), api("/public/community-support")]);
      await loadEligibility();
      setComplaints(mine.complaints || []);
      setHotlines(support.hotlines || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (token) load(); }, [token]);

  const quotaBlocked = Boolean(eligibility?.enabled && !eligibility.allowed);
  const windowBlocked = eligibility?.blockedReasons?.includes("CONCERN_WINDOW_LIMIT_REACHED");
  const openBlocked = eligibility?.blockedReasons?.includes("CONCERN_OPEN_LIMIT_REACHED");

  const visibleComplaints = useMemo(() => complaints.slice((page - 1) * pageSize, page * pageSize), [complaints, page]);

  const submitComplaint = async (event) => {
    event.preventDefault();
    if (!form.complaint_type.trim() || form.details.trim().length < 10) return toast.error("Select a concern type and enter at least 10 characters.");
    if(incidentPhoto && (incidentPhoto.size>5*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(incidentPhoto.type))) return toast.error('Upload a JPG, PNG or WebP photo under 5 MB.');
    if (!eligibility || !eligibility.allowed) return toast.error("Unable to submit right now. Review your allowance or reload to check your eligibility.");
    if (!await reviewAction({ title: "Submit Community Concern?", description: "Your concern will be sent to the barangay for review.", after: { category: form.complaint_type, details: form.details, incidentPhoto:incidentPhoto?.name||null }, confirmLabel: "Submit Concern" })) return;
    setSubmitting(true);
    try {
      if (!operationIdRef.current) operationIdRef.current = crypto.randomUUID();
      const data = await api("/complaints", { method: "POST", token, body: { ...form, operationId: operationIdRef.current } });
      operationIdRef.current = null;
      if(incidentPhoto){
        try{
          const body=new FormData();body.append('image',incidentPhoto);
          await api(`/complaints/${data.complaint.id}/evidence`,{method:'POST',token,body});
        }catch(uploadError){toast.error(`Your concern was submitted, but the photo could not be attached: ${uploadError.message}`);}
      }
      setIncidentPhoto(null);
      setSuccess(data.complaint || true);
      setForm(INITIAL_FORM);
      setActiveTab("mine");
      await Promise.all([load(), refreshNotifications()]);
    } catch (err) {
      toast.error(err.message);
      await loadEligibility();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Resident Services" title="Community concerns" description="Report non-emergency community issues to barangay staff and follow the response until the concern is resolved." actions={<Button type="button" onClick={() => { setActiveTab("report"); loadEligibility(); }}><Send className="h-4 w-4" /> Report Concern</Button>} />

      {hotlines.length ? <Alert tone="danger" title="Need immediate barangay assistance?">
        <p>For urgent matters, call the barangay directly instead of submitting a normal concern and waiting for review.</p>
        <HotlineContacts hotlines={hotlines} />
      </Alert> : null}

      {success ? <Alert tone="success" title="Concern submitted"><p>Your report is now in the barangay review queue. Status updates and barangay responses will appear in My Concerns and Notifications.</p>{success?.id ? <p className="mt-1 text-xs font-semibold">Reference: {success.id}</p> : null}</Alert> : null}

      {eligibility?.enabled ? <Card className="bg-emerald-50/40">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold text-[var(--brand-900)]">Your Concern Submission Allowance</h2><Badge tone={quotaBlocked ? "danger" : "success"}>{quotaBlocked ? "Limit reached" : "Eligible"}</Badge></div>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <p><strong>{eligibility.rollingPeriod.remaining} remaining</strong> out of {eligibility.rollingPeriod.maximum} in the preceding {eligibility.rollingPeriod.days} day(s)</p>
          {eligibility.unresolved.enabled ? <p><strong>{eligibility.unresolved.used} unresolved</strong> out of {eligibility.unresolved.maximum} allowed</p> : null}
        </div>
        {quotaBlocked ? <p className="mt-3 text-sm font-medium text-rose-700" role="alert">{windowBlocked ? "You've reached your rolling submission limit. " : ""}{openBlocked ? "You have the maximum number of unresolved concerns. " : ""}{windowBlocked && eligibility.nextAvailableAt ? `Your rolling allowance may renew after ${formatPhilippineDateTime(eligibility.nextAvailableAt)} (if other limits also allow it).` : ""} You can still track concerns and call the barangay hotlines above.</p> : null}
      </Card> : eligibilityError ? <Alert tone="danger" title="Submission allowance unavailable">{eligibilityError} You may still view existing concerns. <Button type="button" variant="secondary" onClick={loadEligibility}>Retry Check</Button></Alert> : null}

      <SegmentedTabs value={activeTab} onChange={(value) => { setSuccess(null); setActiveTab(value); if (value === "report") loadEligibility(); }} items={[{ value: "mine", label: "My Concerns", count: complaints.length }, { value: "report", label: "Report Concern" }]} />

      {activeTab === "report" ? (
        <div className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
          <Card className="bg-gradient-to-br from-white to-[var(--brand-50)]">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand-500)]">Before submitting</p>
            <h2 className="mt-2 text-2xl font-black text-[var(--brand-900)]">Help staff understand the issue quickly</h2>
            <div className="mt-5 space-y-3 text-sm leading-6 text-stone-600">
              <div className="rounded-2xl bg-white p-4"><strong className="text-stone-800">Choose the correct category.</strong><br />This helps the barangay route the concern to the right team.</div>
              <div className="rounded-2xl bg-white p-4"><strong className="text-stone-800">Include the exact location.</strong><br />Add street, landmark or purok details inside the description.</div>
              <div className="rounded-2xl bg-white p-4"><strong className="text-stone-800">Do not duplicate reports.</strong><br />Track an existing concern from My Concerns instead.</div>
            </div>
          </Card>
          <Card>
            <h2 className="text-xl font-bold text-[var(--brand-900)]">Concern details</h2>
            <p className="mt-1 text-sm text-stone-500">Your report will be visible to authorized barangay staff.</p>
            <form className="mt-6 space-y-5" onSubmit={submitComplaint}>
              <SelectInput label="Concern Type" required value={form.complaint_type} onChange={(event) => updateForm({ complaint_type: event.target.value })}><option value="">Select a concern</option>{concernOptions.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</SelectInput>
              <TextInput label="Incident Purok (optional)" maxLength={100} value={form.incidentPurok} onChange={e=>updateForm({incidentPurok:e.target.value})}/>
              <TextInput label="Exact Location / Landmark" maxLength={250} value={form.incidentLocation} onChange={e=>updateForm({incidentLocation:e.target.value})}/>
              <TextInput label="Incident Date & Time (if known)" type="datetime-local" value={form.incidentAt} onChange={e=>updateForm({incidentAt:e.target.value})}/>
              <TextInput label="Person involved (optional)" maxLength={180} value={form.respondentName} onChange={e=>updateForm({respondentName:e.target.value})}/>
              <label className="block text-sm font-semibold text-stone-700">Optional incident photo (JPG, PNG or WebP, max 5 MB)
                <input type="file" accept="image/jpeg,image/png,image/webp" className="mt-2 block w-full text-sm" onChange={e=>setIncidentPhoto(e.target.files?.[0]||null)}/>
              </label>
              <TextArea label="Details" required minLength={10} maxLength={1500} hint="Include the exact location and enough context for barangay staff to understand what happened." value={form.details} onChange={(event) => updateForm({ details: event.target.value })} placeholder="Describe the location, issue, and any useful details..." />
              {(!eligibility || quotaBlocked) ? <p className="text-sm text-rose-700" role="status">{quotaBlocked ? "New concern submissions are temporarily limited. Your existing concerns remain accessible." : "Checking your submission allowance. Please wait or retry the check above."}</p> : null}
              <Button type="submit" loading={submitting} disabled={!eligibility || quotaBlocked}><Send className="h-4 w-4" /> Submit Concern</Button>
            </form>
          </Card>
        </div>
      ) : (
        <div className="space-y-4">
          {loading ? <LoadingState rows={3} /> : error ? <ErrorState description={error} onRetry={load} /> : complaints.length === 0 ? <EmptyState title="No concerns submitted" description="If you notice a non-emergency issue in the community, submit a report and track the barangay response here." action={<Button type="button" onClick={() => { setActiveTab("report"); loadEligibility(); }}>Report a Concern</Button>} /> : visibleComplaints.map((complaint) => {
            const meta = getStatusMeta(complaint.status || "pending", "complaint");
            return (
              <Card key={complaint.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div><h3 className="text-lg font-bold text-[var(--brand-900)]">{complaint.complaint_type}</h3><p className="mt-1 flex items-center gap-1 text-xs text-stone-500"><Clock3 className="h-3.5 w-3.5" /> Submitted {formatDateTime(complaint.created_at)}</p></div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>
                <p className="mt-4 text-sm leading-7 text-stone-700">{complaint.details}</p>
                <CaseHistory events={complaint.case_history} />
              </Card>
            );
          })}
          {!loading && !error ? <Pagination page={page} totalPages={Math.max(1, Math.ceil(complaints.length / pageSize))} onPageChange={setPage} /> : null}
        </div>
      )}
    </div>
  );
};

export default Complaints;

