import type {
  BillingProvider,
  CreateCheckoutInput,
  CreateCustomerInput,
  CreatePortalInput,
} from '../../src/modules/billing/billing.provider.js';

export class FakeStripe implements BillingProvider {
  failWith: string | null = null;
  readonly calls: { op: string; idempotencyKey: string }[] = [];
  private readonly customers = new Map<string, string>();

  async createCustomer(input: CreateCustomerInput): Promise<{ stripeCustomerId: string }> {
    this.assertUp();
    this.calls.push({ op: 'customer', idempotencyKey: input.idempotencyKey });
    const existing = this.customers.get(input.idempotencyKey);
    if (existing) return { stripeCustomerId: existing };
    const stripeCustomerId = `cus_${input.userId.replace(/-/g, '').slice(0, 12)}`;
    this.customers.set(input.idempotencyKey, stripeCustomerId);
    return { stripeCustomerId };
  }

  async createCheckoutSession(input: CreateCheckoutInput): Promise<{ url: string }> {
    this.assertUp();
    this.calls.push({ op: 'checkout', idempotencyKey: input.idempotencyKey });
    return { url: `https://billing.test/checkout/${input.planId}` };
  }

  async createPortalSession(input: CreatePortalInput): Promise<{ url: string }> {
    this.assertUp();
    this.calls.push({ op: 'portal', idempotencyKey: input.idempotencyKey });
    return { url: 'https://billing.test/portal' };
  }

  private assertUp(): void {
    if (this.failWith) throw new Error(this.failWith);
  }
}
