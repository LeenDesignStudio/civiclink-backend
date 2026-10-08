import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { mapDbError } from './prisma.js';
import { appDb, ownerDb, truncateAll } from '../../test/setup/db.js';
import {
  createAdminUser,
  createJurisdiction,
  createOffice,
  createOfficial,
  createOfficeTerm,
  createSavedLocation,
  createService,
  createServiceCategory,
  createSource,
  createUser,
} from '../../test/factories/index.js';

describe('database constraints', () => {
  let app: PrismaClient;
  let owner: PrismaClient;
  let userId: string;
  let sourceId: string;
  let jurisdictionId: string;
  let officeId: string;
  let officialId: string;
  let otherOfficialId: string;
  let adminId: string;
  let serviceId: string;

  beforeAll(async () => {
    app = appDb();
    owner = ownerDb();
    await truncateAll(owner);
    const user = await createUser(app);
    const source = await createSource(app);
    const jurisdiction = await createJurisdiction(app, source.id);
    const office = await createOffice(app, jurisdiction.id, source.id);
    const official = await createOfficial(app, source.id);
    const otherOfficial = await createOfficial(app, source.id);
    const admin = await createAdminUser(app);
    const category = await createServiceCategory(app);
    const service = await createService(app, category.id, source.id);
    userId = user.id;
    sourceId = source.id;
    jurisdictionId = jurisdiction.id;
    officeId = office.id;
    officialId = official.id;
    otherOfficialId = otherOfficial.id;
    adminId = admin.id;
    serviceId = service.id;
  });

  afterAll(async () => {
    await app.$disconnect();
    await owner.$disconnect();
  });

  async function expectMapped(run: () => Promise<unknown>, code: string): Promise<void> {
    let caught: unknown;
    try {
      await run();
    } catch (error) {
      caught = error;
    }
    expect(caught, code).toBeDefined();
    expect(mapDbError(caught).code).toBe(code);
  }

  it('maps a second HOME location to LOCATION_LABEL_TAKEN', async () => {
    await createSavedLocation(app, userId, 'HOME');
    await expectMapped(() => createSavedLocation(app, userId, 'HOME'), 'LOCATION_LABEL_TAKEN');
  });

  it('maps a second default saved location to CONFLICT', async () => {
    const resident = await createUser(app);
    await app.savedLocation.create({ data: location(resident.id, 'HOME', true) });
    await expectMapped(
      () => app.savedLocation.create({ data: location(resident.id, 'WORK', true) }),
      'CONFLICT',
    );
  });

  it('maps a second current office term to CONFLICT', async () => {
    await createOfficeTerm(app, officeId, officialId);
    await expectMapped(
      () =>
        app.officeTerm.create({
          data: { officeId, officialId: otherOfficialId, status: 'ELECTED', isCurrent: true },
        }),
      'CONFLICT',
    );
  });

  it('maps a second open correction on the same field to DUPLICATE_CORRECTION', async () => {
    await app.correction.create({
      data: { userId, entityType: 'OFFICE', entityId: officeId, field: 'PHONE', proposedValue: '2025550100' },
    });
    await expectMapped(
      () =>
        app.correction.create({
          data: { userId, entityType: 'OFFICE', entityId: officeId, field: 'PHONE', proposedValue: '2025550199' },
        }),
      'DUPLICATE_CORRECTION',
    );
  });

  it('maps an invalid jurisdiction boundary to VALIDATION', async () => {
    await expectMapped(
      () => app.$executeRaw`
        UPDATE jurisdictions
        SET boundary = ST_Multi(ST_GeomFromText('POLYGON((0 0, 1 1, 1 0, 0 1, 0 0))', 4326))
        WHERE id = CAST(${jurisdictionId} AS uuid)
      `,
      'VALIDATION',
    );
  });

  it('maps a service link with two targets to VALIDATION', async () => {
    await expectMapped(
      () =>
        app.serviceLink.create({
          data: { serviceId, jurisdictionId, officeId },
        }),
      'VALIDATION',
    );
  });

  it('maps an alert with two targets to VALIDATION', async () => {
    await expectMapped(
      () =>
        app.alert.create({
          data: {
            targetOfficeId: officeId,
            targetOfficialId: officialId,
            title: 'Notice',
            body: 'Both targets',
            channels: ['IN_APP'],
            createdBy: adminId,
          },
        }),
      'VALIDATION',
    );
  });

  it('maps a sent alert missing sender fields to VALIDATION', async () => {
    await expectMapped(
      () =>
        app.alert.create({
          data: {
            targetOfficeId: officeId,
            title: 'Notice',
            body: 'Sent without a sender',
            channels: ['IN_APP'],
            createdBy: adminId,
            status: 'SENT',
          },
        }),
      'VALIDATION',
    );
  });

  it('maps a dismissed correction without a reason to VALIDATION', async () => {
    await expectMapped(
      () =>
        app.correction.create({
          data: {
            userId,
            entityType: 'OFFICE',
            entityId: officeId,
            field: 'EMAIL',
            status: 'DISMISSED',
            resolvedAt: new Date('2026-01-15T00:00:00.000Z'),
          },
        }),
      'VALIDATION',
    );
  });

  it('maps an applied correction without resolvedAt to VALIDATION', async () => {
    await expectMapped(
      () =>
        app.correction.create({
          data: {
            userId,
            entityType: 'OFFICE',
            entityId: officeId,
            field: 'WEBSITE',
            status: 'APPLIED',
          },
        }),
      'VALIDATION',
    );
  });

  it('maps an OTHER saved location without a name to VALIDATION', async () => {
    await expectMapped(
      () =>
        app.savedLocation.create({
          data: { ...location(userId, 'OTHER', false), customName: null },
        }),
      'VALIDATION',
    );
  });

  it('maps a forced jurisdiction freshness without a note to VALIDATION', async () => {
    await expectMapped(
      () =>
        app.jurisdiction.update({
          where: { id: jurisdictionId },
          data: { freshnessOverride: 'FORCE_OUTDATED', freshnessNote: null },
        }),
      'VALIDATION',
    );
  });

  it('maps a forced office freshness without a note to VALIDATION', async () => {
    await expectMapped(
      () =>
        app.office.update({
          where: { id: officeId },
          data: { freshnessOverride: 'FORCE_CURRENT', freshnessNote: null },
        }),
      'VALIDATION',
    );
  });

  it('maps a forced official freshness without a note to VALIDATION', async () => {
    await expectMapped(
      () =>
        app.official.update({
          where: { id: officialId },
          data: { freshnessOverride: 'FORCE_OUTDATED', freshnessNote: null },
        }),
      'VALIDATION',
    );
  });

  it('maps an office term whose end is before its start to VALIDATION', async () => {
    await expectMapped(
      () =>
        app.officeTerm.create({
          data: {
            officeId,
            officialId,
            status: 'ELECTED',
            isCurrent: false,
            termStart: new Date('2026-06-01'),
            termEnd: new Date('2026-01-01'),
          },
        }),
      'VALIDATION',
    );
  });

  it('maps a source freshness outside 1..3650 to VALIDATION', async () => {
    await expectMapped(
      () => app.source.update({ where: { id: sourceId }, data: { freshnessDays: 0 } }),
      'VALIDATION',
    );
  });

  it('maps a negative plan amount to VALIDATION', async () => {
    await expectMapped(
      () =>
        app.plan.create({
          data: { stripePriceId: `price_${officeId}`, name: 'Bad', amountCents: -1, interval: 'month' },
        }),
      'VALIDATION',
    );
  });

  it('maps a lowercase jurisdiction state to VALIDATION', async () => {
    await expectMapped(
      () => app.jurisdiction.update({ where: { id: jurisdictionId }, data: { state: 'dc' } }),
      'VALIDATION',
    );
  });

  it('maps a short lookup zip to VALIDATION', async () => {
    await expectMapped(
      () =>
        app.lookup.create({
          data: {
            token: `zip${officeId.replaceAll('-', '').slice(0, 28)}`,
            method: 'ZIP',
            displayLabel: 'Bad zip',
            zip: '12',
            jurisdictionIds: [],
            confidence: 'EXACT',
            partialLevels: [],
            levelDetail: { levels: [] },
            latencyMs: 1,
          },
        }),
      'VALIDATION',
    );
  });

  it('maps an update of the append-only change log to FORBIDDEN', async () => {
    const row = await owner.changeLog.create({
      data: { actorType: 'SYSTEM', entityType: 'office', entityId: officeId, action: 'create' },
    });
    await expectMapped(
      () => owner.changeLog.update({ where: { id: row.id }, data: { action: 'tamper' } }),
      'FORBIDDEN',
    );
    await expectMapped(() => owner.changeLog.delete({ where: { id: row.id } }), 'FORBIDDEN');
  });
});

function location(userId: string, label: 'HOME' | 'WORK' | 'OTHER', isDefault: boolean) {
  return {
    userId,
    label,
    customName: label === 'OTHER' ? 'Cabin' : null,
    displayAddress: '1 Main St',
    normalizedAddress: '1 main st',
    isDefault,
    jurisdictionIds: [] as string[],
    confidence: 'EXACT' as const,
    resolvedAt: new Date('2026-01-15T00:00:00.000Z'),
  };
}
