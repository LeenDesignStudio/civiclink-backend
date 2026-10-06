import { builder, rememberScope } from '../../graphql/builder.js';
import type { Connection } from '../../lib/pagination.js';
import { GovLevelEnum, PageInfoType, withoutNulls } from '../follows/relay.graphql.js';
import {
  COVERAGE_VALUES,
  FRESHNESS_OVERRIDES,
  FRESHNESS_VALUES,
  JURISDICTION_TYPES,
  SELECTION_METHODS,
  TERM_STATUSES,
  type JurisdictionRef,
  type LegalVersionDto,
  type OfficeAddressDto,
  type OfficeProfile,
  type OfficialProfile,
  type PlanDto,
  type ServiceCategoryDto,
  type ServiceDto,
  type SourceRef,
} from './civic.dto.js';
import { CivicService } from './civic.service.js';

const publicScope = { public: true };

export { GovLevelEnum };
export const FreshnessEnum = builder.enumType('Freshness', { values: FRESHNESS_VALUES });
export const FreshnessOverrideEnum = builder.enumType('FreshnessOverride', { values: FRESHNESS_OVERRIDES });
export const JurisdictionTypeEnum = builder.enumType('JurisdictionType', { values: JURISDICTION_TYPES });
export const SelectionMethodEnum = builder.enumType('SelectionMethod', { values: SELECTION_METHODS });
export const TermStatusEnum = builder.enumType('TermStatus', { values: TERM_STATUSES });
export const CoverageEnum = builder.enumType('Coverage', { values: COVERAGE_VALUES });

const SourceRefType = builder.objectRef<SourceRef>('CivicSource').implement({
  fields: (t) => ({
    name: t.exposeString('name'),
    url: t.field({ type: 'URL', resolve: (source) => source.url }),
  }),
});

const JurisdictionRefType = builder.objectRef<JurisdictionRef>('JurisdictionRef').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    level: t.field({ type: GovLevelEnum, resolve: (jurisdiction) => jurisdiction.level }),
    type: t.field({ type: JurisdictionTypeEnum, resolve: (jurisdiction) => jurisdiction.type }),
    districtCode: t.exposeString('districtCode', { nullable: true }),
    state: t.exposeString('state', { nullable: true }),
  }),
});

const AddressType = builder.objectRef<OfficeAddressDto>('OfficeAddress').implement({
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

const HolderType = builder.objectRef<NonNullable<OfficeProfile['currentHolder']>>('OfficeHolder').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    slug: t.exposeString('slug'),
    fullName: t.exposeString('fullName'),
    displayName: t.exposeString('displayName', { nullable: true }),
    party: t.exposeString('party', { nullable: true }),
    photoUrl: t.field({ type: 'URL', nullable: true, resolve: (holder) => holder.photoUrl }),
  }),
});

export const OfficeRef = builder.objectRef<OfficeProfile>('Office').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    slug: t.exposeString('slug'),
    name: t.exposeString('name'),
    seatLabel: t.exposeString('seatLabel', { nullable: true }),
    selectionMethod: t.field({ type: SelectionMethodEnum, resolve: (office) => office.selectionMethod }),
    displayOrder: t.exposeInt('displayOrder'),
    phone: t.exposeString('phone', { nullable: true }),
    email: t.exposeString('email', { nullable: true }),
    website: t.field({ type: 'URL', nullable: true, resolve: (office) => office.website }),
    contactUrl: t.field({ type: 'URL', nullable: true, resolve: (office) => office.contactUrl }),
    holderUnknown: t.exposeBoolean('holderUnknown'),
    vacant: t.exposeBoolean('vacant'),
    currentHolder: t.field({ type: HolderType, nullable: true, resolve: (office) => office.currentHolder }),
    termStatus: t.field({ type: TermStatusEnum, nullable: true, resolve: (office) => office.termStatus }),
    addresses: t.field({ type: [AddressType], resolve: (office) => office.addresses }),
    jurisdiction: t.field({ type: JurisdictionRefType, resolve: (office) => office.jurisdiction }),
    source: t.field({ type: SourceRefType, resolve: (office) => office.source }),
    lastUpdatedAt: t.field({ type: 'DateTime', resolve: (office) => office.lastUpdatedAt }),
    freshness: t.field({ type: FreshnessEnum, resolve: (office) => office.freshness }),
    whyItApplies: t.exposeString('whyItApplies', { nullable: true }),
    isFollowed: t.exposeBoolean('isFollowed', { nullable: true }),
  }),
});

const OfficialRef = builder.objectRef<OfficialProfile>('Official').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    slug: t.exposeString('slug'),
    fullName: t.exposeString('fullName'),
    displayName: t.exposeString('displayName', { nullable: true }),
    party: t.exposeString('party', { nullable: true }),
    photoUrl: t.field({ type: 'URL', nullable: true, resolve: (official) => official.photoUrl }),
    website: t.field({ type: 'URL', nullable: true, resolve: (official) => official.website }),
    source: t.field({ type: SourceRefType, resolve: (official) => official.source }),
    lastUpdatedAt: t.field({ type: 'DateTime', resolve: (official) => official.lastUpdatedAt }),
    freshness: t.field({ type: FreshnessEnum, resolve: (official) => official.freshness }),
    redirectOfficeSlug: t.exposeString('redirectOfficeSlug', { nullable: true }),
    whyItApplies: t.exposeString('whyItApplies', { nullable: true }),
  }),
});

export const ServiceCategoryRef = builder.objectRef<ServiceCategoryDto>('ServiceCategory').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    sortOrder: t.exposeInt('sortOrder'),
  }),
});

const ServiceRef = builder.objectRef<ServiceDto>('Service').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    title: t.exposeString('title'),
    description: t.exposeString('description'),
    url: t.field({ type: 'URL', nullable: true, resolve: (service) => service.url }),
    phoneContact: t.exposeString('phoneContact', { nullable: true }),
    category: t.field({ type: ServiceCategoryRef, resolve: (service) => service.category }),
  }),
});

const ServiceEdgeRef = builder.objectRef<Connection<ServiceDto>['edges'][number]>('ServiceEdge').implement({
  fields: (t) => ({
    cursor: t.exposeString('cursor'),
    node: t.field({ type: ServiceRef, resolve: (edge) => edge.node }),
  }),
});

const ServiceConnectionRef = builder.objectRef<Connection<ServiceDto>>('ServiceConnection').implement({
  fields: (t) => ({
    edges: t.field({ type: [ServiceEdgeRef], resolve: (connection) => connection.edges }),
    pageInfo: t.expose('pageInfo', { type: PageInfoType }),
  }),
});

const PlanRef = builder.objectRef<PlanDto>('Plan').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    amountCents: t.exposeInt('amountCents'),
    currency: t.exposeString('currency'),
    interval: t.exposeString('interval'),
    features: t.exposeStringList('features'),
  }),
});

const LegalVersionRef = builder.objectRef<LegalVersionDto>('LegalVersion').implement({
  fields: (t) => ({
    kind: t.exposeString('kind'),
    version: t.exposeString('version'),
    effectiveAt: t.field({ type: 'DateTime', resolve: (doc) => doc.effectiveAt }),
  }),
});

function civic(ctx: { services: unknown }): CivicService {
  return (ctx.services as { civic: CivicService }).civic;
}

builder.queryField('office', (t) =>
  t.field({
    type: OfficeRef,
    authScopes: publicScope,
    args: {
      slug: t.arg.string({ required: true }),
      lookupToken: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) => civic(ctx).getOffice(ctx, withoutNulls(args)),
  }),
);
rememberScope('Query', 'office', publicScope);

builder.queryField('official', (t) =>
  t.field({
    type: OfficialRef,
    authScopes: publicScope,
    args: {
      slug: t.arg.string({ required: true }),
      lookupToken: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) => civic(ctx).getOfficial(ctx, withoutNulls(args)),
  }),
);
rememberScope('Query', 'official', publicScope);

builder.queryField('services', (t) =>
  t.field({
    type: ServiceConnectionRef,
    authScopes: publicScope,
    args: {
      lookupToken: t.arg.string({ required: false }),
      jurisdictionId: t.arg.id({ required: false }),
      officeId: t.arg.id({ required: false }),
      categoryId: t.arg.id({ required: false }),
      first: t.arg.int({ required: false }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) => civic(ctx).listServices(ctx, withoutNulls(args)),
  }),
);
rememberScope('Query', 'services', publicScope);

builder.queryField('serviceCategories', (t) =>
  t.field({
    type: [ServiceCategoryRef],
    authScopes: publicScope,
    resolve: (_root, _args, ctx) => civic(ctx).listServiceCategories(ctx),
  }),
);
rememberScope('Query', 'serviceCategories', publicScope);

builder.queryField('plans', (t) =>
  t.field({
    type: [PlanRef],
    authScopes: publicScope,
    resolve: (_root, _args, ctx) => civic(ctx).listPlans(ctx),
  }),
);
rememberScope('Query', 'plans', publicScope);

builder.queryField('legalVersions', (t) =>
  t.field({
    type: [LegalVersionRef],
    authScopes: publicScope,
    resolve: (_root, _args, ctx) => civic(ctx).listLegalVersions(ctx),
  }),
);
rememberScope('Query', 'legalVersions', publicScope);
