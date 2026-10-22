import { describe, expect, it } from 'vitest';
import type { Db } from '../../db/prisma.js';
import { AuditRepo } from './audit.repo.js';
import type { ChangeLogEntry } from './audit.dto.js';

const entry: ChangeLogEntry = {
  actorType: 'SOURCE',
  actorId: '00000000-0000-4000-8000-000000000010',
  entityType: 'jurisdiction',
  entityId: '00000000-0000-4000-8000-000000000011',
  action: 'source.add',
  before: null,
  after: { name: 'Maryland' },
  requestId: null,
};

function client(created: unknown[]): Db {
  return {
    changeLog: {
      create: (args: unknown) => {
        created.push(args);
        return Promise.resolve({ id: '1' });
      },
    },
  } as unknown as Db;
}

describe('AuditRepo.insert', () => {
  it('writes on the repo client when the caller has no transaction', async () => {
    const created: unknown[] = [];
    const repo = new AuditRepo(client(created));
    await repo.insert(undefined, entry);
    expect(created).toHaveLength(1);
  });

  it('writes on the transaction client when one is passed', async () => {
    const own: unknown[] = [];
    const txWrites: unknown[] = [];
    const repo = new AuditRepo(client(own));
    await repo.insert(client(txWrites), entry);
    expect(txWrites).toHaveLength(1);
    expect(own).toHaveLength(0);
  });
});
