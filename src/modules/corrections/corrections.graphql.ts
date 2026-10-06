import { builder, rememberScope } from '../../graphql/builder.js';
import type { Connection } from '../../lib/pagination.js';
import type { AdminCorrection, CorrectionNoteDto, ResidentCorrection } from './corrections.dto.js';
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
  values: ['ALREADY_CORRECT', 'INSUFFICIENT_EVIDENCE', 'OUT_OF_SCOPE', 'DUPLICATE', 'OTHER'] as const,
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
    entityType: t.expose('entityType', { type: CivicEntityTypeEnum }),
    entityId: t.exposeID('entityId'),
    field: t.expose('field', { type: CorrectionFieldEnum }),
    proposedValue: t.exposeString('proposedValue', { nullable: true }),
    details: t.exposeString('details', { nullable: true }),
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
