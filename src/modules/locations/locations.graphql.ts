import { builder, rememberScope } from '../../graphql/builder.js';
import { withoutNulls } from '../follows/relay.graphql.js';
import type { SavedLocationDto } from './locations.dto.js';
import { LocationsService } from './locations.service.js';

const residentScope = { residentActive: true };

const LocationLabelEnum = builder.enumType('LocationLabel', {
  values: ['HOME', 'WORK', 'OTHER'] as const,
});

export const ConfidenceEnum = builder.enumType('Confidence', {
  values: ['EXACT', 'LIKELY', 'MULTIPLE', 'UNRESOLVED'] as const,
});

const SavedLocationType = builder.objectRef<SavedLocationDto>('SavedLocation').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    label: t.expose('label', { type: LocationLabelEnum }),
    customName: t.exposeString('customName', { nullable: true }),
    displayAddress: t.exposeString('displayAddress'),
    normalizedAddress: t.exposeString('normalizedAddress'),
    geocodePrecision: t.exposeString('geocodePrecision', { nullable: true }),
    isDefault: t.exposeBoolean('isDefault'),
    jurisdictionIds: t.stringList({ resolve: (row) => row.jurisdictionIds }),
    confidence: t.expose('confidence', { type: ConfidenceEnum }),
    resolvedAt: t.field({ type: 'DateTime', resolve: (row) => row.resolvedAt }),
    createdAt: t.field({ type: 'DateTime', resolve: (row) => row.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (row) => row.updatedAt }),
  }),
});

const SaveLocationPayload = builder.objectRef<{ savedLocation: SavedLocationDto }>('SaveLocationPayload').implement({
  fields: (t) => ({
    savedLocation: t.expose('savedLocation', { type: SavedLocationType }),
  }),
});

const DeleteSavedLocationPayload = builder.objectRef<{ id: string }>('DeleteSavedLocationPayload').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
  }),
});

const SaveLocationInput = builder.inputType('SaveLocationInput', {
  fields: (t) => ({
    lookupToken: t.string({ required: true }),
    label: t.field({ type: LocationLabelEnum, required: true }),
    customName: t.string({ required: false }),
    makeDefault: t.boolean({ required: false }),
  }),
});

const UpdateSavedLocationInput = builder.inputType('UpdateSavedLocationInput', {
  fields: (t) => ({
    id: t.field({ type: 'UUID', required: true }),
    label: t.field({ type: LocationLabelEnum, required: false }),
    customName: t.string({ required: false }),
  }),
});

const SavedLocationIdInput = builder.inputType('SavedLocationIdInput', {
  fields: (t) => ({
    id: t.field({ type: 'UUID', required: true }),
  }),
});

function locations(ctx: { services: unknown }): LocationsService {
  return (ctx.services as { locations: LocationsService }).locations;
}

builder.queryField('savedLocations', (t) =>
  t.field({
    type: [SavedLocationType],
    authScopes: residentScope,
    resolve: (_root, _args, ctx) => locations(ctx).savedLocations(ctx),
  }),
);
rememberScope('Query', 'savedLocations', residentScope);

builder.mutationField('saveLocation', (t) =>
  t.field({
    type: SaveLocationPayload,
    authScopes: residentScope,
    args: { input: t.arg({ type: SaveLocationInput, required: true }) },
    resolve: (_root, args, ctx) => locations(ctx).saveLocation(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'saveLocation', residentScope);

builder.mutationField('updateSavedLocation', (t) =>
  t.field({
    type: SaveLocationPayload,
    authScopes: residentScope,
    args: { input: t.arg({ type: UpdateSavedLocationInput, required: true }) },
    resolve: (_root, args, ctx) => locations(ctx).updateSavedLocation(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'updateSavedLocation', residentScope);

builder.mutationField('setDefaultLocation', (t) =>
  t.field({
    type: SaveLocationPayload,
    authScopes: residentScope,
    args: { input: t.arg({ type: SavedLocationIdInput, required: true }) },
    resolve: (_root, args, ctx) => locations(ctx).setDefaultLocation(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'setDefaultLocation', residentScope);

builder.mutationField('deleteSavedLocation', (t) =>
  t.field({
    type: DeleteSavedLocationPayload,
    authScopes: residentScope,
    args: { input: t.arg({ type: SavedLocationIdInput, required: true }) },
    resolve: (_root, args, ctx) => locations(ctx).deleteSavedLocation(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'deleteSavedLocation', residentScope);
