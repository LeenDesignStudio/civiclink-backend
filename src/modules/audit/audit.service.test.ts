import { describe, expect, it } from 'vitest';
import { Authz } from '../../authz/authz.js';
import type { ServiceContext } from '../../graphql/context.js';
import { AuditService } from './audit.service.js';
import type { ChangeLogDto, ChangeLogEntry } from './audit.dto.js';
import type { AuditStore, ChangeLogListQuery } from './audit.store.js';

class FakeAudit implements AuditStore {
  inserted: ChangeLogEntry[] = [];

  insert(_tx: unknown, entry: ChangeLogEntry): Promise<void> {
    this.inserted.push(entry);
    return Promise.resolve();
  }

  list(_query: ChangeLogListQuery): Promise<{ rows: ChangeLogDto[]; total: number }> {
    return Promise.resolve({ rows: [], total: 0 });
  }
}

describe('AuditService', () => {
  it('records through the repo and nulls a resident actor id', async () => {
    const store = new FakeAudit();
    const service = new AuditService(store);
    await service.record('tx', {
      actorType: 'RESIDENT',
      actorId: 'user-should-be-dropped',
      entityType: 'correction',
      entityId: '00000000-0000-4000-8000-000000000001',
      action: 'correction.submitted',
      before: { status: 'OPEN', token: 'secret', unchanged: 'a' },
      after: { status: 'OPEN', token: 'other', unchanged: 'a', note: 'fixed' },
      requestId: 'req-1',
    });
    expect(store.inserted).toHaveLength(1);
    expect(store.inserted[0]).toMatchObject({
      actorType: 'RESIDENT',
      actorId: null,
      before: null,
      after: { note: 'fixed' },
    });
  });

  it('requires changelog read to list entries', async () => {
    const service = new AuditService(new FakeAudit());
    const principal = { kind: 'anonymous' as const };
    const ctx: ServiceContext = {
      requestId: 'req',
      principal,
      authz: new Authz(principal),
      ipHash: 'ip',
    };
    await expect(
      service.list(ctx, {
        entityType: 'office',
        entityId: '00000000-0000-4000-8000-000000000001',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
