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

export const schema = builder.toSchema();
