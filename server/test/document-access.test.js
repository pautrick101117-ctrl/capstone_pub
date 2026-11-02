import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import express from "express";
import sharp from "sharp";
import { signToken } from "../src/lib/jwt.js";
const dataUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const owner = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002",
  admin = "10000000-0000-4000-8000-000000000003";
const id = "20000000-0000-4000-8000-000000000001",
  fileId = "30000000-0000-4000-8000-000000000001";
const absoluteImports = (source, base, overrides = {}) =>
  source.replace(
    /from (["'])([^"']+)\1/g,
    (_, quote, spec) =>
      `from ${quote}${overrides[spec] || (spec.startsWith(".") ? new URL(spec, base).href : import.meta.resolve(spec))}${quote}`,
  );
test("real HTTP document routes enforce live JWT roles, ownership, private downloads and actual photo validation", async (t) => {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    const target = new URL(typeof url === "string" ? url : url.url || `${url}`);
    if (!["127.0.0.1", "localhost"].includes(target.hostname))
      throw new Error(
        "External network access is forbidden in document route tests.",
      );
    return nativeFetch(url, options);
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });
  const tables = {
    users: [owner, other, admin].map((id, index) => ({
      id,
      role: index === 2 ? "admin" : "resident",
      is_active: true,
      must_change_password: false,
      full_name: "Synthetic Resident",
      updated_at: "2026-10-31T00:00:00Z",
    })),
    requests: [
      {
        id,
        user_id: owner,
        status: "approved",
        request_type: "Certificate of Residency",
      },
    ],
    generated_documents: [
      {
        id: fileId,
        request_id: id,
        version_number: 1,
        storage_path: `generated/${id}/${fileId}.docx`,
      },
    ],
    request_attachments: [],
    case_history_events: [],
    notification_logs: [],
  };
  const db = {
    rpc: async (name) => {
      assert.equal(name, "bgy_p105_rate_check");
      return { data: { allowed: true }, error: null };
    },
    from(table) {
      let filters = [],
        patch;
      const chain = {
        select() {
          return this;
        },
        update(value) {
          patch = value;
          return this;
        },
        limit() {
          return this;
        },
        eq(k, v) {
          filters.push((r) => r[k] === v);
          return this;
        },
        in(k, v) {
          filters.push((r) => v.includes(r[k]));
          return this;
        },
        order() {
          return this;
        },
        range() {
          return this;
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: (tables[table] || []).filter((r) =>
              filters.every((f) => f(r)),
            ),
            error: null,
          }).then(resolve, reject);
        },
        async single() {
          const row = (tables[table] || []).find((r) =>
            filters.every((f) => f(r)),
          );
          if (row && patch) Object.assign(row, patch);
          return {
            data: row,
            error: null,
          };
        },
        async maybeSingle() {
          return this.single();
        },
      };
      return chain;
    },
    storage: {
      from() {
        return {
          upload: async () => ({ error: null }),
          remove: async () => ({ error: null }),
          download: async () => ({
            data: new Blob(["synthetic-docx"]),
            error: null,
          }),
        };
      },
    },
  };
  // Only module dependencies are injected. JWT verification, current-user loading and route middleware execute unchanged.
  globalThis.__documentAccessFixture = db;
  const dbModule = dataUrl(
    "export const requireSupabase=()=>globalThis.__documentAccessFixture;",
  );
  const authBase = new URL("../src/middleware/auth.js", import.meta.url);
  let auth = await readFile(authBase, "utf8");
  auth = absoluteImports(auth, authBase, { "../lib/supabase.js": dbModule });
  const rateBase = new URL(
    "../src/middleware/persistentLimit.js",
    import.meta.url,
  );
  let rate = await readFile(rateBase, "utf8");
  rate = absoluteImports(rate, rateBase, { "../lib/supabase.js": dbModule });
  const routeBase = new URL("../src/routes/documents.js", import.meta.url);
  let routeSource = await readFile(routeBase, "utf8");
  routeSource = absoluteImports(routeSource, routeBase, {
    "../middleware/persistentLimit.js": dataUrl(rate),
    "../middleware/auth.js": dataUrl(auth),
    "../lib/supabase.js": dbModule,
    "../utils/audit.js": dataUrl(
      "export const logAudit=async()=>({logged:true});",
    ),
  });
  const router = (
    await import(dataUrl(absoluteImports(routeSource, routeBase)))
  ).default;
  const app = express();
  app.use(express.json());
  app.use("/api/documents", router);
  app.use((error, _req, res, _next) =>
    res.status(error.status || 500).json({ message: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api/documents`;
  const call = (path, actor, options = {}) =>
    fetch(`${base}${path}`, {
      ...options,
      headers: {
        ...(actor
          ? {
              Authorization: `Bearer ${signToken({ sub: actor, role: "super_admin" })}`,
            }
          : {}),
        ...options.headers,
      },
    });
  try {
    assert.equal((await call(`/requests/${id}`)).status, 401);
    assert.equal((await call(`/requests/${id}`, other)).status, 404);
    assert.equal((await call(`/requests/${id}`, owner)).status, 200);
    assert.equal((await call(`/files/${fileId}`, owner)).status, 403);
    assert.equal((await call(`/residents/${other}/photo`, owner)).status, 403);
    assert.equal(
      (
        await call("/templates/current", owner, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call(`/requests/${id}/generate`, owner, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      403,
    );
    const downloaded = await call(`/files/${fileId}`, admin);
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers.get("content-type"), /wordprocessingml/);
    assert.equal(downloaded.headers.get("cache-control"), "private, no-store");
    assert.match(downloaded.headers.get("content-disposition"), /\.docx/);
    const form = new FormData();
    form.append(
      "photo",
      new Blob(["not a photo"], { type: "image/jpeg" }),
      "portrait.jpg",
    );
    assert.equal(
      (await call("/profile/photo", owner, { method: "POST", body: form }))
        .status,
      400,
    );
    const portrait = await sharp({
      create: { width: 300, height: 400, channels: 3, background: "#167332" },
    })
      .png()
      .toBuffer();
    for (let iteration = 0; iteration < 2; iteration++) {
      const upload = new FormData();
      upload.append(
        "photo",
        new Blob([portrait], { type: "image/png" }),
        "portrait.png",
      );
      assert.equal(
        (await call("/profile/photo", owner, { method: "POST", body: upload }))
          .status,
        201,
      );
    }
    assert.equal((await call("/profile/photo", owner)).status, 200);
    assert.equal(
      (await call("/profile/photo", owner, { method: "DELETE" })).status,
      200,
    );
    assert.equal((await call("/profile/photo", owner)).status, 404);
    const forged = await fetch(`${base}/templates`, {
      headers: { Authorization: "Bearer forged-session" },
    });
    assert.equal(forged.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    delete globalThis.__documentAccessFixture;
  }
});

