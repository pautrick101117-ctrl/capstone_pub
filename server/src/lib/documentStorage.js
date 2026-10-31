import sharp from "sharp";
import JSZip from "jszip";
import { XMLValidator } from "fast-xml-parser";
import { randomUUID } from "node:crypto";
import { documentError } from "./documentRules.js";
import { identifyImage } from "./residentIdValidation.js";
export const DOCUMENT_BUCKET = "barangay-documents";
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const normalizePhoto = async (file) => {
  if (
    !file?.buffer ||
    file.buffer.length > 5 * 1024 * 1024 ||
    !identifyImage(file.buffer) ||
    identifyImage(file.buffer)[0] !== file.mimetype
  )
    throw documentError("Upload a real JPEG, PNG or WebP image up to 5 MB.");
  try {
    const input = sharp(file.buffer, {
      limitInputPixels: 16000000,
      failOn: "warning",
    });
    const meta = await input.metadata();
    if (
      meta.width < 160 ||
      meta.height < 160 ||
      meta.width > 6000 ||
      meta.height > 6000 ||
      (meta.pages || 1) !== 1
    )
      throw new Error("dimensions");
    // Decode and re-encode, removing EXIF/GPS and any appended non-image payload.
    return await input
      .rotate()
      .resize({
        width: 1200,
        height: 1200,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
  } catch {
    throw documentError(
      "Image must decode correctly, contain one frame and measure 160–6000 pixels per side (at most 16 megapixels).",
    );
  }
};
export const validateWord = async (file) => {
  if (
    !file?.buffer ||
    file.buffer.length > 10 * 1024 * 1024 ||
    !file.originalname?.toLowerCase().endsWith(".docx") ||
    !file.buffer.subarray(0, 2).equals(Buffer.from("PK"))
  )
    throw documentError("Upload a valid .docx Word document up to 10 MB.");
  try {
    const zip = await JSZip.loadAsync(file.buffer);
    const entries = Object.values(zip.files);
    if (
      entries.length > 500 ||
      entries.reduce((n, e) => n + (e._data?.uncompressedSize || 0), 0) >
        30 * 1024 * 1024
    )
      throw new Error("expanded size");
    if (!zip.file("[Content_Types].xml") || !zip.file("word/document.xml"))
      throw new Error("missing parts");
    for (const e of entries) {
      if (
        (e.unsafeOriginalName && e.unsafeOriginalName !== e.name) ||
        /(^\/|\.\.|vbaProject|embeddings\/|activeX\/|\.bin$|\.exe$|\.js$|\.html$)/i.test(
          e.name,
        )
      )
        throw new Error("unsafe part");
      if (/\.(xml|rels)$/.test(e.name)) {
        const xml = await e.async("string");
        if (XMLValidator.validate(xml) !== true) throw new Error("invalid XML");
        if (
          /<!DOCTYPE|<!ENTITY|<w:altChunk|TargetMode\s*=\s*["']External|INCLUDETEXT|INCLUDEPICTURE|DDEAUTO/i.test(
            xml,
          )
        )
          throw new Error("external content");
      }
    }
    const content = await zip.file("[Content_Types].xml").async("string");
    if (
      !content.includes(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
      ) ||
      /macroEnabled/i.test(content)
    )
      throw new Error("wrong type");
    const xml = await zip.file("word/document.xml").async("string");
    if (!/<w:document\b/.test(xml) || !/<w:body[\s>]/.test(xml))
      throw new Error("invalid document");
    return file.buffer;
  } catch {
    throw documentError(
      "Word file is invalid or contains unsupported macros, embedded files, external links or excessive expanded content.",
    );
  }
};
export const uploadPrivateDocument = async (db, folder, buffer, mime) => {
  const path = `${folder}/${randomUUID()}.${mime === DOCX_MIME ? "docx" : "png"}`;
  const { error } = await db.storage
    .from(DOCUMENT_BUCKET)
    .upload(path, buffer, { contentType: mime, upsert: false });
  if (error)
    throw documentError(
      "Private file storage is unavailable. Please retry.",
      503,
      "DOCUMENT_STORAGE_UNAVAILABLE",
    );
  return path;
};
export const downloadPrivateDocument = async (db, path) => {
  if (
    !/^(photos|requests|generated)\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(png|docx)$/.test(
      path || "",
    )
  )
    throw documentError("Invalid private file reference.", 404);
  const { data, error } = await db.storage.from(DOCUMENT_BUCKET).download(path);
  if (error) throw documentError("Private file could not be retrieved.", 503);
  return Buffer.from(await data.arrayBuffer());
};
export const removeStagedFile = async (db, path) => {
  if (path) {
    const { error } = await db.storage.from(DOCUMENT_BUCKET).remove([path]);
    if (error)
      console.error("[DOCUMENT STAGING CLEANUP]", error.code || "failed");
  }
};
