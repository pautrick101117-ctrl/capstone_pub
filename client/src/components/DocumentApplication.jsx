import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/auth";
import { useReviewAction } from "../hooks/useActionReview";
import { documentTypes } from "../lib/documents";
import ResidentPhoto, { PrivateImage } from "./ResidentPhoto";
import {
  Alert,
  Button,
  Card,
  ErrorState,
  LoadingState,
  SelectInput,
  TextInput,
  TextArea,
} from "./ui";
const labels = {
  businessOwner: "Business owner / authorized representative",
  businessContact: "Business contact number",
  businessPurok: "Business location / purok",
  businessRegistration: "Business registration reference (if applicable)",
  businessName: "Registered business name",
  businessAddress: "Business address",
  businessKind: "Kind of business",
  ctcNumber: "Community Tax Certificate number",
  sssNumber: "SSS number",
  tinNumber: "Tax Identification Number",
  permitYear: "Permit year",
};
export default function DocumentApplication({ request, onSaved, onCancel }) {
  const { token } = useAuth();
  const review = useReviewAction();
  const [profile, setProfile] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [form, setForm] = useState(() => ({
    requestType: request?.request_type || documentTypes[0],
    details: request?.details || "",
    copiesRequested: request?.copies_requested || 1,
    purposeCategory: request?.purpose_category || "Other",
    documentData: request?.document_data || {},
  }));
  const [errors, setErrors] = useState({});
  const [files, setFiles] = useState([]);
  const [submitted, setSubmitted] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [version, setVersion] = useState(request?.lock_version);
  const requestId = request?.id;
  const load = useCallback(async () => {
    try {
      const [p, c, detail] = await Promise.all([
        api("/documents/profile", { token }),
        api("/documents/catalog", { token }),
        requestId
          ? api(`/documents/requests/${requestId}`, { token })
          : Promise.resolve(null),
      ]);
      setProfile(p.profile);
      setCatalog(c.types);
      if (detail) {
        setAttachments(detail.attachments);
        setVersion(detail.request.lock_version);
      }
    } catch (e) {
      setError(e.message);
    }
  }, [token, requestId]);
  useEffect(() => {
    load();
  }, [load]);
  const selected = catalog.find((c) => c.type === form.requestType);
  const field = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const specific = (key, value) =>
    setForm((f) => ({
      ...f,
      documentData: { ...f.documentData, [key]: value },
    }));
  const removeImage = async (attachment) => {
    if (lock.current) return;
    lock.current = true;
    try {
      if (
        !(await review({
          title: "Remove this supporting image?",
          confirmLabel: "Remove image",
          tone: "danger",
        }))
      )
        return;
      setBusy(true);
      const current = await api(`/documents/requests/${requestId}`, { token });
      await api(`/documents/attachments/${attachment.id}`, {
        method: "DELETE",
        token,
        body: { expectedVersion: current.request.lock_version },
      });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    if (lock.current) return;
    const next = {};
    if (form.details.trim().length < 5)
      next.details = "Describe the purpose in at least five characters.";
    if (form.requestType === "Barangay Business Clearance")
      for (const key of selected?.requiredBusinessFields || [])
        if (!form.documentData[key]?.trim())
          next[key] = "This business field is required.";
    if (files.length > 5) next.files = "Upload at most five supporting images.";
    if (
      files.some(
        (f) =>
          !["image/jpeg", "image/png", "image/webp"].includes(f.type) ||
          f.size > 5 * 1024 * 1024,
      )
    )
      next.files =
        "Each supporting image must be JPEG, PNG or WebP up to 5 MB.";
    setErrors(next);
    if (Object.keys(next).length) return;
    lock.current = true;
    let saved = submitted;
    try {
      if (
        !(await review({
          title: request
            ? "Resubmit corrected application?"
            : "Submit document request?",
          description:
            "Review your profile, purpose and document information. Barangay staff must verify these details.",
          after: {
            resident: profile.full_name,
            address: profile.address,
            ...form,
          },
          confirmLabel: "Submit application",
        }))
      )
        return;
      setBusy(true);
      setError("");
      if (!saved) {
        const data = await api(
          request ? `/requests/${request.id}` : "/requests",
          {
            method: request ? "PATCH" : "POST",
            token,
            body: {
              ...form,
              expectedVersion: version,
              operationId: crypto.randomUUID(),
            },
          },
        );
        saved = data.request;
        setSubmitted(saved);
      }
      for (const file of files) {
        const current = await api(`/documents/requests/${saved.id}`, { token });
        const body = new FormData();
        body.append("image", file);
        body.append("kind", "supporting");
        body.append("expectedVersion", current.request.lock_version);
        await api(`/documents/requests/${saved.id}/attachments`, {
          method: "POST",
          token,
          body,
        });
        setFiles((current) => current.filter((f) => f !== file));
      }
      await onSaved(saved);
    } catch (err) {
      setError(
        saved
          ? `Request ${saved.id} was saved. ${err.message} Retry to upload the remaining images; the application will not be submitted again.`
          : err.message,
      );
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };
  if (!profile)
    return error ? (
      <ErrorState description={error} onRetry={load} />
    ) : (
      <LoadingState rows={3} />
    );
  return (
    <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
      <div className="space-y-4">
        <Card>
          <h2 className="text-xl font-bold">Review your resident details</h2>
          <p className="mt-3 font-semibold">{profile.full_name}</p>
          <p className="mt-2">{profile.address || "Address not recorded"}</p>
          <p className="mt-2 text-sm">
            {profile.purok} · {profile.email}
          </p>
          <p className="mt-3 text-sm text-stone-500">
            Contact barangay staff to correct identity or address records before
            approval.
          </p>
        </Card>
        <ResidentPhoto onChanged={load} />
        {attachments.length ? (
          <Card>
            <h3 className="font-semibold">Current supporting images</h3>
            <div className="mt-3 flex flex-wrap gap-3">
              {attachments.map((attachment) => (
                <div key={attachment.id}>
                  <PrivateImage path={`/attachments/${attachment.id}`} />
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={busy}
                    onClick={() => removeImage(attachment)}
                  >
                    Remove image
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        ) : null}
        <Alert title="Requirements">
          {selected?.requiresPhoto
            ? "A clear resident photo and verification of identity and residency are required."
            : "Identity and residency verification are required."}{" "}
          {form.requestType === "Certificate of Indigency"
            ? "Staff must verify indigency and any family income statement."
            : form.requestType === "Barangay Clearance"
              ? "Staff must verify the required clearance records."
              : form.requestType === "Certificate of Residency"
                ? "Staff must verify the residency start date."
                : form.requestType === "Barangay Identification Card"
                  ? "This application does not confirm an ID pickup appointment. Schedule that separately."
                  : "Provide the business information required by the barangay."}
        </Alert>
        {selected && !selected.approved ? (
          <Alert title="Awaiting template approval">
            You may submit an application. Staff must approve the document
            wording before issuing it.
          </Alert>
        ) : null}
      </div>
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <h2 className="text-xl font-bold">
            {request ? "Correct your application" : "Document application"}
          </h2>
          <SelectInput
            label="Document type"
            disabled={Boolean(request) || busy || Boolean(submitted)}
            value={form.requestType}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                requestType: e.target.value,
                documentData: {},
              }))
            }
          >
            {documentTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </SelectInput>
          <SelectInput
            label="Purpose category"
            value={form.purposeCategory}
            onChange={(e) => field("purposeCategory", e.target.value)}
          >
            {[
              "Employment",
              "School",
              "Loan",
              "Government",
              "Personal",
              "Other",
            ].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </SelectInput>
          <TextInput
            label="Copies requested"
            type="number"
            min="1"
            max="10"
            required
            value={form.copiesRequested}
            onChange={(e) => field("copiesRequested", Number(e.target.value))}
          />
          <TextArea
            label="Purpose / Details"
            error={errors.details}
            required
            minLength={5}
            maxLength={1000}
            value={form.details}
            onChange={(e) => field("details", e.target.value)}
          />
          {form.requestType === "Barangay Business Clearance"
            ? Object.entries(labels).map(([key, label]) => (
                <TextInput
                  key={key}
                  label={label}
                  error={errors[key]}
                  required={selected?.requiredBusinessFields.includes(key)}
                  value={form.documentData[key] || ""}
                  maxLength={key === "businessAddress" ? 500 : 180}
                  onChange={(e) => specific(key, e.target.value)}
                />
              ))
            : null}
          {form.requestType === "Certificate of Indigency" ? (
            <TextArea
              label="Family income information (for staff verification, optional)"
              value={form.documentData.familyIncomeStatement || ""}
              maxLength={500}
              onChange={(e) =>
                specific("familyIncomeStatement", e.target.value)
              }
            />
          ) : null}
          <label className="block text-sm font-semibold">
            Supporting images (optional)
            <input
              disabled={busy}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              className="mt-2 block max-w-full"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
          </label>
          <p className="text-xs text-stone-500">
            Up to five images, 5 MB each.
          </p>
          {errors.files ? (
            <p role="alert" className="text-rose-700">
              {errors.files}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          <div className="flex gap-3">
            <Button type="submit" loading={busy}>
              {submitted ? "Retry remaining uploads" : "Review and submit"}
            </Button>
            {onCancel ? (
              <Button
                type="button"
                variant="secondary"
                onClick={onCancel}
                disabled={busy}
              >
                Close
              </Button>
            ) : null}
          </div>
        </form>
      </Card>
    </div>
  );
}

