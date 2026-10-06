import { builder, rememberScope } from '../../graphql/builder.js';
import { withoutNulls } from '../follows/relay.graphql.js';
import { ConfidenceEnum } from '../locations/locations.graphql.js';
import type { ServicePreview } from '../civic/civic.dto.js';
import { CoverageEnum, GovLevelEnum, OfficeRef } from '../civic/civic.graphql.js';
import { LOOKUP_METHODS, type CivicCard, type CivicCardLevel, type ResolveLocationResult } from './lookup.dto.js';
import { LookupService } from './lookup.service.js';

const publicScope = { public: true };

const LookupMethodEnum = builder.enumType('LookupMethod', { values: LOOKUP_METHODS });
const ResolveStatusEnum = builder.enumType('ResolveLocationStatus', {
  values: ['RESOLVED', 'NEEDS_CONFIRMATION'] as const,
});

const ResolveLocationInput = builder.inputType('ResolveLocationInput', {
  fields: (t) => ({
    query: t.string({ required: false }),
    lat: t.float({ required: false }),
    lng: t.float({ required: false }),
    method: t.field({ type: LookupMethodEnum, required: false }),
  }),
});

const LocationCandidateRef = builder
  .objectRef<ResolveLocationResult['candidates'][number]>('LocationCandidate')
  .implement({
    fields: (t) => ({
      displayLabel: t.exposeString('displayLabel'),
      candidateToken: t.exposeString('candidateToken'),
    }),
  });

const ResolveLocationRef = builder.objectRef<ResolveLocationResult>('ResolveLocationResult').implement({
  fields: (t) => ({
    status: t.field({ type: ResolveStatusEnum, resolve: (result) => result.status }),
    token: t.exposeString('token', { nullable: true }),
    confidence: t.field({ type: ConfidenceEnum, nullable: true, resolve: (result) => result.confidence }),
    candidates: t.field({ type: [LocationCandidateRef], resolve: (result) => result.candidates }),
  }),
});

const ReverseGeocodeRef = builder
  .objectRef<{ displayLabel: string; candidateToken: string }>('ReverseGeocodeResult')
  .implement({
    fields: (t) => ({
      displayLabel: t.exposeString('displayLabel'),
      candidateToken: t.exposeString('candidateToken'),
    }),
  });

const CivicCardLevelRef = builder.objectRef<CivicCardLevel>('CivicCardLevel').implement({
  fields: (t) => ({
    level: t.field({ type: GovLevelEnum, resolve: (level) => level.level }),
    confidence: t.field({ type: ConfidenceEnum, resolve: (level) => level.confidence }),
    coverage: t.field({ type: CoverageEnum, resolve: (level) => level.coverage }),
    notice: t.exposeString('notice', { nullable: true }),
    offices: t.field({ type: [OfficeRef], resolve: (level) => level.offices }),
  }),
});

const PreviewCategoryRef = builder.objectRef<ServicePreview['category']>('ServicePreviewCategory').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
  }),
});

const ServicePreviewRef = builder.objectRef<ServicePreview>('ServicePreview').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    title: t.exposeString('title'),
    description: t.exposeString('description'),
    url: t.field({ type: 'URL', nullable: true, resolve: (service) => service.url }),
    phoneContact: t.exposeString('phoneContact', { nullable: true }),
    category: t.expose('category', { type: PreviewCategoryRef }),
  }),
});

const CivicCardRef = builder.objectRef<CivicCard>('CivicCard').implement({
  fields: (t) => ({
    token: t.exposeString('token'),
    displayLabel: t.exposeString('displayLabel'),
    method: t.field({ type: LookupMethodEnum, resolve: (card) => card.method }),
    confidence: t.field({ type: ConfidenceEnum, resolve: (card) => card.confidence }),
    levels: t.field({ type: [CivicCardLevelRef], resolve: (card) => card.levels }),
    servicesPreview: t.field({ type: [ServicePreviewRef], resolve: (card) => card.servicesPreview }),
  }),
});

function lookup(ctx: { services: unknown }): LookupService {
  return (ctx.services as { lookup: LookupService }).lookup;
}

builder.queryField('resolveLocation', (t) =>
  t.field({
    type: ResolveLocationRef,
    authScopes: publicScope,
    args: {
      input: t.arg({ type: ResolveLocationInput, required: true }),
    },
    resolve: (_root, args, ctx) => lookup(ctx).resolveLocation(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Query', 'resolveLocation', publicScope);

builder.queryField('confirmLocationCandidate', (t) =>
  t.field({
    type: ResolveLocationRef,
    authScopes: publicScope,
    args: {
      candidateToken: t.arg.string({ required: true }),
    },
    resolve: (_root, args, ctx) => lookup(ctx).confirmLocationCandidate(ctx, { candidateToken: args.candidateToken }),
  }),
);
rememberScope('Query', 'confirmLocationCandidate', publicScope);

builder.queryField('reverseGeocode', (t) =>
  t.field({
    type: ReverseGeocodeRef,
    authScopes: publicScope,
    args: {
      lat: t.arg.float({ required: true }),
      lng: t.arg.float({ required: true }),
    },
    resolve: (_root, args, ctx) => lookup(ctx).reverseGeocode(ctx, { lat: args.lat, lng: args.lng }),
  }),
);
rememberScope('Query', 'reverseGeocode', publicScope);

builder.queryField('civicCard', (t) =>
  t.field({
    type: CivicCardRef,
    authScopes: publicScope,
    args: {
      token: t.arg.string({ required: true }),
    },
    resolve: (_root, args, ctx) => lookup(ctx).civicCard(ctx, { token: args.token }),
  }),
);
rememberScope('Query', 'civicCard', publicScope);
