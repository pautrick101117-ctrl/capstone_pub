import { requireSupabase } from '../lib/supabase.js';
import { getAuditContext } from '../lib/auditContext.js';
import { cleanAuditValue, auditCategoryForAction } from './auditValues.js';
// Secret values appear as '[redacted]' in database and application events.

const getRequestMeta = (req) => ({
  http_method: req?.method || null,
  route: req?.originalUrl?.split('?')[0] || req?.path || null,
  ip_address: req?.ip || req?.socket?.remoteAddress || null,
  user_agent: req?.get?.('user-agent') || null,
});

export const logAudit = async ({
  actorId, actorRole, actorName, action, entityType, entityId,
  details = {}, module = null, beforeData = null, afterData = null,
  outcome = 'success', eventCategory, eventSource = 'application', req = null, required = false,
}) => {
  const context = getAuditContext();
  const request = req || context?.req;
  const payload = {
    actor_id: actorId || request?.currentUser?.id || null,
    actor_role: actorRole || request?.currentUser?.role || null,
    actor_name_snapshot: actorName || request?.currentUser?.full_name || request?.currentUser?.username || null,
    action: action || 'unknown_action',
    entity_type: entityType || 'system',
    entity_id: `${entityId ?? 'system'}`,
    module,
    ...getRequestMeta(request),
    before_data: cleanAuditValue(beforeData),
    after_data: cleanAuditValue(afterData),
    details: cleanAuditValue(details) || {},
    outcome,
    event_category: eventCategory || auditCategoryForAction(action),
    event_source: eventSource,
    correlation_id: request?.auditRequestId || null,
  };
  const { error } = await requireSupabase().from('audit_logs').insert(payload);
  // Do not silently fall back to legacy columns: the Phase 1 migration is mandatory.
  if (error) {
    if (required) throw error;
    // Row-mutation events are already committed atomically by database triggers.
    // Do not turn a successful write into a misleading HTTP error if a secondary
    // descriptive activity event was unavailable.
    console.warn('[AUDIT ACTIVITY WRITE ERROR]', error.message);
    return { logged: false };
  }
  return { logged: true };
};

export const adminActivityMiddleware = (moduleName = 'admin') => (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const user = req.currentUser;
    if (!user || !['admin', 'super_admin'].includes(user.role)) return;
    // Successful database mutations are automatically audited by database triggers.
    // Do not emit redundant generic admin_api_action entries for them.
    if (res.statusCode < 400 && req.method !== 'GET') return;
    // Page-view events are emitted at actual route navigation. Background reads do
    // not represent intentional page access. Avoid recursive audit-list GET noise.
    if (req.method === 'GET' && /\/(audit-logs|health|notifications)(\/|\?|$)/.test(req.originalUrl)) return;
    if (req.method === 'GET' && !/(export|download|print|pdf|sample)/i.test(req.originalUrl)) return;
    logAudit({
      actorId: user.id, actorRole: user.role, actorName: user.full_name || user.username,
      action: res.statusCode >= 400 ? 'admin_request_failed' : 'admin_export_or_document_access',
      entityType: 'admin_route', entityId: req.originalUrl.split('?')[0], module: moduleName,
      details: { statusCode: res.statusCode, durationMs: Date.now() - start },
      outcome: res.statusCode >= 400 ? 'failed' : 'success', req,
    }).catch((error) => console.warn('[AUDIT ACTIVITY ERROR]', error.message));
  });
  next();
};
