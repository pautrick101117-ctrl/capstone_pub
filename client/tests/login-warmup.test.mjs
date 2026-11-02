import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const context = await readFile(new URL("../src/context/AuthContext.jsx", import.meta.url), "utf8");
const page = await readFile(new URL("../src/pages/admin/AdminLogin.jsx", import.meta.url), "utf8");
test("login alone uses the longer cold-start timeout without duplicate requests", () => {
  assert.match(context, /timeoutMs: 90_000/);
  assert.equal((context.match(/const me = await api\("\/auth\/me"/g) || []).length, 0);
});
test("admin sign in warns when the server is taking longer", () => {
  assert.match(page, /slowLogin/);
  assert.match(page, /Connecting to the server/);
});

