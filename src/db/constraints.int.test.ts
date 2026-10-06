import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { mapDbError } from './prisma.js';
import { appDb, ownerDb, truncateAll } from '../../test/setup/db.js';
import { createSavedLocation, createUser } from '../../test/factories/index.js';

describe('database constraints', () => {
  let app: PrismaClient;
  let owner: PrismaClient;

  beforeAll(async () => {
    app = appDb();
    owner = ownerDb();
    await truncateAll(owner);
  });

  afterAll(async () => {
    await app.$disconnect();
    await owner.$disconnect();
  });

  it('maps a second HOME location to LOCATION_LABEL_TAKEN', async () => {
    const user = await createUser(app);
    await createSavedLocation(app, user.id, 'HOME');
    await expect(createSavedLocation(app, user.id, 'HOME')).rejects.toSatisfy((error: unknown) => {
      return mapDbError(error).code === 'LOCATION_LABEL_TAKEN';
    });
  });

  it('rejects updates to the change log', async () => {
    const row = await owner.changeLog.create({
      data: { actorType: 'SYSTEM', entityType: 'office', entityId: userId(), action: 'create' },
    });
    await expect(
      app.changeLog.update({ where: { id: row.id }, data: { action: 'tamper' } }),
    ).rejects.toThrow();
  });
});

function userId(): string {
  return '00000000-0000-4000-8000-000000000001';
}
