import { manilaDate, validateTemplateConfig, textValue, documentError, DOCUMENT_TYPES } from "./documentRules.js";

export const createPreviewRequest = (documentType, date = manilaDate()) => {
  if (!DOCUMENT_TYPES.includes(documentType)) throw documentError("Unsupported document type.");
  return {
    id: "PREVIEW-NOT-ISSUED",
    request_type: documentType,
    details: "SAMPLE PURPOSE — Education assistance",
    control_number: null,
    issue_date: date,
    copies_requested: 1,
    expiration_date: null,
    verified_snapshot: {
      schemaVersion: 1,
      fullName: "SAMPLE RESIDENT",
      address: "123 Purok 3, Barangay Iba, Silang, Cavite",
      age: 24,
      residencySince: "2014-01-01",
      incomeStatement: "SAMPLE INFORMATION — Staff verification required before issuance.",
      backgroundStatement: "SAMPLE INFORMATION — Clearance verification required before issuance.",
      documentData: {
        businessName: "SAMPLE BUSINESS",
        businessAddress: "123 Purok 4, Barangay Iba, Silang, Cavite",
        businessKind: "Retail Shop",
        ctcNumber: "SAMPLE-CTC",
        sssNumber: "SAMPLE-SSS",
        tinNumber: "SAMPLE-TIN",
        permitYear: date.slice(0, 4),
      },
    },
  };
};

// Blank approval details from the seeded templates may be previewed, but they
// are never silently inserted into the approved configuration.
export const previewTemplateConfig = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw documentError("Invalid template configuration.");
  const config = {
    ...raw,
    chairmanName: textValue(raw.chairmanName || "OFFICIAL NAME NOT CONFIGURED", 700),
    controlPrefix: textValue(raw.controlPrefix || "DRAFT", 12),
  };
  return validateTemplateConfig(config);
};

