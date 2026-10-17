import express from "express";
import adminVotingRoutes from "./adminVoting.js";
import bcrypt from "bcryptjs";
import multer from "multer";
import zlib from "zlib";
import { validateIdFiles, uploadPrivateIds, removePrivateIds, ID_BUCKET } from "../lib/residentIds.js";
import { persistentLimit } from "../middleware/persistentLimit.js";
import { getConcernPhotoUrl } from "../lib/concernEvidence.js";
import { requireSupabase } from "../lib/supabase.js";
import { ensureCommunityProjectForElection } from "../lib/projects.js";
import { mapVotingRpcError } from "../lib/votingOutcome.js";
import { uploadAsset } from "../lib/storage.js";
import { sendAccountCreatedEmail, sendPasswordResetEmail, sendSystemEmail } from "../lib/mailer.js";
import { validateResendConfig } from "../lib/env.js";
import { requireAuth, requireCurrentUser, requireRole } from "../middleware/auth.js";
import { adminActivityMiddleware, logAudit } from "../utils/audit.js";
import { createAuditWorkbook } from "../lib/auditExcel.js";
import { cleanAuditValue } from "../utils/auditValues.js";
import { configuredHotlines, validateHotlines } from "../lib/hotlines.js";
import { validateConcernLimits } from "../lib/concernLimits.js";
import { attachCaseHistories, parseNewCaseResponse, updateCaseWithHistory } from "../lib/caseHistory.js";
import { assertActiveMasterLabel } from "../lib/masterData.js";
import {
  buildUsername,
  createTemporaryPassword,
  ensureAdult,
  normalizeRole,
  normalizePhoneNumber,
  sanitizeUser,
} from "../utils/helpers.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const idUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 5, fields: 35, parts: 45 } });

router.use(requireAuth, requireCurrentUser(), requireRole("admin"));
router.use(adminActivityMiddleware("admin"));
router.use(adminVotingRoutes);

const ensure = (value, message) => {
  if (!value) throw Object.assign(new Error(message), { status: 400 });
};

const splitName = (fullName = "") => {
  const parts = `${fullName}`.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.length > 1 ? parts[parts.length - 1] : parts[0] || "",
    middleName: parts.length > 2 ? parts.slice(1, -1).join(" ") : "",
  };
};

const ensureUniqueUsername = async (db, baseUsername) => {
  let candidate = baseUsername;
  let counter = 1;

  while (true) {
    const { data, error } = await db.from("users").select("id").eq("username", candidate).maybeSingle();
    if (error) throw error;
    if (!data) return candidate;
    counter += 1;
    candidate = `${baseUsername}.${counter}`;
  }
};

const getResidentRecipients = async (db) => {
  const { data, error } = await db
    .from("users")
    .select("id, email, full_name, first_name")
    .eq("role", "resident")
    .eq("is_active", true);
  if (error) throw error;
  return data || [];
};

const notifyResidents = async (db, residents, { title, body, kind = "info" }) => {
  if (!residents.length) return;

  const { error } = await db.from("notifications").insert(
    residents.map((resident) => ({
      user_id: resident.id,
      title,
      body,
      kind,
      broadcast: false,
    }))
  );

  if (error) throw error;

  await Promise.all(
    residents
      .filter((resident) => resident.email)
      .map((resident) =>
        sendSystemEmail({
          to: resident.email,
          subject: title,
          text: body,
        }).catch((emailError) => {
          console.warn(`[EMAIL NOTIFICATION ERROR] ${resident.email}: ${emailError.message}`);
        })
      )
  );
};

const parseBoolean = (value, fallback = true) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return `${value}`.toLowerCase() !== "false";
};

const normalizeHeader = (value = "") => `${value}`.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const parseDelimitedText = (text) => {
  const clean = `${text}`.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!clean) return [];

  const firstLine = clean.split("\n")[0] || "";
  const delimiter = ["\t", ",", ";"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    const next = clean[index + 1];

    if (char === "\"") {
      if (quoted && next === "\"") {
        field += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && char === delimiter) {
      row.push(field.trim());
      field = "";
      continue;
    }

    if (!quoted && char === "\n") {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field.trim());
  rows.push(row);
  return rows.filter((item) => item.some(Boolean));
};

const getCell = (row, headerMap, names) => {
  for (const name of names) {
    const index = headerMap.get(normalizeHeader(name));
    if (index !== undefined) return row[index] || "";
  }
  return "";
};

const normalizeAddress = (value = "") => `${value}`.trim().toLowerCase().replace(/\s+/g, " ");

const createHouseholdRef = () => `HH-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const buildCensusPayload = (body, { allowId = false } = {}) => {
  const members = Number(body.members ?? 1);
  const householdName = `${body.household_name || body.householdName || ""}`.trim();
  const purok = `${body.purok || ""}`.trim();
  const address = `${body.address || body.house_number || body.houseNumber || ""}`.trim();
  const status = `${body.status || "active"}`.trim().toLowerCase();
  const householdRef = `${body.household_ref || body.householdRef || ""}`.trim() || createHouseholdRef();

  ensure(householdName, "Household name is required.");
  ensure(purok, "Purok is required.");
  ensure(address, "Address is required.");
  ensure(Number.isInteger(members) && members >= 0, "Members must be a non-negative whole number.");
  ensure(["active", "for update"].includes(status), "Status must be Active or For Update.");

  const payload = {
    household_ref: householdRef,
    household_name: householdName,
    purok,
    members,
    contact_number:`${body.contactNumber ?? body.contact_number ?? ''}`.trim(),
    housing_tenure:body.housingTenure ?? body.housing_tenure ?? null,
    residency_since:body.residencySince ?? body.residency_since ?? null,
    address,
    // Retained for compatibility with V3 databases and old reports.
    house_number: address,
    status,
    updated_at: new Date().toISOString(),
  };
  if (allowId && body.id) payload.id = body.id;
  return payload;
};

const dedupeHouseholds = (rows = []) => {
  const seen = new Map();
  for (const row of rows) {
    const key = `${row.household_ref || ""}`.trim().toLowerCase() || `${row.id || ""}` || normalizeAddress(row.address || row.house_number);
    if (!seen.has(key)) seen.set(key, { ...row, address: row.address || row.house_number || "", household_ref: row.household_ref || "" });
  }
  return Array.from(seen.values()).sort((a, b) => `${a.address || ""}`.localeCompare(`${b.address || ""}`));
};

const findCensusDuplicate = async (db, payload, excludeId = null) => {
  let refQuery = db.from("census_households").select("id, household_ref, address, house_number").eq("household_ref", payload.household_ref).limit(1);
  if (excludeId) refQuery = refQuery.neq("id", excludeId);
  const refResult = await refQuery;
  if (!refResult.error && refResult.data?.[0]) return refResult.data[0];

  let addressQuery = db.from("census_households").select("id, household_ref, address, house_number").ilike("address", payload.address).limit(1);
  if (excludeId) addressQuery = addressQuery.neq("id", excludeId);
  const addressResult = await addressQuery;
  if (!addressResult.error && addressResult.data?.[0]) return addressResult.data[0];

  // Backward-compatible lookup for a V3 database before migration.
  if (addressResult.error) {
    let legacyQuery = db.from("census_households").select("id, house_number").ilike("house_number", payload.address).limit(1);
    if (excludeId) legacyQuery = legacyQuery.neq("id", excludeId);
    const legacyResult = await legacyQuery;
    if (!legacyResult.error && legacyResult.data?.[0]) return legacyResult.data[0];
  }
  return null;
};

const insertCensusHousehold = async (db, payload) => {
  const { data, error } = await db.from("census_households").insert(payload).select("*").single();
  if (error) {
    // Fallback for V3 databases while still allowing the application to boot before the migration is run.
    if (`${error.message || ""}`.toLowerCase().includes("household_ref") || `${error.message || ""}`.toLowerCase().includes("address")) {
      const legacy = {
        household_name: payload.household_name,
        purok: payload.purok,
        members: payload.members,
        house_number: payload.address,
        status: payload.status,
        updated_at: payload.updated_at,
      };
      const legacyInsert = await db.from("census_households").insert(legacy).select("*").single();
      if (legacyInsert.error) throw legacyInsert.error;
      return { ...legacyInsert.data, address: legacyInsert.data.house_number, household_ref: "" };
    }
    throw error;
  }
  return data;
};

const xmlDecode = (value = "") =>
  `${value}`
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const xmlEncode = (value = "") =>
  `${value ?? ""}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const columnIndex = (cellRef = "") => {
  const letters = `${cellRef}`.match(/^[A-Z]+/i)?.[0] || "A";
  return [...letters.toUpperCase()].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
};

const columnName = (index) => {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
};

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const dosDateTime = (date = new Date()) => ({
  dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  dosDate: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
});

const createZip = (entries) => {
  const fileParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosDate, dosTime } = dosDateTime();

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, "utf8");
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    fileParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...fileParts, centralDirectory, end]);
};

const buildXlsx = (rows) => {
  const sheetRows = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((value, cellIndex) => {
            const ref = `${columnName(cellIndex)}${rowIndex + 1}`;
            return typeof value === "number"
              ? `<c r="${ref}"><v>${value}</v></c>`
              : `<c r="${ref}" t="inlineStr"><is><t>${xmlEncode(value)}</t></is></c>`;
          })
          .join("")}</row>`
    )
    .join("");

  return createZip([
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        "</Types>",
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>",
    },
    {
      name: "xl/workbook.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Households" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        "</Relationships>",
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        sheetRows +
        "</sheetData></worksheet>",
    },
  ]);
};

const unzipXlsxEntries = (buffer) => {
  let eocdOffset = -1;
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocdOffset = index;
      break;
    }
  }
  if (eocdOffset === -1) throw Object.assign(new Error("Invalid Excel file."), { status: 400 });

  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  let offset = centralDirectoryOffset;

  while (offset < buffer.length && buffer.readUInt32LE(offset) === 0x02014b50) {
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const content = method === 8 ? zlib.inflateRawSync(compressed) : compressed;
    entries.set(fileName, content.toString("utf8"));
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
};

const parseSharedStrings = (xml = "") => {
  const strings = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const text = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((item) => xmlDecode(item[1])).join("");
    strings.push(text);
  }
  return strings;
};

const parseXlsxRows = (buffer) => {
  const entries = unzipXlsxEntries(buffer);
  const sheet = entries.get("xl/worksheets/sheet1.xml");
  if (!sheet) throw Object.assign(new Error("Excel file must contain a Sheet1 worksheet."), { status: 400 });

  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml") || "");
  const rows = [];

  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = attrs.match(/\br="([^"]+)"/)?.[1] || "";
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] || "";
      const rawValue = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "";
      const inlineText = body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/)?.[1] || "";
      const value = type === "s" ? sharedStrings[Number(rawValue)] || "" : xmlDecode(inlineText || rawValue);
      row[columnIndex(ref)] = `${value}`.trim();
    }
    if (row.some(Boolean)) rows.push(row);
  }

  return rows;
};

const parseUploadedRows = (file) => {
  const name = `${file.originalname || ""}`.toLowerCase();
  if (name.endsWith(".xlsx")) return parseXlsxRows(file.buffer);
  return parseDelimitedText(file.buffer.toString("utf8"));
};

const getElectionMetrics = async (db, electionId) => {
  const [election, options, votes, completions, residents] = await Promise.all([
    db.from("elections").select("*").eq("id", electionId).single(),
    db.from("election_options").select("*").eq("election_id", electionId).order("created_at"),
    db.from("votes").select("id, user_id").eq("election_id", electionId),
    db.from("project_completions").select("id, user_id").eq("election_id", electionId),
    db.from("users").select("id", { count: "exact", head: true }).eq("role", "resident").eq("is_active", true),
  ]);

  if (election.error) throw election.error;
  if (options.error) throw options.error;
  if (votes.error) throw votes.error;
  if (completions.error) throw completions.error;

  const totalVotes = votes.data?.length || 0;
  const eligibleVoters = residents.count || 0;
  const optionRows = options.data || [];
  const winner = totalVotes > 0 ? [...optionRows].sort((a, b) => Number(b.votes_count || 0) - Number(a.votes_count || 0))[0] || null : null;

  return {
    id: election.data.id,
    title: election.data.title,
    description: election.data.description,
    status: election.data.status,
    startsAt: election.data.starts_at,
    endsAt: election.data.ends_at,
    imageUrl: election.data.image_url,
    totalVotes,
    eligibleVoters,
    notVotedCount: Math.max(eligibleVoters - totalVotes, 0),
    participationRate: eligibleVoters ? Number(((totalVotes / eligibleVoters) * 100).toFixed(1)) : 0,
    completionCount: completions.data?.length || 0,
    winner: winner
      ? {
          id: winner.id,
          name: winner.name,
          votes: Number(winner.votes_count || 0),
        }
      : null,
    options: optionRows.map((option) => ({
      id: option.id,
      name: option.name,
      description: option.description,
      votes: Number(option.votes_count || 0),
      percentage: totalVotes ? Number(((Number(option.votes_count || 0) / totalVotes) * 100).toFixed(1)) : 0,
    })),
  };
};

const tableCrud = ({ table, label, fileField, fileFolder, filePrefix, mapPayload }) => {
  router.get(`/${table}`, async (_req, res, next) => {
    try {
      const db = requireSupabase();
      const { data, error } = await db.from(table).select("*").order("created_at", { ascending: false });
      if (error) throw error;
      res.json({ [table]: data || [] });
    } catch (error) {
      next(error);
    }
  });

  router.post(`/${table}`, upload.single(fileField || "file"), async (req, res, next) => {
    try {
      const db = requireSupabase();
      const assetUrl =
        fileField && req.file
          ? await uploadAsset({
              file: req.file,
              folder: fileFolder || table,
              prefix: filePrefix || label,
            })
          : null;
      const payload = mapPayload ? await mapPayload({ body: req.body, assetUrl, req, db }) : { ...req.body };
      const { data, error } = await db.from(table).insert(payload).select("*").single();
      if (error) throw error;

      await logAudit({
        actorId: req.currentUser.id,
        actorRole: normalizeRole(req.currentUser.role),
        action: `create_${label}`,
        entityType: table,
        entityId: data.id,
        details: payload,
      });

      res.status(201).json({ item: data });
    } catch (error) {
      next(error);
    }
  });

  router.patch(`/${table}/:id`, upload.single(fileField || "file"), async (req, res, next) => {
    try {
      const db = requireSupabase();
      const assetUrl =
        fileField && req.file
          ? await uploadAsset({
              file: req.file,
              folder: fileFolder || table,
              prefix: `${filePrefix || label}-${req.params.id}`,
            })
          : null;
      const payload = mapPayload
        ? await mapPayload({ body: req.body, assetUrl, req, db, existingId: req.params.id })
        : { ...req.body };
      const { data, error } = await db.from(table).update(payload).eq("id", req.params.id).select("*").single();
      if (error) throw error;

      await logAudit({
        actorId: req.currentUser.id,
        actorRole: normalizeRole(req.currentUser.role),
        action: `update_${label}`,
        entityType: table,
        entityId: req.params.id,
        details: payload,
      });

      res.json({ item: data });
    } catch (error) {
      next(error);
    }
  });

  router.delete(`/${table}/:id`, async (req, res, next) => {
    try {
      const db = requireSupabase();
      const { error } = await db.from(table).delete().eq("id", req.params.id);
      if (error) throw error;

      await logAudit({
        actorId: req.currentUser.id,
        actorRole: normalizeRole(req.currentUser.role),
        action: `delete_${label}`,
        entityType: table,
        entityId: req.params.id,
        details: {},
      });

      res.json({ message: `${label} deleted.` });
    } catch (error) {
      next(error);
    }
  });
};

router.get("/dashboard", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const [users, requests, officials, elections, logs, complaints, idRequests, borrowingRequests] = await Promise.all([
      db.from("users").select("*").order("created_at", { ascending: false }),
      db.from("requests").select("*").order("created_at", { ascending: false }),
      db.from("officials").select("*"),
      db.from("elections").select("*").order("created_at", { ascending: false }),
      db.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(30),
      db.from("complaints").select("id, status, created_at"),
      db.from("id_requests").select("id, status, preferred_date, time_slot, created_at"),
      db.from("borrowing_requests").select("id, status, due_at, created_at"),
    ]);

    if (users.error) throw users.error;
    if (requests.error) throw requests.error;
    if (officials.error) throw officials.error;
    if (elections.error) throw elections.error;
    if (logs.error) throw logs.error;
    if (complaints.error) throw complaints.error;
    if (idRequests.error) throw idRequests.error;
    if (borrowingRequests.error) throw borrowingRequests.error;

    const residents = (users.data || []).filter((user) => normalizeRole(user.role) === "resident");
    const activeResidents = residents.filter((user) => user.is_active);
    const pendingRequests = (requests.data || []).filter((item) => item.status !== "completed").length;
    const activeOfficials = (officials.data || []).filter((item) => item.is_active).length;
    const openElections = (elections.data || []).filter((item) => item.status === "live").length;
    const pendingConcerns = (complaints.data || []).filter((item) => item.status === "pending").length;
    const pendingBorrowing = (borrowingRequests.data || []).filter((item) => item.status === "pending").length;
    const now = Date.now();
    const overdueBorrowing = (borrowingRequests.data || []).filter((item) => item.status === "borrowed" && item.due_at && new Date(item.due_at).getTime() < now).length;
    const today = new Date().toISOString().slice(0, 10);
    const idPickupsToday = (idRequests.data || []).filter((item) => ["confirmed", "rescheduled"].includes(item.status) && item.preferred_date === today).length;

    const requestsByDateMap = new Map();
    for (const item of requests.data || []) {
      const dateKey = new Date(item.created_at).toISOString().slice(0, 10);
      const row = requestsByDateMap.get(dateKey) || { date: dateKey };
      row[item.request_type] = (row[item.request_type] || 0) + 1;
      requestsByDateMap.set(dateKey, row);
    }

    const votingParticipation = [];
    for (const election of elections.data || []) {
      const metrics = await getElectionMetrics(db, election.id);
      votingParticipation.push({
        election: election.title,
        participationRate: metrics.participationRate,
        totalVotes: metrics.totalVotes,
      });
    }

    const actorNameById = new Map(
      (users.data || []).map((item) => [
        item.id,
        item.full_name || [item.first_name, item.last_name].filter(Boolean).join(" ") || item.username || null,
      ])
    );

    const normalizedLogs = (logs.data || []).map((item) => ({
      ...item,
      actor_name: actorNameById.get(item.actor_id) || null,
    }));

    const recentActivity = (
      normalizedLogs.filter((item) => item.action !== "login").length
        ? normalizedLogs.filter((item) => item.action !== "login")
        : normalizedLogs
    ).slice(0, 10);

    res.json({
      stats: {
        totalResidents: residents.length,
        pendingRequests,
        activeOfficials,
        openElections,
        pendingConcerns,
        pendingBorrowing,
        overdueBorrowing,
        idPickupsToday,
      },
      charts: {
        requestsByType: Array.from(requestsByDateMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
        residentStatusBreakdown: [
          { name: "Active", value: activeResidents.length },
          { name: "Inactive", value: residents.filter((user) => !user.is_active).length },
          { name: "Pending", value: residents.filter((user) => user.status !== "approved").length },
        ],
        votingParticipation,
      },
      recentActivity,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/users", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db
      .from("users")
      .select("*")
      .eq("role", "resident")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ users: (data || []).map(sanitizeUser) });
  } catch (error) {
    next(error);
  }
});

router.post("/users", idUpload.array("idImages", 5), persistentLimit("admin-create-resident", {max:10,windowSeconds:3600}), async (req, res, next) => {
  try {
    const db = requireSupabase();
    const firstName = `${req.body.firstName || ""}`.trim();
    const middleName = `${req.body.middleName || ""}`.trim();
    const lastName = `${req.body.lastName || ""}`.trim();
    const suffix = `${req.body.suffix || ""}`.trim();
    const fullName = [firstName,middleName,lastName,suffix].filter(Boolean).join(" ");
    const address = `${req.body.address || ""}`.trim();
    const purok = `${req.body.purok || ""}`.trim();
    const contactNumber = normalizePhoneNumber(req.body.phoneNumber || req.body.contactNumber || "");
    const email = `${req.body.email || ""}`.trim().toLowerCase();
    const role = normalizeRole(req.body.role || "resident");
    const birthdate = req.body.birthdate || null;

    if (role !== "resident") {
      throw Object.assign(new Error("Only super admins can create admin accounts."), { status: 403 });
    }

    ensure(firstName && lastName, "First name and last name are required.");
    for (const [val,label] of [[firstName,'First name'],[middleName,'Middle name'],[lastName,'Last name'],[suffix,'Suffix']]) {
      if (val.length > 100) throw Object.assign(new Error(`${label} is too long.`), {status:400});
    }
    for(const [key,label] of [['civilStatus','Civil status'],['citizenship','Citizenship'],['placeOfBirth','Place of birth']]) {
      if(String(req.body[key]||'').length>160)throw Object.assign(new Error(`${label} is too long.`),{status:400});
    }
    const sex = `${req.body.sex || ''}`.trim() || null;
    if (sex && !['male','female','other','prefer_not_to_say'].includes(sex)) throw Object.assign(new Error('Invalid sex selection.'),{status:400});
    const {data: allowedIds,error: idTypesError} = await db.from('resident_id_types').select('id,label,is_active');
    if (idTypesError) throw idTypesError;
    const validatedIds = validateIdFiles(req.files,req.body.idMetadata,allowedIds || []);
    ensure(address, "Address is required.");
    ensure(purok, "Purok is required.");
    ensure(contactNumber, "Phone number is required.");
    ensure(email, "Email is required for resident accounts.");
    if (role === "resident") ensureAdult(birthdate);
    await assertActiveMasterLabel(db, "purok", purok);
    // Fail before creating a database account if the verified-domain email
    // sender has not been configured on the backend deployment.
    validateResendConfig();

    const nameParts = {firstName,middleName,lastName};
    const usernameBase = buildUsername({
      fullName,
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
    });
    const username = await ensureUniqueUsername(db, usernameBase);
    const tempPassword = createTemporaryPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const payload = {
      full_name: fullName,
      first_name: nameParts.firstName,
      middle_name: nameParts.middleName,
      last_name: nameParts.lastName,
      suffix,
      sex,
      civil_status: `${req.body.civilStatus || ''}`.trim() || null,
      citizenship: `${req.body.citizenship || ''}`.trim() || null,
      place_of_birth: `${req.body.placeOfBirth || ''}`.trim() || null,
      residency_since: req.body.residencySince || null,
      email,
      password_hash: passwordHash,
      address,
      purok,
      contact_number: contactNumber,
      role,
      status: "approved",
      email_verified: Boolean(email),
      email_verified_at: email ? new Date().toISOString() : null,
      verification_provider: "admin_created",
      has_voted: false,
      birthdate,
      username,
      must_change_password: true,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await db.from("users").insert(payload).select("*").single();
    if (error) throw error;

    let uploadedIdPaths = [];
    try {
      uploadedIdPaths = (await uploadPrivateIds(validatedIds, data.id, req.currentUser.id)).map(item=>item.storage_path);
    } catch (idError) {
      const {error: cleanupError} = await db.from('users').delete().eq('id',data.id);
      if (cleanupError) throw Object.assign(new Error('ID upload failed and account cleanup needs staff review.'), {status:500,code:'ACCOUNT_CREATION_REVIEW_REQUIRED'});
      throw idError;
    }
    let emailDelivery = { delivered: false, reason: "unknown" };

    try {
      emailDelivery = await sendAccountCreatedEmail({
        email,
        fullName,
        username,
        temporaryPassword: tempPassword,
        role,
      });
    } catch (emailError) {
      console.warn("[EMAIL ACCOUNT ERROR]", {
        code: emailError.code || "EMAIL_PROVIDER_ERROR",
        providerStatus: emailError.providerStatus || null,
        message: emailError.message,
      });
      emailDelivery = {
        delivered: false,
        reason: emailError.code === "EMAIL_SEND_TIMEOUT" ? "timeout" : "send_failed",
        providerStatus: emailError.providerStatus || null,
      };
    }

    // Resident creation is only considered complete when the one-time credentials are accepted
    // by the configured email provider. Never expose a newly-created password in the API response.
    if (!emailDelivery?.delivered) {
      const { error: rollbackError } = await db.from("users").delete().eq("id", data.id);
      if (!rollbackError) await removePrivateIds(uploadedIdPaths);
      if (rollbackError) {
        console.error(`[RESIDENT CREATE ROLLBACK ERROR] ${data.id}: ${rollbackError.message}`);
        throw Object.assign(new Error("Email failed and account cleanup could not be confirmed. Check the resident list before trying again."), {
          status: 500,
          code: "ACCOUNT_CREATION_REVIEW_REQUIRED",
        });
      }
      const providerStatus = emailDelivery.providerStatus;
      const message = emailDelivery.reason === "timeout"
        ? "Resend did not respond in time. The resident account was not created. Please retry."
        : providerStatus === 401 || providerStatus === 403
          ? "Resend rejected the API key or sending domain. Check the backend's Resend configuration."
          : providerStatus === 422 || providerStatus === 400
            ? "Resend rejected the sender or recipient address. Check the email address and verified sending domain."
            : providerStatus === 429
              ? "Resend rate limit reached. Wait a moment and try again."
              : "Resend could not accept the login email. Check your backend and Resend logs; the resident account was not created.";
      throw Object.assign(new Error(message), {
        status: 502,
        code: "ACCOUNT_EMAIL_DELIVERY_FAILED",
      });
    }

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: role === "admin" ? "create_admin_user" : "create_resident_user",
      entityType: "user",
      entityId: data.id,
      details: { username, role, emailDelivered: true, idEvidenceCount: uploadedIdPaths.length },
    });

    res.status(201).json({ user: sanitizeUser(data), emailDelivery });
  } catch (error) {
    next(error);
  }
});

router.get('/resident-id-types', async (_req,res,next) => {
  try {
    const {data,error}=await requireSupabase().from('resident_id_types').select('id,label,is_active').order('label');
    if(error) throw error;
    res.json({types:data||[]});
  } catch(error){next(error);}
});
router.post('/resident-id-types', persistentLimit('admin-id-catalog',{max:20,windowSeconds:3600}), async (req,res,next) => {
  try {
    const label=`${req.body.label||''}`.trim();
    if(label.length<2 || label.length>80 || /[<>]/.test(label)) throw Object.assign(new Error('ID type name must be 2–80 characters.'),{status:400});
    const {data,error}=await requireSupabase().from('resident_id_types').insert({label}).select('id,label,is_active').single();
    if(error) throw error;
    await logAudit({actorId:req.currentUser.id,actorRole:req.currentUser.role, action:'add_resident_id_type',entityType:'resident_id_type',entityId:data.id,details:{label},req});
    res.status(201).json({type:data});
  } catch(error){next(error);}
});
router.get('/users/:userId/id-evidence', async (req,res,next)=>{
  try {
    const db=requireSupabase();
    const {data:user,error:ue}=await db.from('users').select('id,role').eq('id',req.params.userId).maybeSingle();
    if(ue)throw ue;
    if(!user || normalizeRole(user.role)!=='resident') return res.status(404).json({message:'Resident not found.'});
    const {data,error}=await db.from('resident_id_evidence').select('id,document_label,created_at,byte_size,content_type').eq('user_id',user.id).order('created_at');
    if(error)throw error;
    res.json({documents:data||[]});
  }catch(error){next(error);}
});
router.get('/users/:userId/id-evidence/:evidenceId/url', persistentLimit('admin-id-view',{max:60,windowSeconds:3600}), async (req,res,next)=>{
  try {
    const db=requireSupabase();
    const {data,error}=await db.from('resident_id_evidence').select('id,user_id,storage_path,document_label').eq('id',req.params.evidenceId).eq('user_id',req.params.userId).maybeSingle();
    if(error)throw error;
    if(!data)return res.status(404).json({message:'ID image not found.'});
    const signed=await db.storage.from(ID_BUCKET).createSignedUrl(data.storage_path,60);
    if(signed.error)throw signed.error;
    await logAudit({actorId:req.currentUser.id,actorRole:req.currentUser.role,action:'view_resident_id',eventCategory:'activity',entityType:'resident_id_evidence',entityId:data.id,details:{residentId:data.user_id,documentLabel:data.document_label},req});
    res.json({url:signed.data.signedUrl,expiresIn:60});
  }catch(error){next(error);}
});

router.patch("/users/:userId", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: targetUser, error: targetError } = await db
      .from("users")
      .select("id, role, email, full_name, first_name, username")
      .eq("id", req.params.userId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!targetUser) throw Object.assign(new Error("User not found."), { status: 404 });
    if (normalizeRole(targetUser.role) !== "resident") {
      throw Object.assign(new Error("Only super admins can maintain admin accounts."), { status: 403 });
    }

    const updates = {};
    if (req.body.firstName !== undefined || req.body.lastName !== undefined) {
      const firstName = `${req.body.firstName || ''}`.trim();
      const lastName = `${req.body.lastName || ''}`.trim();
      const middleName = `${req.body.middleName || ''}`.trim();
      const suffix = `${req.body.suffix || ''}`.trim();
      ensure(firstName && lastName,'First and last name are required.');
      Object.assign(updates,{first_name:firstName,middle_name:middleName,last_name:lastName,suffix,full_name:[firstName,middleName,lastName,suffix].filter(Boolean).join(' ')});
    } else if (req.body.fullName !== undefined) {
      const fullName = `${req.body.fullName}`.trim();
      ensure(fullName, "Full name is required.");
      const parts = splitName(fullName);
      updates.full_name = fullName;
      updates.first_name = parts.firstName;
      updates.middle_name = parts.middleName;
      updates.last_name = parts.lastName;
    }
    for (const [input,column] of [['sex','sex'],['civilStatus','civil_status'],['citizenship','citizenship'],['placeOfBirth','place_of_birth'],['residencySince','residency_since']]) {
      if (req.body[input] !== undefined) updates[column] = req.body[input] || null;
    }
    if (updates.sex && !['male','female','other','prefer_not_to_say'].includes(updates.sex)) throw Object.assign(new Error('Invalid sex selection.'), {status:400});
    if (req.body.address !== undefined) updates.address = `${req.body.address}`.trim();
    if (req.body.purok !== undefined) updates.purok = `${req.body.purok}`.trim();
    if (req.body.contactNumber !== undefined || req.body.phoneNumber !== undefined) {
      updates.contact_number = normalizePhoneNumber(req.body.contactNumber || req.body.phoneNumber);
    }
    if (req.body.email !== undefined) {
      const email = `${req.body.email || ""}`.trim().toLowerCase();
      ensure(email, "Email is required for resident accounts.");
      updates.email = email;
      updates.email_verified = true;
      updates.email_verified_at = new Date().toISOString();
    }
    if (req.body.birthdate !== undefined) {
      if (req.body.birthdate) ensureAdult(req.body.birthdate);
      updates.birthdate = req.body.birthdate || null;
    }
    if (req.body.isActive !== undefined) updates.is_active = parseBoolean(req.body.isActive, true);
    if (req.body.status !== undefined) updates.status = req.body.status;
    if (req.body.role !== undefined) {
      const role = normalizeRole(req.body.role);
      if (role !== "resident") {
        throw Object.assign(new Error("Only super admins can assign admin roles."), { status: 403 });
      }
      updates.role = role;
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await db.from("users").update(updates).eq("id", req.params.userId).select("*").single();
    if (error) throw error;

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "update_user",
      entityType: "user",
      entityId: req.params.userId,
      details: { changedFields:Object.keys(updates) },
    });

    res.json({ user: sanitizeUser(data) });
  } catch (error) {
    next(error);
  }
});

// Reset credentials are staged: the resident's existing password keeps working
// until they successfully sign in with the emailed temporary password.
router.post("/users/:userId/reset-password", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: resident, error: lookupError } = await db.from("users")
      .select("id, role, is_active, status, email, full_name, first_name, username, pending_password_hash, pending_password_expires_at, pending_password_requested_at")
      .eq("id", req.params.userId).maybeSingle();
    if (lookupError) throw lookupError;
    if (!resident) throw Object.assign(new Error("Resident not found."), { status: 404 });
    if (normalizeRole(resident.role) !== "resident") {
      throw Object.assign(new Error("Only resident accounts can receive a temporary password."), { status: 403 });
    }
    if (!resident.is_active || resident.status !== "approved") {
      throw Object.assign(new Error("Activate the resident account before issuing a reset."), { status: 409 });
    }
    if (!resident.email) {
      throw Object.assign(new Error("Resident has no email address on file. Add an email before requesting a reset."), { status: 400 });
    }
    if (resident.pending_password_requested_at && Date.now() - new Date(resident.pending_password_requested_at).getTime() < 120_000) {
      throw Object.assign(new Error("Please wait two minutes before issuing another temporary password."), { status: 429 });
    }
    validateResendConfig();
    const temporaryPassword = createTemporaryPassword();
    const pendingHash = await bcrypt.hash(temporaryPassword, 12);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const { error: stageError } = await db.from("users").update({
      pending_password_hash: pendingHash,
      pending_password_expires_at: expiresAt,
      pending_password_requested_at: now,
      updated_at: now,
    }).eq("id", resident.id);
    if (stageError) throw stageError;

    let emailDelivery;
    try {
      emailDelivery = await sendPasswordResetEmail({
        email: resident.email,
        fullName: resident.full_name || resident.first_name,
        username: resident.username,
        temporaryPassword,
        role: "resident",
      });
    } catch (emailError) {
      console.warn("[RESIDENT RESET EMAIL ERROR]", { code: emailError.code || "PROVIDER_FAILURE", providerStatus: emailError.providerStatus || null });
      emailDelivery = { delivered: false, reason: emailError.code === "EMAIL_SEND_TIMEOUT" ? "timeout" : "send_failed" };
    }
    if (!emailDelivery?.delivered) {
      // Conditional restoration protects a newer concurrent request. No password
      // is revealed to staff, and the resident's existing login stays valid.
      const { error: restoreError } = await db.from("users").update({
        pending_password_hash: resident.pending_password_hash || null,
        pending_password_expires_at: resident.pending_password_expires_at || null,
        pending_password_requested_at: resident.pending_password_requested_at || null,
      }).eq("id", resident.id).eq("pending_password_hash", pendingHash);
      if (restoreError) throw Object.assign(new Error("Email was not accepted, and reset rollback could not be confirmed. Check the account before retrying."), { status: 503 });
      await logAudit({ actorId: req.currentUser.id, actorRole: normalizeRole(req.currentUser.role),
        action: "resident_password_reset_delivery_failed", entityType: "user", entityId: resident.id,
        module: "residents", outcome: "failed", details: { deliveryStatus: emailDelivery.reason } , req });
      throw Object.assign(new Error("The reset email could not be accepted by Resend. The resident's existing password is unchanged; please try again later."),
        { status: 502, code: "RESET_EMAIL_NOT_ACCEPTED" });
    }
    await logAudit({
      actorId: req.currentUser.id, actorRole: normalizeRole(req.currentUser.role),
      action: "resident_password_reset_issued", entityType: "user", entityId: resident.id,
      module: "residents", req,
      details: { emailAcceptedByProvider: true, expiresAt },
    });
    res.json({
      message: "Resend accepted the reset email. The resident can use the temporary password for 48 hours; their current password remains valid until they use it.",
      emailDelivery, expiresAt,
      user: { id: resident.id, username: resident.username, email: resident.email },
    });
  } catch (error) { next(error); }
});

// Discontinued: accepting a temporary password from an administrator's browser
// exposes a credential and could resend one that has been superseded. Issue a
// fresh staged reset instead (old login remains usable until it is redeemed).
router.post("/users/:userId/resend-temporary-password", (_req, _res, next) => {
  next(Object.assign(new Error("For security, issue a new reset email instead of resending a password from the browser."), { status: 410 }));
});

router.get('/complaints/:id/evidence',persistentLimit('admin-concern-evidence-view',{max:60,windowSeconds:3600}),async(req,res,next)=>{
 try{
  const db=requireSupabase();
  const {data:complaint,error}=await db.from('complaints').select('id').eq('id',req.params.id).maybeSingle();
  if(error)throw error;
  if(!complaint)return res.status(404).json({message:'Concern not found.'});
  const evidence=await getConcernPhotoUrl(complaint.id);
  if(evidence)await logAudit({actorId:req.currentUser.id,actorRole:req.currentUser.role,action:'view_concern_evidence',entityType:'complaint',entityId:complaint.id,req});
  res.json({evidence});
 }catch(error){next(error);}
});
router.get("/complaints", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db.from("complaints").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ complaints: await attachCaseHistories(db, "complaint", data || []) });
  } catch (error) {
    next(error);
  }
});

router.patch("/complaints/:id", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const status = `${req.body.status || ""}`.trim().toLowerCase();
    if (!["pending", "in_review", "resolved"].includes(status)) {
      throw Object.assign(new Error("Complaint status must be pending, in_review, or resolved."), { status: 400 });
    }
    const response = parseNewCaseResponse(req.body);
    const { data: existing, error: findError } = await db.from("complaints").select("id,status").eq("id", req.params.id).maybeSingle();
    if (findError) throw findError;
    if (!existing) throw Object.assign(new Error("Concern not found"), { status: 404 });
    if (status === "resolved" && existing.status !== "resolved" && response.message.length < 3) {
      throw Object.assign(new Error("Add a resolution explanation for the resident."), { status: 400 });
    }
    const data = await updateCaseWithHistory(db, { entityType: "complaint", id: req.params.id,
      currentStatus: req.body.expectedStatus || existing.status, status, response, actorId: req.currentUser.id, operationId: req.body.operationId });

    if (data.user_id && (status !== existing.status || (response.visibility === "resident" && response.message))) {
      await db.from("notifications").insert({
        user_id: data.user_id,
        title: status === existing.status ? "New response to your concern" : "Community concern updated",
        body: `Your concern is now ${status.replace("_", " ")}.${response.visibility === "resident" && response.message ? ` ${response.message}` : ""}`,
        kind: status === "resolved" ? "success" : "info",
        broadcast: false,
      });
    }

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "update_complaint",
      entityType: "complaint",
      entityId: data.id,
      details: { status, responseVisibility: response.visibility },
    });

    res.json({ complaint: data, message: "Community concern updated." });
  } catch (error) {
    next(error);
  }
});

router.get("/requests", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db
      .from("requests")
      .select("*, request_timeline(*)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ requests: await attachCaseHistories(db, "request", data || []) });
  } catch (error) {
    next(error);
  }
});

router.patch("/requests/:id", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const response = parseNewCaseResponse(req.body);
    const { data: existing, error: findError } = await db.from("requests").select("id,status").eq("id",req.params.id).maybeSingle();
    if (findError) throw findError;
    if (!existing) throw Object.assign(new Error("Document request not found"), { status: 404 });
    const data = await updateCaseWithHistory(db, { entityType: "request", id: req.params.id,
      currentStatus: req.body.expectedStatus || existing.status, status: req.body.status || existing.status,
      response, actorId: req.currentUser.id, operationId: req.body.operationId });
    const payload = { status: data.status, admin_note: response.visibility === "resident" ? response.message : "" };

    const shouldNotify = data.status !== existing.status || (response.visibility === "resident" && Boolean(response.message));
    if (shouldNotify) {
    const { data: resident } = await db.from("users").select("email, full_name, first_name").eq("id", data.user_id).maybeSingle();
    await sendSystemEmail({
      to: resident?.email,
      subject: data.status === existing.status ? "New response to your document request" : "Request status updated",
      text: `Your ${data.request_type} request is now ${payload.status}.${payload.admin_note ? ` Note: ${payload.admin_note}` : ""}`,
    }).catch((emailError) => {
      console.warn(`[EMAIL NOTIFICATION ERROR] ${resident?.email}: ${emailError.message}`);
    });
    await db.from("notifications").insert({
      user_id: data.user_id,
      title: data.status === existing.status ? "New response to your document request" : "Request status updated",
      body: `${data.request_type} is now ${payload.status}. ${payload.admin_note || ""}`.trim(),
      kind: "info",
      broadcast: false,
    });
    }

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "update_request",
      entityType: "request",
      entityId: req.params.id,
      details: { status: data.status, responseVisibility: response.visibility },
    });

    res.json({ request: data });
  } catch (error) {
    next(error);
  }
});

router.get("/id-requests", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db
      .from("id_requests")
      .select("*, users!id_requests_user_id_fkey(full_name, first_name, last_name, contact_number)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ requests: await attachCaseHistories(db, "id_request", data || []) });
  } catch (error) {
    next(error);
  }
});

router.patch("/id-requests/:id", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const response = parseNewCaseResponse(req.body);
    const { data: existing, error: findError } = await db.from("id_requests").select("id,status").eq("id",req.params.id).maybeSingle();
    if (findError) throw findError;
    if (!existing) throw Object.assign(new Error("Barangay ID request not found"), { status: 404 });
    const status = req.body.status || existing.status;
    if (status === "cancelled" && existing.status !== "cancelled" && response.message.length < 3) {
      throw Object.assign(new Error("An explanation is required when cancelling."), { status: 400 });
    }
    const extra = {};
    if (req.body.preferredDate !== undefined) extra.preferred_date = req.body.preferredDate;
    if (req.body.timeSlot !== undefined) extra.time_slot = req.body.timeSlot;
    const data = await updateCaseWithHistory(db, { entityType: "id_request", id: req.params.id,
      currentStatus: req.body.expectedStatus || existing.status, status,
      response, actorId: req.currentUser.id, extra, operationId: req.body.operationId });
    const payload = { status: data.status, preferred_date: data.preferred_date,
      time_slot: data.time_slot, admin_note: response.visibility === "resident" ? response.message : "" };

    const shouldNotify = data.status !== existing.status || (response.visibility === "resident" && Boolean(response.message));
    if (shouldNotify) {
    const { data: resident } = await db.from("users").select("email, full_name, first_name").eq("id", data.user_id).maybeSingle();
    await sendSystemEmail({
      to: resident?.email,
      subject: data.status === existing.status ? "New response about your Barangay ID request" : "Barangay ID schedule updated",
      text: `Your Barangay ID request is now ${payload.status}. Pickup: ${payload.preferred_date || "to be scheduled"} ${payload.time_slot || ""}. ${payload.admin_note || ""}`.trim(),
    }).catch((emailError) => {
      console.warn(`[EMAIL NOTIFICATION ERROR] ${resident?.email}: ${emailError.message}`);
    });
    await db.from("notifications").insert({
      user_id: data.user_id,
      title: data.status === existing.status ? "New response about your Barangay ID request" : "Barangay ID schedule updated",
      body: `Status: ${payload.status}. ${payload.admin_note || ""}`.trim(),
      kind: "info",
      broadcast: false,
    });
    }

    res.json({ request: data });
  } catch (error) {
    next(error);
  }
});

router.get("/content", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db.from("landing_content").select("*").order("key_name");
    if (error) throw error;
    res.json({ content: Object.fromEntries((data || []).map((item) => [item.key_name, item.value])) });
  } catch (error) {
    next(error);
  }
});

// Phase 7: hotline settings live in their own validated, concurrency-safe endpoint.
// The general content endpoint may only update the general office contact.
router.put("/content", async (req, res, next) => {
  try {
    const body = req.body || {};
    if (Object.keys(body).length !== 1 || !Object.hasOwn(body, "contact")) {
      const error = new Error("Use System Setup to edit hotlines; only general office contact is allowed here.");
      error.status = 400;
      throw error;
    }
    const contact = body.contact;
    if (!contact || typeof contact !== "object" || Array.isArray(contact)
      || Object.keys(contact).some((field) => !["phone", "email", "address", "facebook"].includes(field))
      || Object.values(contact).some((value) => typeof value !== "string" || value.length > 180)) {
      const error = new Error("Invalid general contact information."); error.status = 400; throw error;
    }
    const db = requireSupabase();
    const { error } = await db.from("landing_content").upsert({
      key_name: "contact", value: contact, updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    res.json({ message: "General contact information saved." });
  } catch (error) { next(error); }
});

router.get("/system-setup/hotlines", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db.from("landing_content")
      .select("value, updated_at").eq("key_name", "hotlines").maybeSingle();
    if (error) throw error;
    if (!data) { const error = new Error("Phase 7 hotline configuration is missing."); error.status = 503; throw error; }
    res.json({ hotlines: configuredHotlines({ hotlines: data.value }), updated_at: data.updated_at });
  } catch (error) { next(error); }
});

router.put("/system-setup/hotlines", async (req, res, next) => {
  try {
    const hotlines = validateHotlines(req.body?.hotlines);
    const version = req.body?.expectedUpdatedAt;
    if (typeof version !== "string" || !Number.isFinite(Date.parse(version))) {
      const error = new Error("Reload the latest hotline settings before saving."); error.status = 400; throw error;
    }
    const db = requireSupabase();
    const { data, error } = await db.rpc("bgy_phase7_save_hotlines", {
      p_hotlines: { hotlines }, p_expected_updated_at: version,
    });
    if (error) {
      if (error.code === "40001" || /updated by someone else/i.test(error.message || "")) {
        const conflict = new Error("Hotline settings were changed by another administrator. Reload before saving again.");
        conflict.status = 409; throw conflict;
      }
      throw error;
    }
    const saved = Array.isArray(data) ? data[0] : data;
    if (!saved?.updated_at) throw new Error("Hotline settings were not saved.");
    res.json({ message: "Hotline settings saved.", hotlines: validateHotlines(saved.value?.hotlines), updated_at: saved.updated_at });
  } catch (error) { next(error); }
});

// Phase 8: quota configuration is separate from hotlines and public contact.
router.get("/system-setup/concern-limits", async (_req, res, next) => {
  try {
    const { data, error } = await requireSupabase().from("landing_content")
      .select("value, updated_at").eq("key_name", "concern_submission_limits").maybeSingle();
    if (error) throw error;
    if (!data) throw Object.assign(new Error("Phase 8 concern policy is missing."), { status: 503 });
    res.json({ policy: validateConcernLimits(data.value), updated_at: data.updated_at });
  } catch (error) { next(error); }
});

router.put("/system-setup/concern-limits", async (req, res, next) => {
  try {
    const policy = validateConcernLimits(req.body?.policy);
    const expectedUpdatedAt = req.body?.expectedUpdatedAt;
    if (typeof expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(expectedUpdatedAt))) {
      throw Object.assign(new Error("Reload current concern limits before saving."), { status: 400 });
    }
    const { data, error } = await requireSupabase().rpc("bgy_phase8_save_concern_limits", {
      p_policy: policy,
      p_expected_updated_at: expectedUpdatedAt,
    });
    if (error) {
      if (error.code === "40001" || /changed by another administrator/i.test(error.message || "")) {
        throw Object.assign(new Error("Another administrator changed these limits. Reload before trying again."), { status: 409, code: "CONCERN_POLICY_STALE" });
      }
      throw error;
    }
    const saved = Array.isArray(data) ? data[0] : data;
    if (!saved?.updated_at) throw new Error("Concern submission settings were not saved.");
    res.json({ message: "Community concern limits saved.", policy: validateConcernLimits(saved.value), updated_at: saved.updated_at });
  } catch (error) { next(error); }
});

router.post("/broadcast", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const title = `${req.body.title || ""}`.trim();
    const body = `${req.body.body || ""}`.trim();
    ensure(title, "Title is required.");
    ensure(body, "Message is required.");

    const residents = await getResidentRecipients(db);
    await notifyResidents(db, residents, { title, body });

    res.json({ message: "Broadcast sent." });
  } catch (error) {
    next(error);
  }
});

router.post("/audit/page-view", async (req, res, next) => {
  try {
    const page = `${req.body.page || ""}`.trim().slice(0, 240);
    const module = `${req.body.module || "admin_portal"}`.trim().slice(0, 120) || "admin_portal";
    await logAudit({
      actorId: req.currentUser.id,
      actorName: req.currentUser.full_name || req.currentUser.fullName,
      actorRole: normalizeRole(req.currentUser.role),
      action: "admin_page_view",
      module,
      entityType: "admin_page",
      details: { page },
      outcome: "success",
      req,
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Phase 1 Audit history. Module/date/action filters are applied in PostgreSQL before
// pagination. Legacy V4 rows remain visible in the Activity/Legacy view.
const auditFilter = (db, params, { includeCount = false } = {}) => {
  let query = db.from("audit_logs").select("*", includeCount ? { count: "exact" } : undefined);
  const category = `${params.category || "all"}`;
  const module = `${params.module || "all"}`;
  const outcome = `${params.outcome || "all"}`;
  const actor = `${params.actor || ""}`.trim();
  const action = `${params.action || ""}`.trim();
  const search = `${params.search || ""}`.trim().slice(0, 100);
  if (["change", "activity", "security"].includes(category)) query = query.eq("event_category", category);
  if (category === "legacy") query = query.is("event_category", null);
  if (module !== "all") query = query.eq("module", module);
  if (["success", "failed", "denied", "partial"].includes(outcome)) query = query.eq("outcome", outcome);
  if (actor) query = query.eq("actor_id", actor);
  if (action) query = query.ilike("action", `%${action.replace(/[%,()\\]/g, "").slice(0, 100)}%`);
  if (search) {
    // Escape PostgREST OR operators; search remains a literal text fragment.
    const safe = search.replace(/[^a-zA-Z0-9 ._@-]/g, " ").trim();
    if (safe) query = query.or(["action","entity_type","entity_id","module","actor_name_snapshot","target_label"].map((key) => `${key}.ilike.%${safe}%`).join(","));
  }
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (params.from && datePattern.test(`${params.from}`)) query = query.gte("created_at", `${params.from}T00:00:00+08:00`);
  if (params.to && datePattern.test(`${params.to}`)) {
    const nextDay = new Date(`${params.to}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    query = query.lt("created_at", `${nextDay.toISOString().slice(0,10)}T00:00:00+08:00`);
  }
  return query.order("created_at", { ascending: false }).order("id", { ascending: false });
};

const auditEnrichNames = async (db, logs) => {
  const withoutName = [...new Set(logs.filter((item) => !item.actor_name_snapshot && item.actor_id).map((item) => item.actor_id))];
  let names = new Map();
  if (withoutName.length) {
    const result = await db.from("users").select("id, full_name, username").in("id", withoutName);
    if (result.error) throw result.error;
    names = new Map((result.data || []).map((user) => [user.id, user.full_name || user.username]));
  }
  return logs.map((log) => ({ ...log,
    details: cleanAuditValue(log.details), before_data: cleanAuditValue(log.before_data),
    after_data: cleanAuditValue(log.after_data), changed_fields: cleanAuditValue(log.changed_fields),
    actor_name: log.actor_name_snapshot || names.get(log.actor_id) || null,
  }));
};

router.get("/audit-logs", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const page = Math.max(1, Math.min(100000, Number(req.query.page || 1) || 1));
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 25) || 25));
    const from = (page - 1) * limit;
    const { data, error, count } = await auditFilter(db, req.query, { includeCount: true }).range(from, from + limit - 1);
    if (error) throw error;
    const logs = await auditEnrichNames(db, data || []);
    res.json({ logs, pagination: { page, limit, total: count || 0, totalPages: Math.max(1, Math.ceil((count || 0) / limit)) } });
  } catch (error) { next(error); }
});

router.get("/audit-logs/export", async (req, res, next) => {
  try {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const { from, to } = req.query;
    if (!datePattern.test(`${from || ""}`) || !datePattern.test(`${to || ""}`))
      throw Object.assign(new Error("Select a valid From and To date to export."), { status: 400 });
    const days = (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000;
    if (days < 0 || days > 366 || !Number.isFinite(days))
      throw Object.assign(new Error("Audit export date range must be between 0 and 366 days."), { status: 400 });
    const db = requireSupabase();
    // PostgREST/Supabase may cap a single request at 1,000 rows. Fetch EVERY
    // matching event in stable pages, bounded by a shared snapshot timestamp.
    // An incomplete report must be rejected, never silently downloaded.
    const snapshot = new Date().toISOString();
    const chunkSize = 500;
    const first = await auditFilter(db, req.query, { includeCount: true })
      .lte("created_at", snapshot).range(0, chunkSize - 1);
    if (first.error) throw first.error;
    const total = first.count || 0;
    if (total > 10000)
      throw Object.assign(new Error("More than 10,000 events match. Narrow the date range before exporting."), { status: 422 });
    const rows = [...(first.data || [])];
    for (let offset = rows.length; offset < total; offset += chunkSize) {
      const nextPage = await auditFilter(db, req.query).lte("created_at", snapshot)
        .range(offset, Math.min(total - 1, offset + chunkSize - 1));
      if (nextPage.error) throw nextPage.error;
      rows.push(...(nextPage.data || []));
    }
    if (rows.length !== total)
      throw Object.assign(new Error("Report data changed during export. Please retry."), { status: 409 });
    const logs = await auditEnrichNames(db, rows);
    const workbook = createAuditWorkbook(logs);
    // Audit report access is itself an activity. Await before releasing the file.
    await logAudit({ actorId: req.currentUser.id, actorRole: req.currentUser.role,
      action: "audit_report_exported", entityType: "audit_report", entityId: req.auditRequestId,
      eventCategory: "activity", required: true, details: { from, to, count: logs.length, filters: { category: req.query.category, module: req.query.module, outcome: req.query.outcome } }, req });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="barangayiba-audit-${from}-to-${to}.xlsx"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(workbook);
  } catch (error) { next(error); }
});



const PROJECT_STATUSES = new Set(["planned", "ongoing", "on_hold", "completed", "cancelled"]);

router.get("/projects", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 12)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    let query = db.from("community_projects").select("*", { count: "exact" });
    if (req.query.status && req.query.status !== "all") query = query.eq("status", req.query.status);
    const { data, error, count } = await query.order("updated_at", { ascending: false }).range(from, to);
    if (error) throw error;
    res.json({ projects: data || [], pagination: { page, limit, total: count || 0 } });
  } catch (error) {
    next(error);
  }
});

router.get("/projects/:id", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const [project, updates] = await Promise.all([
      db.from("community_projects").select("*").eq("id", req.params.id).single(),
      db.from("project_updates").select("*").eq("project_id", req.params.id).order("update_date", { ascending: false }).order("created_at", { ascending: false }),
    ]);
    if (project.error) throw project.error;
    if (updates.error) throw updates.error;
    res.json({ project: project.data, updates: updates.data || [] });
  } catch (error) {
    next(error);
  }
});

router.post("/projects/from-election/:electionId", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const project = await ensureCommunityProjectForElection(db, req.params.electionId, { createdBy: req.currentUser.id });
    if (!project) throw Object.assign(new Error("Only a finalized election with a unique winner can create a community project."), { status: 409 });
    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "create_winning_community_project",
      entityType: "community_project",
      entityId: project.id,
      module: "projects",
      details: { electionId: req.params.electionId, title: project.title },
      afterData: project,
      req,
    });
    res.status(201).json({ project, message: "Winning project is now available in Community Projects." });
  } catch (error) {
    next(error);
  }
});

router.patch("/projects/:id", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: existing, error: existingError } = await db.from("community_projects").select("*").eq("id", req.params.id).single();
    if (existingError) throw existingError;

    const updates = {};
    if (req.body.title !== undefined) updates.title = `${req.body.title || ""}`.trim();
    if (req.body.description !== undefined) updates.description = `${req.body.description || ""}`.trim();
    if (req.body.status !== undefined) {
      if (!PROJECT_STATUSES.has(req.body.status)) throw Object.assign(new Error("Invalid project status."), { status: 400 });
      updates.status = req.body.status;
    }
    if (req.body.progressPercentage !== undefined || req.body.progress_percentage !== undefined) {
      const progress = Number(req.body.progressPercentage ?? req.body.progress_percentage);
      if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw Object.assign(new Error("Progress must be a whole number from 0 to 100."), { status: 400 });
      updates.progress_percentage = progress;
    }
    for (const [bodyKey, dbKey] of [["plannedStartDate", "planned_start_date"], ["actualStartDate", "actual_start_date"], ["expectedCompletionDate", "expected_completion_date"]]) {
      if (req.body[bodyKey] !== undefined) updates[dbKey] = req.body[bodyKey] || null;
    }
    const reason = `${req.body.reason || ""}`.trim();
    if ((["on_hold", "cancelled"].includes(updates.status) ||
         existing.status === "completed" && updates.status && updates.status !== "completed" ||
         updates.progress_percentage !== undefined && updates.progress_percentage < existing.progress_percentage) && reason.length < 5) {
      throw Object.assign(new Error("Provide a reason for pausing, cancelling, correcting completion or reducing progress."), { status: 400 });
    }
    if (updates.status === "ongoing" && !existing.actual_start_date && !updates.actual_start_date) updates.actual_start_date = new Date().toISOString().slice(0, 10);
    if (updates.status === "completed") {
      updates.progress_percentage = 100;
      updates.completed_at = existing.completed_at || new Date().toISOString();
    }
    if (updates.status && updates.status !== "completed") updates.completed_at = null;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await db.rpc("bgy_phase10_update_project", {
      p_actor: req.currentUser.id, p_project: req.params.id,
      p_changes: updates, p_reason: reason || null,
    });
    if (error) throw mapVotingRpcError(error);

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "update_community_project",
      entityType: "community_project",
      entityId: data.id,
      module: "projects",
      beforeData: existing,
      afterData: data,
      details: updates,
      req,
    });
    res.json({ project: data, message: "Project updated." });
  } catch (error) {
    next(error);
  }
});

router.post("/projects/:id/updates", upload.single("image"), async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: project, error: projectError } = await db.from("community_projects").select("*").eq("id", req.params.id).single();
    if (projectError) throw projectError;
    const title = `${req.body.title || ""}`.trim();
    const description = `${req.body.description || ""}`.trim();
    ensure(title, "Update title is required.");
    ensure(description, "Update description is required.");

    let progress = req.body.progressPercentage === undefined || req.body.progressPercentage === "" ? null : Number(req.body.progressPercentage);
    if (progress !== null && (!Number.isInteger(progress) || progress < 0 || progress > 100)) throw Object.assign(new Error("Progress must be a whole number from 0 to 100."), { status: 400 });
    const status = req.body.projectStatus || null;
    if (status && !PROJECT_STATUSES.has(status)) throw Object.assign(new Error("Invalid project status."), { status: 400 });

    const imageUrl = await uploadAsset({ file: req.file, folder: "project-updates", prefix: `${project.id}-${title}` });
    const payload = {
      project_id: project.id,
      title,
      description,
      image_url: imageUrl,
      progress_percentage: progress,
      project_status: status,
      update_date: req.body.updateDate || new Date().toISOString().slice(0, 10),
      created_by: req.currentUser.id,
      updated_at: new Date().toISOString(),
    };
    const { data: saved, error: publishError } = await db.rpc("bgy_phase10_publish_project_update", {
      p_actor: req.currentUser.id, p_project: project.id,
      p_title: title, p_description: description, p_image_url: imageUrl,
      p_progress: progress, p_status: status,
      p_update_date: payload.update_date, p_reason: `${req.body.reason || ""}`.trim() || null,
    });
    if (publishError) throw mapVotingRpcError(publishError);
    const update = saved.update;
    const savedProject = saved.project;

    // Durable in-app notification is queued inside the publish transaction.
    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "publish_project_update",
      entityType: "project_update",
      entityId: update.id,
      module: "projects",
      beforeData: project,
      afterData: savedProject,
      details: payload,
      req,
    });
    res.status(201).json({ update, project: savedProject, message: "Project update published; resident notifications have been queued." });
  } catch (error) {
    next(error);
  }
});


router.patch("/projects/:projectId/updates/:updateId", upload.single("image"), async (req, res, next) => {
  try {
    const db = requireSupabase();
    const [{ data: project, error: projectError }, { data: existing, error: updateError }] = await Promise.all([
      db.from("community_projects").select("*").eq("id", req.params.projectId).single(),
      db.from("project_updates").select("*").eq("id", req.params.updateId).eq("project_id", req.params.projectId).maybeSingle(),
    ]);
    if (projectError) throw projectError;
    if (updateError) throw updateError;
    if (!existing) throw Object.assign(new Error("Project update not found."), { status: 404 });

    const title = `${req.body.title ?? existing.title ?? ""}`.trim();
    const description = `${req.body.description ?? existing.description ?? ""}`.trim();
    ensure(title, "Update title is required.");
    ensure(description, "Update description is required.");

    let progress = req.body.progressPercentage === undefined || req.body.progressPercentage === ""
      ? existing.progress_percentage
      : Number(req.body.progressPercentage);
    if (progress !== null && progress !== undefined && (!Number.isInteger(progress) || progress < 0 || progress > 100)) {
      throw Object.assign(new Error("Progress must be a whole number from 0 to 100."), { status: 400 });
    }

    const status = req.body.projectStatus || existing.project_status || null;
    if (status && !PROJECT_STATUSES.has(status)) throw Object.assign(new Error("Invalid project status."), { status: 400 });
    const imageUrl = req.file
      ? await uploadAsset({ file: req.file, folder: "project-updates", prefix: `${project.id}-${title}` })
      : existing.image_url;

    const payload = {
      title,
      description,
      image_url: imageUrl,
      progress_percentage: progress ?? null,
      project_status: status,
      update_date: req.body.updateDate || existing.update_date,
      updated_at: new Date().toISOString(),
    };

    const { data: savedUpdate, error } = await db.rpc("bgy_phase10_correct_project_update", {
      p_actor: req.currentUser.id, p_project: project.id, p_update: existing.id,
      p_title: payload.title, p_description: payload.description,
      p_image_url: payload.image_url, p_progress: payload.progress_percentage,
      p_status: payload.project_status, p_update_date: payload.update_date,
    });
    if (error) throw mapVotingRpcError(error);
    // Correction of a historical milestone never overwrites current project progress.
    const savedProject = project;

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "edit_project_update",
      entityType: "project_update",
      entityId: savedUpdate.id,
      module: "projects",
      beforeData: existing,
      afterData: savedUpdate,
      details: { projectId: project.id },
      req,
    });

    res.json({ update: savedUpdate, project: savedProject, message: "Project update corrected successfully." });
  } catch (error) {
    next(error);
  }
});

router.get("/census_households", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db
      .from("census_households")
      .select("*")
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ census_households: dedupeHouseholds(data || []) });
  } catch (error) {
    next(error);
  }
});

router.get('/census_households/:householdId/members', async (req,res,next)=>{
  try {
    const {data,error}=await requireSupabase().from('household_members').select('*').eq('household_id',req.params.householdId).order('is_head',{ascending:false}).order('created_at');
    if(error)throw error;
    res.json({members:data||[]});
  }catch(error){next(error);}
});
router.post('/census_households/:householdId/members', async(req,res,next)=>{
  try {
    const db=requireSupabase();
    const body=req.body||{};
    const first_name=`${body.firstName||''}`.trim(),last_name=`${body.lastName||''}`.trim(),relationship=`${body.relationship||''}`.trim();
    if(!first_name||!last_name||!relationship)throw Object.assign(new Error('First name, last name and relationship are required.'),{status:400});
    const payload={household_id:req.params.householdId, first_name,last_name,relationship,
      middle_name:`${body.middleName||''}`.trim(),suffix:`${body.suffix||''}`.trim(),
      user_id:body.userId||null,is_head:Boolean(body.isHead),sex:body.sex||null,birthdate:body.birthdate||null,
      civil_status:body.civilStatus||null,occupation:`${body.occupation||''}`.trim()||null,
      is_senior:Boolean(body.isSenior),is_pwd:Boolean(body.isPwd),is_solo_parent:Boolean(body.isSoloParent),
      is_4ps:Boolean(body.is4ps),is_registered_voter:Boolean(body.isRegisteredVoter)};
    const {data,error}=await db.from('household_members').insert(payload).select('*').single();
    if(error)throw error;
    await logAudit({actorId:req.currentUser.id,actorRole:req.currentUser.role,action:'add_household_member',entityType:'household_member',entityId:data.id, details:{householdId:payload.household_id,relationship},req});
    res.status(201).json({member:data});
  }catch(error){next(error);}
});
router.delete('/census_households/:householdId/members/:memberId', async(req,res,next)=>{
  try {
    const db=requireSupabase();
    const {data,error}=await db.from('household_members').delete().eq('id',req.params.memberId).eq('household_id',req.params.householdId).select('id,relationship').maybeSingle();
    if(error)throw error;
    if(!data)return res.status(404).json({message:'Household member not found.'});
    await logAudit({actorId:req.currentUser.id,actorRole:req.currentUser.role,action:'remove_household_member',entityType:'household_member',entityId:data.id, details:{householdId:req.params.householdId,relationship:data.relationship},req});
    res.json({message:'Household member removed.'});
  }catch(error){next(error);}
});

router.post('/census_households/:householdId/members/:memberId/head', async(req,res,next)=>{
 try{
  const db=requireSupabase();
  const {error}=await db.rpc('bgy_p105_assign_household_head',{p_household_id:req.params.householdId,p_member_id:req.params.memberId});
  if(error)throw error;
  await logAudit({actorId:req.currentUser.id,actorRole:req.currentUser.role, action:'change_household_head',entityType:'household_member',entityId:req.params.memberId,details:{householdId:req.params.householdId},req});
  res.json({message:'Head of household updated.'});
 }catch(error){next(error);}
});
router.get("/census_households/sample", async (req, res, next) => {
  try {
    // Keep the first worksheet import-ready: only the supported header and sample rows.
    // Detailed import guidance is shown in the Census UI before the file is committed.
    const rows = [
      ["household_ref", "household_name", "purok", "members", "address", "status"],
      ["", "Dela Cruz Household", "Purok 1", 5, "12 Rizal Street, Barangay Iba, Silang, Cavite", "active"],
      ["", "Santos Household", "Purok 2", 4, "45 Mabini Street, Barangay Iba, Silang, Cavite", "active"],
      ["", "Reyes Household", "Purok 3", 3, "8 Bonifacio Road, Barangay Iba, Silang, Cavite", "for update"],
    ];
    const workbook = buildXlsx(rows);
    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "download_census_sample",
      entityType: "census_households",
      entityId: "sample",
      module: "census",
      req,
    });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=barangay-iba-census-sample.xlsx");
    res.send(workbook);
  } catch (error) {
    next(error);
  }
});

router.get("/census_households/export", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db
      .from("census_households")
      .select("*")
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;

    const rows = dedupeHouseholds(data || []);
    const workbook = buildXlsx([
      ["household_ref", "household_name", "purok", "members", "address", "status", "created_at", "updated_at"],
      ...rows.map((row) => [
        row.household_ref || "",
        row.household_name,
        row.purok,
        Number(row.members || 0),
        row.address || row.house_number || "",
        row.status,
        row.created_at,
        row.updated_at,
      ]),
    ]);

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "export_census_backup",
      entityType: "census_households",
      entityId: "export",
      module: "census",
      details: { rowCount: rows.length },
      req,
    });

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=barangay-iba-census-backup-${date}.xlsx`);
    res.send(workbook);
  } catch (error) {
    next(error);
  }
});

router.post("/census_households", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const payload = buildCensusPayload(req.body);
    await assertActiveMasterLabel(db, "purok", payload.purok);
    const duplicate = await findCensusDuplicate(db, payload);
    if (duplicate) throw Object.assign(new Error("A household with the same reference or address already exists. Edit the existing record instead."), { status: 409 });
    const data = await insertCensusHousehold(db, payload);

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "create_census_household",
      entityType: "census_household",
      entityId: data.id,
      module: "census",
      afterData: data,
      details: payload,
      req,
    });

    res.status(201).json({ item: data, action: "inserted", message: "Household added." });
  } catch (error) {
    next(error);
  }
});

router.patch("/census_households/:id", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: existing, error: existingError } = await db.from("census_households").select("*").eq("id", req.params.id).single();
    if (existingError) throw existingError;
    const payload = buildCensusPayload({ ...existing, ...req.body, household_ref: existing.household_ref || req.body.householdRef || createHouseholdRef() });
    if(existing.membership_verified)payload.members=existing.members;
    await assertActiveMasterLabel(db, "purok", payload.purok);
    const duplicate = await findCensusDuplicate(db, payload, req.params.id);
    if (duplicate) throw Object.assign(new Error("Another household already uses this address or household reference."), { status: 409 });

    let update = await db.from("census_households").update(payload).eq("id", req.params.id).select("*").single();
    if (update.error && (`${update.error.message || ""}`.toLowerCase().includes("household_ref") || `${update.error.message || ""}`.toLowerCase().includes("address"))) {
      const legacyPayload = {
        household_name: payload.household_name,
        purok: payload.purok,
        members: payload.members,
        house_number: payload.address,
        status: payload.status,
        updated_at: payload.updated_at,
      };
      update = await db.from("census_households").update(legacyPayload).eq("id", req.params.id).select("*").single();
    }
    if (update.error) throw update.error;
    const data = { ...update.data, address: update.data.address || update.data.house_number || "", household_ref: update.data.household_ref || "" };

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "edit_census_household",
      entityType: "census_household",
      entityId: req.params.id,
      module: "census",
      beforeData: existing,
      afterData: data,
      req,
    });
    res.json({ item: data, message: "Household updated." });
  } catch (error) {
    next(error);
  }
});

router.delete("/census_households/:id", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: existing, error: existingError } = await db.from("census_households").select("*").eq("id", req.params.id).single();
    if (existingError) throw existingError;
    const { error } = await db.from("census_households").delete().eq("id", req.params.id);
    if (error) throw error;
    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "delete_census_household",
      entityType: "census_household",
      entityId: req.params.id,
      module: "census",
      beforeData: existing,
      req,
    });
    res.json({ message: "Household deleted." });
  } catch (error) {
    next(error);
  }
});

router.post("/census_households/batch", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) throw Object.assign(new Error("Upload an .xlsx, .csv, or tab-delimited file first."), { status: 400 });

    const rows = parseUploadedRows(req.file);
    if (rows.length < 2) throw Object.assign(new Error("File must include a header row and at least one household row."), { status: 400 });

    const headers = rows[0].map(normalizeHeader);
    const headerMap = new Map(headers.map((header, index) => [header, index]));
    const parsed = [];
    const validationErrors = [];

    rows.slice(1).forEach((row, index) => {
      if (!row.some((cell) => `${cell || ""}`.trim())) return;
      const rowNumber = index + 2;
      const raw = {
        householdRef: getCell(row, headerMap, ["household_ref", "household ref", "household id"]),
        householdName: getCell(row, headerMap, ["household_name", "householdName", "household", "household name"]),
        purok: getCell(row, headerMap, ["purok"]),
        members: getCell(row, headerMap, ["members", "member count", "member_count"]) || 1,
        address: getCell(row, headerMap, ["address", "full address", "house_number", "house number"]),
        status: (getCell(row, headerMap, ["status"]) || "active").toLowerCase(),
      };
      try {
        parsed.push({ rowNumber, payload: buildCensusPayload(raw) });
      } catch (rowError) {
        validationErrors.push({ row: rowNumber, message: rowError.message });
      }
    });

    const db = requireSupabase();
    const [{ data: activePuroks, error: purokError }, { data: existingRows, error: existingError }] = await Promise.all([
      db.from("master_data_values").select("label").eq("category", "purok").eq("is_active", true),
      db.from("census_households").select("id, household_ref, purok, address, house_number"),
    ]);
    if (purokError) throw purokError;
    if (existingError) throw existingError;

    const allowedPuroks = new Set((activePuroks || []).map((item) => `${item.label}`.toLowerCase()));
    const existingKeys = new Set((existingRows || []).map((item) => `${item.purok || ""}|${normalizeAddress(item.address || item.house_number || "")}`.toLowerCase()));
    const fileKeys = new Set();
    const preview = [];
    let duplicateCount = 0;

    for (const item of parsed) {
      const payload = item.payload;
      const rowErrors = [];
      if (!allowedPuroks.has(`${payload.purok}`.toLowerCase())) rowErrors.push(`Invalid or inactive Purok: ${payload.purok}.`);
      if (!["active", "for update"].includes(payload.status)) rowErrors.push(`Invalid status: ${payload.status}. Use active or for update.`);
      const key = `${payload.purok}|${normalizeAddress(payload.address)}`.toLowerCase();
      const duplicateExisting = existingKeys.has(key);
      const duplicateFile = fileKeys.has(key);
      if (duplicateExisting || duplicateFile) duplicateCount += 1;
      fileKeys.add(key);
      if (duplicateFile) rowErrors.push("Duplicate address appears more than once in this upload.");
      if (rowErrors.length) validationErrors.push(...rowErrors.map((message) => ({ row: item.rowNumber, message })));
      preview.push({ rowNumber: item.rowNumber, ...payload, duplicateExisting, duplicateFile, valid: rowErrors.length === 0 });
    }

    const validateOnly = `${req.query.validateOnly || ""}`.toLowerCase() === "true";
    if (validateOnly) {
      return res.json({
        valid: validationErrors.length === 0,
        rowCount: parsed.length,
        validCount: parsed.length - new Set(validationErrors.map((item) => item.row)).size,
        existingCount: (existingRows || []).length,
        duplicateCount,
        errors: validationErrors.slice(0, 50),
        preview: preview.slice(0, 25),
        message: validationErrors.length ? `${validationErrors.length} validation issue${validationErrors.length === 1 ? "" : "s"} found.` : `${parsed.length} household row${parsed.length === 1 ? "" : "s"} passed validation.`,
      });
    }

    if (validationErrors.length) throw Object.assign(new Error("The file has validation errors. Preview and correct them before importing."), { status: 400 });

    const mode = `${req.body.mode || req.query.mode || "append"}`.toLowerCase();
    if (mode === 'replace_all') throw Object.assign(new Error('Destructive Census replacement has been disabled to protect household members. Use Add to Existing Records.'), {status:409,code:'CENSUS_REPLACE_DISABLED'});
    if (mode !== 'append') throw Object.assign(new Error('Import mode must be append.'),{status:400});

    const payload = parsed.map((item) => item.payload);
    let inserted = 0;
    let skipped = 0;

    if (mode === "replace_all") {
      const { data: result, error: replaceError } = await db.rpc("replace_census_households", { rows: payload });
      if (replaceError) {
        throw Object.assign(new Error(`Census replacement requires the V4 database migration. ${replaceError.message}`), { status: 500 });
      }
      inserted = Number(result?.[0]?.inserted_count ?? result?.inserted_count ?? payload.length);
    } else {
      for (const item of payload) {
        const key = `${item.purok}|${normalizeAddress(item.address)}`.toLowerCase();
        if (existingKeys.has(key)) {
          skipped += 1;
          continue;
        }
        await insertCensusHousehold(db, item);
        existingKeys.add(key);
        inserted += 1;
      }
    }

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: mode === "replace_all" ? "replace_all_census_households" : "append_census_households",
      entityType: "census_households",
      entityId: "batch",
      module: "census",
      details: { mode, sourceFile: req.file.originalname, totalRows: payload.length, inserted, skipped, previousCount: (existingRows || []).length },
      req,
    });

    res.status(201).json({ inserted, skipped, mode, message: mode === "replace_all" ? `Census replaced with ${inserted} household records.` : `${inserted} household records added. ${skipped} duplicate${skipped === 1 ? "" : "s"} skipped.` });
  } catch (error) {
    next(error);
  }
});

tableCrud({
  table: "officials",
  label: "official",
  fileField: "photo",
  fileFolder: "officials",
  filePrefix: "official",
  mapPayload: async ({ body, assetUrl, db }) => {
    ensure(`${body.name || ""}`.trim(), "Official name is required.");
    await assertActiveMasterLabel(db, "official_position", body.position);
    await assertActiveMasterLabel(db, "administration_term", body.term);
    return {
      name: `${body.name}`.trim(),
      position: body.position,
      term: body.term,
      contact: body.contact || "",
      photo_url: assetUrl || body.photoUrl || null,
      is_active: parseBoolean(body.isActive, true),
      status: parseBoolean(body.isActive, true) ? "active" : "inactive",
    };
  },
});

tableCrud({
  table: "announcements",
  label: "announcement",
  fileField: "image",
  fileFolder: "announcements",
  filePrefix: "announcement",
  mapPayload: async ({ body, assetUrl, db, existingId }) => {
    const payload = {
      title: body.title,
      body: body.body,
      image_url: assetUrl || body.imageUrl || null,
      type: body.type,
    };

    if (body.date && !existingId) {
      payload.created_at = body.date;
    }

    if (!existingId) {
      const residents = await getResidentRecipients(db);
      await notifyResidents(db, residents, {
        title: body.type === "news" ? "News update" : "New announcement",
        body: body.title,
      });
    }

    return payload;
  },
});

tableCrud({
  table: "events",
  label: "event",
  mapPayload: async ({ body, db }) => {
    ensure(`${body.title || ""}`.trim(), "Event title is required.");
    ensure(body.date, "Event date is required.");
    await assertActiveMasterLabel(db, "event_category", body.type);
    return { title: `${body.title}`.trim(), date: body.date, time: body.time || null, location: `${body.location || ""}`.trim(), description: `${body.description || ""}`.trim(), type: body.type };
  },
});

tableCrud({
  table: "fund_sources",
  label: "fund_source",
  mapPayload: async ({ body, db }) => {
    await assertActiveMasterLabel(db, "administration_term", body.term);
    const amount = Number(body.allocatedAmount || body.allocated_amount || 0);
    ensure(`${body.name || ""}`.trim(), "Fund source name is required.");
    ensure(Number.isFinite(amount) && amount >= 0, "Allocated amount must be zero or greater.");
    return { name: `${body.name}`.trim(), term: body.term, allocated_amount: amount };
  },
});

tableCrud({
  table: "fund_projects",
  label: "fund_project",
  fileField: "receipt",
  fileFolder: "receipts",
  filePrefix: "receipt",
  mapPayload: async ({ body, assetUrl, db }) => {
    await assertActiveMasterLabel(db, "administration_term", body.term);
    const amount = Number(body.amount || 0);
    ensure(`${body.name || ""}`.trim(), "Project name is required.");
    ensure(body.date, "Project date is required.");
    ensure(Number.isFinite(amount) && amount >= 0, "Project amount must be zero or greater.");
    ensure(["ongoing", "completed", "cancelled"].includes(body.status || "ongoing"), "Invalid project status.");
    return { name: `${body.name}`.trim(), date: body.date, amount, description: `${body.description || ""}`.trim(), receipt_url: assetUrl || body.receiptUrl || null, term: body.term, status: body.status || "ongoing" };
  },
});

tableCrud({
  table: "id_pickup_slots",
  label: "id_pickup_slot",
  mapPayload: async ({ body }) => ({
    slot_date: body.slotDate || body.slot_date,
    time_slot: body.timeSlot || body.time_slot,
    capacity: Number(body.capacity || 1),
    is_active: parseBoolean(body.isActive, true),
  }),
});

export default router;

