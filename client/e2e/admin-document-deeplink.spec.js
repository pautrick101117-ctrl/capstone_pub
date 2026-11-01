import { test, expect } from "@playwright/test";

// A clean, unauthenticated browser MUST redirect to the admin login page.
// If the frontend route is missing, React Router renders "Page not found" instead.
test("admin document request deep link is registered", async ({ page }) => {
  await page.goto("/admin/requests/document/aca0f032-f525-4a78-8af1-b401290d2790");
  await expect(page).toHaveURL(/\/admin\/login(?:[/?#]|$)/);
  await expect(page.getByText("This page isn't available.")).toHaveCount(0);
});
