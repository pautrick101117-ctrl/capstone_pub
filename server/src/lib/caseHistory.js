import { randomUUID } from "node:crypto";

export const CASE_TYPES = Object.freeze(["request", "id_request", "complaint", "borrowing_request", "project_suggestion"]);

const caseError = (message, status = 400) => Object.assign(new Error(message), { status });

export const parseNewCaseResponse = (body = {}, { maxLength = 2000 } = {}) => {
  const message = `${body.adminNote ?? body.reviewNote ?? body.message ?? ""}`.trim();
  const visibility = body.visibility || "resident";
  if (message.length > maxLength) throw caseError(`Response must not exceed ${maxLength} characters.`);
  if (!["resident", "internal"].includes(visibility)) throw caseError("Invalid response visibility.");
  return { message, visibility };
};

export const getOperationId = (value) => {
  if (value === undefined || value === null || value === "") return randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(`${value}`)) {
    throw caseError("Invalid operation identifier.");
  }
  return value;
};

export const updateCaseWithHistory = async (db, {
  entityType, id, currentStatus, status, response, actorId, extra = {}, operationId,
}) => {
  if (!CASE_TYPES.includes(entityType)) throw caseError("Unsupported case type.");
  if (!currentStatus) throw caseError("Previous record status is required.");
  if (!actorId) throw caseError("Administrator identity is required.", 403);
  const { data, error } = await db.rpc("bgy_case_apply", {
    p_entity_type: entityType,
    p_entity_id: id,
    p_expected_status: currentStatus,
    p_status: status,
    p_message: response.message,
    p_visibility: response.visibility,
    p_actor_id: actorId,
    p_operation_id: getOperationId(operationId),
    p_extra: extra,
  });
  if (error) {
    const isConflict = /changed since|already been processed|23505|P0001/i.test(`${error.code || ""} ${error.message || ""}`);
    throw caseError(isConflict ? "This record was updated by someone else, or this action was already saved. Refresh the record and try again." : error.message,
      isConflict ? 409 : error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400);
  }
  return data;
};

export const attachCaseHistories = async (db, entityType, rows, { residentVisible = false } = {}) => {
  if (!CASE_TYPES.includes(entityType)) throw caseError("Unsupported case type.");
  if (!Array.isArray(rows) || !rows.length) return rows || [];
  const ids = [...new Set(rows.map((row) => row.id).filter(Boolean))];
  // PostgREST often caps result sets at 1,000 rows. Page through all events
  // instead of silently omitting older responses for busy request queues.
  const pageSize = 500;
  const events = [];
  for (let index = 0; index < ids.length; index += 50) {
    const chunk = ids.slice(index, index + 50);
    for (let offset = 0; ; offset += pageSize) {
      let query = db.from("case_history_events").select("id,entity_type,entity_id,event_type,actor_name_snapshot,actor_role,previous_status,new_status,message,visibility,metadata,created_at")
        .eq("entity_type", entityType).in("entity_id", chunk)
        .order("created_at", { ascending: true }).order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (residentVisible) query = query.eq("visibility", "resident");
      const { data, error } = await query;
      if (error) throw error;
      events.push(...(data || []));
      if ((data || []).length < pageSize) break;
    }
  }
  const grouped = new Map();
  for (const event of events) {
    const existing = grouped.get(event.entity_id) || [];
    existing.push(event);
    grouped.set(event.entity_id, existing);
  }
  return rows.map((row) => ({ ...row, case_history: grouped.get(row.id) || [] }));
};
