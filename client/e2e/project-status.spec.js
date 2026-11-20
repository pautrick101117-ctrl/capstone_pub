import { test, expect } from "@playwright/test";

const projectId = "20000000-0000-4000-8000-000000000001";
const labels = { planned: "Planned", ongoing: "Ongoing", on_hold: "On Hold", completed: "Completed", cancelled: "Cancelled" };

async function fixture(page, { role = "super_admin", status = "planned" } = {}) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const project = {
    id: projectId, title: "Basketball Court Improvements", description: "Replace the basketball ring and repair the community court.",
    status, progress_percentage: 35, election_id: "election-1", updated_at: "2026-11-20T01:00:00Z",
  };
  const state = { project, updates: [], patches: [], published: [], failSave: false };
  const user = { id: "10000000-0000-4000-8000-000000000001", role, fullName: "Synthetic User", firstName: "Synthetic", isActive: true, mustChangePassword: false };
  await page.addInitScript(({ user }) => localStorage.setItem("barangay-iba-auth", JSON.stringify({ token: "synthetic-session", user, notifications: [], expiresAt: Date.now() + 1800000, lastActivityAt: Date.now() })), { user });
  const filtered = (url) => !url.searchParams.get("status") || url.searchParams.get("status") === "all" || url.searchParams.get("status") === project.status ? [project] : [];
  const milestone = (title, description, nextStatus) => ({ id: `update-${state.updates.length + 1}`, title, description, project_status: nextStatus, progress_percentage: 35, update_date: "2026-11-20", created_at: "2026-11-20T01:00:00Z" });
  await page.route("**/*", async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === "127.0.0.1" && url.port === "5173") return route.continue();
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ body: "" });
    const path = url.pathname.slice(4), method = req.method();
    if (path === "/auth/me") return json({ user, notifications: [] });
    if (path === "/admin/projects") {
      const projects = filtered(url);
      return json({ projects, pagination: { total: projects.length } });
    }
    if (path === `/admin/projects/${projectId}` && method === "PATCH") {
      const body = req.postDataJSON();
      state.patches.push(body);
      if (state.failSave) return json({ message: "Unable to save the project status. Please try again." }, 500);
      if (body.status && body.status !== project.status) {
        project.status = body.status;
        project.actual_start_date ||= body.status === "ongoing" ? "2026-11-20" : null;
        project.completed_at = body.status === "completed" ? "2026-11-20T01:00:00Z" : null;
        state.updates.unshift(milestone("Project Status Updated", body.reason || `Project status changed to ${labels[body.status]}.`, body.status));
      }
      for (const key of ["title", "description"]) if (body[key]) project[key] = body[key];
      return json({ project });
    }
    if (path === `/admin/projects/${projectId}/updates` || path.startsWith(`/admin/projects/${projectId}/updates/`)) {
      const form = {};
      for (const part of (req.postData() || "").split(/--[^\r\n]+\r\n/)) {
        const name = part.match(/name="([^"]+)"/), value = part.split("\r\n\r\n")[1]?.replace(/\r\n--[^]*$|\r\n$/g, "");
        if (name && value !== undefined) form[name[1]] = value;
      }
      state.published.push(form);
      let update;
      if (method === "PATCH") {
        update = state.updates.find((item) => item.id === path.split("/").at(-1));
        Object.assign(update, { title: form.title, description: form.description, project_status: form.projectStatus || null, corrected_at: "2026-11-20T02:00:00Z" });
      } else {
        update = milestone(form.title, form.description, form.projectStatus);
        project.status = form.projectStatus;
        state.updates.unshift(update);
      }
      return json({ project, update });
    }
    if (path === `/admin/projects/${projectId}` || path === `/public/projects/${projectId}`) return json({ project, updates: state.updates });
    if (path === "/public/projects") {
      const items = filtered(url);
      return json({ items, pagination: { total: items.length, limit: 6 } });
    }
    if (path === "/public/landing") return json({ communityProjects: [project] });
    if (path === "/suggestions/mine") return json({ suggestions: [{ id: "suggestion-1", title: project.title, description: project.description, status: "approved", project }], pagination: { total: 1 } });
    return json({ items: [], notifications: [], requests: [], complaints: [], suggestions: [], assets: [], events: [], officials: [], options: [], logs: [], pagination: { total: 0 } });
  });
  return { state, errors };
}

async function openStatus(page) {
  await page.getByRole("button", { name: "Update Status", exact: true }).click();
  return page.getByRole("dialog", { name: "Update Project Status", exact: true });
}

async function changeStatus(page, next, reason = "") {
  const dialog = await openStatus(page);
  await dialog.getByRole("combobox", { name: "Project Status", exact: true }).selectOption(next);
  if (reason) await dialog.getByLabel("Reason for Status Change").fill(reason);
  await dialog.getByRole("button", { name: "Save Status", exact: true }).click();
  await page.getByRole("dialog", { name: "Confirm Project Status Change" }).getByRole("button", { name: "Save Status", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test("keyboard-accessible admin cards manage the full project lifecycle and retain history", async ({ page }) => {
  const { state, errors } = await fixture(page);
  await page.goto("/admin/projects");
  const card = page.getByRole("button", { name: `Manage project: ${state.project.title}` });
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: state.project.title })).toBeVisible();
  await expect(page.getByText(/35%|0%|100%|Progress %/)).toHaveCount(0);
  await changeStatus(page, "ongoing");
  await changeStatus(page, "on_hold", "Waiting for delivery of replacement equipment.");
  await changeStatus(page, "ongoing");
  await changeStatus(page, "completed", "Installation and inspection have been completed.");
  await changeStatus(page, "ongoing", "Reopened for an additional safety inspection.");
  await changeStatus(page, "cancelled", "The project has been replaced by a revised proposal.");
  expect(state.patches.map((patch) => patch.status)).toEqual(["ongoing", "on_hold", "ongoing", "completed", "ongoing", "cancelled"]);
  expect(state.patches.every((patch) => !("progressPercentage" in patch))).toBe(true);
  expect(state.updates).toHaveLength(6);
  await page.getByRole("dialog", { name: state.project.title }).getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("tab", { name: "Cancelled", exact: true }).click();
  await expect(card).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: "../artifacts/project-status-admin.png", fullPage: true, animations: "disabled" });
});

test("status validation, discarded edits and failed saves preserve the project record", async ({ page }) => {
  const { state, errors } = await fixture(page, { status: "ongoing" });
  await page.goto(`/admin/projects?recordId=${projectId}`);
  const dialog = await openStatus(page);
  await dialog.getByRole("combobox", { name: "Project Status", exact: true }).selectOption("on_hold");
  await dialog.getByRole("button", { name: "Save Status", exact: true }).click();
  expect(state.patches).toHaveLength(0);
  await expect(dialog.getByLabel("Reason for Status Change")).toHaveAttribute("required", "");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Keep Editing", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Discard Changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  state.failSave = true;
  const retry = await openStatus(page);
  await retry.getByRole("combobox", { name: "Project Status", exact: true }).selectOption("completed");
  await retry.getByLabel("Reason for Status Change").fill("Project work has been inspected and completed.");
  await retry.getByRole("button", { name: "Save Status", exact: true }).click();
  await page.getByRole("dialog", { name: "Confirm Project Status Change" }).getByRole("button", { name: "Save Status", exact: true }).click();
  await expect(page.getByText("Unable to save the project status. Please try again.")).toBeVisible();
  await expect(retry).toBeVisible();
  expect(state.project.status).toBe("ongoing");
  expect(errors).toEqual([]);
});

test("project details and published updates can be edited without percentage fields", async ({ page }) => {
  const { state, errors } = await fixture(page, { status: "ongoing" });
  state.updates.push({ id: "update-1", title: "Work Scheduled", description: "Initial site inspection is scheduled.", project_status: "planned", update_date: "2026-11-19", created_at: "2026-11-19T01:00:00Z" });
  await page.goto(`/admin/projects?recordId=${projectId}`);
  await page.getByRole("button", { name: "Edit Details", exact: true }).click();
  await page.getByLabel("Project Description").fill("Replace the basketball ring and improve the court lighting.");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await page.getByRole("dialog", { name: "Confirm Project Changes" }).getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect.poll(() => state.project.description).toContain("lighting");
  await page.getByRole("button", { name: "Edit Update", exact: true }).click();
  await page.getByLabel("Update Title").fill("Site Inspection Scheduled");
  await page.getByRole("button", { name: "Save Correction", exact: true }).click();
  await page.getByRole("dialog", { name: "Confirm Update Correction" }).getByRole("button", { name: "Save Correction", exact: true }).click();
  await expect.poll(() => state.updates[0].title).toBe("Site Inspection Scheduled");
  expect(state.project.status).toBe("ongoing");
  await page.getByRole("button", { name: "Publish Update", exact: true }).click();
  await page.getByLabel("Update Title").fill("Equipment Delivery");
  await page.getByLabel("Update Description").fill("Replacement equipment has arrived at the project site.");
  await page.getByRole("button", { name: "Publish Update", exact: true }).click();
  await page.getByRole("dialog", { name: "Publish Project Update?", exact: true }).getByRole("button", { name: "Publish Update", exact: true }).click();
  await expect.poll(() => state.updates.length).toBe(2);
  expect(state.published.every((item) => !("progressPercentage" in item))).toBe(true);
  expect(errors).toEqual([]);
});

test("every status appears on the landing page and public project filters and detail", async ({ page }) => {
  const { state, errors } = await fixture(page);
  for (const [status, label] of Object.entries(labels)) {
    state.project.status = status;
    await page.goto("/");
    const homeCard = page.getByRole("link", { name: `View project: ${state.project.title}` });
    await expect(homeCard.getByText(label, { exact: true })).toBeVisible();
    await page.goto("/project-updates");
    const card = page.getByRole("link", { name: `View project: ${state.project.title}` });
    await expect(card.getByText(label, { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: label, exact: true }).click();
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByRole("heading", { name: state.project.title, exact: true })).toBeVisible();
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByText(/35%|Progress after this update|Implementation progress/)).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("residents follow project status within their portal and see historical statuses on mobile", async ({ page }) => {
  const { state, errors } = await fixture(page, { role: "resident", status: "on_hold" });
  state.updates.push({ id: "history-1", title: "Work Started", description: "Site preparation has started.", project_status: "ongoing", progress_percentage: 35, update_date: "2026-11-18", created_at: "2026-11-18T01:00:00Z" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/portal/project-updates");
  await page.getByRole("link", { name: `View project: ${state.project.title}` }).click();
  await expect(page).toHaveURL(`/portal/project-updates/${projectId}`);
  await expect(page.getByRole("button", { name: "More resident services" })).toBeVisible();
  await expect(page.getByText("On Hold", { exact: true })).toBeVisible();
  await expect(page.getByText("Ongoing", { exact: true })).toBeVisible();
  await expect(page.getByText(/35%|Progress after this update/)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "../artifacts/project-status-resident-mobile.png", fullPage: true, animations: "disabled" });
  await page.getByRole("link", { name: "Back to Project Updates" }).click();
  await expect(page).toHaveURL("/portal/project-updates");
  await page.goto("/portal/suggestions");
  await page.getByRole("tab", { name: /My Suggestions/i }).click();
  await expect(page.getByText("On Hold", { exact: true })).toBeVisible();
  await expect(page.getByText(/35%/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View Project Updates", exact: true })).toHaveAttribute("href", `/portal/project-updates/${projectId}`);
  expect(errors).toEqual([]);
});
