import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, FileText, PackageCheck, UserRoundCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { downloadWord } from "../lib/documents";
import { useAuth } from "../context/auth";
import { useReviewAction } from "../hooks/useActionReview";
import { useToast } from "../context/toast";
import ResidentPhoto, { PrivateImage } from "./ResidentPhoto";
import WordPreview from "./WordPreview";
import CaseHistory from "./CaseHistory";
import { Alert, Badge, Button, Card, ErrorState, LoadingState, SelectInput, TextArea, TextInput } from "./ui";
import { getStatusMeta } from "../lib/status";
import { formatDateTime } from "../lib/format";
import { requestStage, requestFieldRows, approvalBlockers, staffEmailItems, preferredWordFile } from "../lib/documentProcessing";


const editableStatuses = ["submitted", "under_review", "acknowledged", "processing", "needs_revision"];
const checkDefinitions = (type) => [
  ["identityVerified", "I checked this resident's identity."],
  ["residencyVerified", "I checked that the resident lives in Barangay Iba."],
  ...(type === "Barangay Clearance" ? [["backgroundVerified", "I completed the required background verification."]] : []),
  ...(type === "Certificate of Indigency" ? [["indigencyVerified", "I verified the indigency information."]] : []),
  ...(type === "Barangay Business Clearance" ? [["businessVerified", "I verified the business details."]] : []),
];
const primaryClass = "rounded-2xl border p-4 text-left transition focus-visible:outline-2 focus-visible:outline-green-700";

export default function DocumentRequestDetail({ id, onChanged }) {
  const { token, user } = useAuth();
  const review = useReviewAction();
  const toast = useToast();
  const lock = useRef(false);
  const [data, setData] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [stage, setStage] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resolution, setResolution] = useState("");
  const [note, setNote] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [issueDate, setIssueDate] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date()));
  const [checks, setChecks] = useState({});
  const [photoId, setPhotoId] = useState("");
  const [preview, setPreview] = useState(null);
  const [revised, setRevised] = useState(null);
  const [selectedFile, setSelectedFile] = useState("");
  const [reviewedWord, setReviewedWord] = useState(false);
  const [physicalCopyReady, setPhysicalCopyReady] = useState(false);
  const [profileEdit, setProfileEdit] = useState(null);

  const load = useCallback(async () => {
    const [detail, versions] = await Promise.all([
      api(`/documents/requests/${id}`, { token }),
      api("/documents/templates", { token }),
    ]);
    setData(detail);
    setTemplates(versions.templates || []);
    setStage(requestStage(detail.request.status));
    return detail;
  }, [id, token]);

  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);
  const act = async (title, operation, options = {}) => {
    if (lock.current) return;
    lock.current = true;
    try {
      if (options.confirm !== false && !(await review({
        title, description: options.description || "Check the details before continuing. The request history will be updated.",
        subject: data?.request?.request_type, confirmLabel: options.confirmLabel || "Confirm",
      }))) return;
      setBusy(true);
      setError("");
      await operation();
      await load();
      await onChanged?.();
    } catch (e) {
      setError(e.message || "This action could not be completed. Please retry.");
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };
  if (!data) return error ? <ErrorState description={error} onRetry={() => load().catch((e) => setError(e.message))} /> : <LoadingState rows={5} />;
  const r = data.request;
  const resident = data.resident;
  const files = data.files || [];
  const meta = getStatusMeta(r.status);
  const approvedTemplates = templates.filter((t) => t.document_type === r.request_type && t.approval_state === "approved")
    .sort((a, b) => b.version - a.version);
  // Pick the most recent approved template unless the reviewer explicitly chose another.
  const activeTemplateId = approvedTemplates.some((t) => t.id === templateId)
    ? templateId : (approvedTemplates[0]?.id || "");
  const checksNeeded = checkDefinitions(r.request_type);
  const photoRequired = ["Barangay Identification Card", "Certificate of Indigency", "Barangay Clearance"].includes(r.request_type);
  const hasRequiredPhoto = !photoRequired || resident.hasPhoto || Boolean(photoId);
  const blockers = approvalBlockers({
    documentType: r.request_type, photoRequired, hasPhoto: hasRequiredPhoto,
    requiredChecks: checksNeeded,
    checks: { ...checks, residencyDateVerified: Boolean(resident.residency_since) },
    approvedTemplates, templateId: activeTemplateId, issueDate,
  });
  const canApprove = blockers.length === 0;
  const activeWordFile = preferredWordFile(files, selectedFile);
  const activeFileId = activeWordFile?.id || "";
  const activePreview = preview?.id === activeFileId ? preview : activeWordFile;
  const emailItems = staffEmailItems(data.emailQueue || [], data.notificationLogs || []);
  const latestEmail = emailItems[0] || null;

  const transition = async (status, adminNote = "", extra = {}) => {
    return api(`/documents/requests/${id}/transition`, {
      method: "PATCH", token,
      body: { status, adminNote, expectedVersion: r.lock_version, operationId: crypto.randomUUID(), ...extra },
    });
  };
  const approve = () => act("Approve this request and create a Word draft?", async () => {
    if (!canApprove) throw new Error("Complete the missing verification items listed below.");
    const result = await transition("approved", "", { templateId: activeTemplateId, issueDate, reviewChecks: checks, photoAttachmentId: photoId });
    setResolution("");
    try {
      await api(`/documents/requests/${id}/generate`, { method: "POST", token, body: {
        expectedVersion: result.request.lock_version, operationId: crypto.randomUUID(), finalize: false,
      }});
      toast.success("Approved. A Word draft was created for review.");
    } catch (e) {
      // Approval has already committed. Show a recoverable action in stage 2.
      setError(`The request was approved, but its Word draft could not be created: ${e.message}. Use Create Word draft to retry.`);
    }
  }, { confirmLabel: "Approve request" });
  const saveWord = (mode, finalize = false) => act(
    finalize ? "Confirm this document has been reviewed and prepared?" : mode === "upload" ? "Upload this revised Word file?" : "Create a Word draft?",
    async () => {
      const operationId = crypto.randomUUID();
      let path = `/documents/requests/${id}/generate`;
      let body = { expectedVersion: r.lock_version, operationId, finalize,
        confirmReviewed: finalize, sourceDocumentId: finalize ? activeFileId : undefined };
      if (mode === "upload") {
        if (!revised) throw new Error("Choose a .docx document first.");
        const form = new FormData();
        form.append("document", revised);
        form.append("expectedVersion", r.lock_version);
        form.append("operationId", operationId);
        body = form;
        path = `/documents/requests/${id}/word`;
      }
      await api(path, { method: "POST", token, body });
      setRevised(null);
      setSelectedFile("");
      setReviewedWord(false);
      setPreview(null);
      toast.success(finalize ? "Document prepared. You can now mark it ready for pickup." : "Word version saved.");
    },
  );
  const saveProfile = () => act("Save this resident's verified information?", async () => {
    await api(`/documents/residents/${r.user_id}/profile`, {
      method: "PATCH", token, body: { ...profileEdit, expectedUpdatedAt: resident.updated_at },
    });
    setProfileEdit(null);
  });
  const nextAction = async (next, reason = "") => act(
    next === "needs_revision" ? "Ask the resident to correct their application?" :
    next === "rejected" ? "Reject this application?" : next === "claimed" ? "Confirm the resident collected the document?" :
    next === "ready_for_pickup" ? "Confirm the signed document is ready for pickup?" : "Start checking this request?",
    async () => {
      await transition(next, reason);
      setNote(""); setResolution("");
      if (next === "ready_for_pickup") setPhysicalCopyReady(false);
      toast.success(next === "ready_for_pickup" ? "Ready for pickup. The system will send the resident an email if an address is available." :
        next === "claimed" ? "Collection recorded." : "Request updated. The system will try to notify the resident by email.");
    },
    { confirm: next !== "under_review" || !["submitted", "acknowledged", "processing"].includes(r.status) },
  );

  return <div className="space-y-6 pb-8 text-base">
    {error ? <Alert tone="danger" title="Action needs attention">{error}</Alert> : null}
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-[var(--brand-900)] sm:text-3xl">{r.request_type}</h1>
        <p className="break-all text-sm text-stone-500">Request #{r.control_number || id}</p>
        <p className="text-base">For: <strong>{resident.full_name}</strong></p>
      </div>
      <Badge tone={meta.tone}>{meta.label}</Badge>
    </header>

    {latestEmail && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4" role="status">
      <p className="text-sm"><strong>Latest resident email:</strong> {latestEmail.type.replaceAll("_", " ")} — {latestEmail.status}. {!resident.email ? "The resident has no email address on file; updates remain visible in their portal." : ""}</p>
      {latestEmail.failed && <Button variant="secondary" disabled={busy} onClick={() => act("Retry this failed email", async () => {
        await api(latestEmail.kind === "queue" ? `/documents/email-queue/${latestEmail.id}/retry` : `/documents/notifications/${latestEmail.id}/retry`, { method: "POST", token });
      }, { confirm: false })}>Retry email</Button>}
    </div>}
    <nav aria-label="Processing steps" className="grid gap-2 sm:grid-cols-3">
      {[[1, "Review request", UserRoundCheck], [2, "Prepare document", FileText], [3, "Release document", PackageCheck]].map(([num, label, Icon]) => {
        const currentStage = requestStage(r.status);
        const unlocked = num <= currentStage;
        return <button key={num} type="button" disabled={!unlocked || busy} onClick={() => setStage(num)}
          aria-current={stage === num ? "step" : undefined}
          className={`${primaryClass} flex items-center gap-3 ${stage === num ? "border-green-700 bg-green-50" : "border-stone-200 bg-white"} ${!unlocked ? "opacity-50" : "hover:border-green-600"}`}>
          {num < currentStage ? <CheckCircle2 className="h-6 w-6 text-green-700" /> : <Icon className="h-6 w-6 text-green-700" />}
          <div><p className="text-xs text-stone-500">Step {num}</p><p className="font-bold">{label}</p></div>
        </button>;
      })}
    </nav>

    {stage === 1 ? <section aria-label="Review request" className="space-y-5">
      <p className="text-stone-600">Check the resident's details and application before making a decision.</p>
      <Card className="space-y-4">
        <h2 className="text-xl font-bold">Application details</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          {[...requestFieldRows(r, resident), ["Submitted", formatDateTime(r.created_at)]].map(([label, value]) => <div key={label} className="rounded-xl bg-stone-50 p-3"><dt className="text-sm text-stone-500">{label}</dt><dd className="mt-1 break-words font-semibold">{value}</dd></div>)}
        </dl>
        {r.request_type === "Barangay Clearance" && <p className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm">Barangay Clearance does not require extra applicant fields. Verify identity, residency and the applicable clearance checks below.</p>}
      </Card>
      <details id="resident-documents" className="rounded-2xl border bg-white p-5" open={(photoRequired && !hasRequiredPhoto) || (r.request_type === "Certificate of Residency" && !resident.residency_since)}>
        <summary className="cursor-pointer text-lg font-semibold">Resident photo, supporting files and profile corrections</summary>
        <div className="mt-4 space-y-4">
          {photoRequired && !hasRequiredPhoto && <Alert title="Resident photo needed">Upload a clear resident photo or select a photo already attached to this request before approving.</Alert>}
          <ResidentPhoto residentId={r.user_id} onChanged={load} />
          {data.attachments?.length ? <div className="grid gap-3 sm:grid-cols-3">{data.attachments.map((a) => <div key={a.id} className="rounded-xl border p-3"><PrivateImage path={`/attachments/${a.id}`} /><p className="text-sm">{a.kind}</p></div>)}</div> : <p className="text-sm text-stone-500">No supporting images uploaded.</p>}
          {editableStatuses.includes(r.status) && <SelectInput label="Photo to use in the document (if required)" value={photoId} onChange={(e) => setPhotoId(e.target.value)}>
            <option value="">Use resident's profile photo</option>
            {(data.attachments || []).filter((a) => a.kind === "photo").map((a) => <option value={a.id} key={a.id}>Photo uploaded {formatDateTime(a.created_at)}</option>)}
          </SelectInput>}
          <Button type="button" variant="secondary" onClick={() => setProfileEdit({ ...resident })}>Correct resident details</Button>
          {profileEdit && <div className="space-y-4 rounded-xl border p-4">
            <p className="text-sm text-stone-600">Only change information you have verified with the resident. Changes here do not alter previously issued documents.</p>
            {[{ title: "Name and identity", fields: ["first_name", "middle_name", "last_name", "suffix", "birthdate", "sex", "civil_status", "citizenship"] },
              { title: "Address and residency", fields: ["house_number", "street", "purok", "barangay", "municipality", "province", "address", "residency_since"] }].map(group =>
              <fieldset key={group.title} className="rounded-xl border p-4"><legend className="px-2 font-semibold">{group.title}</legend>
                <div className="grid gap-3 sm:grid-cols-2">{group.fields.map(key => <TextInput key={key} label={key.replaceAll("_", " ")} type={["birthdate", "residency_since"].includes(key) ? "date" : "text"} value={profileEdit[key] || ""} onChange={e => setProfileEdit(p => ({ ...p, [key]: e.target.value }))} />)}</div>
              </fieldset>)}
            <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={saveProfile}>Save verified details</Button><Button variant="secondary" onClick={() => setProfileEdit(null)}>Cancel</Button></div>
          </div>}
        </div>
      </details>
      {["submitted", "acknowledged", "processing"].includes(r.status) ? <Card className="space-y-3 border-green-200 bg-green-50">
        <h2 className="text-xl font-bold">Next: Start the review</h2>
        <p>Open the verification checklist to check this application.</p>
        <Button disabled={busy} loading={busy} onClick={() => nextAction("under_review")}>Start review <ArrowLeft className="h-4 w-4 rotate-180" /></Button>
      </Card> : null}
      {r.status === "under_review" && <Card className="space-y-4 border-green-200">
        <h2 className="text-xl font-bold">Verification checklist</h2>
        {photoRequired && !hasRequiredPhoto && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">A verified resident photo is required. Expand the photo section above to add or select one.</p>}
        <p className="text-sm text-stone-600">Check each item using the barangay's approved procedures. Only mark verified facts.</p>
        {checksNeeded.map(([key, label]) => <label key={key} className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-base">
          <input type="checkbox" className="mt-1 h-5 w-5 accent-green-700" checked={Boolean(checks[key])} onChange={(e) => setChecks((v) => ({ ...v, [key]: e.target.checked }))} />
          <span>{label}</span>
        </label>)}
        {r.request_type === "Barangay Clearance" && <TextArea label="Verified clearance statement" required rows={3} value={checks.backgroundStatement || ""} placeholder="Enter the statement verified by authorized barangay personnel." onChange={(e) => setChecks((v) => ({ ...v, backgroundStatement: e.target.value }))} />}
        {r.request_type === "Certificate of Indigency" && <TextArea label="Verified income / indigency statement" required rows={3} value={checks.incomeStatement || ""} onChange={(e) => setChecks((v) => ({ ...v, incomeStatement: e.target.value }))} />}
        <SelectInput label="Approved document template" required value={activeTemplateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">Select a template</option>
          {approvedTemplates.map((t) => <option key={t.id} value={t.id}>Version {t.version} — {t.config.chairmanName || "Official"}</option>)}
        </SelectInput>
        {approvedTemplates.length === 0 && <Alert title="Document setup needed">No approved template exists for this document. Ask the superadmin to review and approve its template. {" "}
          {user?.role === "super_admin" ? <Link className="font-semibold underline underline-offset-4" to="/admin/requests?templates=1">Open document templates</Link> : null}
        </Alert>}
        <TextInput label="Document issue date" type="date" required value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        <div className="sticky bottom-0 z-10 rounded-2xl border bg-white p-4 shadow-lg">
          <Button disabled={busy || !canApprove} loading={busy} onClick={approve}>Approve & create Word draft</Button>
          {!canApprove && <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950" role="status">
            <p className="font-semibold">Before you can approve:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">{blockers.map(({ key, label }) => <li key={key}>{label}</li>)}</ul>
          </div>}
        </div>
      </Card>}
      {["under_review", "needs_revision"].includes(r.status) && <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Other decisions</h2>
        {r.status === "needs_revision" && <p className="rounded-xl bg-amber-50 p-3 text-sm">Wait for the resident to resubmit corrections. This request will return to review after resubmission.</p>}
        <p className="text-sm text-stone-600">If you cannot approve, choose one of these options.</p>
        <div className="flex flex-wrap gap-3">
          {r.status === "under_review" && <Button type="button" variant="secondary" disabled={busy} onClick={() => { setResolution("needs_revision"); setNote(""); }}>Ask resident to correct details</Button>}
          <Button type="button" variant="secondary" disabled={busy} onClick={() => { setResolution("rejected"); setNote(""); }}>Reject request</Button>
          {resolution && <Button type="button" variant="secondary" disabled={busy} onClick={() => { setResolution(""); setNote(""); }}>Cancel decision</Button>}
        </div>
        {resolution && <><TextArea label={resolution === "needs_revision" ? "Instructions for the resident" : "Reason for rejection"} required maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Explain clearly what the resident should do." />
          <Button disabled={busy || note.trim().length < 3} variant="secondary" onClick={() => nextAction(resolution, note)}>Confirm decision</Button></>}
      </Card>}
      {r.status === "needs_revision" && <Alert title="Waiting for resident corrections">The resident can resubmit updated information. You can review it when it arrives.</Alert>}
      {r.status === "rejected" && <Alert title="Request rejected">{r.rejection_reason || "The request has been closed."}</Alert>}
      {r.status === "completed" && <Alert title="Historical record">This older record does not prove that the resident collected the document.</Alert>}
      {r.verified_snapshot && <details className="rounded-2xl border p-4"><summary className="cursor-pointer font-semibold">Previously verified issuance details</summary><p className="mt-3">{r.verified_snapshot.fullName} — {r.verified_snapshot.address}</p></details>}
    </section> : null}

    {stage === 2 && <section aria-label="Prepare document" className="space-y-5">
      <Card className="space-y-4">
        <h2 className="text-xl font-bold">Prepare the Word document</h2>
        <p>Review the generated Word file. You can download and edit it, then upload the revised version. Save the final document before moving to pickup.</p>
        {r.status === "approved" && !files.length && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p>No Word draft yet.</p><Button disabled={busy} onClick={() => saveWord("generate")}>Create Word draft</Button></div>}
        {activePreview && <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 p-4">
            <div><p className="text-base font-bold">Current Word document</p>
              <p className="text-sm text-stone-700">Version {activePreview.version_number} — {activePreview.finalized_at ? "Prepared" : "Draft"} {selectedFile ? "(chosen for review)" : "(latest version selected automatically)"}</p>
            </div>
            <Button variant="secondary" onClick={() => downloadWord(activePreview, token).catch((e) => setError(e.message))}>Download Word</Button>
          </div>
          <WordPreview key={activePreview.id} file={activePreview} />
          {files.length > 1 && <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Earlier Word versions ({files.length - 1})</summary>
            <div className="mt-3 space-y-2">{files.map(f => <button key={f.id} type="button" className={`block w-full rounded-lg border p-3 text-left ${activeFileId === f.id ? "border-green-700 bg-green-50" : "bg-white"}`}
              onClick={() => { setSelectedFile(f.id); setPreview(f); setReviewedWord(false); }}>
              Version {f.version_number} — {f.finalized_at ? "Prepared" : "Draft"}{activeFileId === f.id ? " (selected)" : ""}
            </button>)}</div>
          </details>}
        </div>}
        {r.status === "approved" && <div className="space-y-3 border-t pt-4">
          <label className="block text-base font-semibold">Upload edited Word file (.docx)
            <input type="file" className="mt-2 block w-full text-sm" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setRevised(e.target.files?.[0] || null)} /></label>
          <Button variant="secondary" disabled={busy || !revised} onClick={() => saveWord("upload")}>Save edited Word version</Button>
        </div>}
      </Card>
      {r.status === "approved" && <Card className="space-y-4 border-green-200 bg-green-50">
        <h2 className="text-xl font-bold">Next: Confirm document is prepared</h2>
        <p>Check the Word preview above. You can download and edit the file before confirming it is prepared. Physical signing and sealing are checked at the next step.</p>
        <label className="flex items-start gap-3 rounded-xl border border-green-200 bg-white p-4">
          <input type="checkbox" className="mt-1 h-5 w-5" checked={reviewedWord} onChange={e => setReviewedWord(e.target.checked)} />
          <span>I reviewed the selected Word document and confirmed its details are correct.</span>
        </label>
        <Button loading={busy} disabled={busy || !activeFileId || !reviewedWord} onClick={() => saveWord("generate", true)}>Confirm document prepared</Button>
        {!activeFileId && <p className="text-sm" role="alert">First create a Word draft using the button above.</p>}
      </Card>}
      {r.status === "document_prepared" && <Card className="space-y-3 border-green-200 bg-green-50">
        <h2 className="text-xl font-bold">Next: Ready for pickup</h2>
        <p>Only continue when the signed and sealed document is physically available at the barangay office.</p>
        <label className="flex items-start gap-3 rounded-xl border border-green-200 bg-white p-4">
          <input type="checkbox" className="mt-1 h-5 w-5" checked={physicalCopyReady} onChange={e => setPhysicalCopyReady(e.target.checked)} />
          <span>The physical document has been signed, sealed if required, and is available for collection.</span>
        </label>
        <Button loading={busy} disabled={busy || !physicalCopyReady} onClick={() => nextAction("ready_for_pickup")}>Confirm ready for pickup</Button>
        <p className="text-sm text-stone-600">The system will automatically queue the resident's pickup email.</p>
      </Card>}
      {["ready_for_pickup", "claimed"].includes(r.status) && <Alert title="Document prepared">You can check collection information under Release Document.</Alert>}
    </section>}

    {stage === 3 && <section aria-label="Release document" className="space-y-5">
      <Card className="space-y-3">
        <h2 className="text-xl font-bold">Release the document</h2>
        <dl className="grid gap-3 sm:grid-cols-2">{[["Resident", resident.full_name], ["Document", r.request_type], ["Control number", r.control_number || "Not issued"], ["Pickup status", meta.label]].map(([key, val]) => <div key={key} className="rounded-xl bg-stone-50 p-3"><dt className="text-sm text-stone-500">{key}</dt><dd className="font-semibold">{val}</dd></div>)}</dl>
        {r.status === "ready_for_pickup" && <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-3"><h3 className="text-lg font-bold">Next: Record collection</h3><p>Confirm that the resident or authorized representative has actually received the physical document.</p><Button disabled={busy} loading={busy} onClick={() => nextAction("claimed")}>Mark document as collected</Button></div>}
        {r.status === "claimed" && <Alert title="Collection complete">The handover has been recorded.</Alert>}
      </Card>
    </section>}

    <details className="rounded-2xl border border-stone-200 bg-white p-5">
      <summary className="cursor-pointer text-lg font-semibold">Activity history and automatic email status</summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-stone-600">Email updates are sent automatically when a request moves to a new stage. You only need to act if delivery fails.</p>
        {emailItems.length ? emailItems.map((item) => <div key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-stone-50 p-3 text-sm">
          <div><p className="font-semibold capitalize">{item.type.replaceAll("_", " ")} — {item.status}</p>
          <p className="text-stone-600">{formatDateTime(item.createdAt)}</p></div>
          {item.failed && <Button variant="secondary" disabled={busy} onClick={() => act("Retry failed email", async () => {
            await api(item.kind === "queue" ? `/documents/email-queue/${item.id}/retry` : `/documents/notifications/${item.id}/retry`, { method: "POST", token });
          }, { confirm: false })}>Retry email</Button>}
        </div>) : <p className="text-sm text-stone-600">No automatic email has been queued for this request.</p>}
        <CaseHistory events={r.case_history || []} />
      </div>
    </details>
  </div>;
}
