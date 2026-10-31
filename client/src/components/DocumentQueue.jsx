import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/auth";
import { useReviewAction } from "../hooks/useActionReview";
import { documentClosed, documentStatuses } from "../lib/documents";
import { getStatusMeta } from "../lib/status";
import { formatDateTime } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Pagination,
  SelectInput,
  TableShell,
  TextArea,
  TextInput,
} from "./ui";
import DocumentRequestDetail from "./DocumentRequestDetail";
function TemplateEditor() {
  const { token, user } = useAuth();
  const review = useReviewAction();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [config, setConfig] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const show = async () => {
    try {
      const data = await api("/documents/templates", { token });
      setTemplates(data.templates);
      setOpen(true);
    } catch (e) {
      setError(e.message);
    }
  };
  const save = async (approve) => {
    if (busy) return;
    try {
      const parsed = JSON.parse(config);
      if (
        !(await review({
          title: approve
            ? "Approve this new template version?"
            : "Save a new draft template?",
          description:
            "Confirm the exact wording, authorized official, numbering, validity and pickup instructions with the barangay.",
          after: parsed,
          confirmLabel: "Save template",
        }))
      )
        return;
      setBusy(true);
      await api("/documents/templates", {
        method: "POST",
        token,
        body: { documentType: selected.document_type, config: parsed, approve },
      });
      setOpen(false);
      setSelected(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="secondary" onClick={show}>
        Document templates
      </Button>
      {error && !open ? <p role="alert">{error}</p> : null}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Versioned document templates"
        closeDisabled={busy}
      >
        <p className="mb-4 text-sm">
          Existing approved versions are preserved. A super administrator must
          confirm the official wording, official's name, prefix, validity and
          pickup details before approval.
        </p>
        <SelectInput
          label="Base template"
          value={selected?.id || ""}
          onChange={(e) => {
            const t = templates.find((t) => t.id === e.target.value);
            setSelected(t);
            setConfig(t ? JSON.stringify(t.config, null, 2) : "");
          }}
        >
          <option value="">Select template version</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.document_type} v{t.version} ({t.approval_state})
            </option>
          ))}
        </SelectInput>
        {selected ? (
          <>
            <TextArea
              label="Template configuration (JSON)"
              rows={18}
              value={config}
              disabled={user?.role !== "super_admin"}
              onChange={(e) => setConfig(e.target.value)}
            />
            {user?.role === "super_admin" ? (
              <div className="mt-4 flex gap-3">
                <Button disabled={busy} onClick={() => save(false)}>
                  Save new draft
                </Button>
                <Button disabled={busy} onClick={() => save(true)}>
                  Approve new version
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-rose-700">
            {error}
          </p>
        ) : null}
      </Modal>
    </>
  );
}
export default function DocumentQueue({ requests, onChanged }) {
  const [filters, setFilters] = useState({
    status: "active",
    type: "all",
    search: "",
    from: "",
    to: "",
  });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const update = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };
  const rows = useMemo(
    () =>
      requests.filter(
        (r) =>
          (filters.status === "all" ||
            (filters.status === "active"
              ? !documentClosed.includes(r.status)
              : r.status === filters.status)) &&
          (filters.type === "all" || r.request_type === filters.type) &&
          `${r.resident_name} ${r.id} ${r.control_number || ""}`
            .toLowerCase()
            .includes(filters.search.toLowerCase()) &&
          (!filters.from || r.created_at.slice(0, 10) >= filters.from) &&
          (!filters.to || r.created_at.slice(0, 10) <= filters.to),
      ),
    [requests, filters],
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        {[
          "submitted",
          "under_review",
          "needs_revision",
          "approved",
          "ready_for_pickup",
          "claimed",
          "rejected",
        ].map((s) => (
          <Card key={s}>
            <p className="text-xs">{getStatusMeta(s).label}</p>
            <p className="text-2xl font-bold">
              {requests.filter((r) => r.status === s).length}
            </p>
          </Card>
        ))}
      </div>
      <TemplateEditor />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextInput
            label="Search resident or reference"
            value={filters.search}
            onChange={(e) => update("search", e.target.value)}
          />
          <SelectInput
            label="Document type"
            value={filters.type}
            onChange={(e) => update("type", e.target.value)}
          >
            <option value="all">All document types</option>
            {[...new Set(requests.map((r) => r.request_type))].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </SelectInput>
          <SelectInput
            label="Status"
            value={filters.status}
            onChange={(e) => update("status", e.target.value)}
          >
            <option value="active">Active</option>
            <option value="all">All statuses</option>
            {[
              ...documentStatuses,
              "acknowledged",
              "processing",
              "completed",
            ].map((s) => (
              <option key={s} value={s}>
                {getStatusMeta(s).label}
              </option>
            ))}
          </SelectInput>
          <TextInput
            type="date"
            label="Submitted from"
            value={filters.from}
            onChange={(e) => update("from", e.target.value)}
          />
          <TextInput
            type="date"
            label="Submitted through"
            value={filters.to}
            onChange={(e) => update("to", e.target.value)}
          />
        </div>
      </Card>
      {!rows.length ? (
        <EmptyState
          title="No matching requests"
          description="Try another search or filter."
        />
      ) : (
        <TableShell>
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr>
                {["Resident", "Document", "Status", "Submitted", "Action"].map(
                  (h) => (
                    <th className="p-4" key={h}>
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.slice((page - 1) * 8, page * 8).map((r) => (
                <tr className="border-t" key={r.id}>
                  <td className="p-4">{r.resident_name}</td>
                  <td className="p-4">{r.request_type}</td>
                  <td className="p-4">
                    <Badge tone={getStatusMeta(r.status).tone}>
                      {getStatusMeta(r.status).label}
                    </Badge>
                  </td>
                  <td className="p-4">{formatDateTime(r.created_at)}</td>
                  <td className="p-4">
                    <Button onClick={() => setSelected(r.id)}>
                      Open request
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}
      <Pagination
        page={page}
        totalPages={Math.max(1, Math.ceil(rows.length / 8))}
        onPageChange={setPage}
      />
      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Document request details"
        widthClass="max-w-5xl"
      >
        {selected ? (
          <DocumentRequestDetail
            key={selected}
            id={selected}
            onChanged={onChanged}
          />
        ) : null}
      </Modal>
    </div>
  );
}
