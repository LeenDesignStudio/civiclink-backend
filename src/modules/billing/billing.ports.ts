import type { PlanLimits } from './entitlements.service.js';
import type { InvoiceDto, SubscriptionStatus } from './billing.dto.js';

export interface PlanRecord {
  id: string;
  stripePriceId: string;
  name: string;
  amountCents: number;
  currency: string;
  interval: string;
  active: boolean;
  entitlements: Partial<PlanLimits>;
}

export interface SubscriptionRecord {
  id: string;
  userId: string;
  stripeSubscriptionId: string;
  planId: string | null;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  lastEventAt: Date;
}

export interface StripeCustomerRecord {
  userId: string;
  stripeCustomerId: string;
}

export interface UpsertSubscription {
  userId: string;
  stripeSubscriptionId: string;
  planId: string | null;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  lastEventAt: Date;
}

export interface UpsertInvoice {
  stripeInvoiceId: string;
  stripeCustomerId: string;
  number: string | null;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  status: InvoiceDto['status'];
  hostedUrl: string | null;
  pdfUrl: string | null;
  issuedAt: Date;
}

export interface BillingRepo {
  findUser(userId: string): Promise<{ id: string; email: string } | null>;
  findActivePlan(planId: string): Promise<PlanRecord | null>;
  findPlan(planId: string): Promise<PlanRecord | null>;
  findPlanByPrice(stripePriceId: string): Promise<PlanRecord | null>;
  entitlementsFor(userId: string): Promise<Partial<PlanLimits> | null>;
  findCustomer(userId: string): Promise<StripeCustomerRecord | null>;
  findCustomerByStripeId(stripeCustomerId: string): Promise<StripeCustomerRecord | null>;
  saveCustomer(userId: string, stripeCustomerId: string): Promise<void>;
  findBlockingSubscription(userId: string): Promise<SubscriptionRecord | null>;
  findLatestSubscription(userId: string): Promise<SubscriptionRecord | null>;
  findSubscriptionByStripeId(stripeSubscriptionId: string): Promise<SubscriptionRecord | null>;
  upsertSubscription(row: UpsertSubscription): Promise<SubscriptionRecord>;
  listInvoices(
    stripeCustomerId: string,
    page: { limit: number; after?: { issuedAt: Date; id: string } },
  ): Promise<InvoiceDto[]>;
  upsertInvoice(row: UpsertInvoice): Promise<InvoiceDto>;
  insertEvent(id: string, type: string): Promise<'inserted' | 'duplicate'>;
  markEventProcessed(id: string): Promise<void>;
}
