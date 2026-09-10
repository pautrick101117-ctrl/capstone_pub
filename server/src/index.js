import express from "express";
import cors from "cors";
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

  app.use((req, _res, next) => {
    if (env.nodeEnv !== "test") console.log(`[API] ${req.method} ${req.originalUrl}`);
    next();
  });

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.clientUrls.includes(origin)) return callback(null, true);
        return callback(Object.assign(new Error("Origin is not allowed by CORS."), { status: 403 }));
      },
      credentials: false,
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "barangay-iba-api" }));

  app.get("/api/content", async (_req, res, next) => {
    try {
      const { requireSupabase } = await import("./lib/supabase.js");
      const db = requireSupabase();
      const { data, error } = await db.from("landing_content").select("*").order("key_name");
      if (error) throw error;
      res.json({ content: Object.fromEntries((data || []).map((item) => [item.key_name, item.value])) });
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

  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    console.error("[API ERROR]", { status, message: error.message || "Unexpected server error.", code: error.code || null });
    res.status(status).json({ message: error.message || "Unexpected server error.", code: error.code || null });
  });

  return app;
};

export const app = createApp();

const isMainModule = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  validateProductionEnv();
  app.listen(env.port, () => console.log(`API listening on http://localhost:${env.port}`));
  setInterval(() => {
    runMaintenance().catch((error) => console.error("Maintenance task failed:", error.message));
  }, 60 * 1000);
}
