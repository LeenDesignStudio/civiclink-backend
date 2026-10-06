import { builder, rememberScope } from '../../graphql/builder.js';
import { clearResidentAuthCookies } from '../../auth/cookies.js';
import type { MeDto, SubscriptionSummary } from './residents.dto.js';

const SubscriptionSummaryRef = builder.objectRef<SubscriptionSummary>('SubscriptionSummary').implement({
  fields: (t) => ({
    status: t.exposeString('status'),
    planName: t.exposeString('planName', { nullable: true }),
    currentPeriodEnd: t.field({
      type: 'DateTime',
      nullable: true,
      resolve: (row) => row.currentPeriodEnd,
    }),
    cancelAtPeriodEnd: t.exposeBoolean('cancelAtPeriodEnd'),
  }),
});

const MeRef = builder.objectRef<MeDto>('Me').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    displayName: t.exposeString('displayName'),
    email: t.exposeString('email'),
    provider: t.exposeString('provider'),
    status: t.exposeString('status'),
    termsAccepted: t.exposeBoolean('termsAccepted'),
    currentTermsVersion: t.exposeString('currentTermsVersion'),
    currentPrivacyVersion: t.exposeString('currentPrivacyVersion'),
    marketingOptIn: t.exposeBoolean('marketingOptIn'),
    subscription: t.field({
      type: SubscriptionSummaryRef,
      nullable: true,
      resolve: (me) => me.subscription,
    }),
    unreadCount: t.exposeInt('unreadCount'),
    activeSessionCount: t.exposeInt('activeSessionCount'),
  }),
});

const AcceptTermsInput = builder.inputType('AcceptTermsInput', {
  fields: (t) => ({
    termsVersion: t.string({ required: true }),
    privacyVersion: t.string({ required: true }),
    displayName: t.string({ required: true }),
    marketingOptIn: t.boolean({ required: true }),
  }),
});

const UpdateProfileInput = builder.inputType('UpdateProfileInput', {
  fields: (t) => ({
    displayName: t.string({ required: false }),
    marketingOptIn: t.boolean({ required: false }),
  }),
});

const SignOutInput = builder.inputType('SignOutInput', {
  fields: (t) => ({
    everywhere: t.boolean({ required: false }),
  }),
});

const RequestAccountDeletionInput = builder.inputType('RequestAccountDeletionInput', {
  fields: (t) => ({
    reason: t.string({ required: false }),
    reasonText: t.string({ required: false }),
    confirm: t.string({ required: true }),
  }),
});

const MePayload = builder.objectRef<{ me: MeDto }>('MePayload').implement({
  fields: (t) => ({
    me: t.field({ type: MeRef, resolve: (payload) => payload.me }),
  }),
});

const SignOutPayload = builder.objectRef<{ signedOut: boolean }>('SignOutPayload').implement({
  fields: (t) => ({
    signedOut: t.exposeBoolean('signedOut'),
  }),
});

const DeletionPayload = builder
  .objectRef<{ status: string; purgeAfter: Date }>('RequestAccountDeletionPayload')
  .implement({
    fields: (t) => ({
      status: t.exposeString('status'),
      purgeAfter: t.field({ type: 'DateTime', resolve: (row) => row.purgeAfter }),
    }),
  });

const meScopes = { resident: true, permission: 'self.profile:read' as const };
builder.queryField('me', (t) =>
  t.field({
    type: MeRef,
    authScopes: meScopes,
    resolve: (_root, _args, ctx) => ctx.services.residents.me(ctx),
  }),
);
rememberScope('Query', 'me', meScopes);

const acceptScopes = { resident: true, permission: 'self.profile:update' as const };
builder.mutationField('acceptTerms', (t) =>
  t.field({
    type: MePayload,
    authScopes: acceptScopes,
    args: { input: t.arg({ type: AcceptTermsInput, required: true }) },
    resolve: async (_root, args, ctx) => ({ me: await ctx.services.residents.acceptTerms(ctx, args.input) }),
  }),
);
rememberScope('Mutation', 'acceptTerms', acceptScopes);

const updateScopes = { residentActive: true, permission: 'self.profile:update' as const };
builder.mutationField('updateProfile', (t) =>
  t.field({
    type: MePayload,
    authScopes: updateScopes,
    args: { input: t.arg({ type: UpdateProfileInput, required: true }) },
    resolve: async (_root, args, ctx) => ({
      me: await ctx.services.residents.updateProfile(ctx, {
        ...(args.input.displayName != null ? { displayName: args.input.displayName } : {}),
        ...(args.input.marketingOptIn != null ? { marketingOptIn: args.input.marketingOptIn } : {}),
      }),
    }),
  }),
);
rememberScope('Mutation', 'updateProfile', updateScopes);

const signOutScopes = { resident: true, permission: 'self.session:manage' as const };
builder.mutationField('signOut', (t) =>
  t.field({
    type: SignOutPayload,
    authScopes: signOutScopes,
    args: { input: t.arg({ type: SignOutInput, required: false }) },
    resolve: async (_root, args, ctx) => {
      await ctx.services.residents.signOut(ctx, {
        ...(args.input?.everywhere != null ? { everywhere: args.input.everywhere } : {}),
      });
      clearResidentAuthCookies(ctx.reply);
      return { signedOut: true };
    },
  }),
);
rememberScope('Mutation', 'signOut', signOutScopes);

const deleteScopes = { residentActive: true, permission: 'self.account:delete' as const };
builder.mutationField('requestAccountDeletion', (t) =>
  t.field({
    type: DeletionPayload,
    authScopes: deleteScopes,
    args: { input: t.arg({ type: RequestAccountDeletionInput, required: true }) },
    resolve: async (_root, args, ctx) => {
      const result = await ctx.services.residents.requestAccountDeletion(ctx, {
        confirm: args.input.confirm,
        ...(args.input.reason != null ? { reason: args.input.reason } : {}),
        ...(args.input.reasonText != null ? { reasonText: args.input.reasonText } : {}),
      });
      clearResidentAuthCookies(ctx.reply);
      return result;
    },
  }),
);
rememberScope('Mutation', 'requestAccountDeletion', deleteScopes);

const restoreScopes = { resident: true, permission: 'self.account:delete' as const };
builder.mutationField('restoreAccount', (t) =>
  t.field({
    type: MePayload,
    authScopes: restoreScopes,
    resolve: async (_root, _args, ctx) => ({ me: await ctx.services.residents.restoreAccount(ctx) }),
  }),
);
rememberScope('Mutation', 'restoreAccount', restoreScopes);
