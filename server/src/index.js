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
import documentRoutes from "./routes/documents.js";
import suggestionRoutes from "./routes/suggestions.js";
import borrowingRoutes from "./routes/borrowing.js";
import masterDataRoutes from "./routes/masterData.js";
import { env, validateProductionEnv } from "./lib/env.js";
import { runMaintenance } from "./lib/scheduler.js";

// Live deployments advertise liveness immediately, but fail closed until every
// required schema check finishes. Importing the app for tests does not launch
// the production bootstrap sequence.
const isMainModule = Boolean(process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url);
const startup = { state: isMainModule ? "starting" : "ready", stage: isMainModule ? "environment" : "not_applicable" };

const REQUIRED_MIGRATIONS = [
  ["phase1_audit", "bgy_audit_phase1_ready"],
  ["phase2_invitations", "bgy_phase2_ready"],
  ["phase5_passwords", "bgy_phase5_ready"],
  ["phase6_case_history", "bgy_phase6_ready"],
  ["phase7_hotlines", "bgy_phase7_ready"],
  ["phase8_concern_limits", "bgy_phase8_ready"],
  ["phase9_borrowing", "bgy_phase9_ready"],
  ["phase10_projects", "bgy_phase10_ready"],
  ["phase10_5_security", "bgy_p105_ready"],
  ["phase11_documents", "bgy_phase11_ready"],
  ["nov2_workflow_repairs", "bgy_nov2_ready"],
];

const verifyStartup = async () => {
  for (const [stage, functionName] of REQUIRED_MIGRATIONS) {
    startup.stage = stage;
    const started = performance.now();
    console.info("[STARTUP CHECK]", stage, "begin");
    const { data, error } = await requireSupabase().rpc(functionName);
    const elapsed = Math.round(performance.now() - started);
    if (error || data !== true) {
      console.error("[STARTUP CHECK]", stage, "failed", `${elapsed}ms`, error?.message || "returned false");
      throw new Error(`${stage} failed required database readiness verification.`);
    }
    console.info("[STARTUP CHECK]", stage, "passed", `${elapsed}ms`);
  }
  startup.state = "ready";
  startup.stage = "complete";
  console.info("[STARTUP READY] All mandatory database checks passed.");
};

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

  // Readiness is separate from liveness. A cold instance must show whether
  // startup checks are pending or the database is truly inaccessible.
  app.get("/api/health/readiness", async (_req, res) => {
    if (startup.state !== "ready") {
      res.setHeader("Retry-After", "10");
      return res.status(503).json({ ok: false, database: "unchecked", state: startup.state, stage: startup.stage });
    }
    try {
      const { error } = await requireSupabase().from("users").select("id").limit(1);
      if (error) throw error;
      return res.json({ ok: true, database: "connected", state: "ready" });
    } catch (error) {
      console.error("[DATABASE READINESS ERROR]", error.message);
      return res.status(503).json({ ok: false, database: "unavailable", state: "degraded" });
    }
  });

  // Never serve protected routes before required audit/security migrations pass.
  // This gate also makes login failures fast and explains why the server is busy.
  app.use("/api", (req, res, next) => {
    if (startup.state === "ready") return next();
    res.setHeader("Retry-After", "10");
    const waiting = startup.state === "starting";
    return res.status(503).json({
      message: waiting ? "The Barangay Iba server is starting. Please retry shortly."
        : "The Barangay Iba server is not ready. Please contact the administrator.",
      code: waiting ? "SERVICE_STARTING" : "SERVICE_NOT_READY",
      reference: req.auditRequestId || null,
    });
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
  app.use("/api/documents", documentRoutes);
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
    if (res.headersSent) return;
    const upstreamTimeout = !error.status && /timeout|timed out|aborterror|signal is aborted/i.test(error.message || '');
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : error.name === 'MulterError' ? 400 : upstreamTimeout ? 503 : error.status || 500;
    const errorCode = upstreamTimeout ? 'UPSTREAM_TIMEOUT' : error.code || null;

    console.error("[API ERROR]", {
      reference: req.auditRequestId || null,
      status,
      message: error.message || "Unexpected server error.",
      code: errorCode,
    });

    res.status(status).json({
      message: upstreamTimeout ? "The database did not respond in time. Please try again." : status >= 500 ? "The service could not complete this request. Please retry or contact the barangay office." : error.code === 'LIMIT_FILE_SIZE' ? "File exceeds the upload size limit." : error.message || "Unexpected server error.",
      code: errorCode,
      reference: req.auditRequestId || null,
    });
  });

  return app;
};

export const app = createApp();

if (isMainModule) {
  // Refuse to expose application routes if the backend is misconfigured.
  validateProductionEnv();

  // Start listening *before* slow schema checks so liveness and readiness are
  // available during a Render cold start; application endpoints stay blocked.
  const server = app.listen(env.port, () =>
    console.info(`[STARTUP HTTP] Listening on port ${env.port}; schema checks pending.`)
  );
  void verifyStartup().catch((error) => {
    startup.state = "failed";
    console.error("[STARTUP FAILED]", startup.stage, error.message);
  });

  const maintenance = setInterval(() => {
    if (startup.state !== "ready") return;
    runMaintenance().catch((error) =>
      console.error("Maintenance task failed:", error.message)
    );
  }, 60 * 1000);
  maintenance.unref?.();
  server.on("error", (error) => console.error("[HTTP LISTENER ERROR]", error.message));
}

