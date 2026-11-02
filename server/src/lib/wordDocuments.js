import { readFile } from "node:fs/promises";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  ImageRun,
  AlignmentType,
  BorderStyle,
  WidthType,
  VerticalAlign,
  PageOrientation,
  SectionType,
} from "docx";
import { documentError } from "./documentRules.js";

const images = Promise.all(
  ["barangay-iba.jpg", "silang.jpg"].map((name) =>
    readFile(new URL(`../../assets/documents/${name}`, import.meta.url)),
  ),
);
const dateLabel = (value) =>
  value
    ? new Intl.DateTimeFormat("en-PH", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${value}T00:00:00Z`))
    : "";
const para = (text, options = {}) =>
  new Paragraph({
    spacing: { after: 240, line: 300 },
    children: [new TextRun({ text, ...options.run })],
    ...options,
  });
const cell = (children, width) =>
  new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    children,
  });
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const tableBorders = {
  top: noBorder,
  bottom: noBorder,
  left: noBorder,
  right: noBorder,
  insideHorizontal: noBorder,
  insideVertical: noBorder,
};
const graphic = (data, width, height, type = "jpg") =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new ImageRun({ data, type, transformation: { width, height } })],
  });

export const buildDocumentContent = (request, template) => {
  const s = request.verified_snapshot;
  if (!s?.schemaVersion || !template?.config)
    throw documentError("Verified document snapshot is missing.");
  const data = s.documentData || {};
  const values = {
    fullName: s.fullName,
    address: s.address,
    purpose: request.details,
    permitYear: data.permitYear || "",
    incomeStatement: s.incomeStatement || "",
    backgroundStatement: s.backgroundStatement || "",
    ageStatement:
      s.age == null
        ? "with identity verified by this office"
        : s.age >= 18
          ? "of legal age"
          : `${s.age} years of age`,
    residencySince: dateLabel(s.residencySince),
  };
  return {
    title: template.config.title,
    paragraphs: template.config.paragraphs.map((text) =>
      text.replace(/\{\{(.*?)\}\}/g, (_, key) => values[key] ?? ""),
    ),
    businessRows:
      request.request_type === "Barangay Business Clearance"
        ? [
            ["Name of Business", data.businessName],
            ["Business Owner / Representative", data.businessOwner],
            ["Contact Number", data.businessContact],
            ["Business Purok", data.businessPurok],
            ["Registration Reference", data.businessRegistration],
            ["Address of Business", data.businessAddress],
            ["Kind of Business", data.businessKind],
            ["Community Tax Certificate No.", data.ctcNumber],
            ["SSS No.", data.sssNumber],
            ["Tax Identification No.", data.tinNumber],
            ["Permit Year", data.permitYear],
          ].filter(([, v]) => v)
        : [],
    issueLine: `Issued on ${dateLabel(request.issue_date)} at the Barangay Administration Office, Barangay Iba, Silang, Cavite.`,
    validityLine: request.expiration_date
      ? `Valid until ${dateLabel(request.expiration_date)}.`
      : "",
  };
};

export const generateWordDocument = async ({
  request,
  template,
  photo,
  final = false,
}) => {
  const [iba, silang] = await images;
  const content = buildDocumentContent(request, template);
  const config = template.config;
  const idCard = request.request_type === "Barangay Identification Card";
  const s = request.verified_snapshot;
  const width = idCard ? 4453 : 9638;
  const header = new Table({
    width: { size: width, type: WidthType.DXA },
    borders: tableBorders,
    rows: [
      new TableRow({
        children: [
          cell(
            [graphic(iba, idCard ? 40 : 90, idCard ? 40 : 90)],
            idCard ? 650 : 1800,
          ),
          cell(
            [
              "Republic of the Philippines",
              "Province of Cavite",
              "Municipality of Silang",
              "BARANGAY IBA",
            ].map((t, i) =>
              para(t, {
                alignment: AlignmentType.CENTER,
                spacing: { after: idCard ? 10 : 40, line: idCard ? 120 : 300 },
                run: {
                  bold: true,
                  size: idCard ? 12 : i === 3 ? 32 : 23,
                  color: i === 3 ? "164E26" : "000000",
                },
              }),
            ),
            idCard ? 3153 : 6038,
          ),
          cell(
            [graphic(silang, idCard ? 40 : 90, idCard ? 40 : 90)],
            idCard ? 650 : 1800,
          ),
        ],
      }),
    ],
  });
  const signature = [
    para("____________________________", {
      alignment: AlignmentType.CENTER,
      spacing: {
        before: idCard ? 20 : 700,
        after: idCard ? 10 : 40,
        line: idCard ? 100 : 300,
      },
    }),
    para(config.chairmanName, {
      alignment: AlignmentType.CENTER,
      run: { bold: true, size: idCard ? 12 : 24 },
      spacing: { after: idCard ? 10 : 40, line: idCard ? 120 : 300 },
    }),
    para(config.designation, {
      alignment: AlignmentType.CENTER,
      run: { size: idCard ? 11 : 24 },
      spacing: { after: idCard ? 10 : 300, line: idCard ? 120 : 300 },
    }),
  ];
  const body = [header];
  if (!idCard)
    body.push(
      para("OFFICE OF THE SANGGUNIANG BARANGAY", {
        alignment: AlignmentType.CENTER,
        run: { bold: true, size: 21 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 12, color: "000000" },
        },
        spacing: { after: 360 },
      }),
    );
  if (!final)
    body.push(
      para(`DRAFT — NOT VALID FOR ISSUANCE | ${request.id}`, {
        alignment: AlignmentType.CENTER,
        run: { bold: true, color: "A12727", size: idCard ? 8 : 18 },
        spacing: { after: idCard ? 10 : 120, line: idCard ? 100 : 300 },
      }),
    );
  body.push(
    para(
      `CONTROL # ${request.control_number || `DRAFT-${request.id.slice(0, 8)}`}`,
      {
        alignment: AlignmentType.RIGHT,
        run: { size: idCard ? 10 : 22 },
        spacing: { after: idCard ? 10 : 350, line: idCard ? 100 : 300 },
      },
    ),
  );
  body.push(
    para(content.title, {
      alignment: AlignmentType.CENTER,
      run: { bold: true, size: idCard ? 17 : 30 },
      spacing: { after: idCard ? 10 : 360, line: idCard ? 180 : 300 },
    }),
  );
  if (idCard) {
    if (!photo)
      throw documentError("An approved resident photo is required for the ID.");
    body.push(
      new Table({
        width: { size: width, type: WidthType.DXA },
        borders: tableBorders,
        rows: [
          new TableRow({
            children: [
              cell([graphic(photo, 48, 60, "png")], 1000),
              cell(
                [
                  para(s.fullName, {
                    run: { bold: true, size: 14 },
                    spacing: { after: 20, line: 140 },
                  }),
                  para(s.address, {
                    run: { size: 11 },
                    spacing: { after: 20, line: 120 },
                  }),
                  ...content.paragraphs.slice(2).map((t) =>
                    para(t, {
                      run: { size: 10 },
                      spacing: { after: 20, line: 120 },
                    }),
                  ),
                  para(`ID No. ${request.control_number || "SAMPLE — NOT ISSUED"}`, {
                    run: { bold: true, size: 11 },
                    spacing: { after: 20, line: 120 },
                  }),
                  para(`Issued: ${dateLabel(request.issue_date)}`, {
                    run: { size: 10 },
                    spacing: { after: 10, line: 120 },
                  }),
                ],
                width - 1000,
              ),
            ],
          }),
        ],
      }),
    );
    body.push(...signature);
  } else {
    if (photo) body.push(graphic(photo, 85, 100, "png"));
    body.push(
      para("TO WHOM IT MAY CONCERN:", {
        run: { bold: true },
        spacing: { after: 300 },
      }),
    );
    body.push(
      ...content.paragraphs.map((text) =>
        para(text, { alignment: AlignmentType.JUSTIFIED }),
      ),
    );
    if (content.businessRows.length)
      body.push(
        new Table({
          width: { size: width, type: WidthType.DXA },
          borders: tableBorders,
          rows: content.businessRows.map(
            ([label, value]) =>
              new TableRow({
                children: [
                  cell([para(label, { spacing: { after: 100 } })], 3500),
                  cell(
                    [
                      para(value, {
                        run: { bold: true },
                        spacing: { after: 100 },
                      }),
                    ],
                    width - 3500,
                  ),
                ],
              }),
          ),
        }),
      );
    body.push(
      para(content.issueLine, { spacing: { before: 240, after: 360 } }),
    );
    if (photo)
      body.push(
        para("____________________________\nSignature of Applicant", {
          alignment: AlignmentType.RIGHT,
          spacing: { before: 300, after: 240 },
        }),
      );
    body.push(...signature);
  }
  body.push(
    para([content.validityLine, config.footer].filter(Boolean).join(" "), {
      alignment: AlignmentType.CENTER,
      run: { italics: true, size: idCard ? 9 : 21 },
      spacing: { after: idCard ? 10 : 40, line: idCard ? 100 : 300 },
    }),
  );
  const border = {
    style: BorderStyle.DOUBLE,
    size: idCard ? 4 : 10,
    color: "000000",
    space: idCard ? 2 : 15,
  };
  const sections = Array.from(
    { length: request.copies_requested || 1 },
    () => ({
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          size: idCard
            ? {
                width: 3061,
                height: 4853,
                orientation: PageOrientation.LANDSCAPE,
              }
            : { width: 11906, height: 16838 },
          margin: idCard
            ? { top: 100, bottom: 100, left: 200, right: 200 }
            : { top: 900, bottom: 850, left: 1134, right: 1134 },
          borders: {
            pageBorderTop: border,
            pageBorderBottom: border,
            pageBorderLeft: border,
            pageBorderRight: border,
          },
        },
      },
      children: body,
    }),
  );
  const doc = new Document({
    creator: "Barangay Iba Portal",
    title: content.title,
    description: final
      ? "Prepared document. Physical signing and seal are handled by authorized staff."
      : "Internal draft for staff review.",
    styles: {
      default: {
        document: {
          run: { font: "Times New Roman", size: idCard ? 16 : 24 },
          paragraph: { spacing: { line: 300 } },
        },
      },
    },
    sections,
  });
  return Packer.toBuffer(doc);
};


