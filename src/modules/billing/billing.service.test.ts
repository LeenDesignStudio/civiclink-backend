import { describe, expect, it } from 'vitest';
import { Authz, systemPrincipal } from '../../authz/authz.js';
import type { ServiceContext } from '../../graphql/context.js';
import { AlreadySubscribedError, BillingUnavailableError, ForbiddenError, NoBillingAccountError } from '../../lib/errors.js';
import { FakeStripe } from '../../../test/fakes/stripe.js';
import type { InvoiceDto, SubscriptionStatus } from './billing.dto.js';
import { BillingService } from './billing.service.js';
import type { StripeCallOptions, StripeGateway } from './billing.provider.js';
import { StripeBillingProvider } from './stripe.provider.js';
import type {
  BillingRepo,
  PlanRecord,
  SubscriptionRecord,
  StripeCustomerRecord,
  UpsertInvoice,
  UpsertPlan,
  UpsertSubscription,
} from './billing.ports.js';
import { EntitlementsService, type PlanLimits } from './entitlements.service.js';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLAN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

class MemoryBilling implements BillingRepo {
  users = new Map<string, { id: string; email: string }>();
  plans = new Map<string, PlanRecord>();
  customers: StripeCustomerRecord[] = [];
  subs: SubscriptionRecord[] = [];
  invoices: (InvoiceDto & { stripeCustomerId: string; stripeInvoiceId: string })[] = [];
  events = new Set<string>();
  private n = 0;

  findUser(userId: string) {
    return Promise.resolve(this.users.get(userId) ?? null);
  }

  findActivePlan(planId: string) {
    const plan = this.plans.get(planId);
    return Promise.resolve(plan?.active ? plan : null);
  }

  findPlan(planId: string) {
    return Promise.resolve(this.plans.get(planId) ?? null);
  }

  findPlanByPrice(stripePriceId: string) {
    return Promise.resolve([...this.plans.values()].find((plan) => plan.stripePriceId === stripePriceId) ?? null);
  }

  entitlementsFor(userId: string): Promise<Partial<PlanLimits> | null> {
    const sub = this.subs.find(
      (row) => row.userId === userId && (row.status === 'ACTIVE' || row.status === 'TRIALING' || row.status === 'PAST_DUE'),
    );
    if (!sub?.planId) return Promise.resolve(null);
    return Promise.resolve(this.plans.get(sub.planId)?.entitlements ?? null);
  }

  findCustomer(userId: string) {
    return Promise.resolve(this.customers.find((row) => row.userId === userId) ?? null);
  }

  findCustomerByStripeId(stripeCustomerId: string) {
    return Promise.resolve(this.customers.find((row) => row.stripeCustomerId === stripeCustomerId) ?? null);
  }

  saveCustomer(userId: string, stripeCustomerId: string) {
    const existing = this.customers.find((row) => row.userId === userId);
    if (existing) existing.stripeCustomerId = stripeCustomerId;
    else this.customers.push({ userId, stripeCustomerId });
    return Promise.resolve();
  }

  findBlockingSubscription(userId: string) {
    return Promise.resolve(
      this.subs.find(
        (row) =>
          row.userId === userId && (row.status === 'ACTIVE' || row.status === 'TRIALING' || row.status === 'PAST_DUE'),
      ) ?? null,
    );
  }

  findLatestSubscription(userId: string) {
    const rows = this.subs.filter((row) => row.userId === userId);
    return Promise.resolve(rows.sort((a, b) => b.lastEventAt.getTime() - a.lastEventAt.getTime())[0] ?? null);
  }

  findSubscriptionByStripeId(stripeSubscriptionId: string) {
    return Promise.resolve(this.subs.find((row) => row.stripeSubscriptionId === stripeSubscriptionId) ?? null);
  }

  upsertSubscription(row: UpsertSubscription) {
    const existing = this.subs.find((item) => item.stripeSubscriptionId === row.stripeSubscriptionId);
    if (existing) {
      existing.planId = row.planId;
      existing.status = row.status;
      existing.currentPeriodEnd = row.currentPeriodEnd;
      existing.cancelAtPeriodEnd = row.cancelAtPeriodEnd;
      existing.lastEventAt = row.lastEventAt;
      return Promise.resolve(existing);
    }
    this.n += 1;
    const created: SubscriptionRecord = { id: `sub-row-${this.n}`, ...row };
    this.subs.push(created);
    return Promise.resolve(created);
  }

  listInvoices(): Promise<InvoiceDto[]> {
    return Promise.resolve([]);
  }

  upsertInvoice(row: UpsertInvoice) {
    const dto: InvoiceDto & { stripeCustomerId: string; stripeInvoiceId: string } = {
      id: row.stripeInvoiceId,
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
      createdAt: row.issuedAt,
    };
    this.invoices.push(dto);
    return Promise.resolve(dto);
  }

  insertEvent(id: string): Promise<'inserted' | 'duplicate'> {
    if (this.events.has(id)) return Promise.resolve('duplicate');
    this.events.add(id);
    return Promise.resolve('inserted');
  }

  markEventProcessed(): Promise<void> {
    return Promise.resolve();
  }

  upserts: UpsertPlan[] = [];

  upsertPlan(row: UpsertPlan): Promise<void> {
    this.upserts.push(row);
    const existing = [...this.plans.values()].find((plan) => plan.stripePriceId === row.stripePriceId);
    if (existing) {
      existing.name = row.name;
      existing.amountCents = row.amountCents;
      existing.currency = row.currency;
      existing.interval = row.interval;
      existing.entitlements = row.entitlements;
      existing.active = true;
      return Promise.resolve();
    }
    this.n += 1;
    const id = `plan-${this.n}`;
    this.plans.set(id, { id, active: true, ...row });
    return Promise.resolve();
  }

  deactivatePlansExcept(stripePriceIds: string[]): Promise<number> {
    let count = 0;
    for (const plan of this.plans.values()) {
      if (plan.active && !stripePriceIds.includes(plan.stripePriceId)) {
        plan.active = false;
        count += 1;
      }
    }
    return Promise.resolve(count);
  }
}

function systemCtx(): ServiceContext {
  const principal = systemPrincipal('billing.syncPlans');
  return { requestId: 'job', principal, authz: new Authz(principal), ipHash: 'system' };
}

function resident(): ServiceContext {
  const principal = {
    kind: 'resident' as const,
    userId: USER,
    status: 'ACTIVE' as const,
    termsAccepted: true,
    sessionId: 'sess-1',
  };
  return { requestId: 'req-1', principal, authz: new Authz(principal), ipHash: 'ip-hash' };
}

function subEvent(id: string, status: string, created: number) {
  return {
    id,
    type: 'customer.subscription.updated',
    created,
    data: {
      object: {
        id: 'sub_123',
        status,
        metadata: { userId: USER },
        cancel_at_period_end: false,
      },
    },
  };
}

describe('BillingService', () => {
  it('stores status transitions, ignores duplicates and older events', async () => {
    const repo = new MemoryBilling();
    const svc = new BillingService({ repo, provider: new FakeStripe(), publicWebUrl: 'https://civiclink.test' });
    await svc.applyStripeEvent(subEvent('evt_1', 'active', 1_000));
    await svc.applyStripeEvent(subEvent('evt_2', 'past_due', 2_000));
    await svc.applyStripeEvent(subEvent('evt_3', 'canceled', 3_000));
    expect(repo.subs[0]?.status).toBe<SubscriptionStatus>('CANCELED');

    await svc.applyStripeEvent(subEvent('evt_3', 'active', 3_000));
    expect(repo.subs[0]?.status).toBe('CANCELED');

    await svc.applyStripeEvent(subEvent('evt_old', 'active', 500));
    expect(repo.subs[0]?.status).toBe('CANCELED');
  });

  it('rejects checkout when already subscribed and portal without a customer', async () => {
    const repo = new MemoryBilling();
    const stripe = new FakeStripe();
    const svc = new BillingService({ repo, provider: stripe, publicWebUrl: 'https://civiclink.test' });
    repo.users.set(USER, { id: USER, email: 'ada@example.com' });
    repo.plans.set(PLAN, {
      id: PLAN,
      stripePriceId: 'price_1',
      name: 'Plus',
      amountCents: 500,
      currency: 'usd',
      interval: 'month',
      active: true,
      entitlements: { maxSavedLocations: 10, maxFollows: 100 },
    });
    await expect(svc.createPortalSession(resident())).rejects.toBeInstanceOf(NoBillingAccountError);
    expect(stripe.calls).toHaveLength(0);

    const checkout = await svc.createCheckoutSession(resident(), { planId: PLAN });
    expect(checkout.url).toContain(PLAN);
    expect(stripe.calls.some((call) => call.op === 'customer' && call.idempotencyKey === `cust:${USER}`)).toBe(true);

    await svc.applyStripeEvent(subEvent('evt_live', 'active', 10));
    await expect(svc.createCheckoutSession(resident(), { planId: PLAN })).rejects.toBeInstanceOf(AlreadySubscribedError);

    stripe.failWith = 'sk_live_secret from stripe';
    repo.subs.splice(0, repo.subs.length);
    await expect(svc.createCheckoutSession(resident(), { planId: PLAN })).rejects.toBeInstanceOf(BillingUnavailableError);
    try {
      await svc.createCheckoutSession(resident(), { planId: PLAN });
    } catch (err) {
      expect(err).toBeInstanceOf(BillingUnavailableError);
      expect((err as Error).message).not.toContain('sk_live');
    }
  });
});

describe('EntitlementsService', () => {
  it('merges plan entitlements over defaults and follows plan changes', async () => {
    const repo = new MemoryBilling();
    const entitlements = new EntitlementsService(repo, { maxSavedLocations: 5, maxFollows: 50 });
    await expect(entitlements.limits(USER)).resolves.toEqual({ maxSavedLocations: 5, maxFollows: 50 });
    repo.plans.set(PLAN, {
      id: PLAN,
      stripePriceId: 'price_1',
      name: 'Plus',
      amountCents: 500,
      currency: 'usd',
      interval: 'month',
      active: true,
      entitlements: { maxSavedLocations: 10, maxFollows: 80 },
    });
    repo.subs.push({
      id: 'local-1',
      userId: USER,
      stripeSubscriptionId: 'sub_123',
      planId: PLAN,
      status: 'ACTIVE',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      lastEventAt: new Date('2026-10-01T00:00:00.000Z'),
    });
    await expect(entitlements.limits(USER)).resolves.toEqual({ maxSavedLocations: 10, maxFollows: 80 });
    const plan = repo.plans.get(PLAN);
    if (!plan) throw new Error('plan missing');
    plan.entitlements = { maxSavedLocations: 2, maxFollows: 4 };
    await expect(entitlements.limits(USER)).resolves.toEqual({ maxSavedLocations: 2, maxFollows: 4 });
    const subscription = repo.subs[0];
    if (!subscription) throw new Error('subscription missing');
    subscription.status = 'PAST_DUE';
    await expect(entitlements.limits(USER)).resolves.toEqual({ maxSavedLocations: 2, maxFollows: 4 });
    subscription.status = 'CANCELED';
    await expect(entitlements.limits(USER)).resolves.toEqual({ maxSavedLocations: 5, maxFollows: 50 });
  });

  it('enqueues billing.applyEvent and leaves applying the event to the worker', async () => {
    const repo = new MemoryBilling();
    const queued: Array<{ name: string; singletonKey: string }> = [];
    const svc = new BillingService({
      repo,
      provider: new FakeStripe(),
      publicWebUrl: 'https://civiclink.test',
      queue: {
        enqueue: (name, _data, options) => {
          queued.push({ name, singletonKey: options.singletonKey });
          return Promise.resolve();
        },
      },
    });
    await svc.acceptStripeEvent(subEvent('evt_queue', 'active', 1));
    expect(queued).toEqual([{ name: 'billing.applyEvent', singletonKey: 'evt_queue' }]);
    expect(repo.subs).toHaveLength(0);
  });

  it('returns a catalog error when the billing job cannot be queued', async () => {
    const svc = new BillingService({
      repo: new MemoryBilling(),
      provider: new FakeStripe(),
      publicWebUrl: 'https://civiclink.test',
      queue: { enqueue: () => Promise.reject(new Error('queue down')) },
    });
    await expect(svc.acceptStripeEvent(subEvent('evt_fail', 'active', 1))).rejects.toBeInstanceOf(BillingUnavailableError);
  });

  it('enqueues one billing.syncPlans key for product and price updates', async () => {
    const repo = new MemoryBilling();
    const queued: Array<{ name: string; singletonKey: string }> = [];
    const svc = new BillingService({
      repo,
      provider: new FakeStripe(),
      publicWebUrl: 'https://civiclink.test',
      queue: {
        enqueue: (name, _data, options) => {
          queued.push({ name, singletonKey: options.singletonKey });
          return Promise.resolve();
        },
      },
    });
    await svc.acceptStripeEvent(catalogEvent('evt_product', 'product.updated'));
    await svc.acceptStripeEvent(catalogEvent('evt_price', 'price.updated'));
    await svc.acceptStripeEvent(catalogEvent('evt_product', 'product.updated'));
    expect(queued).toEqual([
      { name: 'billing.syncPlans', singletonKey: 'billing.syncPlans' },
      { name: 'billing.syncPlans', singletonKey: 'billing.syncPlans' },
    ]);
    expect(repo.subs).toHaveLength(0);
  });

  it('upserts active prices and deactivates a price that is no longer active', async () => {
    const repo = new MemoryBilling();
    repo.plans.set(PLAN, {
      id: PLAN,
      stripePriceId: 'price_old',
      name: 'Old',
      amountCents: 100,
      currency: 'usd',
      interval: 'month',
      active: true,
      entitlements: {},
    });
    const stripe = new FakeStripe();
    stripe.prices = [
      {
        stripePriceId: 'price_plus',
        name: 'Plus',
        amountCents: 900,
        currency: 'usd',
        interval: 'month',
        features: ['Alerts'],
        entitlements: { maxSavedLocations: 10, maxFollows: 200 },
      },
    ];
    const svc = new BillingService({ repo, provider: stripe, publicWebUrl: 'https://civiclink.test' });
    await expect(svc.syncPlans(resident())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.applyStripeEventAsSystem(resident(), subEvent('evt_denied', 'active', 1))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const result = await svc.syncPlans(systemCtx());
    expect(result).toEqual({ upserted: 1, deactivated: 1 });
    expect(repo.upserts[0]).toMatchObject({
      stripePriceId: 'price_plus',
      name: 'Plus',
      amountCents: 900,
      currency: 'usd',
      interval: 'month',
      features: ['Alerts'],
      entitlements: { maxSavedLocations: 10, maxFollows: 200 },
    });
    expect(repo.plans.get(PLAN)?.active).toBe(false);
    expect([...repo.plans.values()].find((plan) => plan.stripePriceId === 'price_plus')?.active).toBe(true);
  });
});

function catalogEvent(id: string, type: string) {
  return { id, type, created: 1_700_000_000, data: { object: { id: 'price_1' } } };
}

describe('StripeBillingProvider', () => {
  it('passes a 10s AbortSignal and idempotency key, and hides provider errors', async () => {
    const seen: StripeCallOptions[] = [];
    const gateway: StripeGateway = {
      createCustomer: (_params, options) => {
        seen.push(options);
        return Promise.resolve({ id: 'cus_test' });
      },
      createCheckoutSession: () => Promise.resolve({ url: 'https://billing.test/c' }),
      createPortalSession: () => Promise.resolve({ url: 'https://billing.test/p' }),
      listPrices: () => Promise.resolve({ data: [], has_more: false }),
    };
    const provider = new StripeBillingProvider(gateway);
    await provider.createCustomer({ userId: USER, email: 'ada@example.com', idempotencyKey: `cust:${USER}` });
    expect(seen[0]?.timeout).toBe(10_000);
    expect(seen[0]?.idempotencyKey).toBe(`cust:${USER}`);
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);

    const failing = new StripeBillingProvider(gateway, () => AbortSignal.abort(new Error('stripe secret timeout')));
    await expect(
      failing.createCustomer({ userId: USER, email: 'ada@example.com', idempotencyKey: `cust:${USER}` }),
    ).rejects.toMatchObject({ code: 'BILLING_UNAVAILABLE' });
  });

  it('lists active prices with a 10s timeout and keeps billing errors on BILLING_UNAVAILABLE', async () => {
    const seen: StripeCallOptions[] = [];
    const gateway: StripeGateway = {
      createCustomer: () => Promise.resolve({ id: 'cus_test' }),
      createCheckoutSession: () => Promise.resolve({ url: 'https://billing.test/c' }),
      createPortalSession: () => Promise.resolve({ url: 'https://billing.test/p' }),
      listPrices: (_params, options) => {
        seen.push(options);
        return Promise.resolve({
          has_more: false,
          data: [
            {
              id: 'price_plus',
              unit_amount: 900,
              currency: 'usd',
              recurring: { interval: 'month' },
              product: {
                name: 'Plus',
                metadata: { features: 'Alerts', entitlements: '{"maxFollows":40}' },
              },
            },
          ],
        });
      },
    };
    const provider = new StripeBillingProvider(gateway);
    await expect(provider.listActivePrices()).resolves.toEqual([
      {
        stripePriceId: 'price_plus',
        name: 'Plus',
        amountCents: 900,
        currency: 'usd',
        interval: 'month',
        features: ['Alerts'],
        entitlements: { maxFollows: 40 },
      },
    ]);
    expect(seen[0]?.timeout).toBe(10_000);
    const failing = new StripeBillingProvider(gateway, () => AbortSignal.abort(new Error('timeout')));
    await expect(failing.listActivePrices()).rejects.toMatchObject({ code: 'BILLING_UNAVAILABLE' });
  });
});
