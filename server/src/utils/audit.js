import { requireSupabase } from "../lib/supabase.js";

export const logAudit = async ({ actorId, actorRole, action, entityType, entityId, details }) => {
  const db = requireSupabase();
  await db.from("audit_logs").insert({
    actor_id: actorId,
    actor_role: actorRole,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
  });
};
