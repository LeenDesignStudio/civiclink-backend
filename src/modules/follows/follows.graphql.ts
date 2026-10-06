import { builder, rememberScope } from '../../graphql/builder.js';
import type { Connection } from '../../lib/pagination.js';
import type { FollowDto, FollowHolder, FollowOffice } from './follows.dto.js';
import { FollowsService } from './follows.service.js';
import { GovLevelEnum, PageInfoType, withoutNulls } from './relay.graphql.js';

const residentScope = { residentActive: true };

const FollowOfficeType = builder.objectRef<FollowOffice>('FollowOffice').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    level: t.expose('level', { type: GovLevelEnum }),
    lastUpdatedAt: t.field({ type: 'DateTime', resolve: (row) => row.lastUpdatedAt }),
  }),
});

const FollowHolderType = builder.objectRef<FollowHolder>('FollowHolder').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    fullName: t.exposeString('fullName'),
    displayName: t.exposeString('displayName', { nullable: true }),
  }),
});

const FollowType = builder.objectRef<FollowDto>('Follow').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    officeId: t.exposeID('officeId'),
    officialId: t.exposeID('officialId', { nullable: true }),
    createdAt: t.field({ type: 'DateTime', resolve: (row) => row.createdAt }),
    office: t.expose('office', { type: FollowOfficeType }),
    holder: t.expose('holder', { type: FollowHolderType, nullable: true }),
  }),
});

const FollowEdgeType = builder.objectRef<{ cursor: string; node: FollowDto }>('FollowEdge').implement({
  fields: (t) => ({
    cursor: t.exposeString('cursor'),
    node: t.expose('node', { type: FollowType }),
  }),
});

const FollowConnectionType = builder.objectRef<Connection<FollowDto>>('FollowConnection').implement({
  fields: (t) => ({
    edges: t.field({ type: [FollowEdgeType], resolve: (row) => row.edges }),
    pageInfo: t.expose('pageInfo', { type: PageInfoType }),
  }),
});

const FollowInput = builder.inputType('FollowInput', {
  fields: (t) => ({
    officeId: t.field({ type: 'UUID', required: true }),
    officialId: t.field({ type: 'UUID', required: false }),
  }),
});

const UnfollowInput = builder.inputType('UnfollowInput', {
  fields: (t) => ({
    officeId: t.field({ type: 'UUID', required: true }),
  }),
});

const FollowPayload = builder.objectRef<{ follow: FollowDto }>('FollowPayload').implement({
  fields: (t) => ({
    follow: t.expose('follow', { type: FollowType }),
  }),
});

const UnfollowPayload = builder.objectRef<{ officeId: string }>('UnfollowPayload').implement({
  fields: (t) => ({
    officeId: t.exposeID('officeId'),
  }),
});

function follows(ctx: { services: unknown }): FollowsService {
  return (ctx.services as { follows: FollowsService }).follows;
}

builder.queryField('follows', (t) =>
  t.field({
    type: FollowConnectionType,
    authScopes: residentScope,
    args: {
      first: t.arg.int({ required: false }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) => follows(ctx).follows(ctx, withoutNulls(args)),
  }),
);
rememberScope('Query', 'follows', residentScope);

builder.mutationField('follow', (t) =>
  t.field({
    type: FollowPayload,
    authScopes: residentScope,
    args: { input: t.arg({ type: FollowInput, required: true }) },
    resolve: (_root, args, ctx) => follows(ctx).follow(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'follow', residentScope);

builder.mutationField('unfollow', (t) =>
  t.field({
    type: UnfollowPayload,
    authScopes: residentScope,
    args: { input: t.arg({ type: UnfollowInput, required: true }) },
    resolve: (_root, args, ctx) => follows(ctx).unfollow(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'unfollow', residentScope);
