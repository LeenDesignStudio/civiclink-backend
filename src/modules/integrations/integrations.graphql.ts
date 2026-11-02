import { env } from '../../config/env.js';
import { builder, rememberScope } from '../../graphql/builder.js';
import { withoutNulls } from '../follows/relay.graphql.js';
import type { IntegrationSetting } from './integrations.service.js';

const manageScope = { permission: 'admin.users:manage' as const };
const publicScope = { public: true };

const IntegrationSettingRef = builder.objectRef<IntegrationSetting>('IntegrationSetting').implement({
  fields: (t) => ({
    key: t.exposeString('key'),
    label: t.exposeString('label'),
    group: t.exposeString('group'),
    secret: t.exposeBoolean('secret'),
    multiline: t.exposeBoolean('multiline'),
    value: t.exposeString('value'),
  }),
});

const IntegrationSettingInput = builder.inputType('IntegrationSettingInput', {
  fields: (t) => ({
    key: t.string({ required: true }),
    value: t.string({ required: true }),
  }),
});

const SiteConfigRef = builder
  .objectRef<{ turnstileSiteKey: string | null; vapidPublicKey: string | null }>('SiteConfig')
  .implement({
    fields: (t) => ({
      turnstileSiteKey: t.exposeString('turnstileSiteKey', { nullable: true }),
      vapidPublicKey: t.exposeString('vapidPublicKey', { nullable: true }),
    }),
  });

builder.queryField('integrationSettings', (t) =>
  t.field({
    type: [IntegrationSettingRef],
    authScopes: manageScope,
    resolve: (_root, _args, ctx) => ctx.services.integrations.list(ctx),
  }),
);
rememberScope('Query', 'integrationSettings', manageScope);

builder.queryField('siteConfig', (t) =>
  t.field({
    type: SiteConfigRef,
    authScopes: publicScope,
    resolve: () => ({
      turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null,
      vapidPublicKey: env.VAPID_PUBLIC_KEY ?? null,
    }),
  }),
);
rememberScope('Query', 'siteConfig', publicScope);

builder.mutationField('updateIntegrationSettings', (t) =>
  t.field({
    type: [IntegrationSettingRef],
    authScopes: manageScope,
    args: {
      settings: t.arg({ type: [IntegrationSettingInput], required: true }),
    },
    resolve: (_root, args, ctx) => ctx.services.integrations.update(ctx, { settings: withoutNulls(args.settings) }),
  }),
);
rememberScope('Mutation', 'updateIntegrationSettings', manageScope);
