import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import sharp from "sharp";
import JSZip from "jszip";
import { PGlite } from "@electric-sql/pglite";
import {
  DOCUMENT_TYPES,
  validateApplication,
  snapshotResident,
  approvalChecks,
  ageAtDate,
  validDate,
  validateTemplateConfig,
} from "../src/lib/documentRules.js";
import {
  normalizePhoto,
  validateWord,
  DOCX_MIME,
} from "../src/lib/documentStorage.js";
import { generateWordDocument } from "../src/lib/wordDocuments.js";
import {
  buildDocumentNotification,
  performSend,
  sendDocumentNotification,
} from "../src/lib/documentNotifications.js";
const sql = await readFile(
  new URL("../supabase-v4-phase11-documents.sql", import.meta.url),
  "utf8",
);
const resident = {
  id: randomUUID(),
  first_name: "Synthetic",
  middle_name: "A.",
  last_name: "Resident",
  full_name: "Synthetic A. Resident",
  address: "12 Example Street, Purok 1, Iba, Silang, Cavite",
  purok: "Purok 1",
  birthdate: "1990-11-05",
  residency_since: "2010-02-01",
  profile_photo_path: `photos/${randomUUID()}/${randomUUID()}.png`,
};
const business = {
  businessName: "Synthetic Motor Shop",
  businessAddress: "12 Example Street, Iba, Silang, Cavite",
  businessKind: "Motor repair",
  permitYear: "2026",
};
const config = {
  title: "CERTIFICATION",
  chairmanName: "Authorized Test Official",
  designation: "Barangay Chairman",
  footer: "NOT VALID WITHOUT DRY SEAL",
  paragraphs: [
    "{{fullName}} resides at {{address}}.",
    "{{incomeStatement}}{{backgroundStatement}}",
    "For {{purpose}}. {{ageStatement}} Resident since {{residencySince}}.",
  ],
  controlPrefix: "TEST",
  issuanceStage: "approved",
  validityMonths: 3,
  requiredBusinessFields: Object.keys(business),
  pickupInstructions: "Visit the barangay office during posted hours.",
  officeContact: "Contact the barangay office using the portal.",
};
const template = (type) => ({
  id: randomUUID(),
  document_type: type,
  approval_state: "approved",
  version: 1,
  config: {
    ...config,
    title: {
      "Barangay Identification Card": "Barangay Identification Card",
      "Certificate of Indigency": "CERTIFICATION OF INDIGENCY",
      "Barangay Clearance": "FREE-BARANGAY CLEARANCE",
      "Barangay Business Clearance": "FREE-BARANGAY BUSINESS CLEARANCE",
      "Certificate of Residency": "CERTIFICATION",
    }[type],
    paragraphs:
      type === "Barangay Identification Card"
        ? [
            "{{fullName}}",
            "{{address}}",
            "The resident whose photograph appears here is a bona fide resident of this Barangay.",
          ]
        : type === "Barangay Business Clearance"
          ? [
              "This clearance is issued for the business described below for permit year {{permitYear}}.",
              "Application purpose: {{purpose}}.",
            ]
          : type === "Certificate of Residency"
            ? [
                "This is to certify that {{fullName}}, {{ageStatement}}, is a bona fide resident of {{address}}, residing in this community since {{residencySince}}.",
                "This certification is issued upon request for {{purpose}}.",
              ]
            : [
                "This is to certify that {{fullName}} is a bona fide resident of {{address}}.",
                type === "Certificate of Indigency"
                  ? "{{incomeStatement}}"
                  : "{{backgroundStatement}}",
                "This certification is issued upon request for {{purpose}}.",
              ],
  },
});
const request = (type) => ({
  id: randomUUID(),
  request_type: type,
  details: "Synthetic educational assistance",
  copies_requested: 1,
  issue_date: "2026-10-31",
  expiration_date: "2027-01-31",
  control_number: "TEST2026-0001",
  verified_snapshot: snapshotResident(resident, {
    issueDate: "2026-10-31",
    documentData: type === "Barangay Business Clearance" ? business : {},
    checks: {
      incomeStatement:
        "Staff verified this synthetic family meets the indigency criteria.",
      backgroundStatement:
        "Staff verified the records required for this synthetic clearance.",
    },
  }),
});
test("document applications enforce conditional requirements, copies, dates and age at issuance", () => {
  for (const type of DOCUMENT_TYPES)
    assert.equal(
      validateApplication({
        requestType: type,
        details: "Education",
        documentData: business,
      }).request_type,
      type,
    );
  assert.throws(
    () =>
      validateApplication({ requestType: "Anything", details: "Education" }),
    /supported/,
  );
  assert.throws(
    () =>
      validateApplication({
        requestType: "Barangay Business Clearance",
        details: "Education",
      }),
    /businessName/,
  );
  for (const copiesRequested of [0, 11, 1.5])
    assert.throws(
      () =>
        validateApplication({
          requestType: DOCUMENT_TYPES[0],
          details: "Education",
          copiesRequested,
        }),
      /Copies/,
    );
  assert.deepEqual(
    validateApplication({
      requestType: "Certificate of Residency",
      details: "Education",
      documentData: business,
    }).document_data,
    {},
  );
  assert.equal(ageAtDate("2000-11-01", "2026-10-31"), 25);
  assert.equal(ageAtDate("2000-11-01", "2026-11-01"), 26);
  assert.equal(validDate("2026-02-30"), false);
  assert.throws(() => ageAtDate("2027-01-01", "2026-10-31"), /birthdate/);
  const t = template("Barangay Clearance");
  const r = {
    request_type: t.document_type,
    details: "Education",
    copies_requested: 1,
  };
  assert.throws(
    () =>
      approvalChecks(
        r,
        resident,
        t,
        {
          reviewChecks: { identityVerified: true, residencyVerified: true },
          issueDate: "2026-10-31",
        },
        resident.profile_photo_path,
      ),
    /backgroundVerified/,
  );
  assert.throws(
    () => validateTemplateConfig({ ...config, chairmanName: "" }),
    /authorized official/,
  );
  assert.throws(
    () => validateTemplateConfig({ ...config, paragraphs: ["{{password}}"] }),
    /Unknown template/,
  );
});
test("photos decode, normalize, strip metadata and reject spoofed, undersized or excessive images", async () => {
  const buffer = await sharp({
    create: { width: 320, height: 400, channels: 3, background: "#287b35" },
  })
    .jpeg()
    .toBuffer();
  const normalized = await normalizePhoto({ buffer, mimetype: "image/jpeg" });
  assert.equal((await sharp(normalized).metadata()).format, "png");
  for (const file of [
    {
      buffer: Buffer.from("<script>alert(1)</script>"),
      mimetype: "image/jpeg",
    },
    { buffer, mimetype: "image/png" },
    {
      buffer: await sharp({
        create: { width: 10, height: 10, channels: 3, background: "red" },
      })
        .png()
        .toBuffer(),
      mimetype: "image/png",
    },
    { buffer: Buffer.alloc(5 * 1024 * 1024 + 1), mimetype: "image/jpeg" },
  ])
    await assert.rejects(normalizePhoto(file));
});
test("all five Word outputs contain editable text, table layouts, correct details, header logos, photos, copies and no center watermark", async () => {
  const photo = await sharp({
    create: { width: 240, height: 300, channels: 3, background: "#287b35" },
  })
    .png()
    .toBuffer();
  const output = new URL("../../artifacts/documents/", import.meta.url);
  await mkdir(output, { recursive: true });
  for (const type of DOCUMENT_TYPES) {
    const r = request(type);
    r.copies_requested = 2;
    const buffer = await generateWordDocument({
      request: r,
      template: template(type),
      photo:
        type === "Barangay Business Clearance" ||
        type === "Certificate of Residency"
          ? null
          : photo,
    });
    await validateWord({
      buffer,
      originalname: "example.docx",
      mimetype: DOCX_MIME,
    });
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml").async("string");
    assert.match(xml, /Synthetic A\. Resident|Synthetic Motor Shop/);
    assert.match(xml, /TEST2026-0001/);
    assert.match(xml, /DRAFT/);
    assert.match(xml, /<w:p>/);
    assert.match(xml, /<w:tbl>/);
    assert.match(xml, /w:pgBorders/);
    assert.equal((xml.match(/<w:sectPr>/g) || []).length, 2);
    assert.ok(
      Object.keys(zip.files).filter(
        (n) => n.startsWith("word/media/") && !zip.files[n].dir,
      ).length >= 2,
    );
    assert.doesNotMatch(
      xml,
      /watermark|v:shape|CamScanner|JOHN PATRICK|LEONISO/i,
    );
    if (
      !["Barangay Business Clearance", "Certificate of Residency"].includes(
        type,
      )
    ) {
      const media = await Promise.all(
        Object.keys(zip.files)
          .filter((n) => n.startsWith("word/media/") && !zip.files[n].dir)
          .map((n) => zip.file(n).async("nodebuffer")),
      );
      assert.ok(
        media.some((image) => image.equals(photo)),
        "The exact synthetic portrait must be embedded.",
      );
    }
    await writeFile(
      new URL(`${type.toLowerCase().replace(/ /g, "-")}.docx`, output),
      buffer,
    );
    const final = await generateWordDocument({
      request: r,
      template: template(type),
      photo:
        type === "Barangay Business Clearance" ||
        type === "Certificate of Residency"
          ? null
          : photo,
      final: true,
    });
    const finalXml = await (
      await JSZip.loadAsync(final)
    )
      .file("word/document.xml")
      .async("string");
    assert.doesNotMatch(finalXml, /DRAFT/);
  }
  const long = request("Certificate of Residency");
  long.verified_snapshot.fullName = "Long synthetic resident name ".repeat(7);
  long.verified_snapshot.address = "Long synthetic multiline address\n".repeat(
    10,
  );
  await generateWordDocument({
    request: long,
    template: template("Certificate of Residency"),
  });
});
test("Word validation rejects macros, embedded executables and external relationships", async () => {
  const buffer = await generateWordDocument({
    request: request("Certificate of Residency"),
    template: template("Certificate of Residency"),
  });
  for (const [name, text] of [
    ["word/vbaProject.bin", "bad"],
    [
      "word/_rels/evil.rels",
      '<Relationships><Relationship TargetMode="External" Target="https://example.com"/></Relationships>',
    ],
  ]) {
    const zip = await JSZip.loadAsync(buffer);
    zip.file(name, text);
    await assert.rejects(
      validateWord({
        buffer: await zip.generateAsync({ type: "nodebuffer" }),
        originalname: "bad.docx",
      }),
      /unsupported/,
    );
  }
});
test("notifications require matching status, omit confidential identifiers, and record accepted, failed and missing-email attempts", async () => {
  const r = {
    ...request("Certificate of Residency"),
    status: "ready_for_pickup",
  };
  const message = buildDocumentNotification({
    request: r,
    resident: { ...resident, email: "synthetic@example.invalid" },
    template: template(r.request_type),
    type: "ready",
  });
  assert.match(message.text, /ready for pickup/);
  assert.doesNotMatch(message.text, /1990|birthdate|Tax Identification/);
  assert.throws(
    () =>
      buildDocumentNotification({
        request: { ...r, status: "submitted" },
        resident,
        type: "ready",
      }),
    /current request status/,
  );
  const changes = [];
  const db = {
    from: () => ({
      update: (patch) => ({
        eq: () => ({
          select: () => ({
            single: async () => {
              changes.push(patch);
              return { data: patch };
            },
          }),
        }),
      }),
    }),
  };
  const log = {
    id: randomUUID(),
    recipient: "synthetic@example.invalid",
    message_snapshot: message,
    idempotency_key: randomUUID(),
  };
  await performSend(db, log, async () => ({
    accepted: true,
    id: "provider-test",
  }));
  assert.equal(changes.at(-1).attempt_status, "accepted");
  await performSend(db, log, async () => {
    throw Object.assign(new Error("timeout"), { code: "EMAIL_SEND_TIMEOUT" });
  });
  assert.equal(changes.at(-1).error_code, "EMAIL_SEND_TIMEOUT");
  await performSend(db, { ...log, recipient: "" }, () => {
    throw new Error("must not send");
  });
  assert.equal(changes.at(-1).attempt_status, "skipped");
});

test("notification previews, repeated clicks, concurrent sends, invalid email, provider rejection and explicit retry use durable logs", async () => {
  const logs = [];
  const db = {
    from(table) {
      assert.equal(table, "notification_logs");
      let filters = [],
        patch,
        insert;
      const query = {
        select() {
          return this;
        },
        eq(key, value) {
          filters.push((r) => r[key] === value);
          return this;
        },
        insert(value) {
          insert = value;
          return this;
        },
        update(value) {
          patch = value;
          return this;
        },
        async maybeSingle() {
          return {
            data: logs.find((r) => filters.every((f) => f(r))) || null,
            error: null,
          };
        },
        async single() {
          if (insert) {
            if (logs.some((l) => l.idempotency_key === insert.idempotency_key))
              return { error: { code: "23505" } };
            const row = { id: randomUUID(), ...insert };
            logs.push(row);
            return { data: row, error: null };
          }
          const row = logs.find((r) => filters.every((f) => f(r)));
          Object.assign(row, patch);
          return { data: row, error: null };
        },
      };
      return query;
    },
  };
  const r = {
    ...request("Certificate of Residency"),
    status: "ready_for_pickup",
  };
  const context = {
    request: r,
    resident: { ...resident, email: "synthetic@example.invalid" },
    template: template(r.request_type),
    type: "ready",
    actorId: randomUUID(),
    idempotencyKey: randomUUID(),
  };
  const preview = buildDocumentNotification(context);
  context.previewHash = createHash("sha256")
    .update(JSON.stringify(preview))
    .digest("hex");
  let calls = 0;
  const sender = async (message) => {
    calls++;
    assert.equal(message.idempotencyKey, context.idempotencyKey);
    return { accepted: true, id: "provider-test" };
  };
  await assert.rejects(
    sendDocumentNotification(db, { ...context, previewHash: "stale" }, sender),
    /fresh preview/,
  );
  assert.equal(logs.length, 0);
  const attempts = await Promise.allSettled([
    sendDocumentNotification(db, context, sender),
    sendDocumentNotification(db, context, sender),
  ]);
  assert.ok(attempts.some((x) => x.status === "fulfilled"));
  assert.equal(calls, 1);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].attempt_status, "accepted");
  // PostgreSQL jsonb can reorder object keys; that must not invalidate a repeated send.
  logs[0].message_snapshot = Object.fromEntries(
    Object.entries(logs[0].message_snapshot).reverse(),
  );
  await sendDocumentNotification(db, context, sender);
  assert.equal(calls, 1);
  const invalid = {
    ...context,
    idempotencyKey: randomUUID(),
    resident: { ...resident, email: "invalid-address" },
  };
  invalid.previewHash = createHash("sha256")
    .update(JSON.stringify(buildDocumentNotification(invalid)))
    .digest("hex");
  assert.equal(
    (await sendDocumentNotification(db, invalid, sender)).attempt_status,
    "skipped",
  );
  assert.equal(calls, 1);
  const failure = { ...context, idempotencyKey: randomUUID() };
  const failed = await sendDocumentNotification(db, failure, async () => {
    throw Object.assign(new Error("rejected"), { code: "RESEND_API_ERROR" });
  });
  assert.equal(failed.attempt_status, "failed");
  assert.equal(failed.error_code, "RESEND_API_ERROR");
  const retried = await performSend(db, failed, async (message) => {
    assert.equal(message.idempotencyKey, failure.idempotencyKey);
    return { accepted: true, id: "retry-test" };
  });
  assert.equal(retried.attempt_status, "accepted");
  assert.equal(logs.length, 3);
});

test("Phase 11 SQL installs twice, enforces transitions and stale versions, preserves history and snapshots, numbers requests uniquely, and locks finalized versions", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE service_role BYPASSRLS;CREATE ROLE anon;CREATE ROLE authenticated;
 CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 CREATE FUNCTION bgy_p105_ready() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
 CREATE FUNCTION bgy_audit_row_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
 CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),role text,is_active boolean DEFAULT true,first_name text,middle_name text,last_name text,full_name text,updated_at timestamptz DEFAULT now());
 CREATE TABLE requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES users(id),resident_name text,request_type text,details text,status text DEFAULT 'submitted',admin_note text,copies_requested smallint DEFAULT 1,purpose_category text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
 CREATE TABLE request_timeline(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid REFERENCES requests(id),status text,note text,created_at timestamptz DEFAULT now());
 CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,title text,body text,kind text,broadcast boolean);
 CREATE TABLE case_history_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entity_type text,entity_id uuid,event_type text,actor_id uuid,actor_name_snapshot text,actor_role text,previous_status text,new_status text,message text,visibility text,metadata jsonb,operation_id uuid UNIQUE);
 CREATE TABLE id_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,status text);`);
    await db.exec(sql);
    await db.exec(sql);
    await db.exec(`CREATE TRIGGER duplicate_documents BEFORE INSERT OR UPDATE OF status ON requests FOR EACH ROW EXECUTE FUNCTION bgy_p105_guard_duplicate_request();
 CREATE TRIGGER duplicate_ids BEFORE INSERT OR UPDATE OF status ON id_requests FOR EACH ROW EXECUTE FUNCTION bgy_p105_guard_duplicate_request();`);
    const admin = randomUUID(),
      owner = randomUUID(),
      other = randomUUID();
    await db.query(
      "INSERT INTO users(id,role,full_name) VALUES($1,'super_admin','Test Staff'),($2,'resident','Test Resident'),($3,'resident','Other Resident')",
      [admin, owner, other],
    );
    const t = (
      await db.query(
        "SELECT * FROM document_templates WHERE document_type='Certificate of Residency'",
      )
    ).rows[0];
    await db.query(
      "UPDATE document_templates SET config=$1,approval_state='approved',approved_by=$2,approved_at=now() WHERE id=$3",
      [JSON.stringify(config), admin, t.id],
    );
    await assert.rejects(
      db.query("UPDATE document_templates SET config='{}' WHERE id=$1", [t.id]),
      /new template version/,
    );
    const create = async (
      user = owner,
      type = "Certificate of Residency",
      status = "submitted",
    ) =>
      (
        await db.query(
          "INSERT INTO requests(user_id,request_type,details,status) VALUES($1,$2,'Synthetic purpose',$3) RETURNING *",
          [user, type, status],
        )
      ).rows[0];
    const r = await create();
    await assert.rejects(create(), /active request/);
    const imagesRequest = await create(owner, "Barangay Clearance");
    const image = (
      await db.query("SELECT bgy_document_attach($1,$2,0,$3) AS result", [
        imagesRequest.id,
        owner,
        JSON.stringify({
          storage_path: `requests/${imagesRequest.id}/${randomUUID()}.png`,
          kind: "supporting",
        }),
      ])
    ).rows[0].result;
    await assert.rejects(
      db.query("SELECT bgy_document_remove_attachment($1,$2,1)", [
        image.id,
        other,
      ]),
      /Access denied/,
    );
    await db.query("SELECT bgy_document_remove_attachment($1,$2,1)", [
      image.id,
      owner,
    ]);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM request_attachments WHERE request_id=$1",
          [imagesRequest.id],
        )
      ).rows[0].n,
      0,
    );
    const apply = async (
      id,
      version,
      status,
      extra = {},
      actor = admin,
      note = "Staff response",
    ) =>
      (
        await db.query(
          "SELECT bgy_document_transition($1,$2,$3,$4,$5,$6,$7) AS result",
          [
            id,
            actor,
            version,
            status,
            note,
            JSON.stringify(extra),
            randomUUID(),
          ],
        )
      ).rows[0].result;
    await assert.rejects(apply(r.id, 0, "approved"), /Invalid document status/);
    await apply(r.id, 0, "under_review");
    await assert.rejects(apply(r.id, 0, "needs_revision"), /changed/);
    await assert.rejects(
      apply(r.id, 1, "needs_revision", {}, admin, ""),
      /instructions/,
    );
    await apply(r.id, 1, "needs_revision");
    await assert.rejects(
      apply(r.id, 2, "submitted", {}, other),
      /Access denied/,
    );
    await apply(
      r.id,
      2,
      "submitted",
      {
        details: "Corrected application",
        document_data: {},
        copies_requested: 2,
        purpose_category: "School",
      },
      owner,
    );
    await apply(r.id, 3, "under_review");
    const updated = (
      await db.query("SELECT updated_at FROM users WHERE id=$1", [owner])
    ).rows[0].updated_at;
    const extra = {
      template_id: t.id,
      issue_date: "2026-10-31",
      resident_updated_at: updated,
      verified_snapshot: request("Certificate of Residency").verified_snapshot,
      review_checks: { identityVerified: true, residencyVerified: true },
    };
    const approved = await apply(r.id, 4, "approved", extra);
    await assert.rejects(
      db.query("SELECT bgy_document_attach($1,$2,5,$3)", [
        r.id,
        owner,
        JSON.stringify({ storage_path: "unused.png", kind: "photo" }),
      ]),
      /locked after approval/,
    );
    assert.equal(approved.control_number, "TEST2026-0001");
    assert.equal(approved.copies_requested, 2);
    await db.query("UPDATE users SET full_name='Changed later' WHERE id=$1", [
      owner,
    ]);
    assert.equal(
      (
        await db.query("SELECT verified_snapshot FROM requests WHERE id=$1", [
          r.id,
        ])
      ).rows[0].verified_snapshot.fullName,
      "Synthetic A. Resident",
    );
    const file = {
      id: randomUUID(),
      storage_path: `generated/${r.id}/${randomUUID()}.docx`,
      source: "generated",
      sha256: "a".repeat(64),
    };
    const save = async (version, finalize) =>
      (
        await db.query(
          "SELECT bgy_document_save_version($1,$2,$3,$4,$5,$6) AS result",
          [
            r.id,
            admin,
            version,
            JSON.stringify({
              ...file,
              id: randomUUID(),
              storage_path: `generated/${r.id}/${randomUUID()}.docx`,
            }),
            finalize,
            randomUUID(),
          ],
        )
      ).rows[0].result;
    await save(5, false);
    await assert.rejects(save(5, false), /changed/);
    const final = await save(6, true);
    assert.equal(final.version_number, 2);
    await assert.rejects(
      db.query("UPDATE generated_documents SET sha256='changed' WHERE id=$1", [
        final.id,
      ]),
      /immutable/,
    );
    await apply(r.id, 7, "ready_for_pickup");
    await apply(r.id, 8, "claimed");
    await assert.rejects(apply(r.id, 9, "approved"), /Invalid document/);
    const r2 = await create(other);
    await apply(r2.id, 0, "under_review");
    const u2 = (
      await db.query("SELECT updated_at FROM users WHERE id=$1", [other])
    ).rows[0].updated_at;
    assert.equal(
      (await apply(r2.id, 1, "approved", { ...extra, resident_updated_at: u2 }))
        .control_number,
      "TEST2026-0002",
    );
    const legacy = await create(owner, "Old document", "completed");
    assert.equal(legacy.status, "completed");
    assert.equal(legacy.claimed_at, null);
    assert.equal(
      (
        await db.query(
          "SELECT has_function_privilege('anon','bgy_document_transition(uuid,uuid,integer,text,text,jsonb,uuid)','EXECUTE') AS allowed",
        )
      ).rows[0].allowed,
      false,
    );
    await db.query(
      "INSERT INTO id_requests(user_id,status) VALUES($1,'confirmed')",
      [owner],
    );
    await assert.rejects(
      db.query(
        "INSERT INTO id_requests(user_id,status) VALUES($1,'submitted')",
        [owner],
      ),
      /active Barangay ID/,
    );
    assert.ok(
      (await db.query("SELECT count(*)::int AS n FROM case_history_events"))
        .rows[0].n >= 10,
    );
  } finally {
    await db.close();
  }
});
