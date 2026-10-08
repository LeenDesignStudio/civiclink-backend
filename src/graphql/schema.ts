import { builder, rememberScope } from './builder.js';

import '../modules/follows/relay.graphql.js';
import '../modules/follows/follows.graphql.js';
import '../modules/locations/locations.graphql.js';
import '../modules/civic/civic.graphql.js';
import '../modules/civic/civic-admin.graphql.js';
import '../modules/lookup/lookup.graphql.js';
import '../modules/residents/residents.graphql.js';
import '../modules/admin-users/admin-users.graphql.js';
import '../modules/audit/audit.graphql.js';
import '../modules/billing/billing.graphql.js';
import '../modules/contact/contact.graphql.js';
import '../modules/corrections/corrections.graphql.js';
import '../modules/notifications/notifications.graphql.js';
import '../modules/alerts/alerts.graphql.js';
import '../modules/sources/sources.graphql.js';

const publicScope = { public: true };

builder.queryField('health', (t) =>
  t.string({
    authScopes: publicScope,
    resolve: () => 'ok',
  }),
);
rememberScope('Query', 'health', publicScope);

// Depth-limit tests need a recursive public field. schema:print also sets APP_ENV=test,
// but it does not set VITEST, so this field stays out of schema.graphql.
if (process.env.APP_ENV === 'test' && process.env.VITEST === 'true') {
  const Probe = builder.objectRef<{ value: string }>('Probe');
  Probe.implement({
    fields: (t) => ({
      value: t.exposeString('value'),
      next: t.field({
        type: Probe,
        nullable: true,
        resolve: () => ({ value: 'ok' }),
      }),
    }),
  });
  builder.queryField('probe', (t) =>
    t.field({
      type: Probe,
      authScopes: publicScope,
      resolve: () => ({ value: 'ok' }),
    }),
  );
  rememberScope('Query', 'probe', publicScope);
}

export const schema = builder.toSchema();
