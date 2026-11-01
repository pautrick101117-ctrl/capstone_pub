import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { downloadWord } from "../lib/documents";
import { useAuth } from "../context/auth";
import { useToast } from "../context/toast";
import { useReviewAction } from "../hooks/useActionReview";
import ResidentPhoto, { PrivateImage } from "./ResidentPhoto";
import WordPreview from "./WordPreview";
import CaseHistory from "./CaseHistory";
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorState,
  LoadingState,
  SelectInput,
  TextArea,
  TextInput,
} from "./ui";
import { getStatusMeta } from "../lib/status";
import { formatDateTime } from "../lib/format";
const decisionLabels = {
  under_review: "Start review",
  needs_revision: "Ask resident to correct information",
  rejected: "Reject request",
  approved: "Approve request",
  ready_for_pickup: "Mark ready for pickup",
  claimed: "Mark as collected",
};
const nextStages = {
  submitted: ["under_review"],
  acknowledged: ["under_review"],
  processing: ["under_review"],
  under_review: ["needs_revision", "rejected", "approved"],
  needs_revision: ["under_review", "rejected"],
  document_prepared: ["ready_for_pickup"],
  ready_for_pickup: ["claimed"],
};
export default function DocumentRequestDetail({ id, onChanged }) {
  const { token } = useAuth();
  const toast = useToast();
  const review = useReviewAction();
  const [data, setData] = useState(null);
  const [activePanel, setActivePanel] = useState("review");
  const [templates, setTemplates] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [issueDate, setIssueDate] = useState(() =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(
      new Date(),
    ),
  );
  const [checks, setChecks] = useState({});
  const [photoId, setPhotoId] = useState("");
  const [preview, setPreview] = useState(null);
  const [revised, setRevised] = useState(null);
  const [selectedFile, setSelectedFile] = useState("");
  const [notificationType, setNotificationType] = useState("ready");
  const [custom, setCustom] = useState("");
  const [emailPreview, setEmailPreview] = useState(null);
  const [profileEdit, setProfileEdit] = useState(null);
  const load = useCallback(async () => {
    const [detail, ts] = await Promise.all([
      api(`/documents/requests/${id}`, { token }),
      api("/documents/templates", { token }),
    ]);
    setData(detail);
    setTemplates(ts.templates);
    return detail;
  }, [id, token]);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  const perform = async (title, fn, { confirm = true } = {}) => {
    if (lock.current) return;
    lock.current = true;
    try {
      if (
        confirm &&
        !(await review({
          title,
          description:
            "Review the selected request and information before continuing.",
          subject: data.request.request_type,
          after: { reference: id, status: data.request.status },
          confirmLabel: "Confirm",
        }))
      )
        return;
      setBusy(true);
      setError("");
      await fn();
      await load();
      await onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };
  if (!data)
    return error ? (
      <ErrorState
        description={error}
        onRetry={() => load().catch((e) => setError(e.message))}
      />
    ) : (
      <LoadingState rows={4} />
    );
  const r = data.request;
  const meta = getStatusMeta(r.status);
  const versions = data.files || [];
  const transition = () =>
    perform("Save request decision?", async () => {
      await api(`/documents/requests/${id}/transition`, {
        method: "PATCH",
        token,
        body: {
          status: status || r.status,
          adminNote: note,
          expectedVersion: r.lock_version,
          operationId: crypto.randomUUID(),
          templateId,
          issueDate,
          reviewChecks: checks,
          photoAttachmentId: photoId,
        },
      });
      if (status === "approved") setActivePanel("word");
      if (status === "ready_for_pickup" || status === "claimed") setActivePanel("updates");
      setStatus("");
      setNote("");
      setEmailPreview(null);
      toast.success(
        "Request updated. Email can be reviewed and sent separately.",
      );
    });
  const word = ({ finalize = false, upload = false } = {}) =>
    perform(
      finalize
        ? "Confirm document reviewed and prepared?"
        : "Save Word document version?",
      async () => {
        let body = {
          expectedVersion: r.lock_version,
          operationId: crypto.randomUUID(),
          finalize,
          confirmReviewed: finalize,
          sourceDocumentId: selectedFile || undefined,
        };
        let path = `/documents/requests/${id}/generate`;
        if (upload) {
          if (!revised) throw new Error("Choose the revised .docx file.");
          const form = new FormData();
          form.append("document", revised);
          form.append("expectedVersion", r.lock_version);
          form.append("operationId", body.operationId);
          body = form;
          path = `/documents/requests/${id}/word`;
        }
        await api(path, { method: "POST", token, body });
        setRevised(null);
        setPreview(null);
        setSelectedFile("");
        toast.success(
          finalize
            ? "Document prepared. You can now mark it ready for pickup."
            : "Word version saved.",
        );
      },
    );
  const send = () =>
    perform("Send the reviewed email to this resident?", async () => {
      const result = await api(`/documents/requests/${id}/notify`, {
        method: "POST",
        token,
        body: {
          type: emailPreview.type,
          customMessage: emailPreview.custom,
          previewHash: emailPreview.previewHash,
          idempotencyKey: emailPreview.key,
        },
      });
      toast.info(
        result.notification.attempt_status === "accepted"
          ? "Email accepted by Resend. Delivery is not confirmed."
          : `Email attempt: ${result.notification.attempt_status}`,
      );
    });
  const saveProfile = () =>
    perform("Save verified resident profile?", async () => {
      await api(`/documents/residents/${r.user_id}/profile`, {
        method: "PATCH",
        token,
        body: { ...profileEdit, expectedUpdatedAt: data.resident.updated_at },
      });
      setProfileEdit(null);
    });
  return (
    <div className="space-y-5">
      {error ? (
        <Alert tone="danger" title="Action could not be completed">
          {error}
        </Alert>
      ) : null}
      <div>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <p className="mt-2 text-xs">Request reference: {id}</p>
        <p className="mt-2 font-semibold">
          {r.request_type} · {r.copies_requested} copies
        </p>
        <p className="mt-2">Purpose: {r.details}</p>
        {r.control_number ? <p>Control number: {r.control_number}</p> : null}
        {r.status === "completed" ? (
          <Alert title="Historical completed record">
            No physical claim is inferred from this legacy status.
          </Alert>
        ) : null}
      </div>
      <nav aria-label="Document request actions" className="grid grid-cols-3 gap-2 rounded-2xl bg-stone-100 p-2">
        {[
          ["review", "Review request"],
          ["word", "Word document"],
          ["updates", "Updates & history"],
        ].map(([key, label]) => (
          <button key={key} type="button" aria-current={activePanel === key ? "page" : undefined}
            onClick={() => setActivePanel(key)}
            className={`rounded-xl px-2 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700 ${activePanel === key ? "bg-white text-[var(--brand-800)] shadow-sm" : "text-stone-600 hover:bg-white/70"}`}>
            {label}
          </button>
        ))}
      </nav>
      {activePanel === "review" ? <>
      <p className="text-sm text-stone-600">Check the resident details and supporting images, then choose the next action.</p>
      <Card>
        <h3 className="font-bold">Resident profile</h3>
        <p>{data.resident.full_name}</p>
        <p>{data.resident.address}</p>
        <p className="text-sm">
          {data.resident.email} · {data.resident.contact_number}
        </p>
        <p className="text-sm">
          Residency since: {data.resident.residency_since || "Not recorded"}
        </p>
        <p className="mt-2 text-xs text-stone-500">
          The approved snapshot is preserved when this profile changes.
        </p>
        <Button
          variant="secondary"
          onClick={() => setProfileEdit({ ...data.resident })}
        >
          Edit verified profile
        </Button>
        {profileEdit ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              "first_name",
              "middle_name",
              "last_name",
              "suffix",
              "address",
              "purok",
              "house_number",
              "street",
              "barangay",
              "municipality",
              "province",
              "sex",
              "civil_status",
              "citizenship",
              "birthdate",
              "residency_since",
            ].map((key) => (
              <TextInput
                key={key}
                label={key.replace(/_/g, " ")}
                type={
                  ["birthdate", "residency_since"].includes(key)
                    ? "date"
                    : "text"
                }
                value={profileEdit[key] || ""}
                onChange={(e) =>
                  setProfileEdit((v) => ({ ...v, [key]: e.target.value }))
                }
              />
            ))}
            <Button disabled={busy} onClick={saveProfile}>
              Save profile
            </Button>
            <Button variant="ghost" onClick={() => setProfileEdit(null)}>
              Cancel edit
            </Button>
          </div>
        ) : null}
      </Card>
      <ResidentPhoto residentId={r.user_id} onChanged={load} />
      <Card>
        <h3 className="font-bold">Supporting images and request photo</h3>
        <div className="my-3 flex flex-wrap gap-3">
          {data.attachments.map((a) => (
            <div key={a.id}>
              <PrivateImage path={`/attachments/${a.id}`} />
              <p className="text-xs">{a.kind}</p>
              {[
                "submitted",
                "needs_revision",
                "under_review",
                "acknowledged",
                "processing",
              ].includes(r.status) ? (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    perform("Remove this request image?", async () => {
                      await api(`/documents/attachments/${a.id}`, {
                        method: "DELETE",
                        token,
                        body: { expectedVersion: r.lock_version },
                      });
                      setPhotoId("");
                    })
                  }
                >
                  Remove image
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        {[
          "submitted",
          "needs_revision",
          "under_review",
          "acknowledged",
          "processing",
        ].includes(r.status) ? (
          <>
            <label className="block text-sm">
              Upload request-specific photo or supporting image
              <input
                type="file"
                disabled={busy}
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  perform("Attach this request photo?", async () => {
                    const body = new FormData();
                    body.append("image", file);
                    body.append("kind", "photo");
                    body.append("expectedVersion", r.lock_version);
                    await api(`/documents/requests/${id}/attachments`, {
                      method: "POST",
                      token,
                      body,
                    });
                  });
                }}
              />
            </label>
            <SelectInput
              label="Photo to approve for this request"
              value={photoId}
              onChange={(e) => setPhotoId(e.target.value)}
            >
              <option value="">Use resident profile photo</option>
              {data.attachments
                .filter((a) => a.kind === "photo")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    Request photo {formatDateTime(a.created_at)}
                  </option>
                ))}
            </SelectInput>
          </>
        ) : null}
      </Card>
      <Card>
        <h3 className="mb-3 font-bold">Document information</h3>
        <dl className="space-y-2">
          {Object.entries(r.document_data || {})
            .filter(([, v]) => v)
            .map(([key, value]) => (
              <div key={key}>
                <dt className="text-sm text-stone-500">{key}</dt>
                <dd className="whitespace-pre-wrap">{String(value)}</dd>
              </div>
            ))}
        </dl>
        {r.verified_snapshot ? (
          <details className="mt-4">
            <summary>Verified issuance snapshot</summary>
            {r.verified_snapshot.photoPath ? (
              <PrivateImage
                path={`/requests/${id}/photo`}
                alt="Photo approved for this document"
              />
            ) : null}
            <p>{r.verified_snapshot.fullName}</p>
            <p>{r.verified_snapshot.address}</p>
            <p>
              Issue date: {r.issue_date} · Expiration:{" "}
              {r.expiration_date || "Not configured"}
            </p>
            <p>
              {r.verified_snapshot.incomeStatement ||
                r.verified_snapshot.backgroundStatement}
            </p>
          </details>
        ) : null}
      </Card>
      <Card>
        <h3 className="mb-3 font-bold">Review and status</h3>
        <SelectInput
          label="What should happen next?"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Send a note without changing status</option>
          {(nextStages[r.status] || []).map((s) => (
            <option key={s} value={s}>
              {decisionLabels[s] || getStatusMeta(s).label}
            </option>
          ))}
        </SelectInput>
        {status === "approved" ? (
          <div className="my-4 space-y-3">
            <SelectInput
              required
              label="Approved template"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">Select approved wording</option>
              {templates
                .filter(
                  (t) =>
                    t.approval_state === "approved" &&
                    t.document_type === r.request_type,
                )
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    Version {t.version} · {t.config.chairmanName}
                  </option>
                ))}
            </SelectInput>
            <TextInput
              label="Issue date"
              type="date"
              required
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
            {[
              "identityVerified",
              "residencyVerified",
              ...(r.request_type === "Certificate of Indigency"
                ? ["indigencyVerified"]
                : []),
              ...(r.request_type === "Barangay Clearance"
                ? ["backgroundVerified"]
                : []),
              ...(r.request_type === "Barangay Business Clearance"
                ? ["businessVerified"]
                : []),
            ].map((key) => (
              <label className="block text-sm" key={key}>
                <input
                  type="checkbox"
                  checked={Boolean(checks[key])}
                  onChange={(e) =>
                    setChecks((c) => ({ ...c, [key]: e.target.checked }))
                  }
                />{" "}
                {key.replace(/([A-Z])/g, " $1")}
              </label>
            ))}
            {r.request_type === "Certificate of Indigency" ? (
              <TextArea
                label="Staff-verified indigency and income statement"
                required
                value={checks.incomeStatement || ""}
                onChange={(e) =>
                  setChecks((c) => ({ ...c, incomeStatement: e.target.value }))
                }
              />
            ) : null}
            {r.request_type === "Barangay Clearance" ? (
              <TextArea
                label="Staff-verified background certification wording"
                required
                value={checks.backgroundStatement || ""}
                onChange={(e) =>
                  setChecks((c) => ({
                    ...c,
                    backgroundStatement: e.target.value,
                  }))
                }
              />
            ) : null}
            <p className="text-xs">
              The approved template assigns a unique number at approval.
              Signing, sealing and pickup remain separate steps.
            </p>
          </div>
        ) : null}
        <TextArea
          label={
            status === "needs_revision"
              ? "Instructions for the resident"
              : status === "rejected"
                ? "Rejection reason"
                : "Resident-facing response"
          }
          required={["needs_revision", "rejected"].includes(status)}
          value={note}
          maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          disabled={busy || (!status && !note.trim())}
          onClick={transition}
        >
          Save decision or note
        </Button>
      </Card>
      </> : null}
      {activePanel === "word" ? <>
      <p className="text-sm text-stone-600">Generate, edit and prepare the Word document after approval. All versions remain available.</p>
      {r.status !== "approved" && !versions.length ? (
        <Alert title="Document not yet available">Word generation becomes available after approval. Review the resident information first.</Alert>
      ) : null}
      <Card>
        <h3 className="font-bold">Editable Word documents</h3>
        <p className="my-2 text-sm">
          Downloaded edits must be uploaded here. Each saved version is
          retained. Review the selected file before preparing it.
        </p>
        {r.status === "approved" ? (
          <div className="my-4 space-y-3">
            <Button disabled={busy} onClick={() => word()}>
              Generate draft Word document
            </Button>
            <label className="block text-sm">
              Revised Word document
              <input
                type="file"
                accept=".docx"
                disabled={busy}
                onChange={(e) => setRevised(e.target.files?.[0] || null)}
              />
            </label>
            <Button
              variant="secondary"
              disabled={busy || !revised}
              onClick={() => word({ upload: true })}
            >
              Upload revised Word version
            </Button>
          </div>
        ) : null}
        <div className="space-y-3">
          {versions.map((f) => (
            <div
              key={f.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border p-3"
            >
              <span>
                Version {f.version_number} · {f.source} ·{" "}
                {f.finalized_at ? "Prepared" : "Draft"}
              </span>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  downloadWord(f, token).catch((e) => setError(e.message))
                }
              >
                Download Word
              </Button>
              <Button variant="ghost" onClick={() => setPreview(f)}>
                Preview
              </Button>
              {r.status === "approved" ? (
                <label className="text-sm">
                  <input
                    type="radio"
                    name="finalWord"
                    checked={selectedFile === f.id}
                    onChange={() => setSelectedFile(f.id)}
                  />{" "}
                  Use this version
                </label>
              ) : null}
            </div>
          ))}
        </div>
        {preview ? <WordPreview key={preview.id} file={preview} /> : null}
        {r.status === "approved" && versions.length ? (
          <div className="mt-4">
            <p className="mb-3 text-sm">
              For an uploaded revision, confirm that all wording, numbering and
              dates are correct and that the draft notice was removed. Generated
              drafts are rebuilt as a prepared document.
            </p>
            <Button
              disabled={busy || !selectedFile}
              onClick={() => word({ finalize: true })}
            >
              Confirm reviewed and mark prepared
            </Button>
          </div>
        ) : null}
      </Card>
      </> : null}
      {activePanel === "updates" ? <>
      <p className="text-sm text-stone-600">Send a status email when appropriate, or check the request's previous activity.</p>
      <Card>
        <h3 className="font-bold">Notify resident</h3>
        <p className="mb-3 text-sm">
          Emails contain a request reference and portal instructions. Provider
          acceptance does not confirm delivery.
        </p>
        <SelectInput
          label="Notification"
          value={notificationType}
          onChange={(e) => {
            setNotificationType(e.target.value);
            setEmailPreview(null);
          }}
        >
          {[
            ["received", "Request received"],
            ["revision", "Additional information required"],
            ["rejected", "Request rejected"],
            ["approved", "Request approved"],
            ["ready", "Ready for pickup"],
            ["reminder", "Pickup reminder"],
            ["custom", "Custom administrative message"],
          ].map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </SelectInput>
        {notificationType === "custom" ? (
          <TextArea
            label="Administrative message"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              setEmailPreview(null);
            }}
            maxLength={1500}
            hint="Do not include identity or tax numbers, or confidential documents."
          />
        ) : null}
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            perform(
              "Preview notification",
              async () => {
                const p = await api(
                  `/documents/requests/${id}/notification-preview`,
                  {
                    method: "POST",
                    token,
                    body: { type: notificationType, customMessage: custom },
                  },
                );
                setEmailPreview({
                  ...p,
                  type: notificationType,
                  custom,
                  key: crypto.randomUUID(),
                });
              },
              { confirm: false },
            )
          }
        >
          Preview email
        </Button>
        {emailPreview ? (
          <div className="my-4 rounded-xl border p-4">
            <p>To: {emailPreview.message.to || "No email on file"}</p>
            <p className="font-bold">{emailPreview.message.subject}</p>
            <pre className="my-3 whitespace-pre-wrap font-sans text-sm">
              {emailPreview.message.text}
            </pre>
            <Button disabled={busy || !emailPreview.message.to} onClick={send}>
              Send reviewed email
            </Button>
          </div>
        ) : null}
        <div className="mt-4 space-y-2">
          {data.notificationLogs.map((log) => (
            <div key={log.id} className="rounded-xl bg-stone-50 p-3 text-sm">
              <p>
                {log.notification_type} · {log.attempt_status} ·{" "}
                {formatDateTime(log.created_at)}
              </p>
              <p>
                {log.recipient || "No email"} {log.error_code}{" "}
                {log.provider_message_id
                  ? `Provider ID: ${log.provider_message_id}`
                  : ""}
              </p>
              {["failed", "sending"].includes(log.attempt_status) ? (
                <>
                  <details>
                    <summary>Reviewed message</summary>
                    <pre className="whitespace-pre-wrap font-sans">
                      {log.message_snapshot.text}
                    </pre>
                  </details>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      perform("Retry the previously reviewed email?", () =>
                        api(`/documents/notifications/${log.id}/retry`, {
                          method: "POST",
                          token,
                        }),
                      )
                    }
                  >
                    Retry
                  </Button>
                </>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
      <details className="rounded-2xl border border-stone-200 bg-white p-5">
        <summary className="cursor-pointer font-bold">Full request history</summary>
        <div className="mt-4"><CaseHistory events={r.case_history} /></div>
      </details>
      </> : null}
    </div>
  );
}

