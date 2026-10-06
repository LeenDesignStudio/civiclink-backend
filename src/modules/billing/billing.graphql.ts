import { builder, rememberScope } from '../../graphql/builder.js';
import type { Connection } from '../../lib/pagination.js';
import type { InvoiceDto, SubscriptionDto, SubscriptionStatus } from './billing.dto.js';
import { BillingService } from './billing.service.js';
import { PageInfoType, withoutNulls } from '../follows/relay.graphql.js';

const billingScope = { residentActive: true, permission: 'self.billing:manage' as const };

const SubscriptionStatusEnum = builder.enumType('SubscriptionStatus', {
  values: [
    'INCOMPLETE',
    'INCOMPLETE_EXPIRED',
    'TRIALING',
    'ACTIVE',
    'PAST_DUE',
    'CANCELED',
    'UNPAID',
    'PAUSED',
  ] as const satisfies readonly SubscriptionStatus[],
});

const InvoiceStatusEnum = builder.enumType('InvoiceStatus', {
  values: ['DRAFT', 'OPEN', 'PAID', 'UNCOLLECTIBLE', 'VOID'] as const,
});

const PlanSummaryType = builder
  .objectRef<NonNullable<SubscriptionDto['plan']>>('PlanSummary')
  .implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      amountCents: t.exposeInt('amountCents'),
      currency: t.exposeString('currency'),
      interval: t.exposeString('interval'),
    }),
  });

const SubscriptionType = builder.objectRef<SubscriptionDto>('Subscription').implement({
  fields: (t) => ({
    status: t.expose('status', { type: SubscriptionStatusEnum }),
    currentPeriodEnd: t.field({
      type: 'DateTime',
      nullable: true,
      resolve: (row) => row.currentPeriodEnd,
    }),
    cancelAtPeriodEnd: t.exposeBoolean('cancelAtPeriodEnd'),
    plan: t.expose('plan', { type: PlanSummaryType, nullable: true }),
  }),
});

const InvoiceType = builder.objectRef<InvoiceDto>('Invoice').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    number: t.exposeString('number', { nullable: true }),
    amountDueCents: t.exposeInt('amountDueCents'),
    amountPaidCents: t.exposeInt('amountPaidCents'),
    currency: t.exposeString('currency'),
    status: t.expose('status', { type: InvoiceStatusEnum }),
    hostedUrl: t.exposeString('hostedUrl', { nullable: true }),
    pdfUrl: t.exposeString('pdfUrl', { nullable: true }),
    issuedAt: t.field({ type: 'DateTime', resolve: (row) => row.issuedAt }),
  }),
});

const InvoiceEdgeType = builder.objectRef<{ cursor: string; node: InvoiceDto }>('InvoiceEdge').implement({
  fields: (t) => ({
    cursor: t.exposeString('cursor'),
    node: t.expose('node', { type: InvoiceType }),
  }),
});

const InvoiceConnectionType = builder.objectRef<Connection<InvoiceDto>>('InvoiceConnection').implement({
  fields: (t) => ({
    edges: t.field({ type: [InvoiceEdgeType], resolve: (row) => row.edges }),
    pageInfo: t.expose('pageInfo', { type: PageInfoType }),
  }),
});

const CheckoutPayload = builder.objectRef<{ url: string }>('CheckoutSessionPayload').implement({
  fields: (t) => ({
    url: t.exposeString('url'),
  }),
});

const PortalPayload = builder.objectRef<{ url: string }>('PortalSessionPayload').implement({
  fields: (t) => ({
    url: t.exposeString('url'),
  }),
});

const CheckoutInput = builder.inputType('CreateCheckoutSessionInput', {
  fields: (t) => ({
    planId: t.field({ type: 'UUID', required: true }),
  }),
});

function billing(ctx: { services: unknown }): BillingService {
  return (ctx.services as { billing: BillingService }).billing;
}

builder.queryField('subscription', (t) =>
  t.field({
    type: SubscriptionType,
    nullable: true,
    authScopes: billingScope,
    resolve: (_root, _args, ctx) => billing(ctx).subscription(ctx),
  }),
);
rememberScope('Query', 'subscription', billingScope);

builder.queryField('invoices', (t) =>
  t.field({
    type: InvoiceConnectionType,
    authScopes: billingScope,
    args: {
      first: t.arg.int({ required: false }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) => billing(ctx).invoices(ctx, withoutNulls(args)),
  }),
);
rememberScope('Query', 'invoices', billingScope);

builder.mutationField('createCheckoutSession', (t) =>
  t.field({
    type: CheckoutPayload,
    authScopes: billingScope,
    args: { input: t.arg({ type: CheckoutInput, required: true }) },
    resolve: (_root, args, ctx) => billing(ctx).createCheckoutSession(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'createCheckoutSession', billingScope);

builder.mutationField('createPortalSession', (t) =>
  t.field({
    type: PortalPayload,
    authScopes: billingScope,
    args: {},
    resolve: (_root, _args, ctx) => billing(ctx).createPortalSession(ctx),
  }),
);
rememberScope('Mutation', 'createPortalSession', billingScope);
