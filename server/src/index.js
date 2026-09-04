import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import votingRoutes from "./routes/voting.js";
import adminRoutes from "./routes/admin.js";
import superAdminRoutes from "./routes/superAdmin.js";
import notificationRoutes from "./routes/notifications.js";
import complaintRoutes from "./routes/complaints.js";
import publicRoutes from "./routes/public.js";
import requestRoutes from "./routes/requests.js";
import suggestionRoutes from "./routes/suggestions.js";
import { env } from "./lib/env.js";
import { runMaintenance } from "./lib/scheduler.js";

const app = express();

app.use((req, _res, next) => {
  console.log(`[API] ${req.method} ${req.originalUrl}`);
  next();
});

app.use(
  cors({
    origin: env.clientUrl.split(",").map((item) => item.trim()).filter(Boolean),
    credentials: false,
  })
);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/content", async (_req, res, next) => {
  try {
    const { requireSupabase } = await import("./lib/supabase.js");
    const db = requireSupabase();
    const { data } = await db.from("landing_content").select("*").order("key_name");
    res.json({
      content: Object.fromEntries((data || []).map((item) => [item.key_name, item.value])),
    });
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

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  console.error("[API ERROR]", {
    status,
    message: error.message || "Unexpected server error.",
    code: error.code || null,
    stack: error.stack || null,
  });
  res.status(status).json({
    message: error.message || "Unexpected server error.",
    code: error.code || null,
  });
});

app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port}`);
  runMaintenance().catch((error) => {
    console.error("Initial maintenance task failed:", error.message);
  });
});

setInterval(() => {
  runMaintenance().catch((error) => {
    console.error("Maintenance task failed:", error.message);
  });
}, 60 * 1000);
