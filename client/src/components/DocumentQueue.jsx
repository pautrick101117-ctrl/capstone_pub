import { useMemo, useState } from "react";
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
  TextInput,
} from "./ui";
import DocumentRequestDetail from "./DocumentRequestDetail";
import TemplateManager from "./TemplateManager";
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
      <TemplateManager />
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

