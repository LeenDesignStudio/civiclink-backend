import { describe, expect, it } from 'vitest';
import { Authz, systemPrincipal } from '../../authz/authz.js';
import type { ServiceContext } from '../../graphql/context.js';
import { ForbiddenError, NotFoundError, UpstreamError } from '../../lib/errors.js';
import { QUEUES } from '../queues.js';
import { authorizeJob, isPermanent } from './index.js';

describe('isPermanent', () => {
  it('is true only for a non-retryable AppError', () => {
    expect(isPermanent(new NotFoundError())).toBe(true);
    expect(isPermanent(new UpstreamError())).toBe(false);
    expect(isPermanent(new Error('network'))).toBe(false);
  });
});

describe('job permissions', () => {
  it('rejects a job handler when the principal lacks that system permission', () => {
    const viewer = {
      kind: 'admin' as const,
      adminId: 'admin-1',
      role: 'ADMIN_STAFF' as const,
      sessionId: 'session-1',
    };
    const denied: ServiceContext = {
      requestId: 'job',
      principal: viewer,
      authz: new Authz(viewer),
      ipHash: 'system',
    };
    for (const name of Object.values(QUEUES)) {
      expect(() => authorizeJob(denied, name)).toThrow(ForbiddenError);
    }
    const principal = systemPrincipal('billing.syncPlans');
    const allowed: ServiceContext = {
      requestId: 'job',
      principal,
      authz: new Authz(principal),
      ipHash: 'system',
    };
    for (const name of Object.values(QUEUES)) {
      expect(() => authorizeJob(allowed, name)).not.toThrow();
    }
  });
});
