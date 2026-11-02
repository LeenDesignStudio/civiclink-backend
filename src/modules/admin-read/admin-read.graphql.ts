import { builder, rememberScope } from '../../graphql/builder.js';
import { PageInfoRef } from '../audit/audit.graphql.js';
import { FreshnessEnum } from '../civic/civic.graphql.js';
import { ACTIVITY_KINDS } from './activity.js';
import type { AdminReadService, AttentionItem, DashboardView, PilotCoverageRow, RecentEdit, SearchView } from './admin-read.service.js';
import type { ActivityRow, SearchGroup } from './admin-read.store.js';

const readScope = { permission: 'admin.dashboard:read' as const };

const AttentionKind = builder.enumType('AdminAttentionKind', {
  values: ['CORRECTION', 'RECORD', 'SOURCE', 'ALERT'] as const,
});
const BoundaryStatus = builder.enumType('AdminBoundaryStatus', {
  values: ['OK', 'MISSING'] as const,
});
const ActivityKind = builder.enumType('AdminActivityKind', {
  values: ACTIVITY_KINDS,
});

function readService(ctx: { services: { adminRead: AdminReadService } }): AdminReadService {
  return ctx.services.adminRead;
}

const AttentionRef = builder.objectRef<AttentionItem>('AdminAttentionItem').implement({
  fields: (t) => ({
    kind: t.field({ type: AttentionKind, resolve: (row) => row.kind }),
    id: t.exposeID('id'),
    label: t.exposeString('label'),
    reason: t.exposeString('reason'),
    ageDays: t.exposeInt('ageDays'),
  }),
});

const RecentRef = builder.objectRef<RecentEdit>('AdminRecentEdit').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    entityType: t.exposeString('entityType'),
    entityId: t.exposeID('entityId'),
    label: t.exposeString('label'),
    typeLabel: t.exposeString('typeLabel'),
    actionLabel: t.exposeString('actionLabel'),
    actorName: t.exposeString('actorName', { nullable: true }),
    createdAt: t.field({ type: 'DateTime', resolve: (row) => row.createdAt }),
  }),
});

const PilotRowRef = builder.objectRef<PilotCoverageRow>('AdminPilotRow').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    displayId: t.exposeString('displayId'),
    boundary: t.field({ type: BoundaryStatus, resolve: (row) => row.boundary }),
    officeCount: t.exposeInt('officeCount'),
    freshness: t.field({ type: FreshnessEnum, resolve: (row) => row.freshness }),
  }),
});

const PilotRef = builder.objectRef<DashboardView['pilotCoverage']>('AdminPilotCoverage').implement({
  fields: (t) => ({
    summary: t.exposeString('summary'),
    covered: t.exposeInt('covered'),
    total: t.exposeInt('total'),
    rows: t.field({ type: [PilotRowRef], resolve: (row) => row.rows }),
  }),
});

const DashboardRef = builder.objectRef<DashboardView>('AdminDashboard').implement({
  fields: (t) => ({
    pendingCorrections: t.exposeInt('pendingCorrections'),
    oldestPendingDays: t.exposeInt('oldestPendingDays', { nullable: true }),
    outdatedRecords: t.exposeInt('outdatedRecords'),
    sourceIssues: t.exposeInt('sourceIssues'),
    alertsNeedingAttention: t.exposeInt('alertsNeedingAttention'),
    officials: t.exposeInt('officials'),
    offices: t.exposeInt('offices'),
    jurisdictions: t.exposeInt('jurisdictions'),
    services: t.exposeInt('services'),
    needsAttention: t.field({ type: [AttentionRef], resolve: (row) => row.needsAttention }),
    recentlyEdited: t.field({ type: [RecentRef], resolve: (row) => row.recentlyEdited }),
    pilotCoverage: t.field({ type: PilotRef, resolve: (row) => row.pilotCoverage }),
  }),
});

const SearchHitRef = builder.objectRef<SearchGroup['items'][number]>('AdminSearchHit').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    label: t.exposeString('label'),
    displayId: t.exposeString('displayId', { nullable: true }),
  }),
});

const SearchGroupRef = builder.objectRef<SearchGroup>('AdminSearchGroup').implement({
  fields: (t) => ({
    total: t.exposeInt('total'),
    items: t.field({ type: [SearchHitRef], resolve: (row) => row.items }),
  }),
});

const SearchRef = builder.objectRef<SearchView>('AdminSearch').implement({
  fields: (t) => ({
    offices: t.field({ type: SearchGroupRef, resolve: (row) => row.offices }),
    officials: t.field({ type: SearchGroupRef, resolve: (row) => row.officials }),
    jurisdictions: t.field({ type: SearchGroupRef, resolve: (row) => row.jurisdictions }),
    services: t.field({ type: SearchGroupRef, resolve: (row) => row.services }),
    sources: t.field({ type: SearchGroupRef, resolve: (row) => row.sources }),
    corrections: t.field({ type: SearchGroupRef, resolve: (row) => row.corrections }),
  }),
});

const ActivityRef = builder.objectRef<ActivityRow>('AdminActivity').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    kind: t.field({ type: ActivityKind, resolve: (row) => row.kind }),
    title: t.exposeString('title'),
    preview: t.exposeString('preview'),
    entityType: t.exposeString('entityType'),
    entityId: t.exposeID('entityId'),
    unread: t.exposeBoolean('unread'),
    createdAt: t.field({ type: 'DateTime', resolve: (row) => row.createdAt }),
  }),
});

const ActivityEdgeRef = builder.objectRef<{ cursor: string; node: ActivityRow }>('AdminActivityEdge').implement({
  fields: (t) => ({
    cursor: t.exposeString('cursor'),
    node: t.field({ type: ActivityRef, resolve: (edge) => edge.node }),
  }),
});

const ActivityConnectionRef = builder
  .objectRef<{ edges: { cursor: string; node: ActivityRow }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null }; totalCount: number }>('AdminActivityConnection')
  .implement({
    fields: (t) => ({
      edges: t.field({ type: [ActivityEdgeRef], resolve: (page) => page.edges }),
      pageInfo: t.field({ type: PageInfoRef, resolve: (page) => page.pageInfo }),
      totalCount: t.exposeInt('totalCount'),
    }),
  });

const MarkInput = builder.inputType('MarkAdminActivityReadInput', {
  fields: (t) => ({
    ids: t.field({ type: ['UUID'], required: false }),
    all: t.boolean({ required: false }),
  }),
});

const MarkPayload = builder.objectRef<{ updated: number }>('MarkAdminActivityReadPayload').implement({
  fields: (t) => ({
    updated: t.exposeInt('updated'),
  }),
});

builder.queryField('adminDashboard', (t) =>
  t.field({
    type: DashboardRef,
    authScopes: readScope,
    resolve: (_root, _args, ctx) => readService(ctx).dashboard(ctx),
  }),
);
rememberScope('Query', 'adminDashboard', readScope);

builder.queryField('adminSearch', (t) =>
  t.field({
    type: SearchRef,
    authScopes: readScope,
    args: { q: t.arg.string({ required: true }) },
    resolve: (_root, args, ctx) => readService(ctx).search(ctx, { q: args.q }),
  }),
);
rememberScope('Query', 'adminSearch', readScope);

builder.queryField('adminActivity', (t) =>
  t.field({
    type: ActivityConnectionRef,
    authScopes: readScope,
    args: {
      first: t.arg.int({ required: false }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) => readService(ctx).activity(ctx, { first: args.first, after: args.after }),
  }),
);
rememberScope('Query', 'adminActivity', readScope);

builder.queryField('adminUnreadActivityCount', (t) =>
  t.int({
    authScopes: readScope,
    resolve: (_root, _args, ctx) => readService(ctx).unreadCount(ctx),
  }),
);
rememberScope('Query', 'adminUnreadActivityCount', readScope);

builder.mutationField('markAdminActivityRead', (t) =>
  t.field({
    type: MarkPayload,
    authScopes: readScope,
    args: { input: t.arg({ type: MarkInput, required: true }) },
    resolve: (_root, args, ctx) =>
      readService(ctx).markRead(ctx, {
        ...(args.input.ids != null ? { ids: args.input.ids } : {}),
        ...(args.input.all != null ? { all: args.input.all } : {}),
      }),
  }),
);
rememberScope('Mutation', 'markAdminActivityRead', readScope);
