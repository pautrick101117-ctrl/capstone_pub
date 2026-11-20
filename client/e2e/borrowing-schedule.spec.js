import { test, expect } from "@playwright/test";
import { Buffer } from "node:buffer";

const startAt = "2030-05-02T10:00";
const dueAt = "2030-05-03T10:00";
const resources = [
  { id: "chairs", name: "Chairs", category: "item", total_quantity: 100, max_borrow_minutes: 1440 },
  { id: "hall", name: "Barangay Hall", category: "facility", total_quantity: 1, max_borrow_minutes: 480 },
];

async function fixture(page) {
  await page.clock.install({ time: new Date("2030-05-01T00:00:00Z") });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = { checks: [], submissions: [], requests: [], deferNext: false, pending: null, failNext: false, unavailable: false };
  const user = { id: "10000000-0000-4000-8000-000000000001", role: "resident", fullName: "Synthetic Resident", firstName: "Synthetic", isActive: true, mustChangePassword: false };
  await page.addInitScript(({ user }) => localStorage.setItem("barangay-iba-auth", JSON.stringify({ token: "synthetic-session", user, notifications: [], expiresAt: Date.now() + 1800000, lastActivityAt: Date.now() })), { user });
  await page.route("**/*", async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === "127.0.0.1" && url.port === "5173") return route.continue();
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") });
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    const path = url.pathname.slice(4);
    if (path === "/auth/me") return json({ user, notifications: [] });
    if (path === "/borrowing/mine") return json({ requests: state.requests });
    if (path === "/borrowing/assets") {
      const start = url.searchParams.get("startAt"), due = url.searchParams.get("dueAt");
      const duration = start && due ? (Date.parse(due) - Date.parse(start)) / 60_000 : 0;
      const available = !state.unavailable;
      const assets = resources.map((asset) => ({ ...asset, durationConfigured: true, is_active: true,
        availableQuantity: available ? asset.total_quantity : 0, withinDurationLimit: duration <= asset.max_borrow_minutes,
        isAvailable: available && duration <= asset.max_borrow_minutes,
        unavailableReason: duration > asset.max_borrow_minutes ? "BORROW_DURATION_EXCEEDED" : available ? null : "BORROW_RESOURCE_UNAVAILABLE",
      }));
      if (start && due) {
        state.checks.push({ startAt: start, dueAt: due });
        if (state.deferNext) {
          state.deferNext = false;
          let finish;
          const completed = new Promise((resolve) => { finish = resolve; });
          await new Promise((resolve) => { state.pending = () => { resolve(); return completed; }; });
          // The client deliberately aborts this old request after a schedule change.
          await json({ assets }).catch(() => {});
          finish();
          return;
        }
        if (state.failNext) { state.failNext = false; return json({ message: "Unable to check availability. Please try again." }, 503); }
      }
      return json({ assets });
    }
    if (path === "/borrowing/requests" && req.method() === "POST") {
      const body = req.postDataJSON();
      state.submissions.push(body);
      const request = { id: "request-1", asset: resources.find((asset) => asset.id === body.assetId), start_at: body.startAt, due_at: body.dueAt, quantity: body.quantity, purpose: body.purpose, event_location: body.eventLocation, status: "pending", case_history: [] };
      state.requests.push(request);
      return json({ request, message: "Borrowing request submitted for barangay review." }, 201);
    }
    return json({ items: [], notifications: [], requests: [] });
  });
  await page.goto("/portal/borrowing");
  return { state, errors };
}

const resourceCard = (page, name) => page.getByRole("heading", { name, exact: true }).locator("..");
const scheduleCard = (page) => page.getByRole("heading", { name: "2. Choose your borrowing schedule", exact: true }).locator("../..");
const borrowFrom = (page) => page.getByLabel("Borrow From", { exact: true });
const returnBy = (page) => page.getByLabel("Return By", { exact: true });
const checkButton = (page) => page.getByRole("button", { name: "Check Availability", exact: true });
const reviewButton = (page) => page.getByRole("button", { name: "Review Borrowing Request", exact: true });

async function selectResource(page, name = "Chairs") {
  await resourceCard(page, name).getByRole("button", { name: "Select resource", exact: true }).click();
}
async function fillSchedule(page, start = startAt, due = dueAt) {
  await borrowFrom(page).fill(start);
  await returnBy(page).fill(due);
}
async function fillRequest(page) {
  await page.getByLabel("Purpose / Event").fill("Community gathering for local residents.");
  await page.getByLabel("Event / Use Location").fill("Purok 1, Barangay Iba");
  await page.getByRole("checkbox", { name: /Borrowing responsibility/ }).check();
}

test("two schedule fields accept the exact maximum, show a summary, and submit the checked Philippine times", async ({ page }) => {
  const { state, errors } = await fixture(page);
  await selectResource(page);
  await fillSchedule(page);
  await expect(page.getByLabel("How many hours do you need?")).toHaveCount(0);
  const summary = page.getByRole("definition");
  await expect(summary.filter({ hasText: /^1 day$/ })).toHaveCount(2);
  await expect(returnBy(page)).toHaveAttribute("max", dueAt);
  await expect(checkButton(page)).toBeEnabled();
  await checkButton(page).click();
  await expect(reviewButton(page)).toBeEnabled();
  await fillRequest(page);
  await reviewButton(page).click();
  await page.getByRole("button", { name: "Confirm & Submit Request", exact: true }).click();
  await expect.poll(() => state.submissions.length).toBe(1);
  expect(state.submissions[0]).toMatchObject({ assetId: "chairs", startAt: "2030-05-02T02:00:00.000Z", dueAt: "2030-05-03T02:00:00.000Z" });
  await expect(page.getByRole("heading", { name: "Chairs × 1", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("over-limit and reversed ranges show inline errors and block checking and review", async ({ page }) => {
  const { state, errors } = await fixture(page);
  await selectResource(page);
  await fillSchedule(page, startAt, "2030-05-03T10:01");
  await expect(scheduleCard(page).locator("span.text-rose-600").filter({ hasText: /selected duration is 24h 1m/ })).toBeVisible();
  await expect(returnBy(page)).toHaveAttribute("aria-invalid", "true");
  await expect(checkButton(page)).toBeDisabled();
  await expect(reviewButton(page)).toBeDisabled();
  await expect(page.getByText("Check availability for this resource and schedule before continuing.")).toHaveCount(0);
  for (const due of [startAt, "2030-05-02T09:59"]) {
    await returnBy(page).fill(due);
    await expect(returnBy(page)).toHaveAccessibleDescription("Return By must be later than Borrow From.");
    await expect(checkButton(page)).toBeDisabled();
  }
  await fillSchedule(page, "2030-05-01T07:59", "2030-05-01T09:00");
  await expect(borrowFrom(page)).toHaveAccessibleDescription("Borrow From must be a future date and time.");
  expect(state.checks).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("resource changes preserve dates, apply the new limit, and require a fresh availability check", async ({ page }) => {
  const { state, errors } = await fixture(page);
  await selectResource(page);
  await fillSchedule(page);
  await checkButton(page).click();
  await expect(reviewButton(page)).toBeEnabled();
  await selectResource(page, "Barangay Hall");
  await expect(borrowFrom(page)).toHaveValue(startAt);
  await expect(returnBy(page)).toHaveValue(dueAt);
  await expect(returnBy(page)).toHaveAccessibleDescription(/Barangay Hall may be borrowed for a maximum of 8 hours/);
  await expect(reviewButton(page)).toBeDisabled();
  await expect(checkButton(page)).toBeDisabled();
  await fillSchedule(page, "2030-05-02T22:00", "2030-05-03T06:00");
  await expect(checkButton(page)).toBeEnabled();
  await checkButton(page).click();
  await expect(reviewButton(page)).toBeEnabled();
  expect(state.checks).toHaveLength(2);
  expect(errors).toEqual([]);
});

test("late availability responses cannot replace results for an edited schedule", async ({ page }) => {
  const { state, errors } = await fixture(page);
  await selectResource(page);
  await fillSchedule(page);
  state.deferNext = true;
  state.unavailable = true;
  await checkButton(page).click();
  await expect.poll(() => Boolean(state.pending)).toBe(true);
  await returnBy(page).fill("2030-05-02T18:00");
  await expect(reviewButton(page)).toBeDisabled();
  state.unavailable = false;
  await checkButton(page).click();
  await expect(reviewButton(page)).toBeEnabled();
  await state.pending();
  await expect(reviewButton(page)).toBeEnabled();
  await expect(page.getByLabel("Quantity", { exact: false })).toHaveAttribute("max", "100");
  expect(state.checks).toHaveLength(2);
  expect(errors).toEqual([]);
});

test("cleared dates and service errors can be corrected and retried on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { state, errors } = await fixture(page);
  await selectResource(page);
  await fillSchedule(page);
  await returnBy(page).fill("");
  await returnBy(page).blur();
  await expect(returnBy(page)).toHaveAccessibleDescription("Select a return date and time.");
  await expect(checkButton(page)).toBeDisabled();
  await returnBy(page).fill("2030-05-03T10:01");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await scheduleCard(page).screenshot({ path: "../artifacts/borrowing-schedule-mobile.png", animations: "disabled" });
  await returnBy(page).fill(dueAt);
  state.failNext = true;
  await checkButton(page).click();
  await expect(page.getByText("Unable to check availability. Please try again.")).toBeVisible();
  await expect(reviewButton(page)).toBeDisabled();
  await returnBy(page).fill("2030-05-02T18:00");
  await expect(page.getByText("Unable to check availability. Please try again.")).toHaveCount(0);
  await checkButton(page).click();
  await expect(reviewButton(page)).toBeEnabled();
  expect(errors).toEqual([]);
});

test("submission revalidates a start time that expires while the review is open", async ({ page }) => {
  const { state, errors } = await fixture(page);
  await selectResource(page);
  await fillSchedule(page, "2030-05-01T08:02", "2030-05-01T09:02");
  await checkButton(page).click();
  await expect(reviewButton(page)).toBeEnabled();
  await fillRequest(page);
  await reviewButton(page).click();
  await page.clock.setSystemTime(new Date("2030-05-01T00:02:01Z"));
  const dialog = page.getByRole("dialog", { name: "Review borrowing request", exact: true });
  const submit = dialog.getByRole("button", { name: "Confirm & Submit Request", exact: true });
  // Changing the system clock does not run the periodic refresh. Submission
  // must check the current time again before sending a request.
  await submit.click();
  await expect(dialog.getByRole("alert")).toContainText("Borrow From must be a future date and time.");
  await expect(submit).toBeDisabled();
  expect(state.submissions).toHaveLength(0);
  expect(errors).toEqual([]);
});
