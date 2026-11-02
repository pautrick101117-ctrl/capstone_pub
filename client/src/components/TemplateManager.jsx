import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { previewTemplateWord } from "../lib/documents";
import { useAuth } from "../context/auth";
import { Button, Modal, SelectInput, TextArea, TextInput } from "./ui";
import WordPreview from "./WordPreview";

const businessFields = [
  ["businessOwner", "Business owner / authorized representative"],
  ["businessContact", "Business contact number"],
  ["businessPurok", "Business location / purok"],
  ["businessRegistration", "Business registration reference (if applicable)"],
  ["businessName", "Business name"],
  ["businessAddress", "Business address"],
  ["businessKind", "Kind of business"],
  ["permitYear", "Permit year"],
  ["ctcNumber", "Community Tax Certificate number"],
  ["sssNumber", "SSS number"],
  ["tinNumber", "TIN"],
];

const stringify = (value) => JSON.stringify(value);
const currentByType = (records = []) => {
  const sorted = [...records].sort((a, b) => b.version - a.version);
  const seen = new Set();
  return sorted.filter((row) => {
    if (seen.has(row.document_type)) return false;
    seen.add(row.document_type);
    return true;
  });
};
const normalizeDraft = (value) => ({
  ...value,
  paragraphs: Array.isArray(value?.paragraphs) ? [...value.paragraphs] : [],
  requiredBusinessFields: Array.isArray(value?.requiredBusinessFields)
    ? [...value.requiredBusinessFields]
    : ["businessName", "businessAddress", "businessKind", "permitYear"],
});

const savePreviewFile = (blob, documentType) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${documentType.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-sample-preview.docx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export default function TemplateManager({ openOnLoad = false }) {
  const { token, user } = useAuth();
  const canEdit = user?.role === "super_admin";
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [config, setConfig] = useState(null);
  const [advanced, setAdvanced] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewedConfig, setPreviewedConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewRetry, setPreviewRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const abortRef = useRef(null);
  const serialRef = useRef(0);
  const currentTemplates = useMemo(() => currentByType(templates), [templates]);
  const selected = useMemo(() => templates.find((t) => t.id === selectedId), [templates, selectedId]);
  const isCurrentPreview = Boolean(preview && config && previewedConfig === stringify(config));
  const requiredMissing = config ? [
    ["Official document title", config.title],
    ["Authorized official's name", config.chairmanName],
    ["Official designation", config.designation],
    ["Uppercase control prefix (letters only)", /^[A-Z]{1,12}$/.test(String(config.controlPrefix||"")) ? config.controlPrefix : ""],
    ["Pickup instructions", config.pickupInstructions],
    ["Office contact", config.officeContact],
  ].filter(([,value]) => !String(value||"").trim()).map(([label]) => label) : [];
  const unsavedForm = Boolean(selected && config && stringify(config) !== stringify(normalizeDraft(selected.config)));
  const unsavedAdvanced = Boolean(advanced && config && jsonText !== JSON.stringify(config, null, 2));
  const hasUnsavedChanges = unsavedForm || unsavedAdvanced;

  const select = useCallback((template) => {
    abortRef.current?.abort();
    serialRef.current += 1;
    setSelectedId(template?.id || "");
    const value = template ? normalizeDraft(template.config) : null;
    setConfig(value);
    setJsonText(value ? JSON.stringify(value, null, 2) : "");
    setAdvanced(false);
    setPreview(null);
    setPreviewedConfig(null);
    setPreviewing(false);
    setPreviewError("");
    setError("");
    setMessage("");
  }, []);

  const confirmDiscard = () => !hasUnsavedChanges || window.confirm(
    "You have unsaved template changes. Discard them?",
  );
  const close = () => {
    if (busy || !confirmDiscard()) return;
    abortRef.current?.abort();
    serialRef.current += 1;
    setOpen(false);
  };

  const show = useCallback(async () => {
    setOpen(true);
    setLoading(true);
    setError("");
    try {
      const data = await api("/documents/templates", { token });
      const items = data.templates || [];
      setTemplates(items);
      select(currentByType(items)[0] || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, select]);

  // Used by the approval screen when a document type has no approved template.
  useEffect(() => {
    if (openOnLoad) void show();
  }, [openOnLoad, show]);

  const fetchPreview = useCallback(async (template, draft, { savedOnly = false } = {}) => {
    if (!template || !draft) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort("timeout"), 45000);
    abortRef.current = controller;
    const serial = ++serialRef.current;
    setPreviewing(true);
    setPreviewError("");
    // Keep the last good Word preview visible while unsaved edits render.
    try {
      const blob = await previewTemplateWord({
        templateId: template.id,
        config: savedOnly ? undefined : draft,
        token,
        signal: controller.signal,
      });
      if (serial !== serialRef.current || controller.signal.aborted) return;
      setPreview(blob);
      setPreviewedConfig(stringify(draft));
    } catch (e) {
      if (serial === serialRef.current) {
        if (controller.signal.reason === "timeout") {
          setPreviewError("Word preview timed out. Check your server and try again.");
        } else if (!controller.signal.aborted) {
          setPreviewError(e.message || "The preview could not be generated.");
        }
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (serial === serialRef.current) setPreviewing(false);
    }
  }, [token]);

  // Preview the unsaved editor state. A timer avoids generating a Word file
  // for every keystroke; fetchPreview aborts the previous HTTP request.
  const draftFingerprint = config ? stringify(config) : "";
  useEffect(() => {
    if (!open || !selected || !config) return undefined;
    if (draftFingerprint === previewedConfig && preview) return undefined;
    const timer = window.setTimeout(() => {
      fetchPreview(selected, config, { savedOnly: !canEdit });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [open, selected?.id, draftFingerprint, canEdit, fetchPreview, previewedConfig, preview, previewRetry]);

  useEffect(() => () => {
    serialRef.current += 1;
    abortRef.current?.abort();
  }, []);

  // Browser navigation should not silently discard unsaved template edits.
  useEffect(() => {
    if (!open || !hasUnsavedChanges) return undefined;
    const onBeforeUnload = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [open, hasUnsavedChanges]);

  const update = (key, value) => {
    setConfig((current) => {
      const next = { ...current, [key]: value };
      setJsonText(JSON.stringify(next, null, 2));
      return next;
    });
    setMessage("");
  };

  const editParagraph = (index, value) => {
    const paragraphs = [...config.paragraphs];
    paragraphs[index] = value;
    update("paragraphs", paragraphs);
  };

  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON must contain an object.");
      const draft = normalizeDraft(parsed);
      setConfig(draft);
      setJsonText(JSON.stringify(draft, null, 2));
      setError("");
      setMessage("Changes applied. The Word preview will update automatically.");
    } catch (e) {
      setError(`Invalid JSON: ${e.message}`);
    }
  };

  const save = async () => {
    if (!selected || !config || busy || !canEdit) return;
    if (requiredMissing.length) {
      setError(`Complete these fields before saving: ${requiredMissing.join(", ")}.`);
      return;
    }
    if (!isCurrentPreview) {
      setError("Please review the latest Word preview before saving.");
      return;
    }
    if (advanced) {
      try {
        if (stringify(normalizeDraft(JSON.parse(jsonText))) !== stringify(config)) {
          setError("Apply your Advanced JSON changes before saving.");
          return;
        }
      } catch {
        setError("Correct the Advanced JSON before saving.");
        return;
      }
    }
    setBusy(true);
    setError("");
    try {
      const saved = await api("/documents/templates/current", {
        method: "PUT", token,
        body: { documentType: selected.document_type, config, expectedTemplateId: selected.id },
      });
      const refreshed = await api("/documents/templates", { token });
      setTemplates(refreshed.templates || []);
      const newest = refreshed.templates?.find((t) => t.id === saved.template.id) || saved.template;
      select(newest);
      setMessage("Changes saved. This document template is now available for future requests.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button type="button" variant="secondary" onClick={show}>Document templates</Button>
      <Modal
        open={open}
        onClose={close}
        closeDisabled={busy}
        title="Document Template Manager"
        description="Select a document, edit the official wording, preview it, and save changes. Preview data is fictional."
        widthClass="max-w-[96vw]"
      >
        {loading ? <p role="status" className="py-8 text-center">Loading document templates…</p> : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <SelectInput label="Select document" value={selectedId} onChange={(e) => {
                const nextId = e.target.value;
                if (nextId === selectedId || !confirmDiscard()) return;
                select(currentTemplates.find((t) => t.id === nextId));
              }} className="min-w-[250px] flex-1">
                <option value="">Select a document</option>
                {currentTemplates.map((t) => (
                  <option value={t.id} key={t.id}>{t.document_type}</option>
                ))}
              </SelectInput>
              {selected ? <span role="status" className="rounded-full bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-700">{hasUnsavedChanges ? "Unsaved changes" : selected.approval_state === "approved" ? "Saved · Available" : "Not yet configured"}</span> : null}
            </div>
            {selected && config ? (
              <div className="grid items-start gap-5 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
                <section aria-label="Template settings" className="max-h-[70vh] space-y-4 overflow-y-auto rounded-2xl border border-stone-200 p-4">
                  <h4 className="text-base font-bold text-[var(--brand-900)]">Edit document template</h4>
                  <p className="rounded-xl bg-sky-50 p-3 text-sm text-sky-900">Enter the official title, wording, signatory, control prefix, pickup instructions and office contact. Preview before saving. Only use details approved by the barangay.</p>
                  {requiredMissing.length ? <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-bold">Before saving, complete:</p>
                    <ul className="list-disc pl-5">{requiredMissing.map(field=><li key={field}>{field}</li>)}</ul>
                  </div> : <p className="text-sm font-semibold text-green-800">All required fields are entered. Check the Word preview and save changes.</p>}
                  {!canEdit ? <p className="rounded-xl bg-stone-100 p-3 text-sm">Only Super Admin can edit and save document templates. Other staff may preview them.</p> : null}
                  <TextInput label="Document title" required disabled={!canEdit || busy} maxLength={700} value={config.title || ""} onChange={(e) => update("title", e.target.value)} />
                  <div className="space-y-3 rounded-xl border border-stone-200 p-3">
                    <div className="flex items-center justify-between gap-2"><h5 className="font-semibold">Document paragraphs</h5><span className="text-xs text-stone-500">{config.paragraphs.length}/8</span></div>
                    <p className="text-xs text-stone-500">You can use fields like {"{{fullName}}"}, {"{{address}}"}, {"{{purpose}}"} and {"{{residencySince}}"}.</p>
                    {config.paragraphs.map((paragraph, index) => (
                      <div key={index} className="flex items-start gap-2">
                        <TextArea label={`Paragraph ${index + 1}`} rows={3} maxLength={1400} disabled={!canEdit || busy} value={paragraph} onChange={(e) => editParagraph(index, e.target.value)} className="flex-1" />
                        {canEdit ? <button type="button" aria-label={`Remove paragraph ${index + 1}`} disabled={busy || config.paragraphs.length <= 1} onClick={() => update("paragraphs", config.paragraphs.filter((_, i) => i !== index))} className="mt-8 rounded-lg border border-stone-200 p-2 text-rose-600 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button> : null}
                      </div>
                    ))}
                    {canEdit && config.paragraphs.length < 8 ? <Button type="button" variant="secondary" disabled={busy} onClick={() => update("paragraphs", [...config.paragraphs, ""])}><Plus className="h-4 w-4" /> Add paragraph</Button> : null}
                  </div>
                  <h5 className="border-t pt-3 font-bold">Authorized Signatory</h5>
                  <TextInput label="Authorized official's name" required maxLength={700} disabled={!canEdit || busy} placeholder="Enter the approved official's name" value={config.chairmanName || ""} onChange={(e) => update("chairmanName", e.target.value)} />
                  <TextInput label="Official designation" required maxLength={700} disabled={!canEdit || busy} value={config.designation || ""} onChange={(e) => update("designation", e.target.value)} />
                  <TextInput label="Control-number prefix" required maxLength={12} hint="Uppercase letters only, e.g. I or BC" disabled={!canEdit || busy} value={config.controlPrefix || ""} onChange={(e) => update("controlPrefix", e.target.value.toUpperCase())} />
                  <TextInput label="Validity (months)" type="number" min="1" max="60" hint="Leave blank if this document has no standard validity period" disabled={!canEdit || busy} value={config.validityMonths ?? ""} onChange={(e) => update("validityMonths", e.target.value === "" ? null : Number(e.target.value))} />
                  <TextArea label="Footer note" rows={2} maxLength={700} disabled={!canEdit || busy} value={config.footer || ""} onChange={(e) => update("footer", e.target.value)} />
                  <h5 className="border-t pt-3 font-bold">Collection and Office Details</h5>
                  <TextArea label="Pickup instructions" rows={2} maxLength={700} disabled={!canEdit || busy} value={config.pickupInstructions || ""} onChange={(e) => update("pickupInstructions", e.target.value)} />
                  <TextInput label="Office contact" maxLength={700} disabled={!canEdit || busy} value={config.officeContact || ""} onChange={(e) => update("officeContact", e.target.value)} />
                  {selected.document_type === "Barangay Business Clearance" ? (
                    <fieldset className="space-y-2 rounded-xl border border-stone-200 p-3" disabled={!canEdit || busy}>
                      <legend className="font-semibold">Required business fields</legend>
                      {businessFields.map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.requiredBusinessFields.includes(key)} onChange={(e) => update("requiredBusinessFields", e.target.checked ? [...config.requiredBusinessFields, key] : config.requiredBusinessFields.filter((v) => v !== key))}/>{label}</label>
                      ))}
                    </fieldset>
                  ) : null}
                  {canEdit ? (
                    <div className="border-t pt-3">
                      <button type="button" className="flex w-full items-center gap-2 text-sm font-semibold text-stone-700" aria-expanded={advanced} onClick={() => { setAdvanced(!advanced); if (!advanced) setJsonText(JSON.stringify(config, null, 2)); }}><Settings2 className="h-4 w-4" /> Advanced JSON editor</button>
                      {advanced ? <div className="mt-3 space-y-2"><TextArea label="Template configuration (JSON)" rows={12} value={jsonText} disabled={busy} onChange={(e) => setJsonText(e.target.value)}/><Button type="button" variant="secondary" disabled={busy} onClick={applyJson}>Apply JSON changes</Button></div> : null}
                    </div>
                  ) : null}
                </section>
                <section aria-label="Word document preview" className="min-w-0 space-y-3 rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><h4 className="font-bold text-[var(--brand-900)]">Actual Word preview</h4><p className="text-xs text-stone-500">Uses the document generator, logos and sample resident details. No official document is issued.</p></div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" disabled={!preview || !isCurrentPreview || previewing} onClick={() => savePreviewFile(preview, selected.document_type)}><Download className="h-4 w-4" /> Download sample</Button>
                    </div>
                  </div>
                  {previewError ? <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <span>{previewError}</span>
                    <Button type="button" variant="secondary" disabled={previewing} onClick={() => { setPreviewError(""); setPreviewRetry(v => v + 1); }}>Try preview again</Button>
                  </div> : null}
                  <p role="status" aria-live="polite" className="text-sm text-stone-600">
                    {previewing || (preview && !isCurrentPreview && !previewError) ? <><RefreshCw className="mr-2 inline h-4 w-4 animate-spin" /> Updating preview from unsaved edits…</> : isCurrentPreview ? (hasUnsavedChanges ? "Preview updated · Changes not saved" : "Preview of saved template") : previewError ? "Preview needs attention. Your edits are still here and have not been saved." : "Preparing sample preview…"}
                  </p>
                  {preview ? <WordPreview blob={preview} title={`Sample ${selected.document_type}`} /> : <p className="rounded-xl border border-dashed p-8 text-center text-sm text-stone-500">Preparing the document preview automatically…</p>}
                </section>
              </div>
            ) : !error ? <p className="py-12 text-center text-stone-500">No template selected.</p> : null}
            {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
            {message ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p> : null}
            {selected && canEdit ? <div className="flex flex-wrap justify-end gap-3 border-t border-stone-200 pt-4">
              <Button type="button" loading={busy} disabled={!isCurrentPreview || previewing || requiredMissing.length > 0 || (selected.approval_state === "approved" && !hasUnsavedChanges)} onClick={save}>Save Changes</Button>
            </div> : null}
          </div>
        )}
      </Modal>
    </>
  );
}

