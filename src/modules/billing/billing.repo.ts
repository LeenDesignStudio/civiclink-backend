import { dbCall, mapDbError, type Db } from '../../db/prisma.js';
import { isAppError } from '../../lib/errors.js';
import type { InvoiceDto, SubscriptionStatus } from './billing.dto.js';
import type { PlanLimits } from './entitlements.service.js';
import { isEntitledStatus } from './entitlements.service.js';
import type {
  BillingRepo as BillingStore,
  PlanRecord,
  SubscriptionRecord,
  StripeCustomerRecord,
  UpsertInvoice,
  UpsertSubscription,
} from './billing.ports.js';

const ENTITLED: SubscriptionStatus[] = ['ACTIVE', 'TRIALING', 'PAST_DUE'];

function entitlementsOf(value: unknown): Partial<PlanLimits> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const out: Partial<PlanLimits> = {};
  if (typeof record.maxSavedLocations === 'number') out.maxSavedLocations = record.maxSavedLocations;
  if (typeof record.maxFollows === 'number') out.maxFollows = record.maxFollows;
  return out;
}

function planOf(row: {
  id: string;
  stripePriceId: string;
  name: string;
  amountCents: number;
  currency: string;
  interval: string;
  active: boolean;
  entitlements: unknown;
}): PlanRecord {
  return {
    id: row.id,
    stripePriceId: row.stripePriceId,
    name: row.name,
    amountCents: row.amountCents,
    currency: row.currency,
    interval: row.interval,
    active: row.active,
    entitlements: entitlementsOf(row.entitlements),
  };
}

const planSelect = {
  id: true,
  stripePriceId: true,
  name: true,
  amountCents: true,
  currency: true,
  interval: true,
  active: true,
  entitlements: true,
} as const;

function subscriptionOf(row: {
  id: string;
  userId: string;
  stripeSubscriptionId: string;
  planId: string | null;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  lastEventAt: Date;
}): SubscriptionRecord {
  return {
    id: row.id,
    userId: row.userId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    planId: row.planId,
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    lastEventAt: row.lastEventAt,
  };
}

export class BillingRepo implements BillingStore {
  constructor(private readonly db: Db) {}

  async findUser(userId: string): Promise<{ id: string; email: string } | null> {
    return dbCall(() => this.db.user.findUnique({ where: { id: userId }, select: { id: true, email: true } }));
  }

  async findActivePlan(planId: string): Promise<PlanRecord | null> {
    const row = await dbCall(() =>
      this.db.plan.findFirst({ where: { id: planId, active: true }, select: planSelect }),
    );
    return row ? planOf(row) : null;
  }

  async findPlan(planId: string): Promise<PlanRecord | null> {
    const row = await dbCall(() => this.db.plan.findUnique({ where: { id: planId }, select: planSelect }));
    return row ? planOf(row) : null;
  }

  async findPlanByPrice(stripePriceId: string): Promise<PlanRecord | null> {
    const row = await dbCall(() =>
      this.db.plan.findUnique({ where: { stripePriceId }, select: planSelect }),
    );
    return row ? planOf(row) : null;
  }

  async entitlementsFor(userId: string): Promise<Partial<PlanLimits> | null> {
    const row = await dbCall(() =>
      this.db.subscription.findFirst({
        where: { userId, status: { in: ENTITLED } },
        orderBy: { updatedAt: 'desc' },
        select: { status: true, plan: { select: { entitlements: true } } },
      }),
    );
    if (!row || !isEntitledStatus(row.status) || !row.plan) return null;
    return entitlementsOf(row.plan.entitlements);
  }

  async findCustomer(userId: string): Promise<StripeCustomerRecord | null> {
    return dbCall(() =>
      this.db.stripeCustomer.findUnique({
        where: { userId },
        select: { userId: true, stripeCustomerId: true },
      }),
    );
  }

  async findCustomerByStripeId(stripeCustomerId: string): Promise<StripeCustomerRecord | null> {
    return dbCall(() =>
      this.db.stripeCustomer.findUnique({
        where: { stripeCustomerId },
        select: { userId: true, stripeCustomerId: true },
      }),
    );
  }

  async saveCustomer(userId: string, stripeCustomerId: string): Promise<void> {
    await dbCall(() =>
      this.db.stripeCustomer.upsert({
        where: { userId },
        create: { userId, stripeCustomerId },
        update: { stripeCustomerId },
      }),
    );
  }

  async findBlockingSubscription(userId: string): Promise<SubscriptionRecord | null> {
    const row = await dbCall(() =>
      this.db.subscription.findFirst({
        where: { userId, status: { in: ENTITLED } },
        orderBy: { lastEventAt: 'desc' },
      }),
    );
    return row ? subscriptionOf(row) : null;
  }

  async findLatestSubscription(userId: string): Promise<SubscriptionRecord | null> {
    const row = await dbCall(() =>
      this.db.subscription.findFirst({
        where: { userId },
        orderBy: { lastEventAt: 'desc' },
      }),
    );
    return row ? subscriptionOf(row) : null;
  }

  async findSubscriptionByStripeId(stripeSubscriptionId: string): Promise<SubscriptionRecord | null> {
    const row = await dbCall(() =>
      this.db.subscription.findUnique({ where: { stripeSubscriptionId } }),
    );
    return row ? subscriptionOf(row) : null;
  }

  async upsertSubscription(row: UpsertSubscription): Promise<SubscriptionRecord> {
    const saved = await dbCall(() =>
      this.db.subscription.upsert({
        where: { stripeSubscriptionId: row.stripeSubscriptionId },
        create: {
          userId: row.userId,
          stripeSubscriptionId: row.stripeSubscriptionId,
          planId: row.planId,
          status: row.status,
          currentPeriodEnd: row.currentPeriodEnd,
          cancelAtPeriodEnd: row.cancelAtPeriodEnd,
          lastEventAt: row.lastEventAt,
        },
        update: {
          planId: row.planId,
          status: row.status,
          currentPeriodEnd: row.currentPeriodEnd,
          cancelAtPeriodEnd: row.cancelAtPeriodEnd,
          lastEventAt: row.lastEventAt,
        },
      }),
    );
    return subscriptionOf(saved);
  }

  async listInvoices(
    stripeCustomerId: string,
    page: { limit: number; after?: { issuedAt: Date; id: string } },
  ): Promise<InvoiceDto[]> {
    const rows = await dbCall(() =>
      this.db.invoice.findMany({
        where: {
          stripeCustomerId,
          ...(page.after
            ? {
                OR: [
                  { issuedAt: { lt: page.after.issuedAt } },
                  { issuedAt: page.after.issuedAt, id: { lt: page.after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
        take: page.limit,
      }),
    );
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      amountDueCents: row.amountDueCents,
      amountPaidCents: row.amountPaidCents,
      currency: row.currency,
      status: row.status,
      hostedUrl: row.hostedUrl,
      pdfUrl: row.pdfUrl,
      issuedAt: row.issuedAt,
      createdAt: row.createdAt,
    }));
  }

  async upsertInvoice(row: UpsertInvoice): Promise<InvoiceDto> {
    const saved = await dbCall(() =>
      this.db.invoice.upsert({
        where: { stripeInvoiceId: row.stripeInvoiceId },
        create: {
          stripeInvoiceId: row.stripeInvoiceId,
          stripeCustomerId: row.stripeCustomerId,
          number: row.number,
          amountDueCents: row.amountDueCents,
          amountPaidCents: row.amountPaidCents,
          currency: row.currency,
          status: row.status,
          hostedUrl: row.hostedUrl,
          pdfUrl: row.pdfUrl,
          issuedAt: row.issuedAt,
        },
        update: {
          number: row.number,
          amountDueCents: row.amountDueCents,
          amountPaidCents: row.amountPaidCents,
          currency: row.currency,
          status: row.status,
          hostedUrl: row.hostedUrl,
          pdfUrl: row.pdfUrl,
          issuedAt: row.issuedAt,
        },
      }),
    );
    return {
      id: saved.id,
      number: saved.number,
      amountDueCents: saved.amountDueCents,
      amountPaidCents: saved.amountPaidCents,
      currency: saved.currency,
      status: saved.status,
      hostedUrl: saved.hostedUrl,
      pdfUrl: saved.pdfUrl,
      issuedAt: saved.issuedAt,
      createdAt: saved.createdAt,
    };
  }

  async insertEvent(id: string, type: string): Promise<'inserted' | 'duplicate'> {
    try {
      await this.db.stripeEvent.create({ data: { id, type } });
      return 'inserted';
    } catch (err) {
      if (isAppError(err)) throw err;
      const mapped = mapDbError(err);
      if (mapped.code === 'CONFLICT') return 'duplicate';
      throw mapped;
    }
  }

  async markEventProcessed(id: string): Promise<void> {
    await dbCall(() =>
      this.db.stripeEvent.update({ where: { id }, data: { processedAt: new Date() } }),
    );
  }
}
