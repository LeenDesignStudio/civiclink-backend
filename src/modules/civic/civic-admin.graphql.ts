import { builder, rememberScope } from '../../graphql/builder.js';
import { withoutNulls } from '../follows/relay.graphql.js';
import { CivicService } from './civic.service.js';
import { FreshnessOverrideEnum, JurisdictionTypeEnum, SelectionMethodEnum, TermStatusEnum } from './civic.graphql.js';
import { GovLevelEnum } from '../follows/relay.graphql.js';

const readScope = { permission: 'admin.civic:read' as const };
const writeScope = { permission: 'admin.civic:write' as const };
const retireScope = { permission: 'admin.civic:retire' as const };

function civic(ctx: { services: unknown }): CivicService {
  return (ctx.services as { civic: CivicService }).civic;
}

const IdStatus = builder.objectRef<{ id: string; status: string }>('RecordStatusPayload');
IdStatus.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    status: t.exposeString('status'),
  }),
});

const JurisdictionAdmin = builder.objectRef<{
  id: string;
  name: string;
  level: 'FEDERAL' | 'STATE' | 'COUNTY' | 'MUNICIPAL' | 'EDUCATION' | 'SPECIAL';
  type: string;
  status: string;
}>('AdminJurisdiction');
JurisdictionAdmin.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    level: t.field({ type: GovLevelEnum, resolve: (row) => row.level }),
    type: t.field({
      type: JurisdictionTypeEnum,
      resolve: (row) => row.type as never,
    }),
    status: t.exposeString('status'),
  }),
});

builder.queryField('adminJurisdiction', (t) =>
  t.field({
    type: JurisdictionAdmin,
    authScopes: readScope,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_root, args, ctx) => civic(ctx).adminJurisdiction(ctx, String(args.id)),
  }),
);
rememberScope('Query', 'adminJurisdiction', readScope);

builder.mutationField('upsertJurisdiction', (t) =>
  t.field({
    type: JurisdictionAdmin,
    authScopes: writeScope,
    args: {
      input: t.arg({
        type: builder.inputType('UpsertJurisdictionInput', {
          fields: (i) => ({
            id: i.id({ required: false }),
            name: i.string({ required: true }),
            level: i.field({ type: GovLevelEnum, required: true }),
            type: i.field({ type: JurisdictionTypeEnum, required: true }),
            subtype: i.string({ required: false }),
            parentId: i.id({ required: false }),
            districtCode: i.string({ required: false }),
            geoid: i.string({ required: false }),
            state: i.string({ required: false }),
            website: i.string({ required: false }),
            sourceId: i.id({ required: true }),
            sourceRecordUrl: i.string({ required: false }),
            lastUpdatedAt: i.field({ type: 'DateTime', required: true }),
            freshnessOverride: i.field({ type: FreshnessOverrideEnum, required: false }),
            freshnessNote: i.string({ required: false }),
          }),
        }),
        required: true,
      }),
    },
    resolve: (_root, args, ctx) => civic(ctx).upsertJurisdiction(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'upsertJurisdiction', writeScope);

function idMutation(name: 'retireJurisdiction' | 'restoreJurisdiction' | 'retireOffice' | 'restoreOffice' | 'retireOfficial' | 'restoreOfficial' | 'retireService' | 'restoreService', scope: typeof retireScope) {
  builder.mutationField(name, (t) =>
    t.field({
      type: IdStatus,
      authScopes: scope,
      args: { id: t.arg.id({ required: true }), retireActiveOffices: t.arg.boolean({ required: false }) },
      resolve: async (_root, args, ctx) => {
        const service = civic(ctx);
        const input = withoutNulls(args);
        switch (name) {
          case 'retireJurisdiction':
            return service.retireJurisdiction(ctx, input);
          case 'restoreJurisdiction':
            return service.restoreJurisdiction(ctx, input);
          case 'retireOffice':
            return service.retireOffice(ctx, input);
          case 'restoreOffice':
            return service.restoreOffice(ctx, input);
          case 'retireOfficial':
            return service.retireOfficial(ctx, input);
          case 'restoreOfficial':
            return service.restoreOfficial(ctx, input);
          case 'retireService':
            return service.retireService(ctx, input);
          case 'restoreService':
            return service.restoreService(ctx, input);
          default:
            return service.retireOffice(ctx, input);
        }
      },
    }),
  );
  rememberScope('Mutation', name, scope);
}

idMutation('retireJurisdiction', retireScope);
idMutation('restoreJurisdiction', retireScope);
idMutation('retireOffice', retireScope);
idMutation('restoreOffice', retireScope);
idMutation('retireOfficial', retireScope);
idMutation('restoreOfficial', retireScope);
idMutation('retireService', retireScope);
idMutation('restoreService', retireScope);

builder.mutationField('upsertOffice', (t) =>
  t.field({
    type: 'ID',
    authScopes: writeScope,
    args: {
      input: t.arg({
        type: builder.inputType('UpsertOfficeInput', {
          fields: (i) => ({
            id: i.id({ required: false }),
            jurisdictionId: i.id({ required: true }),
            name: i.string({ required: true }),
            seatLabel: i.string({ required: false }),
            selectionMethod: i.field({ type: SelectionMethodEnum, required: true }),
            displayOrder: i.int({ required: false }),
            whyTemplate: i.string({ required: false }),
            phone: i.string({ required: false }),
            email: i.string({ required: false }),
            website: i.string({ required: false }),
            contactUrl: i.string({ required: false }),
            holderUnknown: i.boolean({ required: false }),
            sourceId: i.id({ required: true }),
            sourceRecordUrl: i.string({ required: false }),
            lastUpdatedAt: i.field({ type: 'DateTime', required: true }),
            freshnessNote: i.string({ required: false }),
            notifyFollowers: i.boolean({ required: false }),
          }),
        }),
        required: true,
      }),
    },
    resolve: async (_root, args, ctx) => (await civic(ctx).upsertOffice(ctx, withoutNulls(args.input))).id,
  }),
);
rememberScope('Mutation', 'upsertOffice', writeScope);

builder.mutationField('upsertOfficial', (t) =>
  t.field({
    type: 'ID',
    authScopes: writeScope,
    args: {
      input: t.arg({
        type: builder.inputType('UpsertOfficialInput', {
          fields: (i) => ({
            id: i.id({ required: false }),
            fullName: i.string({ required: true }),
            displayName: i.string({ required: false }),
            party: i.string({ required: false }),
            photoUrl: i.string({ required: false }),
            website: i.string({ required: false }),
            sourceId: i.id({ required: true }),
            sourceRecordUrl: i.string({ required: false }),
            lastUpdatedAt: i.field({ type: 'DateTime', required: true }),
            freshnessNote: i.string({ required: false }),
            notifyFollowers: i.boolean({ required: false }),
          }),
        }),
        required: true,
      }),
    },
    resolve: async (_root, args, ctx) => (await civic(ctx).upsertOfficial(ctx, withoutNulls(args.input))).id,
  }),
);
rememberScope('Mutation', 'upsertOfficial', writeScope);

builder.mutationField('setOfficeTerm', (t) =>
  t.field({
    type: 'ID',
    authScopes: writeScope,
    args: {
      input: t.arg({
        type: builder.inputType('SetOfficeTermInput', {
          fields: (i) => ({
            officeId: i.id({ required: true }),
            officialId: i.id({ required: true }),
            status: i.field({ type: TermStatusEnum, required: true }),
            termStart: i.field({ type: 'DateTime', required: false }),
            termEnd: i.field({ type: 'DateTime', required: false }),
            makeCurrent: i.boolean({ required: true }),
            notifyFollowers: i.boolean({ required: false }),
          }),
        }),
        required: true,
      }),
    },
    resolve: async (_root, args, ctx) => (await civic(ctx).setOfficeTerm(ctx, withoutNulls(args.input))).id,
  }),
);
rememberScope('Mutation', 'setOfficeTerm', writeScope);

builder.mutationField('endOfficeTerm', (t) =>
  t.field({
    type: 'ID',
    authScopes: writeScope,
    args: {
      input: t.arg({
        type: builder.inputType('EndOfficeTermInput', {
          fields: (i) => ({
            termId: i.id({ required: true }),
            termEnd: i.field({ type: 'DateTime', required: false }),
          }),
        }),
        required: true,
      }),
    },
    resolve: async (_root, args, ctx) => (await civic(ctx).endOfficeTerm(ctx, withoutNulls(args.input))).id,
  }),
);
rememberScope('Mutation', 'endOfficeTerm', writeScope);

builder.mutationField('upsertService', (t) =>
  t.field({
    type: 'ID',
    authScopes: writeScope,
    args: {
      input: t.arg({
        type: builder.inputType('UpsertServiceInput', {
          fields: (i) => ({
            id: i.id({ required: false }),
            title: i.string({ required: true }),
            categoryId: i.id({ required: true }),
            description: i.string({ required: true }),
            url: i.string({ required: false }),
            phoneContact: i.string({ required: false }),
            jurisdictionIds: i.stringList({ required: false }),
            officeIds: i.stringList({ required: false }),
            lastValidatedAt: i.field({ type: 'DateTime', required: true }),
            sourceId: i.id({ required: true }),
          }),
        }),
        required: true,
      }),
    },
    resolve: async (_root, args, ctx) => (await civic(ctx).upsertService(ctx, withoutNulls(args.input))).id,
  }),
);
rememberScope('Mutation', 'upsertService', writeScope);

builder.mutationField('upsertServiceCategory', (t) =>
  t.field({
    type: 'ID',
    authScopes: writeScope,
    args: {
      input: t.arg({
        type: builder.inputType('UpsertServiceCategoryInput', {
          fields: (i) => ({
            id: i.id({ required: false }),
            name: i.string({ required: true }),
            sortOrder: i.int({ required: false }),
            active: i.boolean({ required: false }),
          }),
        }),
        required: true,
      }),
    },
    resolve: async (_root, args, ctx) => (await civic(ctx).upsertServiceCategory(ctx, withoutNulls(args.input))).id,
  }),
);
rememberScope('Mutation', 'upsertServiceCategory', writeScope);

builder.queryField('adminOffice', (t) =>
  t.field({
    type: 'ID',
    authScopes: readScope,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_root, args, ctx) => (await civic(ctx).adminOffice(ctx, String(args.id))).id,
  }),
);
rememberScope('Query', 'adminOffice', readScope);

builder.queryField('adminOfficial', (t) =>
  t.field({
    type: 'ID',
    authScopes: readScope,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_root, args, ctx) => (await civic(ctx).adminOfficial(ctx, String(args.id))).id,
  }),
);
rememberScope('Query', 'adminOfficial', readScope);

builder.queryField('adminService', (t) =>
  t.field({
    type: 'ID',
    authScopes: readScope,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_root, args, ctx) => (await civic(ctx).adminService(ctx, String(args.id))).id,
  }),
);
rememberScope('Query', 'adminService', readScope);
