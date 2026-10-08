import Stripe from 'stripe';
import { BillingUnavailableError, isAppError } from '../../lib/errors.js';
import type { BillingProvider, StripeCallOptions, StripeGateway } from './billing.provider.js';

const TIMEOUT_MS = 10_000;

async function settle<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  if (signal.aborted) throw new Error('timeout');
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('timeout'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err instanceof Error ? err : new Error('Stripe request failed'));
      },
    );
  });
}

export class StripeBillingProvider implements BillingProvider {
  constructor(
    private readonly gateway: StripeGateway,
    private readonly signals: () => AbortSignal = () => AbortSignal.timeout(TIMEOUT_MS),
  ) {}

  static fromApiKey(apiKey: string): StripeBillingProvider {
    const stripe = new Stripe(apiKey, { timeout: TIMEOUT_MS, maxNetworkRetries: 2 });
    const gateway: StripeGateway = {
      createCustomer: (params, options) =>
        stripe.customers.create(params, stripeOptions(options)),
      createCheckoutSession: (params, options) =>
        stripe.checkout.sessions.create(params, stripeOptions(options)),
      createPortalSession: (params, options) =>
        stripe.billingPortal.sessions.create(params, stripeOptions(options)),
    };
    return new StripeBillingProvider(gateway);
  }

  createCustomer(input: { userId: string; email: string; idempotencyKey: string }): Promise<{ stripeCustomerId: string }> {
    return this.invoke(
      (options) =>
        this.gateway.createCustomer({ email: input.email, metadata: { userId: input.userId } }, options),
      input.idempotencyKey,
    ).then((customer) => ({ stripeCustomerId: customer.id }));
  }

  async createCheckoutSession(input: {
    stripeCustomerId: string;
    stripePriceId: string;
    userId: string;
    planId: string;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<{ url: string }> {
    const session = await this.invoke(
      (options) =>
        this.gateway.createCheckoutSession(
          {
            mode: 'subscription',
            customer: input.stripeCustomerId,
            client_reference_id: input.userId,
            line_items: [{ price: input.stripePriceId, quantity: 1 }],
            success_url: input.successUrl,
            cancel_url: input.cancelUrl,
            metadata: { userId: input.userId, planId: input.planId },
          },
          options,
        ),
      input.idempotencyKey,
    );
    if (!session.url) throw new BillingUnavailableError();
    return { url: session.url };
  }

  async createPortalSession(input: {
    stripeCustomerId: string;
    returnUrl: string;
    idempotencyKey: string;
  }): Promise<{ url: string }> {
    const session = await this.invoke(
      (options) =>
        this.gateway.createPortalSession(
          { customer: input.stripeCustomerId, return_url: input.returnUrl },
          options,
        ),
      input.idempotencyKey,
    );
    if (!session.url) throw new BillingUnavailableError();
    return { url: session.url };
  }

  private async invoke<T>(fn: (options: StripeCallOptions) => Promise<T>, idempotencyKey: string): Promise<T> {
    const signal = this.signals();
    const options: StripeCallOptions = { timeout: TIMEOUT_MS, signal, idempotencyKey };
    try {
      return await settle(signal, fn(options));
    } catch (err) {
      if (isAppError(err)) throw err;
      throw new BillingUnavailableError({ cause: err });
    }
  }
}

function stripeOptions(options: StripeCallOptions): { timeout: number; idempotencyKey?: string } {
  const base: { timeout: number; idempotencyKey?: string } = { timeout: options.timeout };
  if (options.idempotencyKey) base.idempotencyKey = options.idempotencyKey;
  return base;
}
