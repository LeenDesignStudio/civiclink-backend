import type { CatalogPrice } from '../../src/modules/billing/catalog.js';
import type {
  BillingProvider,
  CreateCheckoutInput,
  CreateCustomerInput,
  CreatePortalInput,
} from '../../src/modules/billing/billing.provider.js';

export class FakeStripe implements BillingProvider {
  failWith: string | null = null;
  readonly calls: { op: string; idempotencyKey: string }[] = [];
  prices: CatalogPrice[] = [];
  private readonly customers = new Map<string, string>();

  createCustomer(input: CreateCustomerInput): Promise<{ stripeCustomerId: string }> {
    this.assertUp();
    this.calls.push({ op: 'customer', idempotencyKey: input.idempotencyKey });
    const existing = this.customers.get(input.idempotencyKey);
    if (existing) return Promise.resolve({ stripeCustomerId: existing });
    const stripeCustomerId = `cus_${input.userId.replace(/-/g, '').slice(0, 12)}`;
    this.customers.set(input.idempotencyKey, stripeCustomerId);
    return Promise.resolve({ stripeCustomerId });
  }

  createCheckoutSession(input: CreateCheckoutInput): Promise<{ url: string }> {
    this.assertUp();
    this.calls.push({ op: 'checkout', idempotencyKey: input.idempotencyKey });
    return Promise.resolve({ url: `https://billing.test/checkout/${input.planId}` });
  }

  createPortalSession(input: CreatePortalInput): Promise<{ url: string }> {
    this.assertUp();
    this.calls.push({ op: 'portal', idempotencyKey: input.idempotencyKey });
    return Promise.resolve({ url: 'https://billing.test/portal' });
  }

  listActivePrices(): Promise<CatalogPrice[]> {
    this.assertUp();
    this.calls.push({ op: 'prices', idempotencyKey: 'list' });
    return Promise.resolve(this.prices);
  }

  private assertUp(): void {
    if (this.failWith) throw new Error(this.failWith);
  }
}
