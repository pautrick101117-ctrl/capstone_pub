import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
const owner = "10000000-0000-4000-8000-000000000001",
  requestId = "20000000-0000-4000-8000-000000000001",
  templateId = "30000000-0000-4000-8000-000000000001";
const types = [
  "Barangay Identification Card",
  "Certificate of Indigency",
  "Barangay Clearance",
  "Barangay Business Clearance",
  "Certificate of Residency",
];
const profile = {
  id: owner,
  first_name: "Synthetic",
  middle_name: "A.",
  last_name: "Resident",
  full_name: "Synthetic A. Resident",
  address: "12 Example Street, Iba, Silang, Cavite",
  purok: "Purok 1",
  email: "synthetic@example.invalid",
  contact_number: "",
  birthdate: "1990-01-01",
  residency_since: "2010-01-01",
  hasPhoto: true,
  updated_at: "2026-10-31T00:00:00Z",
};
const syntheticUser = (role) => ({
  id: owner,
  role,
  firstName: "Synthetic",
  fullName: profile.full_name,
  username: "synthetic",
  email: profile.email,
  isActive: true,
  mustChangePassword: false,
  address: profile.address,
  purok: profile.purok,
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l7sAAAAASUVORK5CYII=",
  "base64",
);
const empty = {
  users: [],
  requests: [],
  documents: [],
  events: [],
  slots: [],
  id_pickup_slots: [],
  complaints: [],
  suggestions: [],
  elections: [],
  projects: [],
  items: [],
  updates: [],
  officials: [],
  funds: [],
  announcements: [],
  news: [],
  logs: [],
  audit_logs: [],
  households: [],
  types: [],
  values: [],
  options: [],
  assets: [],
  notifications: [],
  hotlines: [],
  reports: [],
  statistics: {},
  stats: {},
  charts: {},
  recentActivity: [],
  pagination: { page: 1, totalPages: 1, total: 0, limit: 10 },
  content: {},
  settings: {},
  contact: {},
  fundSummary: { total: 0, spent: 0, remaining: 0 },
  hero: { hero: {} },
  upcomingEvents: [],
  liveElection: null,
};
async function fixture(page, role = "resident", options = {}) {
  const user = syntheticUser(role);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = {
    requests: options.requests || [],
    files: options.files || [],
    logs: [],
    submitted: 0,
    emails: 0,
    photos: 0,
  };
  const template = {
    id: templateId,
    document_type: "Certificate of Residency",
    version: 1,
    approval_state: "approved",
    config: {
      title: "CERTIFICATION",
      chairmanName: "Synthetic Authorized Official",
      designation: "Barangay Chairman",
      paragraphs: ["{{fullName}} resides at {{address}}."],
      controlPrefix: "R",
      issuanceStage: "approved",
      validityMonths: 3,
      pickupInstructions: "Visit the office.",
      officeContact: "Contact the barangay office.",
      requiredBusinessFields: [
        "businessName",
        "businessAddress",
        "businessKind",
        "permitYear",
      ],
    },
  };
  await page.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.hostname === "127.0.0.1" && url.port === "5173")
      return route.continue();
    if (!url.pathname.startsWith("/api/"))
      return route.fulfill({ contentType: "image/png", body: png });
    const path = url.pathname.slice(4),
      method = req.method();
    let body;
    try {
      body = req.postDataJSON();
    } catch {
      body = {};
    }
    const json = (data) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (path === "/auth/me") return json({ user, notifications: [] });
    if (path === "/auth/login")
      return json({ user, token: "synthetic-test-session" });
    if (path === "/requests/mine" || path === "/admin/requests")
      return json({ requests: state.requests });
    if (path === "/requests" && method === "POST") {
      state.submitted++;
      const r = {
        id: `20000000-0000-4000-8000-${String(state.submitted).padStart(12,'0')}`,
        user_id: owner,
        resident_name: profile.full_name,
        request_type: body.requestType,
        details: body.details,
        document_data: body.documentData,
        copies_requested: body.copiesRequested,
        status: "submitted",
        lock_version: 0,
        created_at: "2026-10-31T01:00:00Z",
        case_history: [],
        request_timeline: [],
      };
      state.requests.push(r);
      return json({ request: r });
    }
    if (path === `/requests/${requestId}` && method === "PATCH") {
      Object.assign(state.requests[0], {
        details: body.details,
        status: body.status || "submitted",
        lock_version: state.requests[0].lock_version + 1,
      });
      return json({ request: state.requests[0] });
    }
    if (
      path === "/documents/profile" ||
      path === `/documents/residents/${owner}/profile`
    )
      return json({ profile });
    if (path.endsWith("/photo")) {
      if (method === "POST") state.photos++;
      return method === "GET"
        ? route.fulfill({ contentType: "image/png", body: png })
        : json({ hasPhoto: true });
    }
    if (path === "/documents/catalog")
      return json({
        types: types.map((type) => ({
          type,
          templateId,
          approved: true,
          requiresPhoto: type !== "Certificate of Residency",
          requiredBusinessFields: template.config.requiredBusinessFields,
        })),
      });
    if (path === "/documents/templates") return json({ templates: [template] });
    if (path === `/documents/requests/${requestId}`)
      return json({
        request: state.requests[0],
        resident: profile,
        attachments: [],
        files: state.files,
        notificationLogs: state.logs,
      });
    if (path === `/documents/requests/${requestId}/transition`) {
      const r = state.requests[0];
      Object.assign(r, {
        status: body.status,
        lock_version: r.lock_version + 1,
        control_number:
          body.status === "approved" ? "R2026-0001" : r.control_number,
        issue_date: body.issueDate || r.issue_date,
      });
      return json({ request: r });
    }
    if (
      path === `/documents/requests/${requestId}/generate` ||
      path.endsWith("/word")
    ) {
      const r = state.requests[0];
      const f = {
        id: `40000000-0000-4000-8000-${String(state.files.length + 1).padStart(12, "0")}`,
        request_id: requestId,
        version_number: state.files.length + 1,
        source: path.endsWith("/word") ? "uploaded" : "generated",
        finalized_at: body.finalize ? "2026-10-31" : null,
      };
      state.files.unshift(f);
      r.lock_version++;
      if (body.finalize) r.status = "document_prepared";
      return json({ document: f });
    }
    if (path.startsWith("/documents/files/"))
      return route.fulfill({
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        body: await readFile(
          new URL(
            `../../artifacts/documents/${state.requests[0].request_type.toLowerCase().replace(/ /g, "-")}.docx`,
            import.meta.url,
          ),
        ),
      });
    if (path.endsWith("/notification-preview"))
      return json({
        message: {
          to: profile.email,
          subject: "Document ready for pickup",
          text: `Hello Synthetic, your document is ready for pickup. Request ${requestId}.`,
        },
        previewHash: "synthetic-preview",
      });
    if (path.endsWith("/notify")) {
      state.emails++;
      const log = {
        id: "mail-1",
        attempt_status: "accepted",
        notification_type: body.type,
        recipient: profile.email,
        created_at: "2026-10-31",
        provider_message_id: "synthetic-provider-id",
      };
      state.logs.push(log);
      return json({ notification: log });
    }
    if (path === "/complaints/eligibility")
      return json({ enabled: false, allowed: true });
    if (path === "/public/landing") return json(empty);
    if (path === "/admin/dashboard") return json(empty);
    if (path === "/voting/current")
      return json({ election: null, options: [] });
    return json(empty);
  });
  if (options.signedIn !== false)
    await page.addInitScript(
      ({ user }) =>
        localStorage.setItem(
          "barangay-iba-auth",
          JSON.stringify({
            token: "synthetic-test-session",
            user,
            notifications: [],
            expiresAt: Date.now() + 1800000,
            lastActivityAt: Date.now(),
          }),
        ),
      { user },
    );
  return { state, errors };
}
const request = (status) => ({
  id: requestId,
  user_id: owner,
  resident_name: profile.full_name,
  request_type: "Certificate of Residency",
  details: "Synthetic loan application",
  copies_requested: 1,
  document_data: {},
  status,
  lock_version: 0,
  created_at: "2026-10-31T01:00:00Z",
  case_history: [],
  request_timeline: [],
});

test("public, resident and administrative routes render without fatal errors using controlled synthetic responses", async ({
  page,
}) => {
  for (const [role, paths] of [
    [
      "resident",
      [
        "/",
        "/news",
        "/news/example",
        "/announcements",
        "/fund_transparency",
        "/officials",
        "/calendar",
        "/help-center",
        "/terms-of-use",
        "/privacy-policy",
        "/voting-result",
        "/voting-result/example",
        "/project-updates",
        "/project-updates/example",
        "/portal",
        "/portal/requests",
        "/portal/voting",
        "/portal/calendar",
        "/portal/suggestions",
        "/portal/voting-result",
        "/portal/complaints",
        "/portal/borrowing",
        "/portal/settings",
        "/change-password",
      ],
    ],
    [
      "super_admin",
      [
        "/admin",
        "/admin/residents",
        "/admin/requests",
        "/admin/officials",
        "/admin/news",
        "/admin/announcements",
        "/admin/funds",
        "/admin/events",
        "/admin/project-suggestions",
        "/admin/voting",
        "/admin/projects",
        "/admin/census",
        "/admin/complaints",
        "/admin/borrowing",
        "/admin/broadcasts",
        "/admin/settings",
        "/admin/audit-logs",
        "/admin/reports",
        "/admin/admin-accounts",
      ],
    ],
  ]) {
    await page.unrouteAll();
    const { errors } = await fixture(page, role);
    for (const path of paths) {
      await page.goto(path);
      await page.waitForTimeout(160);
      await expect(
        page.getByRole("heading", { name: "This page could not be loaded" }),
        path,
      ).toHaveCount(0);
      expect(errors, path).toEqual([]);
    }
  }
});
test("resident login and all five conditional document applications submit once with references", async ({
  page,
}) => {
  const { state } = await fixture(page, "resident", { signedIn: false });
  await page.goto("/login");
  await page
    .getByLabel(/Username, Email, or Contact Number/)
    .first()
    .fill("synthetic");
  await page
    .locator('input[autocomplete="current-password"]')
    .fill("Synthetic123");
  await page
    .getByRole("button", { name: "Login to Portal", exact: true })
    .click();
  await expect(page).toHaveURL(/\/portal$/);
  for (const type of types) {
    await page.goto("/portal/requests");
    await page
      .getByRole("button", { name: "New Request", exact: true })
      .first()
      .click();
    await page.getByLabel("Document type").selectOption(type);
    await page
      .getByLabel("Purpose / Details")
      .fill("Synthetic education request");
    if (type === "Barangay Business Clearance") {
      for (const [label, value] of [
        ["Registered business name", "Synthetic Shop"],
        ["Business address", "12 Example Street"],
        ["Kind of business", "Retail"],
        ["Permit year", "2026"],
      ])
        await page.getByLabel(label).fill(value);
      await expect(
        page.getByLabel(
          "Family income information (for staff verification, optional)",
        ),
      ).toHaveCount(0);
    }
    await page
      .getByRole("button", { name: "Review and submit", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Submit application", exact: true })
      .click();
    await expect(
      page.getByText(`Reference: ${state.requests.at(-1).id}`, { exact: true }),
    ).toBeVisible();
  }
  expect(state.submitted).toBe(5);
});
test("resident revision instructions and corrected submission remain visible", async ({
  page,
}) => {
  const r = {
    ...request("needs_revision"),
    revision_instructions: "Please correct the purpose.",
  };
  const { state } = await fixture(page, "resident", { requests: [r] });
  await page.goto("/portal/requests");
  await expect(page.getByText("Please correct the purpose.")).toBeVisible();
  await page.getByRole("button", { name: "Correct application" }).click();
  await page
    .getByLabel("Purpose / Details")
    .fill("Corrected synthetic education purpose");
  await page.getByRole("button", { name: "Review and submit" }).click();
  await page
    .getByRole("button", { name: "Submit application", exact: true })
    .click();
  await expect.poll(() => state.requests[0].status).toBe("submitted");
  expect(state.submitted).toBe(0);
});
test("admin review, Word versions, preview, preparation, pickup notification and claim controls", async ({
  page,
}) => {
  const { state, errors } = await fixture(page, "super_admin", {
    requests: [request("submitted")],
  });
  await page.goto("/admin/requests");
  await page.getByRole("button", { name: "Open request" }).click();
  await page.getByLabel("Decision").selectOption("under_review");
  await page
    .getByRole("button", { name: "Review decision", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect.poll(() => state.requests[0].status).toBe("under_review");
  await page.getByLabel("Decision").selectOption("approved");
  await page.getByLabel("Approved template").selectOption(templateId);
  await page.getByLabel("identity Verified").check();
  await page.getByLabel("residency Verified").check();
  await page
    .getByRole("button", { name: "Review decision", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect.poll(() => state.requests[0].status).toBe("approved");
  await page
    .getByRole("button", { name: "Generate draft Word document" })
    .click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Version 1 · generated · Draft")).toBeVisible();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    page
      .frameLocator('iframe[title="Word preview version 1"]')
      .getByText("Synthetic A. Resident", { exact: false })
      .first(),
  ).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Word", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.docx$/);
  await page.getByLabel("Revised Word document").setInputFiles({
    name: "revised.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await readFile(
      new URL(
        "../../artifacts/documents/certificate-of-residency.docx",
        import.meta.url,
      ),
    ),
  });
  await page
    .getByRole("button", { name: "Upload revised Word version", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Version 2 · uploaded · Draft")).toBeVisible();
  await page.getByLabel("Use this version").first().check();
  await page
    .getByRole("button", { name: "Confirm reviewed and mark prepared" })
    .click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect.poll(() => state.requests[0].status).toBe("document_prepared");
  await page.getByLabel("Decision").selectOption("ready_for_pickup");
  await page
    .getByRole("button", { name: "Review decision", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect.poll(() => state.requests[0].status).toBe("ready_for_pickup");
  await page
    .getByRole("button", { name: "Preview email", exact: true })
    .click();
  await expect(
    page.getByText(`To: ${profile.email}`, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Send reviewed email", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect.poll(() => state.emails).toBe(1);
  await expect(page.getByText(/Email accepted by Resend/)).toBeVisible();
  await page.getByLabel("Decision").selectOption("claimed");
  await page
    .getByRole("button", { name: "Review decision", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect.poll(() => state.requests[0].status).toBe("claimed");
  expect(errors).toEqual([]);
  await page.screenshot({
    path: "../artifacts/admin-document-workflow.png",
    fullPage: true,
  });
});
test("photo validation and mobile request layout", async ({ page }) => {
  const { state } = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/portal/settings");
  await page.getByLabel("Upload or replace photo").setInputFiles({
    name: "invalid.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(
    page.getByText("Choose a JPEG, PNG or WebP image up to 5 MB."),
  ).toBeVisible();
  expect(state.photos).toBe(0);
  await page.getByLabel("Upload or replace photo").setInputFiles({
    name: "portrait.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect.poll(() => state.photos).toBe(1);
  await page.goto("/portal/requests");
  await page
    .getByRole("button", { name: "New Request", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Document type")).toBeVisible();
  await page.screenshot({
    path: "../artifacts/resident-document-mobile.png",
    fullPage: true,
  });
});

test("all five generated Word files render their editable content, logos and photo in the browser preview", async ({
  page,
}) => {
  const file = {
    id: "40000000-0000-4000-8000-000000000001",
    request_id: requestId,
    version_number: 1,
    source: "generated",
  };
  const { state, errors } = await fixture(page, "super_admin", {
    requests: [request("approved")],
    files: [file],
  });
  for (const type of types) {
    state.requests[0].request_type = type;
    await page.goto("/admin/requests");
    await page.getByRole("button", { name: "Open request" }).click();
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.frameLocator('iframe[title="Word preview version 1"]');
    await expect(preview.locator("section.docx")).toHaveCount(2);
    await expect(preview.locator("img").first()).toBeVisible();
    expect(await preview.locator("img").count()).toBeGreaterThanOrEqual(
      [
        "Barangay Identification Card",
        "Certificate of Indigency",
        "Barangay Clearance",
      ].includes(type)
        ? 6
        : 4,
    );
    if (type === "Barangay Identification Card") {
      expect(
        await preview
          .locator("section.docx")
          .first()
          .evaluate((el) => el.getBoundingClientRect().height),
      ).toBeLessThanOrEqual(205);
      await preview
        .locator("section.docx")
        .first()
        .screenshot({
          path: "../artifacts/preview-barangay-identification-card.png",
        });
      continue;
    }
    const html = await page
      .locator('iframe[title="Word preview version 1"]')
      .evaluate((frame) => frame.contentDocument.documentElement.outerHTML);
    await page.setContent(html);
    await page.screenshot({
      path: `../artifacts/preview-${type.toLowerCase().replace(/ /g, "-")}.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});
