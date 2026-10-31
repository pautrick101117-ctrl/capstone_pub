import { API_URL } from "./api";
export const documentTypes = [
  "Barangay Identification Card",
  "Certificate of Indigency",
  "Barangay Clearance",
  "Barangay Business Clearance",
  "Certificate of Residency",
];
export const documentStatuses = [
  "submitted",
  "under_review",
  "needs_revision",
  "rejected",
  "approved",
  "document_prepared",
  "ready_for_pickup",
  "claimed",
  "cancelled",
];
export const documentClosed = ["completed", "claimed", "cancelled", "rejected"];
export const documentBlob = async (path, token) => {
  const response = await fetch(`${API_URL}/documents${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "Unable to retrieve private file.");
  }
  return response.blob();
};
export const downloadWord = async (file, token) => {
  const blob = await documentBlob(`/files/${file.id}`, token);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `request-${file.request_id}-v${file.version_number}.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};


// Does not save or issue a document. The server renders a sample-only draft.
export const previewTemplateWord = async ({ templateId, config, token, signal }) => {
  const response = await fetch(`${API_URL}/documents/templates/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ templateId, ...(config === undefined ? {} : { config }) }),
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `Template preview failed (HTTP ${response.status}).`);
  }
  return response.blob();
};
