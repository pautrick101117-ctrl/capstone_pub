export const DOCUMENT_TYPES = Object.freeze([
  "Barangay Identification Card",
  "Certificate of Indigency",
  "Barangay Clearance",
  "Barangay Business Clearance",
  "Certificate of Residency",
]);
export const documentError = (
  message,
  status = 400,
  code = "DOCUMENT_VALIDATION",
) => Object.assign(new Error(message), { status, code });
export const textValue = (value, max = 500) => {
  if (value == null) return "";
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw documentError(`Text must contain at most ${max} characters.`);
  return value.trim();
};
export const validDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
export const manilaDate = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
export const ageAtDate = (birthdate, issueDate) => {
  if (!validDate(birthdate) || !validDate(issueDate) || birthdate > issueDate)
    throw documentError("A valid birthdate and issue date are required.");
  return (
    Number(issueDate.slice(0, 4)) -
    Number(birthdate.slice(0, 4)) -
    (issueDate.slice(5) < birthdate.slice(5) ? 1 : 0)
  );
};
export const validateApplication = (
  body,
  {
    requiredBusinessFields = [
      "businessName",
      "businessAddress",
      "businessKind",
      "permitYear",
    ],
  } = {},
) => {
  const requestType = textValue(body.requestType, 80);
  if (!DOCUMENT_TYPES.includes(requestType))
    throw documentError("Choose a supported document type.");
  const details = textValue(body.details, 1000);
  if (details.length < 5)
    throw documentError("Describe the purpose in at least five characters.");
  const copies = Number(body.copiesRequested ?? 1);
  if (!Number.isInteger(copies) || copies < 1 || copies > 10)
    throw documentError("Copies must be between 1 and 10.");
  const purpose = body.purposeCategory || "Other";
  if (
    ![
      "Employment",
      "School",
      "Loan",
      "Government",
      "Personal",
      "Other",
    ].includes(purpose)
  )
    throw documentError("Choose a valid purpose category.");
  const raw = body.documentData ?? {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw documentError("Invalid document information.");
  const fields =
    requestType === "Barangay Business Clearance"
      ? [
          "businessName",
          "businessAddress",
          "businessKind",
          "ctcNumber",
          "sssNumber",
          "tinNumber",
          "permitYear",
        ]
      : requestType === "Certificate of Indigency"
        ? ["familyIncomeStatement"]
        : [];
  const documentData = Object.fromEntries(
    fields.map((key) => [
      key,
      textValue(
        raw[key],
        key === "businessAddress" || key === "familyIncomeStatement"
          ? 500
          : 180,
      ),
    ]),
  );
  if (requestType === "Barangay Business Clearance") {
    for (const key of requiredBusinessFields)
      if (!documentData[key])
        throw documentError(`Business field required: ${key}.`);
    if (documentData.permitYear && !/^20\d{2}$/.test(documentData.permitYear))
      throw documentError("Permit year must be a four-digit year.");
  }
  return {
    request_type: requestType,
    details,
    copies_requested: copies,
    purpose_category: purpose,
    document_data: documentData,
  };
};
export const snapshotResident = (
  resident,
  {
    issueDate,
    photoPath = resident.profile_photo_path,
    documentData,
    checks = {},
  },
) => {
  const fullName = textValue(
    resident.first_name && resident.last_name
      ? [
          resident.first_name,
          resident.middle_name,
          resident.last_name,
          resident.suffix,
        ]
          .filter(Boolean)
          .join(" ")
      : resident.full_name,
    250,
  );
  const address = textValue(
    resident.address ||
      [
        resident.house_number,
        resident.street,
        resident.purok,
        resident.barangay,
        resident.municipality,
        resident.province,
      ]
        .filter(Boolean)
        .join(", "),
    1000,
  );
  if (!fullName || !address)
    throw documentError(
      "Verified full name and complete address are required.",
    );
  if (!validDate(issueDate)) throw documentError("Choose a valid issue date.");
  return {
    schemaVersion: 1,
    fullName,
    address,
    firstName: resident.first_name,
    middleName: resident.middle_name || "",
    lastName: resident.last_name,
    suffix: resident.suffix || "",
    birthdate: resident.birthdate || null,
    age: resident.birthdate ? ageAtDate(resident.birthdate, issueDate) : null,
    sex: resident.sex || "",
    civilStatus: resident.civil_status || "",
    citizenship: resident.citizenship || "",
    purok: resident.purok || "",
    houseNumber: resident.house_number || "",
    street: resident.street || "",
    barangay: resident.barangay || "",
    municipality: resident.municipality || "",
    province: resident.province || "",
    residencySince: resident.residency_since || null,
    photoPath: photoPath || null,
    documentData,
    incomeStatement: textValue(checks.incomeStatement || "", 700),
    backgroundStatement: textValue(checks.backgroundStatement || "", 700),
    capturedAt: new Date().toISOString(),
  };
};
export const approvalChecks = (
  request,
  resident,
  template,
  body,
  photoPath,
) => {
  if (
    !template ||
    template.approval_state !== "approved" ||
    template.document_type !== request.request_type
  )
    throw documentError("Select an approved template for this document.");
  const checks = body.reviewChecks || {};
  for (const key of [
    "identityVerified",
    "residencyVerified",
    ...(request.request_type === "Certificate of Indigency"
      ? ["indigencyVerified"]
      : []),
    ...(request.request_type === "Barangay Clearance"
      ? ["backgroundVerified"]
      : []),
    ...(request.request_type === "Barangay Business Clearance"
      ? ["businessVerified"]
      : []),
  ])
    if (checks[key] !== true)
      throw documentError(`Staff verification required: ${key}.`);
  const app = validateApplication(
    {
      requestType: request.request_type,
      details: request.details,
      copiesRequested: request.copies_requested,
      purposeCategory: request.purpose_category,
      documentData: request.document_data,
    },
    template.config,
  );
  if (
    [
      "Barangay Identification Card",
      "Certificate of Indigency",
      "Barangay Clearance",
    ].includes(request.request_type) &&
    !photoPath
  )
    throw documentError("A verified resident photo is required.");
  if (
    request.request_type === "Certificate of Residency" &&
    !validDate(resident.residency_since)
  )
    throw documentError("A verified residency start date is required.");
  if (
    request.request_type === "Certificate of Indigency" &&
    !textValue(checks.incomeStatement || "", 700)
  )
    throw documentError("Enter the staff-verified indigency statement.");
  if (
    request.request_type === "Barangay Clearance" &&
    !textValue(checks.backgroundStatement || "", 700)
  )
    throw documentError("Enter the staff-verified clearance wording.");
  return snapshotResident(resident, {
    issueDate: body.issueDate,
    photoPath,
    documentData: app.document_data,
    checks,
  });
};

export const validateTemplateConfig = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw documentError("Template configuration must be an object.");
  const keys = [
    "title",
    "chairmanName",
    "designation",
    "footer",
    "pickupInstructions",
    "officeContact",
    "controlPrefix",
  ];
  const result = Object.fromEntries(
    keys.map((key) => [
      key,
      textValue(raw[key], key === "controlPrefix" ? 12 : 700),
    ]),
  );
  if (
    !result.title ||
    !result.chairmanName ||
    !result.designation ||
    !result.controlPrefix ||
    !/^[A-Z]{1,12}$/.test(result.controlPrefix)
  )
    throw documentError(
      "Title, authorized official, designation and uppercase control prefix are required.",
    );
  if (
    !Array.isArray(raw.paragraphs) ||
    raw.paragraphs.length < 1 ||
    raw.paragraphs.length > 8
  )
    throw documentError("Provide one to eight approved body paragraphs.");
  result.paragraphs = raw.paragraphs.map((p) => textValue(p, 1400));
  const known = [
    "fullName",
    "address",
    "incomeStatement",
    "backgroundStatement",
    "purpose",
    "permitYear",
    "ageStatement",
    "residencySince",
  ];
  for (const p of result.paragraphs)
    for (const [, key] of p.matchAll(/\{\{(.*?)\}\}/g))
      if (!known.includes(key))
        throw documentError(`Unknown template field: ${key}.`);
  result.validityMonths =
    raw.validityMonths == null || raw.validityMonths === ""
      ? null
      : Number(raw.validityMonths);
  if (
    result.validityMonths != null &&
    (!Number.isInteger(result.validityMonths) ||
      result.validityMonths < 1 ||
      result.validityMonths > 60)
  )
    throw documentError("Validity must be one to 60 months, or null.");
  result.issuanceStage = "approved";
  result.requiredBusinessFields = raw.requiredBusinessFields || [
    "businessName",
    "businessAddress",
    "businessKind",
    "permitYear",
  ];
  if (
    !Array.isArray(result.requiredBusinessFields) ||
    result.requiredBusinessFields.some(
      (k) =>
        ![
          "businessName",
          "businessAddress",
          "businessKind",
          "permitYear",
          "ctcNumber",
          "sssNumber",
          "tinNumber",
        ].includes(k),
    )
  )
    throw documentError("Invalid business requirement list.");
  return result;
};
