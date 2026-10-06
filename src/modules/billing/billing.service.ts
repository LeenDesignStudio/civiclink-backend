import type { ServiceContext } from '../../graphql/context.js';
import {
  AlreadySubscribedError,
  BillingUnavailableError,
  isAppError,
  NoBillingAccountError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors.js';
import { clampFirst, decodeCursor, encodeCursor, type Connection } from '../../lib/pagination.js';
import { parseInput } from '../locations/locations.service.js';
import type { ApplyStripeEventResult, InvoiceDto, StripeWebhookEvent, SubscriptionDto, SubscriptionStatus } from './billing.dto.js';
import { checkoutSchema, invoicesQuerySchema } from './billing.inputs.js';
import type { BillingProvider } from './billing.provider.js';
import type { BillingRepo, PlanRecord, SubscriptionRecord } from './billing.ports.js';
import { isEntitledStatus } from './entitlements.service.js';

const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

const INVOICE_EVENTS = new Set(['invoice.paid', 'invoice.payment_failed', 'invoice.finalized']);

const STATUS_MAP: Record<string, SubscriptionStatus> = {
  incomplete: 'INCOMPLETE',
  incomplete_expired: 'INCOMPLETE_EXPIRED',
  trialing: 'TRIALING',
  active: 'ACTIVE',
  past_due: 'PAST_DUE',
  canceled: 'CANCELED',
  unpaid: 'UNPAID',
  paused: 'PAUSED',
};

const INVOICE_STATUS: Record<string, InvoiceDto['status']> = {
  draft: 'DRAFT',
  open: 'OPEN',
  paid: 'PAID',
  uncollectible: 'UNCOLLECTIBLE',
  void: 'VOID',
};

export interface BillingDeps {
  repo: BillingRepo;
  provider: BillingProvider;
  publicWebUrl: string;
}

export class BillingService {
  constructor(private readonly deps: BillingDeps) {}

  async subscription(ctx: ServiceContext): Promise<SubscriptionDto | null> {
    ctx.authz.require('self.billing:manage');
    const userId = ctx.authz.requireResident({ active: true });
    const row = await this.deps.repo.findLatestSubscription(userId);
    if (!row) return null;
    return this.toDto(row);
  }

  async invoices(ctx: ServiceContext, input: unknown): Promise<Connection<InvoiceDto>> {
    ctx.authz.require('self.billing:manage');
    const userId = ctx.authz.requireResident({ active: true });
    const parsed = parseInput(invoicesQuerySchema, input ?? {});
    const first = clampFirst(parsed.first, 24, 20);
    const decoded = parsed.after ? decodeCursor(parsed.after) : undefined;
    if (parsed.after && !decoded) {
      throw new ValidationError('Invalid cursor.', [
        { path: 'after', code: 'custom', message: 'Invalid cursor.' },
      ]);
    }
    const customer = await this.deps.repo.findCustomer(userId);
    if (!customer) {
      return { edges: [], pageInfo: { hasNextPage: false, endCursor: null } };
    }
    const rows = await this.deps.repo.listInvoices(customer.stripeCustomerId, {
      limit: first + 1,
      ...(decoded ? { after: { issuedAt: decoded.createdAt, id: decoded.id } } : {}),
    });
    const hasNextPage = rows.length > first;
    const page = hasNextPage ? rows.slice(0, first) : rows;
    const last = page[page.length - 1];
    return {
      edges: page.map((node) => ({ cursor: encodeCursor(node.issuedAt, node.id), node })),
      pageInfo: {
        hasNextPage,
        endCursor: last ? encodeCursor(last.issuedAt, last.id) : null,
      },
    };
  }

  async createCheckoutSession(ctx: ServiceContext, input: unknown): Promise<{ url: string }> {
    ctx.authz.require('self.billing:manage');
    const userId = ctx.authz.requireResident({ active: true });
    const parsed = parseInput(checkoutSchema, input);
    const blocking = await this.deps.repo.findBlockingSubscription(userId);
    if (blocking && isEntitledStatus(blocking.status)) throw new AlreadySubscribedError();
    const plan = await this.deps.repo.findActivePlan(parsed.planId);
    if (!plan?.active) throw new NotFoundError();
    const user = await this.deps.repo.findUser(userId);
    if (!user) throw new NotFoundError();
    const customer = await this.customerFor(user.id, user.email);
    const base = this.deps.publicWebUrl.replace(/\/$/, '');
    try {
      return await this.deps.provider.createCheckoutSession({
        stripeCustomerId: customer.stripeCustomerId,
        stripePriceId: plan.stripePriceId,
        userId,
        planId: plan.id,
        successUrl: `${base}/billing?checkout=success`,
        cancelUrl: `${base}/billing?checkout=cancel`,
        idempotencyKey: `checkout:${userId}:${plan.id}`,
      });
    } catch (err) {
      if (isAppError(err)) throw err;
      throw new BillingUnavailableError({ cause: err });
    }
  }

  async createPortalSession(ctx: ServiceContext): Promise<{ url: string }> {
    ctx.authz.require('self.billing:manage');
    const userId = ctx.authz.requireResident({ active: true });
    const customer = await this.deps.repo.findCustomer(userId);
    if (!customer) throw new NoBillingAccountError();
    const base = this.deps.publicWebUrl.replace(/\/$/, '');
    try {
      return await this.deps.provider.createPortalSession({
        stripeCustomerId: customer.stripeCustomerId,
        returnUrl: `${base}/billing`,
        idempotencyKey: `portal:${userId}`,
      });
    } catch (err) {
      if (isAppError(err)) throw err;
      throw new BillingUnavailableError({ cause: err });
    }
  }

  /**
   * Apply one verified Stripe event. The HTTP route owns signature checks.
   * Inserts the event id first; a second delivery is a duplicate no-op.
   * Subscription updates older than `lastEventAt` are ignored.
   */
  async applyStripeEvent(event: unknown): Promise<ApplyStripeEventResult> {
    const parsed = parseEvent(event);
    const inserted = await this.deps.repo.insertEvent(parsed.id, parsed.type);
    if (inserted === 'duplicate') return { duplicate: true, ignored: false };
    const ignored = await this.dispatch(parsed);
    await this.deps.repo.markEventProcessed(parsed.id);
    return { duplicate: false, ignored };
  }

  private async customerFor(userId: string, email: string): Promise<{ stripeCustomerId: string }> {
    const existing = await this.deps.repo.findCustomer(userId);
    if (existing) return existing;
    try {
      const created = await this.deps.provider.createCustomer({
        userId,
        email,
        idempotencyKey: `cust:${userId}`,
      });
      await this.deps.repo.saveCustomer(userId, created.stripeCustomerId);
      return created;
    } catch (err) {
      if (isAppError(err)) throw err;
      throw new BillingUnavailableError({ cause: err });
    }
  }

  private async dispatch(event: StripeWebhookEvent): Promise<boolean> {
    if (event.type === 'checkout.session.completed') return this.onCheckout(event);
    if (SUBSCRIPTION_EVENTS.has(event.type)) return this.onSubscription(event);
    if (INVOICE_EVENTS.has(event.type)) return this.onInvoice(event);
    return true;
  }

  private async onCheckout(event: StripeWebhookEvent): Promise<boolean> {
    const object = event.data.object;
    const stripeSubscriptionId = idOf(object.subscription);
    const stripeCustomerId = idOf(object.customer);
    const userId = metaString(object, 'userId') ?? stringOf(object.client_reference_id);
    if (!stripeSubscriptionId || !stripeCustomerId || !userId) return true;
    const existing = await this.deps.repo.findSubscriptionByStripeId(stripeSubscriptionId);
    if (existing && eventInstant(event).getTime() < existing.lastEventAt.getTime()) return true;
    if (!(await this.deps.repo.findCustomer(userId))) {
      await this.deps.repo.saveCustomer(userId, stripeCustomerId);
    }
    const planId = metaString(object, 'planId');
    const plan = planId ? await this.deps.repo.findPlan(planId) : null;
    const paid = object.payment_status === 'paid' || object.status === 'complete';
    await this.deps.repo.upsertSubscription({
      userId,
      stripeSubscriptionId,
      planId: plan?.id ?? null,
      status: paid ? 'ACTIVE' : 'INCOMPLETE',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      lastEventAt: eventInstant(event),
    });
    return false;
  }

  private async onSubscription(event: StripeWebhookEvent): Promise<boolean> {
    const object = event.data.object;
    const stripeSubscriptionId = stringOf(object.id);
    if (!stripeSubscriptionId) return true;
    const existing = await this.deps.repo.findSubscriptionByStripeId(stripeSubscriptionId);
    const at = eventInstant(event);
    if (existing && at.getTime() < existing.lastEventAt.getTime()) return true;
    const status =
      event.type === 'customer.subscription.deleted'
        ? (mapStatus(object.status) ?? 'CANCELED')
        : mapStatus(object.status);
    if (!status) return true;
    const userId =
      existing?.userId ??
      metaString(object, 'userId') ??
      (await this.userFromCustomer(idOf(object.customer)));
    if (!userId) return true;
    const price = priceId(object);
    const plan = price ? await this.deps.repo.findPlanByPrice(price) : null;
    const period = unixDate(object.current_period_end);
    await this.deps.repo.upsertSubscription({
      userId,
      stripeSubscriptionId,
      planId: plan?.id ?? existing?.planId ?? null,
      status,
      currentPeriodEnd: period ?? existing?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: object.cancel_at_period_end === true,
      lastEventAt: at,
    });
    return false;
  }

  private async onInvoice(event: StripeWebhookEvent): Promise<boolean> {
    const object = event.data.object;
    const stripeInvoiceId = stringOf(object.id);
    const stripeCustomerId = idOf(object.customer);
    if (!stripeInvoiceId || !stripeCustomerId) return true;
    const customer = await this.deps.repo.findCustomerByStripeId(stripeCustomerId);
    if (!customer) return true;
    const status = mapInvoice(object.status) ?? (event.type === 'invoice.paid' ? 'PAID' : 'OPEN');
    const issued = unixDate(object.created) ?? eventInstant(event);
    await this.deps.repo.upsertInvoice({
      stripeInvoiceId,
      stripeCustomerId,
      number: stringOf(object.number),
      amountDueCents: intOf(object.amount_due),
      amountPaidCents: intOf(object.amount_paid),
      currency: (stringOf(object.currency) ?? 'usd').slice(0, 3),
      status,
      hostedUrl: stringOf(object.hosted_invoice_url),
      pdfUrl: stringOf(object.invoice_pdf),
      issuedAt: issued,
    });
    return false;
  }

  private async userFromCustomer(stripeCustomerId: string | null): Promise<string | null> {
    if (!stripeCustomerId) return null;
    const customer = await this.deps.repo.findCustomerByStripeId(stripeCustomerId);
    return customer?.userId ?? null;
  }

  private async toDto(row: SubscriptionRecord): Promise<SubscriptionDto> {
    const plan = row.planId ? await this.deps.repo.findPlan(row.planId) : null;
    return {
      status: row.status,
      currentPeriodEnd: row.currentPeriodEnd,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      plan: plan ? planView(plan) : null,
    };
  }
}

export async function applyStripeEvent(
  service: BillingService,
  event: unknown,
): Promise<ApplyStripeEventResult> {
  return service.applyStripeEvent(event);
}

function planView(plan: PlanRecord): NonNullable<SubscriptionDto['plan']> {
  return {
    id: plan.id,
    name: plan.name,
    amountCents: plan.amountCents,
    currency: plan.currency,
    interval: plan.interval,
  };
}

function parseEvent(input: unknown): StripeWebhookEvent {
  if (!input || typeof input !== 'object') throw new ValidationError('Invalid Stripe event.');
  const record = input as Record<string, unknown>;
  const data = record.data;
  const object =
    data && typeof data === 'object' && 'object' in data ? (data as { object?: unknown }).object : undefined;
  if (typeof record.id !== 'string' || typeof record.type !== 'string' || typeof record.created !== 'number') {
    throw new ValidationError('Invalid Stripe event.');
  }
  if (!object || typeof object !== 'object') throw new ValidationError('Invalid Stripe event.');
  return {
    id: record.id,
    type: record.type,
    created: record.created,
    data: { object: object as Record<string, unknown> },
  };
}

function eventInstant(event: StripeWebhookEvent): Date {
  return new Date(event.created * 1000);
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function idOf(value: unknown): string | null {
  const direct = stringOf(value);
  if (direct) return direct;
  if (value && typeof value === 'object' && 'id' in value) return stringOf(value.id);
  return null;
}

function metaString(object: Record<string, unknown>, key: string): string | null {
  const metadata = object.metadata;
  if (!metadata || typeof metadata !== 'object' || !(key in metadata)) return null;
  return stringOf((metadata as Record<string, unknown>)[key]);
}

function mapStatus(value: unknown): SubscriptionStatus | null {
  if (typeof value !== 'string') return null;
  return STATUS_MAP[value] ?? null;
}

function mapInvoice(value: unknown): InvoiceDto['status'] | null {
  if (typeof value !== 'string') return null;
  return INVOICE_STATUS[value] ?? null;
}

function unixDate(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Date(value * 1000);
}

function intOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function priceId(object: Record<string, unknown>): string | null {
  const items = object.items;
  if (!items || typeof items !== 'object' || !('data' in items)) return null;
  const data = (items as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const first: unknown = data[0];
  if (!first || typeof first !== 'object' || !('price' in first)) return null;
  const price = (first as { price?: unknown }).price;
  return idOf(price);
}
