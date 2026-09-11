import { requireSupabase } from "../lib/supabase.js";

const REDACTED_KEYS = new Set([
  "password",
  "password_hash",
  "newpassword",
  "currentpassword",
  "temporarypassword",
  "token",
  "authorization",
  "code",
  "verification_code",
  "verificationcode",
  "jwt",
  "secret",
]);

const cleanAuditValue = (value, depth = 0) => {
  if (depth > 5) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => cleanAuditValue(item, depth + 1));
  if (typeof value !== "object") return typeof value === "string" && value.length > 4000 ? `${value.slice(0, 4000)}…` : value;

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 150)
      .map(([key, item]) => [key, REDACTED_KEYS.has(key.toLowerCase()) ? "[redacted]" : cleanAuditValue(item, depth + 1)])
  );
};

const getRequestMeta = (req) => ({
  http_method: req?.method || null,
  route: req?.originalUrl || req?.path || null,
  ip_address: req?.ip || req?.socket?.remoteAddress || null,
  user_agent: req?.get?.("user-agent") || null,
});

export const logAudit = async ({
  actorId,
  actorRole,
  actorName,
  action,
  entityType,
  entityId,
  details = {},
  module = null,
  beforeData = null,
  afterData = null,
  outcome = "success",
  req = null,
}) => {
  const db = requireSupabase();
  const requestMeta = getRequestMeta(req);
  const expandedPayload = {
    actor_id: actorId || null,
    actor_role: actorRole || null,
    actor_name_snapshot: actorName || req?.currentUser?.full_name || req?.currentUser?.username || null,
    action: action || "unknown_action",
    entity_type: entityType || "system",
    entity_id: `${entityId ?? "system"}`,
    module: module || null,
    http_method: requestMeta.http_method,
    route: requestMeta.route,
    ip_address: requestMeta.ip_address,
    user_agent: requestMeta.user_agent,
    before_data: cleanAuditValue(beforeData),
    after_data: cleanAuditValue(afterData),
    details: cleanAuditValue(details) || {},
    outcome,
  };

  const { error } = await db.from("audit_logs").insert(expandedPayload);
  if (!error) return;

  // Backward-compatible fallback for databases that have not run the V4 migration yet.
  const { error: fallbackError } = await db.from("audit_logs").insert({
    actor_id: expandedPayload.actor_id,
    actor_role: expandedPayload.actor_role,
    action: expandedPayload.action,
    entity_type: expandedPayload.entity_type,
    entity_id: expandedPayload.entity_id,
    details: {
      ...expandedPayload.details,
      module: expandedPayload.module,
      httpMethod: expandedPayload.http_method,
      route: expandedPayload.route,
      outcome: expandedPayload.outcome,
    },
  });
  if (fallbackError) throw fallbackError;
};

export const adminActivityMiddleware = (moduleName = "admin") => (req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    const user = req.currentUser;
    if (!user || !["admin", "super_admin"].includes(`${user.role || ""}`.replace("super-admin", "super_admin"))) return;

    logAudit({
      actorId: user.id,
      actorRole: user.role,
      actorName: user.full_name || user.username,
      action: req.method === "GET" ? "admin_view" : "admin_api_action",
      entityType: "admin_route",
      entityId: req.originalUrl,
      module: moduleName,
      details: {
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        query: cleanAuditValue(req.query || {}),
        body: req.method === "GET" ? undefined : cleanAuditValue(req.body || {}),
      },
      outcome: res.statusCode >= 400 ? "failed" : "success",
      req,
    }).catch((error) => console.warn(`[AUDIT LOG ERROR] ${error.message}`));
  });
  next();
};
