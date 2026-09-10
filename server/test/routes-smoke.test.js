import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(`../src/routes/${name}.js`, import.meta.url), "utf8");
const expected = {
  auth: ["/login", "/forgot-password/request-code", "/change-password"],
  public: ["/landing", "/community-support"],
  voting: [],
  admin: ["/users", "/complaints", "/content"],
  superAdmin: ["/users"],
  notifications: ["/read-all"],
  complaints: ["/mine"],
  requests: [],
  suggestions: [],
  borrowing: ["/assets", "/mine", "/requests", "/admin/assets", "/admin/requests"],
};

for (const [name, paths] of Object.entries(expected)) {
  test(`server route contract exists: ${name}`, async () => {
    const source = await read(name);
    assert.match(source, /express\.Router\(\)/);
    assert.match(source, /export default router/);
    for (const path of paths) assert.ok(source.includes(`"${path}"`), `${name} should contain ${path}`);
  });
}

test("server index mounts all feature routers and exposes health endpoint", async () => {
  const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
  for (const mount of ["/api/auth", "/api/public", "/api/voting", "/api/admin", "/api/super-admin", "/api/notifications", "/api/complaints", "/api/requests", "/api/suggestions", "/api/borrowing"]) {
    assert.ok(source.includes(`"${mount}"`), `index should mount ${mount}`);
  }
  assert.ok(source.includes('app.get("/api/health"'));
  assert.match(source, /export const createApp/);
});
