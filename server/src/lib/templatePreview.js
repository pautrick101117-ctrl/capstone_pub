import sharp from "sharp";
import { generateWordDocument } from "./wordDocuments.js";
import { createPreviewRequest, previewTemplateConfig } from "./templatePreviewData.js";

const SAMPLE_PHOTO = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="220" viewBox="0 0 180 220">
<rect width="180" height="220" fill="#eef1ee"/>
<circle cx="90" cy="76" r="32" fill="#98aba0"/>
<path d="M35 175c0-37 23-57 55-57s55 20 55 57" fill="#98aba0"/>
<text x="90" y="205" text-anchor="middle" font-size="12" font-family="Arial" fill="#243e32">SAMPLE PHOTO</text>
</svg>`;

export const generateTemplatePreview = async ({ documentType, config }) => {
  const templateConfig = previewTemplateConfig(config);
  const request = createPreviewRequest(documentType);
  const photo = documentType === "Barangay Identification Card"
    ? await sharp(Buffer.from(SAMPLE_PHOTO)).png().toBuffer()
    : null;
  const buffer = await generateWordDocument({
    request, template: { document_type: documentType, config: templateConfig }, photo,
    final: false,
  });
  return buffer;
};

