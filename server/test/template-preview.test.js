import { test } from "node:test";
import assert from "node:assert/strict";
import { createPreviewRequest, previewTemplateConfig } from "../src/lib/templatePreviewData.js";

const seeded = {
  title: "CERTIFICATION OF INDIGENCY",
  paragraphs: ["This is to certify that {{fullName}} is a resident of {{address}}.", "Issued for {{purpose}}."],
  chairmanName: "", controlPrefix: "I", designation: "Barangay Chairman", footer: "NOT VALID WITHOUT DRY SEAL",
  pickupInstructions: "", officeContact: "", validityMonths: null,
};

test("preview safely handles a seeded, unapproved template without altering stored settings", () => {
  const preview = previewTemplateConfig(seeded);
  assert.equal(preview.chairmanName, "OFFICIAL NAME NOT CONFIGURED");
  assert.equal(preview.controlPrefix, "I");
  assert.equal(seeded.chairmanName, "");
  assert.deepEqual(preview.paragraphs, seeded.paragraphs);
});

test("preview rejects unsupported placeholders and unrecognized fields", () => {
  assert.throws(() => previewTemplateConfig({ ...seeded, paragraphs: ["{{apiKey}}"] }), /Unknown template field/);
  assert.throws(() => previewTemplateConfig({ ...seeded, controlPrefix: "1INVALID" }), /control prefix/);
});

test("preview only uses sample data and does not assign an issued control number", () => {
  const draft = createPreviewRequest("Barangay Identification Card", "2026-10-31");
  assert.equal(draft.control_number, null);
  assert.equal(draft.copies_requested, 1);
  assert.match(draft.verified_snapshot.fullName, /^SAMPLE/);
  assert.equal(draft.verified_snapshot.schemaVersion, 1);
  assert.match(draft.id, /PREVIEW/);
  assert.equal(draft.issue_date, "2026-10-31");
});

test("business clearance preview contains mock business data, not any real resident", () => {
  const draft = createPreviewRequest("Barangay Business Clearance", "2026-10-31");
  assert.equal(draft.verified_snapshot.documentData.businessName, "SAMPLE BUSINESS");
  assert.equal(draft.verified_snapshot.documentData.permitYear, "2026");
});

test("preview rejects an unsupported document type", () => {
  assert.throws(() => createPreviewRequest("Unknown Certificate"), /Unsupported document type/);
});

