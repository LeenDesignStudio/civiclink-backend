import { builder, rememberScope } from '../../graphql/builder.js';
import type { Connection } from '../../lib/pagination.js';
import type {
  AdminCorrection,
  CorrectionNoteDto,
  CorrectionTiles,
  OpenCorrectionBrief,
  ResidentCorrection,
} from './corrections.dto.js';
import { CorrectionsService } from './corrections.service.js';
import { GovLevelEnum, PageInfoType, withoutNulls } from '../follows/relay.graphql.js';

const residentScope = { residentActive: true };
const readScope = { permission: 'admin.correction:read' as const };
const resolveScope = { permission: 'admin.correction:resolve' as const };

const CivicEntityTypeEnum = builder.enumType('CivicEntityType', {
  values: ['JURISDICTION', 'OFFICE', 'OFFICIAL', 'SERVICE'] as const,
});

const CorrectionFieldEnum = builder.enumType('CorrectionField', {
  values: [
    'OFFICEHOLDER_NAME',
    'TITLE',
    'PARTY',
    'PHONE',
    'EMAIL',
    'WEBSITE',
    'OFFICE_ADDRESS',
    'DISTRICT',
    'DOES_NOT_APPLY',
    'SERVICE_DETAILS',
    'OTHER',
  ] as const,
});

const CorrectionStatusEnum = builder.enumType('CorrectionStatus', {
  values: ['SUBMITTED', 'IN_REVIEW', 'APPLIED', 'DISMISSED'] as const,
});

const DismissReasonEnum = builder.enumType('DismissReason', {
  values: ['CANT_VERIFY', 'SOURCE_CORRECT', 'DUPLICATE', 'OUT_OF_SCOPE', 'OTHER'] as const,
});

const RecordBriefType = builder
  .objectRef<{ id: string; displayId: string | null; name: string | null }>('CorrectionRecordBrief')
  .implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      displayId: t.exposeString('displayId', { nullable: true }),
      name: t.exposeString('name', { nullable: true }),
    }),
  });

const SubmitterType = builder
  .objectRef<{ displayName: string | null; accountId: string }>('CorrectionSubmitter')
  .implement({
    fields: (t) => ({
      displayName: t.exposeString('displayName', { nullable: true }),
      accountId: t.exposeID('accountId'),
    }),
  });

const DecidedByType = builder
  .objectRef<{ id: string; name: string | null }>('CorrectionDecidedBy')
  .implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name', { nullable: true }),
    }),
  });

const OpenCorrectionType = builder.objectRef<OpenCorrectionBrief>('OpenCorrectionBrief').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    displayId: t.exposeString('displayId', { nullable: true }),
    status: t.expose('status', { type: CorrectionStatusEnum }),
  }),
});

const CorrectionTilesType = builder.objectRef<CorrectionTiles>('CorrectionTiles').implement({
  fields: (t) => ({
    pending: t.exposeInt('pending'),
    inReview: t.exposeInt('inReview'),
    applied30d: t.exposeInt('applied30d'),
    dismissed30d: t.exposeInt('dismissed30d'),
  }),
});

const ResidentCorrectionType = builder.objectRef<ResidentCorrection>('Correction').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    entityType: t.expose('entityType', { type: CivicEntityTypeEnum }),
    entityId: t.exposeID('entityId'),
    field: t.expose('field', { type: CorrectionFieldEnum }),
    proposedValue: t.exposeString('proposedValue', { nullable: true }),
    details: t.exposeString('details', { nullable: true }),
    evidenceUrl: t.exposeString('evidenceUrl', { nullable: true }),
    status: t.expose('status', { type: CorrectionStatusEnum }),
    dismissReason: t.expose('dismissReason', { type: DismissReasonEnum, nullable: true }),
    dismissNote: t.exposeString('dismissNote', { nullable: true }),
    createdAt: t.field({ type: 'DateTime', resolve: (row) => row.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (row) => row.updatedAt }),
  }),
});

const CorrectionNoteType = builder.objectRef<CorrectionNoteDto>('CorrectionNote').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    adminId: t.exposeID('adminId'),
    body: t.exposeString('body'),
    createdAt: t.field({ type: 'DateTime', resolve: (row) => row.createdAt }),
  }),
});

const AdminCorrectionType = builder.objectRef<AdminCorrection>('AdminCorrection').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    displayId: t.exposeString('displayId', { nullable: true }),
    entityType: t.expose('entityType', { type: CivicEntityTypeEnum }),
    recordType: t.expose('entityType', { type: CivicEntityTypeEnum }),
    entityId: t.exposeID('entityId'),
    record: t.field({
      type: RecordBriefType,
      resolve: (row) => ({
        id: row.entityId,
        displayId: row.recordDisplayId ?? null,
        name: row.recordName ?? null,
      }),
    }),
    field: t.expose('field', { type: CorrectionFieldEnum }),
    currentValue: t.string({ nullable: true, resolve: (row) => row.currentValueSnapshot?.value ?? null }),
    proposedValue: t.exposeString('proposedValue', { nullable: true }),
    details: t.exposeString('details', { nullable: true }),
    description: t.string({ nullable: true, resolve: (row) => row.details }),
    evidenceUrl: t.exposeString('evidenceUrl', { nullable: true }),
    status: t.expose('status', { type: CorrectionStatusEnum }),
    dismissReason: t.expose('dismissReason', { type: DismissReasonEnum, nullable: true }),
    dismissNote: t.exposeString('dismissNote', { nullable: true }),
    currentValueSnapshot: t.string({
      nullable: true,
      resolve: (row) => row.currentValueSnapshot?.value ?? null,
    }),
    assigneeId: t.exposeID('assigneeId', { nullable: true }),
    submitterDisplayName: t.exposeString('submitterDisplayName', { nullable: true }),
    submittedBy: t.field({
      type: SubmitterType,
      nullable: true,
      resolve: (row) => (row.userId ? { displayName: row.submitterDisplayName, accountId: row.userId } : null),
    }),
    decidedAt: t.field({ type: 'DateTime', nullable: true, resolve: (row) => row.resolvedAt }),
    decidedBy: t.field({
      type: DecidedByType,
      nullable: true,
      resolve: (row) => (row.resolvedBy ? { id: row.resolvedBy, name: row.decidedByName ?? null } : null),
    }),
    recordChangedSinceSubmission: t.boolean({ resolve: (row) => row.recordChangedSinceSubmission ?? false }),
    recordRetired: t.boolean({ resolve: (row) => row.recordRetired ?? false }),
    otherOpenCorrections: t.field({
      type: [OpenCorrectionType],
      resolve: (row) => row.otherOpenCorrections ?? [],
    }),
    notes: t.field({ type: [CorrectionNoteType], resolve: (row) => row.notes }),
    createdAt: t.field({ type: 'DateTime', resolve: (row) => row.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (row) => row.updatedAt }),
  }),
});

const MyEdge = builder.objectRef<{ cursor: string; node: ResidentCorrection }>('MyCorrectionEdge').implement({
  fields: (t) => ({
    cursor: t.exposeString('cursor'),
    node: t.expose('node', { type: ResidentCorrectionType }),
  }),
});

const MyConnection = builder.objectRef<Connection<ResidentCorrection>>('MyCorrectionConnection').implement({
  fields: (t) => ({
    edges: t.field({ type: [MyEdge], resolve: (row) => row.edges }),
    pageInfo: t.expose('pageInfo', { type: PageInfoType }),
  }),
});

const AdminEdge = builder.objectRef<{ cursor: string; node: AdminCorrection }>('AdminCorrectionEdge').implement({
  fields: (t) => ({
    cursor: t.exposeString('cursor'),
    node: t.expose('node', { type: AdminCorrectionType }),
  }),
});

const AdminConnection = builder
  .objectRef<Connection<AdminCorrection>>('AdminCorrectionConnection')
  .implement({
    fields: (t) => ({
      edges: t.field({ type: [AdminEdge], resolve: (row) => row.edges }),
      pageInfo: t.expose('pageInfo', { type: PageInfoType }),
      totalCount: t.int({ nullable: true, resolve: (row) => row.totalCount ?? null }),
    }),
  });

const SubmitPayload = builder
  .objectRef<{ correction: ResidentCorrection }>('SubmitCorrectionPayload')
  .implement({
    fields: (t) => ({
      correction: t.expose('correction', { type: ResidentCorrectionType }),
    }),
  });

const AdminPayload = builder.objectRef<{ correction: AdminCorrection }>('AdminCorrectionPayload').implement({
  fields: (t) => ({
    correction: t.expose('correction', { type: AdminCorrectionType }),
  }),
});

const SubmitInput = builder.inputType('SubmitCorrectionInput', {
  fields: (t) => ({
    entityType: t.field({ type: CivicEntityTypeEnum, required: true }),
    entityId: t.field({ type: 'UUID', required: true }),
    field: t.field({ type: CorrectionFieldEnum, required: true }),
    proposedValue: t.string({ required: false }),
    details: t.string({ required: false }),
    evidenceUrl: t.string({ required: false }),
    lookupToken: t.string({ required: false }),
  }),
});

const AdminFilter = builder.inputType('AdminCorrectionFilter', {
  fields: (t) => ({
    status: t.field({ type: CorrectionStatusEnum, required: false }),
    level: t.field({ type: GovLevelEnum, required: false }),
    entityType: t.field({ type: CivicEntityTypeEnum, required: false }),
    olderThanDays: t.int({ required: false }),
    assignedToMe: t.boolean({ required: false }),
    q: t.string({ required: false }),
    field: t.field({ type: CorrectionFieldEnum, required: false }),
    recordType: t.field({ type: CivicEntityTypeEnum, required: false }),
    submittedFrom: t.field({ type: 'DateTime', required: false }),
    submittedTo: t.field({ type: 'DateTime', required: false }),
  }),
});

const AssignInput = builder.inputType('AssignCorrectionInput', {
  fields: (t) => ({
    id: t.field({ type: 'UUID', required: true }),
    assigneeId: t.field({ type: 'UUID', required: false }),
  }),
});

const ApplyInput = builder.inputType('ApplyCorrectionInput', {
  fields: (t) => ({
    id: t.field({ type: 'UUID', required: true }),
    value: t.string({ required: false }),
    sourceId: t.field({ type: 'UUID', required: false }),
    sourceUrl: t.string({ required: false }),
    notifyFollowers: t.boolean({ required: false }),
  }),
});

const DismissInput = builder.inputType('DismissCorrectionInput', {
  fields: (t) => ({
    id: t.field({ type: 'UUID', required: true }),
    reason: t.field({ type: DismissReasonEnum, required: true }),
    note: t.string({ required: false }),
  }),
});

const NoteInput = builder.inputType('AddCorrectionNoteInput', {
  fields: (t) => ({
    id: t.field({ type: 'UUID', required: true }),
    body: t.string({ required: true }),
  }),
});

const IdInput = builder.inputType('CorrectionIdInput', {
  fields: (t) => ({
    id: t.field({ type: 'UUID', required: true }),
  }),
});

function corrections(ctx: { services: unknown }): CorrectionsService {
  return (ctx.services as { corrections: CorrectionsService }).corrections;
}

builder.mutationField('submitCorrection', (t) =>
  t.field({
    type: SubmitPayload,
    authScopes: residentScope,
    args: { input: t.arg({ type: SubmitInput, required: true }) },
    resolve: (_root, args, ctx) => corrections(ctx).submitCorrection(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'submitCorrection', residentScope);

builder.queryField('myCorrections', (t) =>
  t.field({
    type: MyConnection,
    authScopes: residentScope,
    args: {
      first: t.arg.int({ required: false }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) => corrections(ctx).myCorrections(ctx, withoutNulls(args)),
  }),
);
rememberScope('Query', 'myCorrections', residentScope);

builder.queryField('adminCorrections', (t) =>
  t.field({
    type: AdminConnection,
    authScopes: readScope,
    args: {
      filter: t.arg({ type: AdminFilter, required: false }),
      first: t.arg.int({ required: false }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) => corrections(ctx).adminCorrections(ctx, withoutNulls(args)),
  }),
);
rememberScope('Query', 'adminCorrections', readScope);

builder.queryField('adminCorrection', (t) =>
  t.field({
    type: AdminCorrectionType,
    authScopes: readScope,
    args: { id: t.arg({ type: 'UUID', required: true }) },
    resolve: (_root, args, ctx) => corrections(ctx).adminCorrection(ctx, { id: args.id }),
  }),
);
rememberScope('Query', 'adminCorrection', readScope);

builder.queryField('adminCorrectionTiles', (t) =>
  t.field({
    type: CorrectionTilesType,
    authScopes: readScope,
    resolve: (_root, _args, ctx) => corrections(ctx).adminCorrectionTiles(ctx),
  }),
);
rememberScope('Query', 'adminCorrectionTiles', readScope);

builder.mutationField('assignCorrection', (t) =>
  t.field({
    type: AdminPayload,
    authScopes: resolveScope,
    args: { input: t.arg({ type: AssignInput, required: true }) },
    resolve: (_root, args, ctx) => corrections(ctx).assignCorrection(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'assignCorrection', resolveScope);

builder.mutationField('markCorrectionInReview', (t) =>
  t.field({
    type: AdminPayload,
    authScopes: resolveScope,
    args: { input: t.arg({ type: IdInput, required: true }) },
    resolve: (_root, args, ctx) => corrections(ctx).markCorrectionInReview(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'markCorrectionInReview', resolveScope);

builder.mutationField('applyCorrection', (t) =>
  t.field({
    type: AdminPayload,
    authScopes: resolveScope,
    args: { input: t.arg({ type: ApplyInput, required: true }) },
    resolve: (_root, args, ctx) => corrections(ctx).applyCorrection(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'applyCorrection', resolveScope);

builder.mutationField('dismissCorrection', (t) =>
  t.field({
    type: AdminPayload,
    authScopes: resolveScope,
    args: { input: t.arg({ type: DismissInput, required: true }) },
    resolve: (_root, args, ctx) => corrections(ctx).dismissCorrection(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'dismissCorrection', resolveScope);

builder.mutationField('addCorrectionNote', (t) =>
  t.field({
    type: AdminPayload,
    authScopes: resolveScope,
    args: { input: t.arg({ type: NoteInput, required: true }) },
    resolve: (_root, args, ctx) => corrections(ctx).addCorrectionNote(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'addCorrectionNote', resolveScope);
