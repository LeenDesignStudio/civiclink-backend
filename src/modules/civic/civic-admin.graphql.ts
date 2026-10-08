import { builder, rememberScope } from '../../graphql/builder.js';
import type { Connection } from '../../lib/pagination.js';
import { PageInfoRef } from '../audit/audit.graphql.js';
import { withoutNulls } from '../follows/relay.graphql.js';
import { CivicService } from './civic.service.js';
import type { AdminJurisdictionNode, AdminOfficeRecord, AdminOfficialRecord, AdminOfficialTerm, AdminServiceLink, AdminServiceRecord, JurisdictionRecord, OfficeAddressDto, ServiceCategoryRecord } from './civic.dto.js';
import { FreshnessEnum, FreshnessOverrideEnum, JurisdictionTypeEnum, SelectionMethodEnum, TermStatusEnum } from './civic.graphql.js';
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

type AdminJurisdictionView = JurisdictionRecord & { hasBoundary?: boolean };

const JurisdictionAdmin = builder.objectRef<AdminJurisdictionView>('AdminJurisdiction');
JurisdictionAdmin.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    level: t.field({ type: GovLevelEnum, resolve: (row) => row.level }),
    type: t.field({
      type: JurisdictionTypeEnum,
      resolve: (row) => row.type,
    }),
    status: t.exposeString('status'),
    subtype: t.exposeString('subtype', { nullable: true }),
    parentId: t.exposeID('parentId', { nullable: true }),
    districtCode: t.exposeString('districtCode', { nullable: true }),
    geoid: t.exposeString('geoid', { nullable: true }),
    state: t.exposeString('state', { nullable: true }),
    boundaryVintage: t.exposeString('boundaryVintage', { nullable: true }),
    hasBoundary: t.boolean({ resolve: (row) => row.hasBoundary ?? false }),
    website: t.exposeString('website', { nullable: true }),
    sourceId: t.exposeID('sourceId'),
    sourceRecordUrl: t.exposeString('sourceRecordUrl', { nullable: true }),
    lastUpdatedAt: t.field({ type: 'DateTime', resolve: (row) => row.lastUpdatedAt }),
    freshnessOverride: t.field({ type: FreshnessOverrideEnum, resolve: (row) => row.freshnessOverride }),
    freshnessNote: t.exposeString('freshnessNote', { nullable: true }),
  }),
});

const RecordStatusEnum = builder.enumType('RecordStatus', { values: ['ACTIVE', 'RETIRED'] as const });

const AdminAddress = builder.objectRef<OfficeAddressDto>('AdminOfficeAddress').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    label: t.exposeString('label'),
    street: t.exposeString('street'),
    city: t.exposeString('city'),
    state: t.exposeString('state'),
    zip: t.exposeString('zip'),
    phone: t.exposeString('phone', { nullable: true }),
    hours: t.exposeString('hours', { nullable: true }),
  }),
});

const OfficeAdmin = builder.objectRef<AdminOfficeRecord>('AdminOffice').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    slug: t.exposeString('slug'),
    jurisdictionId: t.exposeID('jurisdictionId'),
    name: t.exposeString('name'),
    seatLabel: t.exposeString('seatLabel', { nullable: true }),
    selectionMethod: t.field({ type: SelectionMethodEnum, resolve: (row) => row.selectionMethod }),
    displayOrder: t.exposeInt('displayOrder'),
    whyTemplate: t.exposeString('whyTemplate', { nullable: true }),
    phone: t.exposeString('phone', { nullable: true }),
    email: t.exposeString('email', { nullable: true }),
    website: t.exposeString('website', { nullable: true }),
    contactUrl: t.exposeString('contactUrl', { nullable: true }),
    holderUnknown: t.exposeBoolean('holderUnknown'),
    sourceId: t.exposeID('sourceId'),
    sourceRecordUrl: t.exposeString('sourceRecordUrl', { nullable: true }),
    lastUpdatedAt: t.field({ type: 'DateTime', resolve: (row) => row.lastUpdatedAt }),
    freshnessOverride: t.field({ type: FreshnessOverrideEnum, resolve: (row) => row.freshnessOverride }),
    freshnessNote: t.exposeString('freshnessNote', { nullable: true }),
    status: t.field({ type: RecordStatusEnum, resolve: (row) => row.status }),
    followerCount: t.exposeInt('followerCount'),
    addresses: t.field({ type: [AdminAddress], resolve: (row) => row.addresses }),
  }),
});

const AdminTermOffice = builder.objectRef<AdminOfficialTerm['office']>('AdminOfficialTermOffice').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    slug: t.exposeString('slug'),
    name: t.exposeString('name'),
    status: t.field({ type: RecordStatusEnum, resolve: (row) => row.status }),
  }),
});

const AdminTerm = builder.objectRef<AdminOfficialTerm>('AdminOfficialTerm').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    officeId: t.exposeID('officeId'),
    status: t.field({ type: TermStatusEnum, resolve: (row) => row.status }),
    termStart: t.field({ type: 'DateTime', nullable: true, resolve: (row) => row.termStart }),
    termEnd: t.field({ type: 'DateTime', nullable: true, resolve: (row) => row.termEnd }),
    isCurrent: t.exposeBoolean('isCurrent'),
    office: t.field({ type: AdminTermOffice, resolve: (row) => row.office }),
  }),
});

const AdminServiceLinkRef = builder.objectRef<AdminServiceLink>('AdminServiceLink').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    jurisdictionId: t.exposeID('jurisdictionId', { nullable: true }),
    officeId: t.exposeID('officeId', { nullable: true }),
  }),
});

const OfficialAdmin = builder.objectRef<AdminOfficialRecord>('AdminOfficial').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    slug: t.exposeString('slug'),
    fullName: t.exposeString('fullName'),
    displayName: t.exposeString('displayName', { nullable: true }),
    party: t.exposeString('party', { nullable: true }),
    photoUrl: t.exposeString('photoUrl', { nullable: true }),
    website: t.exposeString('website', { nullable: true }),
    sourceId: t.exposeID('sourceId'),
    sourceRecordUrl: t.exposeString('sourceRecordUrl', { nullable: true }),
    lastUpdatedAt: t.field({ type: 'DateTime', resolve: (row) => row.lastUpdatedAt }),
    freshnessOverride: t.field({ type: FreshnessOverrideEnum, resolve: (row) => row.freshnessOverride }),
    freshnessNote: t.exposeString('freshnessNote', { nullable: true }),
    status: t.field({ type: RecordStatusEnum, resolve: (row) => row.status }),
    terms: t.field({ type: [AdminTerm], resolve: (row) => row.terms }),
  }),
});

const ServiceAdmin = builder.objectRef<AdminServiceRecord>('AdminService').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    title: t.exposeString('title'),
    categoryId: t.exposeID('categoryId'),
    description: t.exposeString('description'),
    url: t.exposeString('url', { nullable: true }),
    phoneContact: t.exposeString('phoneContact', { nullable: true }),
    lastValidatedAt: t.field({ type: 'DateTime', resolve: (row) => row.lastValidatedAt }),
    sourceId: t.exposeID('sourceId'),
    status: t.field({ type: RecordStatusEnum, resolve: (row) => row.status }),
    links: t.field({ type: [AdminServiceLinkRef], resolve: (row) => row.links }),
    jurisdictionIds: t.field({ type: ['ID'], resolve: (row) => row.jurisdictionIds }),
    officeIds: t.field({ type: ['ID'], resolve: (row) => row.officeIds }),
  }),
});

const CategoryAdmin = builder.objectRef<ServiceCategoryRecord>('AdminServiceCategory').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    sortOrder: t.exposeInt('sortOrder'),
    active: t.exposeBoolean('active'),
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
    type: OfficeAdmin,
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
    resolve: (_root, args, ctx) => civic(ctx).upsertOffice(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'upsertOffice', writeScope);

builder.mutationField('upsertOfficial', (t) =>
  t.field({
    type: OfficialAdmin,
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
    resolve: (_root, args, ctx) => civic(ctx).upsertOfficial(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'upsertOfficial', writeScope);

const TermPayload = builder.objectRef<{ id: string; officeId: string }>('OfficeTermPayload').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    officeId: t.exposeID('officeId'),
  }),
});

builder.mutationField('setOfficeTerm', (t) =>
  t.field({
    type: TermPayload,
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
    resolve: (_root, args, ctx) => civic(ctx).setOfficeTerm(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'setOfficeTerm', writeScope);

builder.mutationField('endOfficeTerm', (t) =>
  t.field({
    type: TermPayload,
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
    resolve: (_root, args, ctx) => civic(ctx).endOfficeTerm(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'endOfficeTerm', writeScope);

builder.mutationField('upsertService', (t) =>
  t.field({
    type: ServiceAdmin,
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
    resolve: (_root, args, ctx) => civic(ctx).upsertService(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'upsertService', writeScope);

builder.mutationField('upsertServiceCategory', (t) =>
  t.field({
    type: CategoryAdmin,
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
    resolve: (_root, args, ctx) => civic(ctx).upsertServiceCategory(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'upsertServiceCategory', writeScope);

builder.queryField('adminOffice', (t) =>
  t.field({
    type: OfficeAdmin,
    authScopes: readScope,
    args: { id: t.arg.id({ required: true }) },
    resolve: (_root, args, ctx) => civic(ctx).adminOffice(ctx, String(args.id)),
  }),
);
rememberScope('Query', 'adminOffice', readScope);

builder.queryField('adminOfficial', (t) =>
  t.field({
    type: OfficialAdmin,
    authScopes: readScope,
    args: { id: t.arg.id({ required: true }) },
    resolve: (_root, args, ctx) => civic(ctx).adminOfficial(ctx, String(args.id)),
  }),
);
rememberScope('Query', 'adminOfficial', readScope);

builder.queryField('adminService', (t) =>
  t.field({
    type: ServiceAdmin,
    authScopes: readScope,
    args: { id: t.arg.id({ required: true }) },
    resolve: (_root, args, ctx) => civic(ctx).adminService(ctx, String(args.id)),
  }),
);
rememberScope('Query', 'adminService', readScope);

function connectionType<T extends { id: string }>(name: string, nodeType: unknown) {
  const edge = builder.objectRef<{ cursor: string; node: T }>(`${name}Edge`).implement({
    fields: (t) => ({
      cursor: t.exposeString('cursor'),
      node: t.field({ type: nodeType as never, resolve: (row) => row.node as never }),
    }),
  });
  return builder.objectRef<Connection<T>>(`${name}Connection`).implement({
    fields: (t) => ({
      edges: t.field({ type: [edge], resolve: (page) => page.edges }),
      pageInfo: t.field({ type: PageInfoRef, resolve: (page) => page.pageInfo }),
      totalCount: t.int({ resolve: (page) => page.totalCount ?? 0 }),
    }),
  });
}

const AdminCivicSort = builder.enumType('AdminCivicSort', { values: ['NEWEST', 'NAME'] as const });

const JurisdictionFilter = builder.inputType('AdminJurisdictionFilter', {
  fields: (t) => ({
    level: t.field({ type: GovLevelEnum, required: false }),
    type: t.field({ type: JurisdictionTypeEnum, required: false }),
    state: t.string({ required: false }),
    status: t.field({ type: RecordStatusEnum, required: false }),
    freshness: t.field({ type: FreshnessEnum, required: false }),
    q: t.string({ required: false }),
  }),
});

const OfficeFilter = builder.inputType('AdminOfficeFilter', {
  fields: (t) => ({
    level: t.field({ type: GovLevelEnum, required: false }),
    jurisdictionId: t.id({ required: false }),
    vacantOnly: t.boolean({ required: false }),
    staleOnly: t.boolean({ required: false }),
    status: t.field({ type: RecordStatusEnum, required: false }),
    q: t.string({ required: false }),
  }),
});

const OfficialFilter = builder.inputType('AdminOfficialFilter', {
  fields: (t) => ({
    status: t.field({ type: RecordStatusEnum, required: false }),
    officeId: t.id({ required: false }),
    q: t.string({ required: false }),
  }),
});

const ServiceFilter = builder.inputType('AdminServiceFilter', {
  fields: (t) => ({
    categoryId: t.id({ required: false }),
    status: t.field({ type: RecordStatusEnum, required: false }),
    linkBroken: t.boolean({ required: false }),
    q: t.string({ required: false }),
  }),
});

const JurisdictionConnection = connectionType<AdminJurisdictionNode>('AdminJurisdiction', JurisdictionAdmin);
const OfficeConnection = connectionType<AdminOfficeRecord & { createdAt: Date }>('AdminOffice', OfficeAdmin);
const OfficialConnection = connectionType<AdminOfficialRecord & { createdAt: Date }>('AdminOfficial', OfficialAdmin);
const ServiceConnection = connectionType<AdminServiceRecord & { createdAt: Date }>('AdminService', ServiceAdmin);

builder.queryField('adminJurisdictions', (t) =>
  t.field({
    type: JurisdictionConnection,
    authScopes: readScope,
    args: {
      filter: t.arg({ type: JurisdictionFilter, required: false }),
      sort: t.arg({ type: AdminCivicSort, required: false }),
      first: t.arg.int({ required: false }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) => civic(ctx).adminJurisdictions(ctx, withoutNulls(args)),
  }),
);
rememberScope('Query', 'adminJurisdictions', readScope);

builder.queryField('adminOffices', (t) =>
  t.field({
    type: OfficeConnection,
    authScopes: readScope,
    args: {
      filter: t.arg({ type: OfficeFilter, required: false }),
      sort: t.arg({ type: AdminCivicSort, required: false }),
      first: t.arg.int({ required: false }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) => civic(ctx).adminOffices(ctx, withoutNulls(args)),
  }),
);
rememberScope('Query', 'adminOffices', readScope);

builder.queryField('adminOfficials', (t) =>
  t.field({
    type: OfficialConnection,
    authScopes: readScope,
    args: {
      filter: t.arg({ type: OfficialFilter, required: false }),
      sort: t.arg({ type: AdminCivicSort, required: false }),
      first: t.arg.int({ required: false }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) => civic(ctx).adminOfficials(ctx, withoutNulls(args)),
  }),
);
rememberScope('Query', 'adminOfficials', readScope);

builder.queryField('adminServices', (t) =>
  t.field({
    type: ServiceConnection,
    authScopes: readScope,
    args: {
      filter: t.arg({ type: ServiceFilter, required: false }),
      sort: t.arg({ type: AdminCivicSort, required: false }),
      first: t.arg.int({ required: false }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) => civic(ctx).adminServices(ctx, withoutNulls(args)),
  }),
);
rememberScope('Query', 'adminServices', readScope);
