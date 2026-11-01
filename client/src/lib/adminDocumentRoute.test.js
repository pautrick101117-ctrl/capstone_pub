import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("admin document route and detail page ship together", async () => {
  const [app, page, queue] = await Promise.all([
    read("../App.jsx"),
    read("../pages/admin/DocumentRequestPage.jsx"),
    read("../components/DocumentQueue.jsx"),
  ]);
  assert.match(app, /import\s+DocumentRequestPage\s+from\s+["']\.\/pages\/admin\/DocumentRequestPage["']/);
  assert.match(app, /path=["']admin["'][^]*path=["']requests\/document\/:id["']\s+element=\{<DocumentRequestPage\s*\/>\}/);
  assert.match(page, /useParams\(\)/);
  assert.match(page, /<DocumentRequestDetail\s+id=\{id\}/);
  assert.match(queue, /to=\{`\/admin\/requests\/document\/\$\{r\.id\}`\}/);
});

test("Vercel SPA rewrite supports deep links", async () => {
  const vercel = JSON.parse(await read("../../vercel.json"));
  assert.ok(vercel.rewrites.some(item => item.destination === "/index.html" && item.source === "/(.*)"));
});
