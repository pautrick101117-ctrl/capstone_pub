import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const auditStorage = new AsyncLocalStorage();
export const getAuditContext = () => auditStorage.getStore();
export const auditRequestContext = (req, _res, next) => {
  req.auditRequestId = randomUUID();
  auditStorage.run({ req }, next);
};

// Applied ONLY by the private Supabase service client. Headers are never accepted
// from incoming browser requests; trusted authenticated req.currentUser is the source.
export const withAuditHeaders = (options = {}) => {
  const context = getAuditContext();
  const headers = new Headers(options.headers || {});
  const user = context?.req?.currentUser;
  if (user?.id) {
    headers.set('x-bgy-audit-actor-id', String(user.id));
    headers.set('x-bgy-audit-actor-role', String(user.role || 'resident'));
    headers.set('x-bgy-audit-actor-name', Buffer.from(String(user.full_name || user.username || ''), 'utf8').toString('base64'));
  }
  if (context?.req?.auditRequestId) {
    const req = context.req;
    headers.set('x-bgy-audit-request-id', req.auditRequestId);
    headers.set('x-bgy-audit-route', String(req.path || '').slice(0, 240));
    headers.set('x-bgy-audit-method', String(req.method || '').slice(0, 12));
    headers.set('x-bgy-audit-ip', String(req.ip || '').slice(0, 96));
    headers.set('x-bgy-audit-user-agent', Buffer.from(String(req.get?.('user-agent') || '').slice(0, 600), 'utf8').toString('base64'));
  }
  return { ...options, headers };
};
