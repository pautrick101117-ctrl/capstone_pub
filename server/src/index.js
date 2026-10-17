import express from "express";
import cors from "cors";
import { auditRequestContext } from "./lib/auditContext.js";
import { requireSupabase } from "./lib/supabase.js";
import { logAudit } from "./utils/audit.js";
import { publicHotlineSupport } from "./lib/hotlines.js";
import { publicContentOnly } from "./lib/publicContent.js";
import { pathToFileURL } from "node:url";
import authRoutes from "./routes/auth.js";
import votingRoutes from "./routes/voting.js";
import adminRoutes from "./routes/admin.js";
import superAdminRoutes from "./routes/superAdmin.js";
import notificationRoutes from "./routes/notifications.js";
import complaintRoutes from "./routes/complaints.js";
import publicRoutes from "./routes/public.js";
import requestRoutes from "./routes/requests.js";
import suggestionRoutes from "./routes/suggestions.js";
import borrowingRoutes from "./routes/borrowing.js";
import masterDataRoutes from "./routes/masterData.js";
import { env, validateProductionEnv } from "./lib/env.js";
import { runMaintenance } from "./lib/scheduler.js";

export const createApp = () => {
  const app = express();

  // Render runs the app behind a reverse proxy.
  // Trust one proxy hop so req.ip resolves to the real client IP
  // instead of the Render proxy IP.
  //
  // This prevents multiple users from sharing the same
  // login rate-limit bucket.
  if (env.nodeEnv === "production") {
    app.set("trust proxy", 1);
  }

  app.use(auditRequestContext);

  app.use((req, _res, next) => {
    if (env.nodeEnv !== "test") {
      console.log(`[API] ${req.method} ${req.originalUrl}`);
    }
    next();
  });

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.clientUrls.includes(origin)) {
          return callback(null, true);
        }

        return callback(
          Object.assign(
            new Error("Origin is not allowed by CORS."),
            { status: 403 }
          )
        );
      },
      credentials: false,
    })
  );

  app.use(express.json({ limit: "1mb" }));

  // Liveness says only that the Express process is responding.
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, service: "barangay-iba-api" })
  );

  // Readiness confirms the database is accessible without exposing credentials
  // or resident records. Useful for diagnosing a working UI with empty data.
  app.get("/api/health/readiness", async (_req, res) => {
    try {
      const { requireSupabase } = await import("./lib/supabase.js");
      const { error } = await requireSupabase().from("users").select("id").limit(1);
      if (error) throw error;
      res.json({ ok: true, database: "connected" });
    } catch (error) {
      console.error("[DATABASE READINESS ERROR]", error.message);
      res.status(503).json({ ok: false, database: "unavailable" });
    }
  });

  app.get("/api/content", async (_req, res, next) => {
    try {
      const { requireSupabase } = await import("./lib/supabase.js");

      const db = requireSupabase();

      const { data, error } = await db
        .from("landing_content")
        .select("*")
        .order("key_name");

      if (error) throw error;

      const content = Object.fromEntries((data || []).map((item) => [item.key_name, item.value]));
      const publicContent = publicContentOnly(content);
      const hotlineInfo = publicHotlineSupport(publicContent);
      res.json({ content: { ...publicContent, hotline: hotlineInfo.hotline, hotlines: hotlineInfo.hotlines } });
    } catch (error) {
      next(error);
    }
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/public", publicRoutes);
  app.use("/api/voting", votingRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/super-admin", superAdminRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/complaints", complaintRoutes);
  app.use("/api/requests", requestRoutes);
  app.use("/api/suggestions", suggestionRoutes);
  app.use("/api/borrowing", borrowingRoutes);
  app.use("/api/master-data", masterDataRoutes);

  app.use(async (error, req, res, _next) => {
    // Rejected access is a security event, not a successful business mutation.
    // Login credential failures already have their own dedicated audit event.
    const deniedStatus = Number(error.status || 500);
    if ([401, 403].includes(deniedStatus) && req.path !== "/api/auth/login") {
      try {
        await logAudit({ action: "access_denied", module: "authorization",
          entityType: "route", entityId: req.path, outcome: "denied",
          eventCategory: "security", details: { status: deniedStatus }, req });
      } catch (auditError) { console.warn("[DENIED ACCESS AUDIT ERROR]", auditError.message); }
    }
    const status = error.status || 500;

    console.error("[API ERROR]", {
      status,
      message: error.message || "Unexpected server error.",
      code: error.code || null,
    });

    res.status(status).json({
      message: error.message || "Unexpected server error.",
      code: error.code || null,
    });
  });

  return app;
};

export const app = createApp();

const isMainModule =
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  validateProductionEnv();

  // Refuse to serve writes against a pre-Phase-1 schema: missing database
  // triggers would otherwise leave consequential mutations unaudited.
  const auditReady = await requireSupabase().rpc("bgy_audit_phase1_ready");
  if (auditReady.error || auditReady.data !== true) {
    throw new Error("Phase 1 Audit migration missing or incomplete. Run server/supabase-v4-phase1-audit-upgrade.sql before deploying this API.");
  }

  const phase2Ready = await requireSupabase().rpc("bgy_phase2_ready");
  if (phase2Ready.error || phase2Ready.data !== true) {
    throw new Error("Phase 2 Admin Invitations migration missing. Run server/supabase-v4-phase2-admin-invitations.sql before deploying this API.");
  }

  const phase5Ready = await requireSupabase().rpc("bgy_phase5_ready");
  if (phase5Ready.error || phase5Ready.data !== true) {
    throw new Error("Phase 5 staged Resident Password migration missing. Run server/supabase-v4-phase5-resident-passwords.sql before deploying this API.");
  }

  const phase6Ready = await requireSupabase().rpc("bgy_phase6_ready");
  if (phase6Ready.error || phase6Ready.data !== true) {
    throw new Error("Phase 6 Case History migration missing. Run server/supabase-v4-phase6-case-history.sql before deploying the API.");
  }

  const phase7Ready = await requireSupabase().rpc("bgy_phase7_ready");
  if (phase7Ready.error || phase7Ready.data !== true) {
    throw new Error("Phase 7 Hotline Settings migration missing. Run server/supabase-v4-phase7-hotline-settings.sql before deploying the API.");
  }

  const phase8Ready = await requireSupabase().rpc("bgy_phase8_ready");
  if (phase8Ready.error || phase8Ready.data !== true) {
    throw new Error("Phase 8 Concern Limits migration missing. Run server/supabase-v4-phase8-concern-limits.sql before deploying this API.");
  }

  const phase9Ready = await requireSupabase().rpc("bgy_phase9_ready");
  if (phase9Ready.error || phase9Ready.data !== true) {
    throw new Error("Phase 9 Borrowing Duration migration missing. Run server/supabase-v4-phase9-borrowing-duration.sql before deploying this API.");
  }

  const phase10Ready = await requireSupabase().rpc("bgy_phase10_ready");
  if (phase10Ready.error || phase10Ready.data !== true) {
    throw new Error("Phase 10 Project Lifecycle migration missing. Run server/supabase-v4-phase10-project-lifecycle.sql before deploying this API.");
  }

  const p105Ready = await requireSupabase().rpc('bgy_p105_ready');
  if (p105Ready.error || p105Ready.data !== true) {
    throw new Error('Phase 10.5 Data & Security migration missing. Run server/supabase-v4-phase10-5-data-security.sql before deploying this API.');
  }

  app.listen(env.port, () =>
    console.log(
      `API listening on http://localhost:${env.port}`
    )
  );

  setInterval(() => {
    runMaintenance().catch((error) =>
      console.error(
        "Maintenance task failed:",
        error.message
      )
    );
  }, 60 * 1000);
}

