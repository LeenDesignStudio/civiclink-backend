import { builder, rememberScope } from '../../graphql/builder.js';
import { ValidationError } from '../../lib/errors.js';
import type { Connection } from '../../lib/pagination.js';
import { GovLevelEnum, PageInfoType, withoutNulls } from '../follows/relay.graphql.js';
import type { DashboardCounts } from './dashboard.js';
import { ExportService } from './export.js';
import { SourcesService } from './sources.service.js';
import type { PendingRow, RunRow, SourceRow } from '../pipeline/records.js';

const readScope = { permission: 'admin.civic:read' as const };
const writeScope = { permission: 'admin.source:write' as const };
const runScope = { permission: 'admin.source:run' as const };
const decideScope = { permission: 'admin.source:decide' as const };
const dashboardScope = { permission: 'admin.dashboard:read' as const };
const exportScope = { permission: 'admin.export:csv' as const };

const SourceMethodEnum = builder.enumType('SourceMethod', {
  values: ['API', 'BULK', 'PAGE_COLLECTION', 'MANUAL'] as const,
});
const SourceScheduleEnum = builder.enumType('SourceSchedule', {
  values: ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ON_DEMAND'] as const,
});
const RunStatusEnum = builder.enumType('RunStatus', {
  values: ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const,
});
const ChangeDecisionEnum = builder.enumType('ChangeDecision', {
  values: ['PENDING', 'ACCEPTED', 'REJECTED'] as const,
});
const ExportListEnum = builder.enumType('ExportList', {
  values: ['JURISDICTIONS', 'OFFICES', 'OFFICIALS', 'SERVICES', 'SOURCES', 'CORRECTIONS', 'ALERTS'] as const,
});

const SourceType = builder.objectRef<SourceRow>('Source').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    publisher: t.exposeString('publisher'),
    url: t.exposeString('url'),
    termsUrl: t.exposeString('termsUrl'),
    method: t.field({ type: SourceMethodEnum, resolve: (row) => row.method }),
    schedule: t.field({ type: SourceScheduleEnum, resolve: (row) => row.schedule }),
    freshnessDays: t.exposeInt('freshnessDays'),
    levels: t.field({ type: [GovLevelEnum], resolve: (row) => row.levels as ('FEDERAL' | 'STATE' | 'COUNTY' | 'MUNICIPAL' | 'EDUCATION' | 'SPECIAL')[] }),
    collectorKey: t.exposeString('collectorKey', { nullable: true }),
    active: t.exposeBoolean('active'),
    lastRunAt: t.field({ type: 'DateTime', nullable: true, resolve: (row) => row.lastRunAt }),
  }),
});

const RunType = builder.objectRef<RunRow>('SourceRun').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    status: t.field({ type: RunStatusEnum, resolve: (row) => row.status }),
    added: t.exposeInt('added'),
    changed: t.exposeInt('changed'),
    pending: t.exposeInt('pending'),
    error: t.exposeString('error', { nullable: true }),
    createdAt: t.field({ type: 'DateTime', resolve: (row) => row.createdAt }),
  }),
});

const SourceDetail = builder.objectRef<{ source: SourceRow; runs: RunRow[] }>('AdminSource').implement({
  fields: (t) => ({
    source: t.field({ type: SourceType, resolve: (row) => row.source }),
    runs: t.field({ type: [RunType], resolve: (row) => row.runs }),
  }),
});

const SourceEdge = builder.objectRef<{ cursor: string; node: SourceRow }>('SourceEdge').implement({
  fields: (t) => ({
    cursor: t.exposeString('cursor'),
    node: t.field({ type: SourceType, resolve: (edge) => edge.node }),
  }),
});

const SourceConnection = builder
  .objectRef<Connection<SourceRow> & { totalCount: number }>('SourceConnection')
  .implement({
    fields: (t) => ({
      edges: t.field({ type: [SourceEdge], resolve: (page) => page.edges }),
      pageInfo: t.field({ type: PageInfoType, resolve: (page) => page.pageInfo }),
      totalCount: t.exposeInt('totalCount'),
    }),
  });

const PendingType = builder.objectRef<PendingRow>('PendingSourceChange').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    entityType: t.exposeString('entityType'),
    entityId: t.exposeID('entityId', { nullable: true }),
    field: t.exposeString('field'),
    oldValue: t.exposeString('oldValue', { nullable: true }),
    newValue: t.exposeString('newValue'),
    decision: t.field({ type: ChangeDecisionEnum, resolve: (row) => row.decision }),
  }),
});

const CountPair = builder.objectRef<{ status: string; count: number }>('StatusCount').implement({
  fields: (t) => ({
    status: t.exposeString('status'),
    count: t.exposeInt('count'),
  }),
});
const LevelCount = builder.objectRef<{ level: string; count: number }>('LevelCount').implement({
  fields: (t) => ({
    level: t.exposeString('level'),
    count: t.exposeInt('count'),
  }),
});
const DashboardType = builder.objectRef<DashboardCounts>('AdminDashboardCounts').implement({
  fields: (t) => ({
    correctionsByStatus: t.field({ type: [CountPair], resolve: (row) => row.correctionsByStatus }),
    correctionsOlderThan5d: t.exposeInt('correctionsOlderThan5d'),
    staleRecordsByLevel: t.field({ type: [LevelCount], resolve: (row) => row.staleRecordsByLevel }),
    failedSourceRuns: t.exposeInt('failedSourceRuns'),
    pendingSourceChanges: t.exposeInt('pendingSourceChanges'),
    alertsLast7d: t.exposeInt('alertsLast7d'),
    alertFailures: t.exposeInt('alertFailures'),
  }),
});

const SourcePayload = builder.objectRef<{ source: SourceRow }>('SourcePayload').implement({
  fields: (t) => ({ source: t.field({ type: SourceType, resolve: (row) => row.source }) }),
});
const RefreshPayload = builder.objectRef<{ run: RunRow }>('TriggerSourceRefreshPayload').implement({
  fields: (t) => ({ run: t.field({ type: RunType, resolve: (row) => row.run }) }),
});
const DecidePayload = builder.objectRef<{ change: PendingRow }>('DecideSourceChangePayload').implement({
  fields: (t) => ({ change: t.field({ type: PendingType, resolve: (row) => row.change }) }),
});
const ExportPayload = builder.objectRef<{ url: string }>('ExportCsvPayload').implement({
  fields: (t) => ({ url: t.exposeString('url') }),
});

const UpsertInput = builder.inputType('UpsertSourceInput', {
  fields: (t) => ({
    id: t.field({ type: 'UUID', required: false }),
    name: t.string({ required: true }),
    publisher: t.string({ required: true }),
    url: t.string({ required: true }),
    termsUrl: t.string({ required: true }),
    method: t.field({ type: SourceMethodEnum, required: true }),
    schedule: t.field({ type: SourceScheduleEnum, required: true }),
    freshnessDays: t.int({ required: true }),
    levels: t.field({ type: [GovLevelEnum], required: true }),
    collectorKey: t.string({ required: false }),
    active: t.boolean({ required: true }),
  }),
});
const RefreshInput = builder.inputType('TriggerSourceRefreshInput', {
  fields: (t) => ({ sourceId: t.field({ type: 'UUID', required: true }) }),
});
const DecideInput = builder.inputType('DecideSourceChangeInput', {
  fields: (t) => ({
    id: t.field({ type: 'UUID', required: true }),
    decision: t.field({ type: ChangeDecisionEnum, required: true }),
  }),
});
const ExportInput = builder.inputType('ExportCsvInput', {
  fields: (t) => ({
    list: t.field({ type: ExportListEnum, required: true }),
    filter: t.string({ required: false }),
  }),
});

function sources(ctx: { services: unknown }): SourcesService {
  return (ctx.services as { sources: SourcesService }).sources;
}

function apiBase(request: {
  protocol: string;
  hostname: string;
  headers: {
    'x-forwarded-proto'?: string | string[];
    'x-forwarded-host'?: string | string[];
    host?: string | string[] | undefined;
  };
}): string {
  const forwardedProto = request.headers['x-forwarded-proto'];
  const forwardedHost = request.headers['x-forwarded-host'] ?? request.headers.host;
  const proto = firstHeader(forwardedProto) ?? request.protocol;
  const host = firstHeader(forwardedHost) ?? request.hostname;
  return `${proto}://${host}`;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  if (!value) return undefined;
  const first = value.split(',')[0]?.trim();
  return first && first.length > 0 ? first : undefined;
}

function exportsOf(ctx: { services: unknown }): ExportService {
  return (ctx.services as { exports: ExportService }).exports;
}

builder.queryField('adminSources', (t) =>
  t.field({
    type: SourceConnection,
    authScopes: readScope,
    args: { first: t.arg.int({ required: false }), after: t.arg.string({ required: false }) },
    resolve: (_root, args, ctx) => sources(ctx).adminSources(ctx, withoutNulls(args)),
  }),
);
rememberScope('Query', 'adminSources', readScope);

builder.queryField('adminSource', (t) =>
  t.field({
    type: SourceDetail,
    authScopes: readScope,
    args: { id: t.arg({ type: 'UUID', required: true }) },
    resolve: (_root, args, ctx) => sources(ctx).adminSource(ctx, { sourceId: args.id }),
  }),
);
rememberScope('Query', 'adminSource', readScope);

builder.queryField('pendingSourceChanges', (t) =>
  t.field({
    type: [PendingType],
    authScopes: readScope,
    args: {
      sourceId: t.arg({ type: 'UUID', required: false }),
      decision: t.arg({ type: ChangeDecisionEnum, required: false }),
      first: t.arg.int({ required: false }),
    },
    resolve: (_root, args, ctx) => sources(ctx).pendingSourceChanges(ctx, withoutNulls(args)),
  }),
);
rememberScope('Query', 'pendingSourceChanges', readScope);

builder.queryField('adminDashboardCounts', (t) =>
  t.field({
    type: DashboardType,
    authScopes: dashboardScope,
    resolve: (_root, _args, ctx) => sources(ctx).adminDashboardCounts(ctx),
  }),
);
rememberScope('Query', 'adminDashboardCounts', dashboardScope);

builder.mutationField('upsertSource', (t) =>
  t.field({
    type: SourcePayload,
    authScopes: writeScope,
    args: { input: t.arg({ type: UpsertInput, required: true }) },
    resolve: (_root, args, ctx) => sources(ctx).upsertSource(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'upsertSource', writeScope);

builder.mutationField('triggerSourceRefresh', (t) =>
  t.field({
    type: RefreshPayload,
    authScopes: runScope,
    args: { input: t.arg({ type: RefreshInput, required: true }) },
    resolve: (_root, args, ctx) => sources(ctx).triggerSourceRefresh(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'triggerSourceRefresh', runScope);

builder.mutationField('decideSourceChange', (t) =>
  t.field({
    type: DecidePayload,
    authScopes: decideScope,
    args: { input: t.arg({ type: DecideInput, required: true }) },
    resolve: (_root, args, ctx) => sources(ctx).decideSourceChange(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'decideSourceChange', decideScope);

builder.mutationField('exportCsv', (t) =>
  t.field({
    type: ExportPayload,
    authScopes: exportScope,
    args: { input: t.arg({ type: ExportInput, required: true }) },
    resolve: (_root, args, ctx) => {
      const input = withoutNulls(args.input) as { list: string; filter?: string };
      let filter: Record<string, string> | undefined;
      if (input.filter) {
        try {
          const parsed: unknown = JSON.parse(input.filter);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            filter = Object.fromEntries(
              Object.entries(parsed).flatMap(([key, value]) => (typeof value === 'string' ? [[key, value]] : [])),
            );
          }
        } catch {
          throw new ValidationError('Filter must be JSON.');
        }
      }
      const body = filter ? { list: input.list, filter } : { list: input.list };
      return exportsOf(ctx).exportCsv(ctx, body, apiBase(ctx.reply.request));
    },
  }),
);
rememberScope('Mutation', 'exportCsv', exportScope);
