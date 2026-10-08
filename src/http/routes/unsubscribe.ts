import type { FastifyInstance } from 'fastify';
import { assertReturnTo } from '../../auth/return-to.js';
import type { NotificationsService } from '../../modules/notifications/notifications.service.js';

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

const FRIENDLY = '<!doctype html><title>Link unavailable</title><p>This link is invalid or has expired.</p>';

export interface UnsubscribeRouteDeps {
  notifications: Pick<NotificationsService, 'unsubscribeFromToken' | 'openFromToken' | 'clickFromToken'>;
  webUrl: string;
}

export function registerUnsubscribeRoutes(app: FastifyInstance, deps: UnsubscribeRouteDeps): void {
  app.get('/u/unsub', async (request, reply) => {
    const token = queryValue(request.query, 't');
    reply.header('cache-control', 'no-store');
    if (!token || !(await deps.notifications.unsubscribeFromToken(token))) {
      return reply.type('text/html; charset=utf-8').send(FRIENDLY);
    }
    return reply.type('text/html; charset=utf-8').send(
      '<!doctype html><title>Unsubscribed</title><p>Email for that category is off. In-app notices stay on.</p>',
    );
  });

  app.get('/u/o', async (request, reply) => {
    const token = queryValue(request.query, 't');
    reply.header('cache-control', 'no-store');
    if (!token || !(await deps.notifications.openFromToken(token))) {
      return reply.type('text/html; charset=utf-8').send(FRIENDLY);
    }
    return reply.type('image/gif').send(PIXEL);
  });

  app.get('/u/c', async (request, reply) => {
    const token = queryValue(request.query, 't');
    const redirect = queryValue(request.query, 'r');
    reply.header('cache-control', 'no-store');
    if (!token) return reply.type('text/html; charset=utf-8').send(FRIENDLY);
    const path = await deps.notifications.clickFromToken(token, redirect);
    if (!path) return reply.type('text/html; charset=utf-8').send(FRIENDLY);
    try {
      const safe = assertReturnTo(path);
      const target = new URL(safe, deps.webUrl);
      if (target.origin !== new URL(deps.webUrl).origin) {
        return await reply.type('text/html; charset=utf-8').send(FRIENDLY);
      }
      return await reply.redirect(target.toString(), 302);
    } catch {
      return reply.type('text/html; charset=utf-8').send(FRIENDLY);
    }
  });
}

function queryValue(query: unknown, key: string): string | undefined {
  if (!query || typeof query !== 'object') return undefined;
  const value = (query as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
