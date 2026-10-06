import { randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../src/generated/prisma/client.js';

let sequence = 0;

function tag(): string {
  sequence += 1;
  return `${sequence.toString(36)}${randomUUID().slice(0, 8)}`;
}

function sha(): string {
  return randomBytes(32).toString('hex');
}

const now = () => new Date('2026-01-15T00:00:00.000Z');

export async function createUser(db: PrismaClient, email = `user-${tag()}@example.com`) {
  return db.user.create({ data: { email, displayName: 'Resident' } });
}

export async function createAuthIdentity(db: PrismaClient, userId: string) {
  return db.authIdentity.create({
    data: { userId, provider: 'GOOGLE', providerSubject: tag(), emailVerified: true },
  });
}

export async function createUserSession(db: PrismaClient, userId: string) {
  return db.userSession.create({
    data: { userId, refreshTokenHash: sha(), familyId: randomUUID(), expiresAt: now() },
  });
}

export async function createDeletionRequest(db: PrismaClient, userId: string) {
  return db.deletionRequest.create({
    data: { userId, purgeAfter: now() },
  });
}

export async function createSource(db: PrismaClient) {
  return db.source.create({
    data: {
      name: `Source ${tag()}`,
      publisher: 'CivicLink tests',
      url: 'https://example.com/source',
      termsUrl: 'https://example.com/terms',
      method: 'MANUAL',
      schedule: 'ON_DEMAND',
      levels: ['COUNTY'],
    },
  });
}

export async function createJurisdiction(
  db: PrismaClient,
  sourceId: string,
  input?: {
    name?: string;
    type?: 'COUNTY' | 'MUNICIPALITY' | 'ZCTA' | 'CONGRESSIONAL_DISTRICT';
    level?: 'COUNTY' | 'MUNICIPAL' | 'FEDERAL' | 'SPECIAL';
    geoid?: string;
  },
) {
  return db.jurisdiction.create({
    data: {
      name: input?.name ?? `District ${tag()}`,
      level: input?.level ?? 'COUNTY',
      type: input?.type ?? 'COUNTY',
      sourceId,
      lastUpdatedAt: now(),
      ...(input?.geoid ? { geoid: input.geoid } : {}),
      state: 'DC',
    },
  });
}

export async function createOffice(db: PrismaClient, jurisdictionId: string, sourceId: string) {
  return db.office.create({
    data: {
      slug: `office-${tag()}`,
      jurisdictionId,
      name: 'Test office',
      selectionMethod: 'ELECTED',
      sourceId,
      lastUpdatedAt: now(),
    },
  });
}

export async function createOfficeAddress(db: PrismaClient, officeId: string) {
  return db.officeAddress.create({
    data: { officeId, label: 'Main', street: '1 Main', city: 'Washington', state: 'DC', zip: '20001' },
  });
}

export async function createOfficial(db: PrismaClient, sourceId: string) {
  return db.official.create({
    data: { slug: `official-${tag()}`, fullName: 'Alex Example', sourceId, lastUpdatedAt: now() },
  });
}

export async function createOfficeTerm(db: PrismaClient, officeId: string, officialId: string) {
  return db.officeTerm.create({
    data: { officeId, officialId, status: 'ELECTED', isCurrent: true },
  });
}

export async function createSavedLocation(db: PrismaClient, userId: string, label: 'HOME' | 'WORK' | 'OTHER' = 'OTHER') {
  return db.savedLocation.create({
    data: {
      userId,
      label,
      customName: label === 'OTHER' ? 'Cabin' : null,
      displayAddress: '1 Main St',
      normalizedAddress: '1 main st',
      isDefault: false,
      jurisdictionIds: [],
      confidence: 'EXACT',
      resolvedAt: now(),
    },
  });
}

export async function createLookup(db: PrismaClient, userId?: string) {
  return db.lookup.create({
    data: {
      token: tag().slice(0, 32),
      ...(userId ? { userId } : {}),
      method: 'ADDRESS',
      displayLabel: '1 Main St',
      jurisdictionIds: [],
      confidence: 'EXACT',
      partialLevels: [],
      levelDetail: { levels: [] },
      latencyMs: 10,
    },
  });
}

export async function createFollow(db: PrismaClient, userId: string, officeId: string) {
  return db.follow.create({ data: { userId, officeId } });
}

export async function createSourceRun(db: PrismaClient, sourceId: string) {
  return db.sourceRun.create({ data: { sourceId, status: 'SUCCEEDED' } });
}

export async function createPendingSourceChange(db: PrismaClient, sourceRunId: string) {
  return db.pendingSourceChange.create({
    data: { sourceRunId, entityType: 'OFFICE', field: 'phone', newValue: { phone: '2025550100' } },
  });
}

export async function createServiceCategory(db: PrismaClient) {
  return db.serviceCategory.create({ data: { name: `Category ${tag()}`, sortOrder: 1 } });
}

export async function createService(db: PrismaClient, categoryId: string, sourceId: string) {
  return db.service.create({
    data: { title: 'Permit desk', categoryId, description: 'How to apply', sourceId, lastValidatedAt: now() },
  });
}

export async function createServiceLink(db: PrismaClient, serviceId: string, jurisdictionId: string) {
  return db.serviceLink.create({ data: { serviceId, jurisdictionId } });
}

export async function createAdminUser(db: PrismaClient) {
  return db.adminUser.create({
    data: { email: `admin-${tag()}@qubalink.com`, role: 'EDITOR', status: 'ACTIVE' },
  });
}

export async function createAdminSession(db: PrismaClient, adminId: string) {
  return db.adminSession.create({
    data: { adminId, tokenHash: sha(), expiresAt: now() },
  });
}

export async function createCorrection(db: PrismaClient, userId: string, entityId: string) {
  return db.correction.create({
    data: { userId, entityType: 'OFFICE', entityId, field: 'PHONE', proposedValue: '2025550100' },
  });
}

export async function createCorrectionNote(db: PrismaClient, correctionId: string, adminId: string) {
  return db.correctionNote.create({ data: { correctionId, adminId, body: 'Checked the source.' } });
}

export async function createChangeLog(db: PrismaClient, entityId: string) {
  return db.changeLog.create({
    data: { actorType: 'SYSTEM', entityType: 'office', entityId, action: 'update' },
  });
}

export async function createAlert(db: PrismaClient, officeId: string, createdBy: string) {
  return db.alert.create({
    data: { targetOfficeId: officeId, title: 'Notice', body: 'A civic update', channels: ['IN_APP'], createdBy },
  });
}

export async function createNotification(db: PrismaClient, userId: string) {
  return db.notification.create({
    data: { userId, type: 'ALERT', title: 'Notice', body: 'Hello', sourceRef: `alert:${tag()}` },
  });
}

export async function createNotificationDelivery(db: PrismaClient, notificationId: string, userId: string) {
  return db.notificationDelivery.create({
    data: { notificationId, channel: 'IN_APP', dedupeKey: `${tag()}:${userId}:IN_APP` },
  });
}

export async function createNotificationPreference(db: PrismaClient, userId: string) {
  return db.notificationPreference.create({
    data: { userId, category: 'ALERTS', channel: 'EMAIL', enabled: true },
  });
}

export async function createPushSubscription(db: PrismaClient, userId: string) {
  return db.pushSubscription.create({ data: { userId, token: tag() } });
}

export async function createPlan(db: PrismaClient) {
  return db.plan.create({
    data: {
      stripePriceId: `price_${tag()}`,
      name: 'Resident',
      amountCents: 500,
      interval: 'month',
      entitlements: { maxSavedLocations: 10, maxFollows: 200 },
    },
  });
}

export async function createStripeCustomer(db: PrismaClient, userId: string) {
  return db.stripeCustomer.create({ data: { userId, stripeCustomerId: `cus_${tag()}` } });
}

export async function createSubscription(db: PrismaClient, userId: string, planId: string) {
  return db.subscription.create({
    data: { userId, planId, stripeSubscriptionId: `sub_${tag()}`, status: 'ACTIVE', lastEventAt: now() },
  });
}

export async function createInvoice(db: PrismaClient, stripeCustomerId: string) {
  return db.invoice.create({
    data: {
      stripeInvoiceId: `in_${tag()}`,
      stripeCustomerId,
      amountDueCents: 500,
      amountPaidCents: 500,
      currency: 'usd',
      status: 'PAID',
      issuedAt: now(),
    },
  });
}

export async function createStripeEvent(db: PrismaClient) {
  return db.stripeEvent.create({ data: { id: `evt_${tag()}`, type: 'customer.subscription.updated' } });
}

export async function createContactMessage(db: PrismaClient) {
  return db.contactMessage.create({
    data: { name: 'Sam', email: `sam-${tag()}@example.com`, topic: 'OTHER', message: 'Hello there', ipHash: sha() },
  });
}

export async function createRateLimit(db: PrismaClient) {
  return db.rateLimit.create({ data: { key: tag(), points: 1, expire: BigInt(Date.now() + 60_000) } });
}

export async function createLegalDocument(db: PrismaClient) {
  return db.legalDocument.create({
    data: { kind: 'TERMS', version: tag().slice(0, 20), effectiveAt: now(), current: false },
  });
}
