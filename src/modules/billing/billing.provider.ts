export interface CreateCustomerInput {
  userId: string;
  email: string;
  idempotencyKey: string;
}

export interface CreateCheckoutInput {
  stripeCustomerId: string;
  stripePriceId: string;
  userId: string;
  planId: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}

export interface CreatePortalInput {
  stripeCustomerId: string;
  returnUrl: string;
  idempotencyKey: string;
}

export interface BillingProvider {
  createCustomer(input: CreateCustomerInput): Promise<{ stripeCustomerId: string }>;
  createCheckoutSession(input: CreateCheckoutInput): Promise<{ url: string }>;
  createPortalSession(input: CreatePortalInput): Promise<{ url: string }>;
}

export interface StripeCallOptions {
  idempotencyKey?: string;
  timeout: number;
  signal: AbortSignal;
}

export interface StripeGateway {
  createCustomer(
    params: { email: string; metadata: { userId: string } },
    options: StripeCallOptions,
  ): Promise<{ id: string }>;
  createCheckoutSession(
    params: {
      mode: 'subscription';
      customer: string;
      client_reference_id: string;
      line_items: { price: string; quantity: number }[];
      success_url: string;
      cancel_url: string;
      metadata: { userId: string; planId: string };
    },
    options: StripeCallOptions,
  ): Promise<{ url: string | null }>;
  createPortalSession(
    params: { customer: string; return_url: string },
    options: StripeCallOptions,
  ): Promise<{ url: string }>;
}
