import express from "express";
import adminVotingRoutes from "./adminVoting.js";
import bcrypt from "bcryptjs";
import multer from "multer";
import zlib from "zlib";
import { requireSupabase } from "../lib/supabase.js";
import { uploadAsset } from "../lib/storage.js";
import { sendAccountCreatedEmail, sendPasswordResetEmail, sendSystemEmail } from "../lib/mailer.js";
import { requireAuth, requireCurrentUser, requireRole } from "../middleware/auth.js";
import { logAudit } from "../utils/audit.js";
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

router.use(requireAuth, requireCurrentUser({ allowPasswordChange: true }), requireRole("admin"));
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

const normalizeHouseNumber = (value = "") => `${value}`.trim().toLowerCase();

const buildCensusPayload = (body) => {
  const members = Number(body.members || 1);
  const householdName = `${body.household_name || body.householdName || ""}`.trim();
  const purok = `${body.purok || ""}`.trim();
  const houseNumber = `${body.house_number || body.houseNumber || ""}`.trim();
  const status = `${body.status || "active"}`.trim().toLowerCase();

  ensure(householdName, "Household name is required.");
  ensure(purok, "Purok is required.");
  ensure(houseNumber, "House number is required.");
  ensure(Number.isInteger(members) && members >= 1, "Members must be a positive whole number.");

  return {
    household_name: householdName,
    purok,
    members,
    house_number: houseNumber,
    status,
    updated_at: new Date().toISOString(),
  };
};

const dedupeHouseholds = (rows = []) => {
  const byHouseNumber = new Map();
  for (const row of rows) {
    const key = normalizeHouseNumber(row.house_number) || row.id;
    if (!byHouseNumber.has(key)) byHouseNumber.set(key, row);
  }
  return Array.from(byHouseNumber.values()).sort((a, b) => `${a.house_number}`.localeCompare(`${b.house_number}`));
};

const saveCensusHousehold = async (db, payload) => {
  const { data: existingRows, error: lookupError } = await db
    .from("census_households")
    .select("id")
    .ilike("house_number", payload.house_number)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);
  if (lookupError) throw lookupError;

  const existing = existingRows?.[0];
  if (existing) {
    const { data, error } = await db
      .from("census_households")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return { action: "updated", data };
  }

  const { data, error } = await db.from("census_households").insert(payload).select("*").single();
  if (error) throw error;
  return { action: "inserted", data };
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

const ELECTION_STATUSES = new Set(["draft", "live", "closed"]);

const normalizeElectionDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw Object.assign(new Error("Election dates must be valid date and time values."), { status: 400 });
  }
  return date.toISOString();
};

const normalizeElectionOptions = (items = []) =>
  (items || [])
    .map((option) => ({
      name: `${option.name || ""}`.trim(),
      description: `${option.description || ""}`.trim(),
    }))
    .filter((option) => option.name);

const sameElectionOptions = (left = [], right = []) => {
  const normalize = (items) => items.map((item) => `${item.name}\n${item.description || ""}`);
  const leftItems = normalize(left);
  const rightItems = normalize(right);
  return leftItems.length === rightItems.length && leftItems.every((item, index) => item === rightItems[index]);
};

const addTimelineEntry = async (db, requestId, status, note = "") => {
  const { error } = await db.from("request_timeline").insert({
    request_id: requestId,
    status,
    note,
  });
  if (error) throw error;
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
    const [users, requests, officials, elections, logs] = await Promise.all([
      db.from("users").select("*").order("created_at", { ascending: false }),
      db.from("requests").select("*").order("created_at", { ascending: false }),
      db.from("officials").select("*"),
      db.from("elections").select("*").order("created_at", { ascending: false }),
      db.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(30),
    ]);

    if (users.error) throw users.error;
    if (requests.error) throw requests.error;
    if (officials.error) throw officials.error;
    if (elections.error) throw elections.error;
    if (logs.error) throw logs.error;

    const residents = (users.data || []).filter((user) => normalizeRole(user.role) === "resident");
    const activeResidents = residents.filter((user) => user.is_active);
    const pendingRequests = (requests.data || []).filter((item) => item.status !== "completed").length;
    const activeOfficials = (officials.data || []).filter((item) => item.is_active).length;
    const openElections = (elections.data || []).filter((item) => item.status === "live").length;

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

router.post("/users", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const fullName = `${req.body.fullName || ""}`.trim();
    const address = `${req.body.address || ""}`.trim();
    const purok = `${req.body.purok || ""}`.trim();
    const contactNumber = normalizePhoneNumber(req.body.phoneNumber || req.body.contactNumber || "");
    const email = `${req.body.email || ""}`.trim().toLowerCase();
    const role = normalizeRole(req.body.role || "resident");
    const birthdate = req.body.birthdate || null;

    if (role !== "resident") {
      throw Object.assign(new Error("Only super admins can create admin accounts."), { status: 403 });
    }

    ensure(fullName, "Full name is required.");
    ensure(address, "Address is required.");
    ensure(purok, "Purok is required.");
    ensure(contactNumber, "Phone number is required.");
    ensure(email, "Email is required for resident accounts.");
    if (role === "resident") ensureAdult(birthdate);

    const nameParts = splitName(fullName);
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

    let emailDelivery = { delivered: false };

    try {
      emailDelivery = await sendAccountCreatedEmail({
        email,
        fullName,
        username,
        temporaryPassword: tempPassword,
        role,
      });
    } catch (emailError) {
      console.warn("[EMAIL ACCOUNT ERROR]", emailError.message);
    }

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: role === "admin" ? "create_admin_user" : "create_resident_user",
      entityType: "user",
      entityId: data.id,
      details: { username, role },
    });

    res.status(201).json({ user: sanitizeUser(data), temporaryPassword: tempPassword, emailDelivery });
  } catch (error) {
    next(error);
  }
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
    if (req.body.fullName !== undefined) {
      const fullName = `${req.body.fullName}`.trim();
      ensure(fullName, "Full name is required.");
      const parts = splitName(fullName);
      updates.full_name = fullName;
      updates.first_name = parts.firstName;
      updates.middle_name = parts.middleName;
      updates.last_name = parts.lastName;
    }
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
      details: updates,
    });

    res.json({ user: sanitizeUser(data) });
  } catch (error) {
    next(error);
  }
});

router.post("/users/:userId/reset-password", async (req, res, next) => {
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
      throw Object.assign(new Error("Only super admins can reset admin account passwords."), { status: 403 });
    }
    if (!targetUser.email) {
      throw Object.assign(new Error("Resident has no email address on file. Add an email before resetting the password."), { status: 400 });
    }

    const tempPassword = createTemporaryPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    const { data, error } = await db
      .from("users")
      .update({ password_hash: passwordHash, must_change_password: true, updated_at: new Date().toISOString() })
      .eq("id", req.params.userId)
      .select("*")
      .single();
    if (error) throw error;

    let emailDelivery = { delivered: false, reason: "unknown" };
    try {
      emailDelivery = await sendPasswordResetEmail({
        email: targetUser.email,
        fullName: targetUser.full_name || targetUser.first_name,
        username: targetUser.username,
        temporaryPassword: tempPassword,
        role: "resident",
      });
    } catch (emailError) {
      console.warn("[EMAIL RESET ERROR]", emailError.message);
      emailDelivery = { delivered: false, reason: "send_failed" };
    }

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "reset_user_password",
      entityType: "user",
      entityId: req.params.userId,
      details: { emailDelivered: Boolean(emailDelivery.delivered) },
    });

    res.json({
      message: emailDelivery.delivered
        ? "Password reset successful. The temporary password was emailed to the resident."
        : "Password reset successful, but the email could not be delivered. Copy the temporary password and provide it securely to the resident.",
      temporaryPassword: tempPassword,
      emailDelivery,
      user: sanitizeUser(data),
    });
  } catch (error) {
    next(error);
  }
});


router.get("/complaints", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db.from("complaints").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ complaints: data || [] });
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
    const updates = {
      status,
      admin_note: `${req.body.adminNote || req.body.admin_note || ""}`.trim(),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await db.from("complaints").update(updates).eq("id", req.params.id).select("*").single();
    if (error) throw error;

    if (data.user_id) {
      await db.from("notifications").insert({
        user_id: data.user_id,
        title: "Community concern updated",
        body: `Your concern is now ${status.replace("_", " ")}.${updates.admin_note ? ` ${updates.admin_note}` : ""}`,
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
      details: updates,
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
    res.json({ requests: data || [] });
  } catch (error) {
    next(error);
  }
});

router.patch("/requests/:id", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const payload = {
      status: req.body.status,
      admin_note: req.body.adminNote || "",
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await db.from("requests").update(payload).eq("id", req.params.id).select("*").single();
    if (error) throw error;

    await addTimelineEntry(db, data.id, payload.status, payload.admin_note);

    const { data: resident } = await db.from("users").select("email, full_name, first_name").eq("id", data.user_id).maybeSingle();
    await sendSystemEmail({
      to: resident?.email,
      subject: "Request status updated",
      text: `Your ${data.request_type} request is now ${payload.status}.${payload.admin_note ? ` Note: ${payload.admin_note}` : ""}`,
    }).catch((emailError) => {
      console.warn(`[EMAIL NOTIFICATION ERROR] ${resident?.email}: ${emailError.message}`);
    });
    await db.from("notifications").insert({
      user_id: data.user_id,
      title: "Request status updated",
      body: `${data.request_type} is now ${payload.status}. ${payload.admin_note || ""}`.trim(),
      kind: "info",
      broadcast: false,
    });

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "update_request",
      entityType: "request",
      entityId: req.params.id,
      details: payload,
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
    res.json({ requests: data || [] });
  } catch (error) {
    next(error);
  }
});

router.patch("/id-requests/:id", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const payload = {
      status: req.body.status,
      admin_note: req.body.adminNote || "",
      preferred_date: req.body.preferredDate || null,
      time_slot: req.body.timeSlot || null,
    };
    const { data, error } = await db.from("id_requests").update(payload).eq("id", req.params.id).select("*").single();
    if (error) throw error;

    const { data: resident } = await db.from("users").select("email, full_name, first_name").eq("id", data.user_id).maybeSingle();
    await sendSystemEmail({
      to: resident?.email,
      subject: "Barangay ID schedule updated",
      text: `Your Barangay ID request is now ${payload.status}. Pickup: ${payload.preferred_date || "to be scheduled"} ${payload.time_slot || ""}. ${payload.admin_note || ""}`.trim(),
    }).catch((emailError) => {
      console.warn(`[EMAIL NOTIFICATION ERROR] ${resident?.email}: ${emailError.message}`);
    });
    await db.from("notifications").insert({
      user_id: data.user_id,
      title: "Barangay ID schedule updated",
      body: `Status: ${payload.status}. ${payload.admin_note || ""}`.trim(),
      kind: "info",
      broadcast: false,
    });

    res.json({ request: data });
  } catch (error) {
    next(error);
  }
});

router.get("/suggestions", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db
      .from("project_suggestions")
      .select("*, users!project_suggestions_user_id_fkey(full_name, first_name, last_name)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ suggestions: data || [] });
  } catch (error) {
    next(error);
  }
});

router.patch("/suggestions/:id", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const status = req.body.status;
    ensure(status, "Status is required.");
    const { data, error } = await db
      .from("project_suggestions")
      .update({ status })
      .eq("id", req.params.id)
      .select("*")
      .single();
    if (error) throw error;

    let election = null;
    if (status === "approved") {
      const insert = await db
        .from("elections")
        .insert({
          title: data.title,
          description: data.description,
          image_url: data.image_url || null,
          status: "draft",
          source_suggestion_id: data.id,
        })
        .select("*")
        .single();
      if (insert.error) throw insert.error;
      election = insert.data;
    }

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "review_project_suggestion",
      entityType: "project_suggestion",
      entityId: req.params.id,
      details: { status, electionId: election?.id || null },
    });

    res.json({ suggestion: data, election });
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

router.put("/content", async (req, res, next) => {
  try {
    const db = requireSupabase();
    for (const [key_name, value] of Object.entries(req.body || {})) {
      const { error } = await db
        .from("landing_content")
        .upsert({ key_name, value, updated_at: new Date().toISOString() });
      if (error) throw error;
    }
    res.json({ message: "Content updated." });
  } catch (error) {
    next(error);
  }
});

router.get("/election", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: election, error } = await db.from("elections").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!election) return res.json({ election: null, options: [] });

    const { data: options, error: optionError } = await db
      .from("election_options")
      .select("*")
      .eq("election_id", election.id)
      .order("created_at");
    if (optionError) throw optionError;
    res.json({ election, options: options || [] });
  } catch (error) {
    next(error);
  }
});

router.put("/election", upload.single("image"), async (req, res, next) => {
  try {
    const db = requireSupabase();
    const rawElection = req.body.election ? JSON.parse(req.body.election) : req.body;
    const rawOptions = req.body.options ? JSON.parse(req.body.options) : [];
    ensure(rawElection?.title, "Election title is required.");
    const status = rawElection.status || "draft";
    if (!ELECTION_STATUSES.has(status)) {
      throw Object.assign(new Error("Election status must be draft, live, or closed."), { status: 400 });
    }

    const imageUrl = req.file
      ? await uploadAsset({
          file: req.file,
          folder: "elections",
          prefix: rawElection.title,
        })
      : rawElection.imageUrl || null;

    const startsAt = normalizeElectionDate(rawElection.startsAt);
    const endsAt = normalizeElectionDate(rawElection.endsAt);
    const options = normalizeElectionOptions(rawOptions);

    if (status !== "draft" && options.length < 2) {
      throw Object.assign(new Error("At least two voting options are required."), { status: 400 });
    }
    if (status === "live") {
      ensure(startsAt, "Start date and time are required before opening voting.");
      ensure(endsAt, "End date and time are required before opening voting.");
      if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
        throw Object.assign(new Error("Voting end time must be after the start time."), { status: 400 });
      }
      if (new Date(endsAt).getTime() <= Date.now()) {
        throw Object.assign(new Error("Voting end time must be in the future before opening voting."), { status: 400 });
      }
    }

    let previousElection = null;
    let existingOptions = [];
    let existingVoteCount = 0;
    if (rawElection.id) {
      const [previous, optionRows, voteRows] = await Promise.all([
        db.from("elections").select("*").eq("id", rawElection.id).maybeSingle(),
        db.from("election_options").select("name, description").eq("election_id", rawElection.id).order("created_at"),
        db.from("votes").select("id", { count: "exact", head: true }).eq("election_id", rawElection.id),
      ]);
      if (previous.error) throw previous.error;
      if (optionRows.error) throw optionRows.error;
      if (voteRows.error) throw voteRows.error;
      previousElection = previous.data;
      existingOptions = normalizeElectionOptions(optionRows.data || []);
      existingVoteCount = voteRows.count || 0;
    }

    if (existingVoteCount > 0 && !sameElectionOptions(existingOptions, options)) {
      throw Object.assign(new Error("Voting options cannot be changed after votes have been recorded."), { status: 400 });
    }

    const electionPayload = {
      title: rawElection.title,
      description: rawElection.description || "",
      status,
      starts_at: startsAt,
      ends_at: endsAt,
      image_url: imageUrl,
      source_suggestion_id: rawElection.sourceSuggestionId || null,
    };

    let savedElection;
    if (rawElection.id) {
      const update = await db.from("elections").update(electionPayload).eq("id", rawElection.id).select("*").single();
      if (update.error) throw update.error;
      savedElection = update.data;
    } else {
      const insert = await db.from("elections").insert(electionPayload).select("*").single();
      if (insert.error) throw insert.error;
      savedElection = insert.data;
    }

    if (existingVoteCount === 0) {
      await db.from("election_options").delete().eq("election_id", savedElection.id);
      if (options.length) {
        const insertOptions = await db.from("election_options").insert(
          options.map((option) => ({
            election_id: savedElection.id,
            name: option.name,
            description: option.description,
            votes_count: 0,
          }))
        );
        if (insertOptions.error) throw insertOptions.error;
      }
    }

    if (savedElection.status === "live" && previousElection?.status !== "live") {
      const closeOtherLives = await db.from("elections").update({ status: "closed" }).neq("id", savedElection.id).eq("status", "live");
      if (closeOtherLives.error) throw closeOtherLives.error;
      const resetVotes = await db.from("users").update({ has_voted: false }).eq("role", "resident");
      if (resetVotes.error) throw resetVotes.error;

      const residents = await getResidentRecipients(db);
      await notifyResidents(db, residents, {
        title: "Voting is now open",
        body: `${savedElection.title} is now live for voting.`,
      });
    }

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "save_election",
      entityType: "election",
      entityId: savedElection.id,
      details: electionPayload,
    });

    res.json({ election: savedElection });
  } catch (error) {
    next(error);
  }
});

router.get("/election-results", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: elections, error } = await db.from("elections").select("id").order("created_at", { ascending: false });
    if (error) throw error;
    const items = [];
    for (const election of elections || []) {
      items.push(await getElectionMetrics(db, election.id));
    }
    res.json({ elections: items });
  } catch (error) {
    next(error);
  }
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

router.get("/audit-logs", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const { data, error } = await db.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    res.json({ logs: data || [] });
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

router.get("/census_households/export", async (_req, res, next) => {
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
      ["household_name", "purok", "members", "house_number", "status", "updated_at"],
      ...rows.map((row) => [
        row.household_name,
        row.purok,
        Number(row.members || 0),
        row.house_number,
        row.status,
        row.updated_at,
      ]),
    ]);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=census-households-backup.xlsx");
    res.send(workbook);
  } catch (error) {
    next(error);
  }
});

router.post("/census_households", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const payload = buildCensusPayload(req.body);
    const result = await saveCensusHousehold(db, payload);

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: `${result.action}_census_household`,
      entityType: "census_households",
      entityId: result.data.id,
      details: payload,
    });

    res.status(result.action === "inserted" ? 201 : 200).json({ item: result.data, action: result.action });
  } catch (error) {
    next(error);
  }
});

router.post("/census_households/batch", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      throw Object.assign(new Error("Upload a CSV or Excel file first."), { status: 400 });
    }

    const rows = parseUploadedRows(req.file);
    if (rows.length < 2) {
      throw Object.assign(new Error("File must include a header row and at least one household row."), { status: 400 });
    }

    const headers = rows[0].map(normalizeHeader);
    const headerMap = new Map(headers.map((header, index) => [header, index]));
    const payload = [];
    const errors = [];

    rows.slice(1).forEach((row, index) => {
      const rowNumber = index + 2;
      const householdName = getCell(row, headerMap, ["household_name", "householdName", "household", "household name"]);
      const purok = getCell(row, headerMap, ["purok"]);
      const members = Number(getCell(row, headerMap, ["members", "member count", "member_count"]) || 1);
      const houseNumber = getCell(row, headerMap, ["house_number", "houseNumber", "house no", "house number"]);
      const status = (getCell(row, headerMap, ["status"]) || "active").toLowerCase();

      if (!householdName) errors.push(`Row ${rowNumber}: household name is required.`);
      if (!purok) errors.push(`Row ${rowNumber}: purok is required.`);
      if (!houseNumber) errors.push(`Row ${rowNumber}: house number is required.`);
      if (!Number.isInteger(members) || members < 1) errors.push(`Row ${rowNumber}: members must be a positive whole number.`);

      payload.push({
        household_name: householdName,
        purok,
        members,
        house_number: houseNumber,
        status: status || "active",
        updated_at: new Date().toISOString(),
      });
    });

    if (errors.length) {
      throw Object.assign(new Error(errors.slice(0, 8).join(" ")), { status: 400 });
    }

    const db = requireSupabase();
    const saved = [];
    let inserted = 0;
    let updated = 0;

    for (const item of payload) {
      const result = await saveCensusHousehold(db, item);
      saved.push(result.data);
      if (result.action === "inserted") inserted += 1;
      if (result.action === "updated") updated += 1;
    }

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "batch_upload_census_households",
      entityType: "census_households",
      entityId: "batch",
      details: { count: payload.length, inserted, updated },
    });

    res.status(201).json({ households: saved, inserted, updated });
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
  mapPayload: async ({ body, assetUrl }) => ({
    name: body.name,
    position: body.position,
    term: body.term,
    contact: body.contact || "",
    photo_url: assetUrl || body.photoUrl || null,
    is_active: parseBoolean(body.isActive, true),
    status: parseBoolean(body.isActive, true) ? "active" : "inactive",
  }),
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
  mapPayload: async ({ body }) => ({
    title: body.title,
    date: body.date,
    time: body.time || null,
    location: body.location || "",
    description: body.description || "",
    type: body.type || "general",
  }),
});

tableCrud({
  table: "fund_sources",
  label: "fund_source",
  mapPayload: async ({ body }) => ({
    name: body.name,
    term: body.term,
    allocated_amount: Number(body.allocatedAmount || body.allocated_amount || 0),
  }),
});

tableCrud({
  table: "fund_projects",
  label: "fund_project",
  fileField: "receipt",
  fileFolder: "receipts",
  filePrefix: "receipt",
  mapPayload: async ({ body, assetUrl }) => ({
    name: body.name,
    date: body.date,
    amount: Number(body.amount || 0),
    description: body.description || "",
    receipt_url: assetUrl || body.receiptUrl || null,
    term: body.term,
    status: body.status || "ongoing",
  }),
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
