import { builder, rememberScope } from '../../graphql/builder.js';
import type { PageInfo } from '../../lib/pagination.js';
import type { ChangeLogDto, ChangeLogPage } from './audit.dto.js';

export const PageInfoRef = builder.objectRef<PageInfo>('PageInfo').implement({
  fields: (t) => ({
    hasNextPage: t.exposeBoolean('hasNextPage'),
    endCursor: t.exposeString('endCursor', { nullable: true }),
  }),
});

const ChangeLogEntryRef = builder.objectRef<ChangeLogDto>('ChangeLogEntry').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    actorType: t.exposeString('actorType'),
    actorId: t.exposeID('actorId', { nullable: true }),
    entityType: t.exposeString('entityType'),
    entityId: t.exposeID('entityId'),
    action: t.exposeString('action'),
    before: t.string({
      nullable: true,
      resolve: (row) => (row.before ? JSON.stringify(row.before) : null),
    }),
    after: t.string({
      nullable: true,
      resolve: (row) => (row.after ? JSON.stringify(row.after) : null),
    }),
    requestId: t.exposeString('requestId', { nullable: true }),
    createdAt: t.field({ type: 'DateTime', resolve: (row) => row.createdAt }),
  }),
});

const ChangeLogEdgeRef = builder
  .objectRef<ChangeLogPage['edges'][number]>('ChangeLogEdge')
  .implement({
    fields: (t) => ({
      cursor: t.exposeString('cursor'),
      node: t.field({ type: ChangeLogEntryRef, resolve: (edge) => edge.node }),
    }),
  });

const ChangeLogConnectionRef = builder.objectRef<ChangeLogPage>('ChangeLogConnection').implement({
  fields: (t) => ({
    edges: t.field({ type: [ChangeLogEdgeRef], resolve: (page) => page.edges }),
    pageInfo: t.field({ type: PageInfoRef, resolve: (page) => page.pageInfo }),
    totalCount: t.int({ resolve: (page) => page.totalCount }),
  }),
});

const changeLogScopes = { permission: 'admin.changelog:read' as const };

builder.queryField('changeLog', (t) =>
  t.field({
    type: ChangeLogConnectionRef,
    authScopes: changeLogScopes,
    args: {
      entityType: t.arg.string({ required: true }),
      entityId: t.arg({ type: 'UUID', required: true }),
      first: t.arg.int({ required: false }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.audit.list(ctx, {
        entityType: args.entityType,
        entityId: args.entityId,
        first: args.first,
        after: args.after,
      }),
  }),
);

rememberScope('Query', 'changeLog', changeLogScopes);
