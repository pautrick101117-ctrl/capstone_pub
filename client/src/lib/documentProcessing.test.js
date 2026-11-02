import test from "node:test";
import assert from "node:assert/strict";
import { requestStage, requestFieldRows } from "./documentProcessing.js";
test("internal statuses map to the three staff-facing stages", () => {
  for(const state of ["submitted","under_review","needs_revision","rejected","cancelled"]) assert.equal(requestStage(state),1);
  for(const state of ["approved","document_prepared"]) assert.equal(requestStage(state),2);
  for(const state of ["ready_for_pickup","claimed"]) assert.equal(requestStage(state),3);
});
test("Barangay Clearance summary is not empty without document_data", () => {
  const rows=requestFieldRows({request_type:"Barangay Clearance",details:"Employment",copies_requested:1,document_data:{}},{full_name:"Sample Citizen",address:"Purok 1"});
  assert.deepEqual(rows.find(([label])=>label==="Purpose"),["Purpose","Employment"]);
  assert.deepEqual(rows.find(([label])=>label==="Requested document"),["Requested document","Barangay Clearance"]);
  assert.deepEqual(rows.find(([label])=>label==="Copies"),["Copies",1]);
});
test("Business Clearance shows extra required fields only when populated", () => {
  const rows=requestFieldRows({request_type:"Barangay Business Clearance",details:"Permit",document_data:{businessName:"Sample Shop",tinNumber:""}},{full_name:"Test",address:"Iba"});
  assert.deepEqual(rows.find(([label])=>label==="Business name"),["Business name","Sample Shop"]);
  assert.equal(rows.some(([label])=>label==="Tax Identification Number"),false);
});

import { approvalBlockers, preferredWordFile, staffEmailItems } from "./documentProcessing.js";

test("approval blockers explain each missing item without technical field names", () => {
  const missing = approvalBlockers({
    documentType: "Barangay Clearance", photoRequired: true, hasPhoto: false,
    requiredChecks: [["identityVerified", "I checked identity."], ["backgroundVerified", "I checked background."]],
    checks: {}, approvedTemplates: [], templateId: "", issueDate: "",
  });
  assert.deepEqual(missing.map(m => m.key), ["photo", "identityVerified", "backgroundVerified", "backgroundStatement", "template", "issueDate"]);
  assert.match(missing.find(m => m.key === "identityVerified").label, /^Verify/);
  assert.ok(missing.every(m => !m.label.includes("identityVerified")));
});

test("approval blockers clear when verified, and latest approved template is chosen", () => {
  const missing = approvalBlockers({
    documentType: "Barangay Clearance", photoRequired: true, hasPhoto: true,
    requiredChecks: [["identityVerified", "Identity"], ["residencyVerified", "Residency"], ["backgroundVerified", "Background"]],
    checks: { identityVerified: true, residencyVerified: true, backgroundVerified: true, backgroundStatement: "Checked by authorized staff" },
    approvedTemplates: [{ id: "v3" }], templateId: "v3", issueDate: "2026-11-01",
  });
  assert.deepEqual(missing, []);
});

test("newest Word version is default; staff may choose a previous version", () => {
  const files = [{ id: "old", version_number: 1 }, { id: "new", version_number: 3 }, { id: "mid", version_number: 2 }];
  assert.equal(preferredWordFile(files).id, "new");
  assert.equal(preferredWordFile(files, "old").id, "old");
  assert.equal(preferredWordFile(files, "removed").id, "new");
  assert.equal(preferredWordFile([]), null);
});

test("email outbox is canonical, no duplicate event from notification log", () => {
  const queue = [{ id: "q", queue_state: "done", notification_type: "ready", created_at: "2026-11-01" }];
  const legacy = [{ id: "l", attempt_status: "accepted", notification_type: "ready" }];
  const items = staffEmailItems(queue, legacy);
  assert.equal(items.length, 1);
  assert.equal(items[0].status, "Accepted by email provider");
  assert.equal(staffEmailItems([{ id: "bad", notification_type: "approved", queue_state: "failed" }], [])[0].failed, true);
});

test("Certificate of Residency shows a missing start date", () => {
  const blockers = approvalBlockers({documentType: "Certificate of Residency", photoRequired: false, hasPhoto: false,
    checks: {}, approvedTemplates: [{id:"t"}], templateId: "t", issueDate: "2026-11-01"});
  assert.deepEqual(blockers.map(x=>x.key), ["residencyDateVerified"]);
});

