export type SubscriptionStatus =
  | 'INCOMPLETE'
  | 'INCOMPLETE_EXPIRED'
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'UNPAID'
  | 'PAUSED';

export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'UNCOLLECTIBLE' | 'VOID';

export interface SubscriptionDto {
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  plan: {
    id: string;
    name: string;
    amountCents: number;
    currency: string;
    interval: string;
  } | null;
}

export interface InvoiceDto {
  id: string;
  number: string | null;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  status: InvoiceStatus;
  hostedUrl: string | null;
  pdfUrl: string | null;
  issuedAt: Date;
  createdAt: Date;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

export interface ApplyStripeEventResult {
  duplicate: boolean;
  ignored: boolean;
}
