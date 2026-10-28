import { builder, rememberScope } from '../../graphql/builder.js';
import type { Connection } from '../../lib/pagination.js';
import { PageInfoType, withoutNulls } from '../follows/relay.graphql.js';
import { NotificationChannelEnum } from '../notifications/notifications.graphql.js';
import type { AlertDto, AlertPreview, AlertTiles, ChannelDelivery, ChannelStats, FailureReason } from './alerts.dto.js';
import { AlertsService } from './alerts.service.js';

const readScope = { permission: 'admin.alert:read' as const };
const writeScope = { permission: 'admin.alert:write' as const };
const sendScope = { permission: 'admin.alert:send' as const };

const AlertStatusEnum = builder.enumType('AlertStatus', {
  values: ['DRAFT', 'SENDING', 'SENT', 'PARTLY_FAILED', 'FAILED'] as const,
});

const AlertTargetTypeEnum = builder.enumType('AlertTargetType', {
  values: ['OFFICE', 'OFFICIAL'] as const,
});

const AlertType = builder.objectRef<AlertDto>('Alert').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    displayId: t.exposeString('displayId', { nullable: true }),
    targetOfficeId: t.exposeID('targetOfficeId', { nullable: true }),
    targetOfficialId: t.exposeID('targetOfficialId', { nullable: true }),
    title: t.exposeString('title'),
    body: t.exposeString('body'),
    message: t.string({ resolve: (row) => row.body }),
    link: t.exposeString('link', { nullable: true }),
    channels: t.field({ type: [NotificationChannelEnum], resolve: (row) => row.channels }),
    status: t.field({ type: AlertStatusEnum, resolve: (row) => row.status }),
    recipientCount: t.exposeInt('recipientCount', { nullable: true }),
    sentAt: t.field({ type: 'DateTime', nullable: true, resolve: (row) => row.sentAt }),
    sentBy: t.exposeID('sentBy', { nullable: true }),
    sentByName: t.exposeString('sentByName', { nullable: true }),
    createdAt: t.field({ type: 'DateTime', resolve: (row) => row.createdAt }),
  }),
});

const StatsType = builder.objectRef<ChannelStats>('AlertChannelStats').implement({
  fields: (t) => ({
    channel: t.field({ type: NotificationChannelEnum, resolve: (row) => row.channel }),
    queued: t.exposeInt('queued'),
    sent: t.exposeInt('sent'),
    delivered: t.exposeInt('delivered'),
    failed: t.exposeInt('failed'),
    skipped: t.exposeInt('skipped'),
    opens: t.exposeInt('opens'),
    clicks: t.exposeInt('clicks'),
  }),
});

const DeliveryType = builder.objectRef<ChannelDelivery>('AlertChannelDelivery').implement({
  fields: (t) => ({
    channel: t.field({ type: NotificationChannelEnum, resolve: (row) => row.channel }),
    targeted: t.exposeInt('targeted'),
    sent: t.exposeInt('sent'),
    delivered: t.exposeInt('delivered'),
    failed: t.exposeInt('failed'),
    notEligible: t.exposeInt('notEligible'),
    opens: t.exposeInt('opens'),
    clicks: t.exposeInt('clicks'),
  }),
});

const FailureType = builder.objectRef<FailureReason>('AlertFailureReason').implement({
  fields: (t) => ({
    reason: t.exposeString('reason'),
    count: t.exposeInt('count'),
  }),
});

const AlertDetail = builder
  .objectRef<AlertDto & { stats: ChannelStats[]; delivery: ChannelDelivery[]; followerCount: number; failureReasons: FailureReason[] }>('AdminAlert')
  .implement({
    fields: (t) => ({
      alert: t.field({ type: AlertType, resolve: (row) => row }),
      stats: t.field({ type: [StatsType], resolve: (row) => row.stats }),
      followerCount: t.exposeInt('followerCount'),
      delivery: t.field({ type: [DeliveryType], resolve: (row) => row.delivery }),
      failureReasons: t.field({ type: [FailureType], resolve: (row) => row.failureReasons }),
    }),
  });

const AlertTilesType = builder.objectRef<AlertTiles>('AlertTiles').implement({
  fields: (t) => ({
    total: t.exposeInt('total'),
    sent7d: t.exposeInt('sent7d'),
    drafts: t.exposeInt('drafts'),
    failedOrPartly: t.exposeInt('failedOrPartly'),
  }),
});

const AlertEdge = builder.objectRef<{ cursor: string; node: AlertDto }>('AlertEdge').implement({
  fields: (t) => ({
    cursor: t.exposeString('cursor'),
    node: t.field({ type: AlertType, resolve: (edge) => edge.node }),
  }),
});

const AlertConnection = builder
  .objectRef<Connection<AlertDto> & { totalCount: number }>('AlertConnection')
  .implement({
    fields: (t) => ({
      edges: t.field({ type: [AlertEdge], resolve: (page) => page.edges }),
      pageInfo: t.field({ type: PageInfoType, resolve: (page) => page.pageInfo }),
      totalCount: t.exposeInt('totalCount'),
    }),
  });

const PreviewType = builder.objectRef<AlertPreview>('AlertPreview').implement({
  fields: (t) => ({
    inAppTitle: t.string({ resolve: (row) => row.inApp.title }),
    inAppBody: t.string({ resolve: (row) => row.inApp.body }),
    emailSubject: t.string({ resolve: (row) => row.email.subject }),
    emailText: t.string({ resolve: (row) => row.email.text }),
    pushTitle: t.string({ resolve: (row) => row.push.title }),
    pushBody: t.string({ resolve: (row) => row.push.body }),
    inAppRecipients: t.int({ resolve: (row) => row.recipientCount.inApp }),
    emailRecipients: t.int({ resolve: (row) => row.recipientCount.email }),
    pushRecipients: t.int({ resolve: (row) => row.recipientCount.push }),
    followers: t.int({ resolve: (row) => row.recipientCount.followers }),
  }),
});

const AlertPayload = builder.objectRef<{ alert: AlertDto }>('AlertPayload').implement({
  fields: (t) => ({
    alert: t.field({ type: AlertType, resolve: (row) => row.alert }),
  }),
});

const DeletePayload = builder.objectRef<{ id: string }>('DeleteAlertDraftPayload').implement({
  fields: (t) => ({ id: t.exposeID('id') }),
});

const TestPayload = builder.objectRef<{ sent: boolean }>('SendTestAlertPayload').implement({
  fields: (t) => ({ sent: t.exposeBoolean('sent') }),
});

const SaveInput = builder.inputType('SaveAlertDraftInput', {
  fields: (t) => ({
    id: t.field({ type: 'UUID', required: false }),
    targetOfficeId: t.field({ type: 'UUID', required: false }),
    targetOfficialId: t.field({ type: 'UUID', required: false }),
    title: t.string({ required: true }),
    body: t.string({ required: true }),
    link: t.string({ required: false }),
    channels: t.field({
      type: [builder.enumType('AlertDraftChannel', { values: ['IN_APP', 'EMAIL', 'PUSH'] as const })],
      required: true,
    }),
  }),
});

const IdInput = builder.inputType('AlertIdInput', {
  fields: (t) => ({ id: t.field({ type: 'UUID', required: true }) }),
});

const SendInput = builder.inputType('SendAlertInput', {
  fields: (t) => ({
    id: t.field({ type: 'UUID', required: true }),
    confirmRecipientCount: t.int({ required: true }),
  }),
});

const FilterInput = builder.inputType('AdminAlertFilter', {
  fields: (t) => ({
    status: t.field({ type: AlertStatusEnum, required: false }),
    targetOfficeId: t.field({ type: 'UUID', required: false }),
    q: t.string({ required: false }),
    channel: t.field({ type: NotificationChannelEnum, required: false }),
    targetType: t.field({ type: AlertTargetTypeEnum, required: false }),
    sentFrom: t.field({ type: 'DateTime', required: false }),
    sentTo: t.field({ type: 'DateTime', required: false }),
    sentBy: t.field({ type: 'UUID', required: false }),
  }),
});

function alerts(ctx: { services: unknown }): AlertsService {
  return (ctx.services as { alerts: AlertsService }).alerts;
}

builder.queryField('adminAlerts', (t) =>
  t.field({
    type: AlertConnection,
    authScopes: readScope,
    args: {
      filter: t.arg({ type: FilterInput, required: false }),
      first: t.arg.int({ required: false }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) => alerts(ctx).adminAlerts(ctx, withoutNulls(args)),
  }),
);
rememberScope('Query', 'adminAlerts', readScope);

builder.queryField('adminAlert', (t) =>
  t.field({
    type: AlertDetail,
    authScopes: readScope,
    args: { id: t.arg({ type: 'UUID', required: true }) },
    resolve: (_root, args, ctx) => alerts(ctx).adminAlert(ctx, { id: args.id }),
  }),
);
rememberScope('Query', 'adminAlert', readScope);

builder.queryField('adminAlertTiles', (t) =>
  t.field({
    type: AlertTilesType,
    authScopes: readScope,
    resolve: (_root, _args, ctx) => alerts(ctx).adminAlertTiles(ctx),
  }),
);
rememberScope('Query', 'adminAlertTiles', readScope);

builder.queryField('previewAlert', (t) =>
  t.field({
    type: PreviewType,
    authScopes: writeScope,
    args: { id: t.arg({ type: 'UUID', required: true }) },
    resolve: (_root, args, ctx) => alerts(ctx).previewAlert(ctx, { id: args.id }),
  }),
);
rememberScope('Query', 'previewAlert', writeScope);

builder.mutationField('saveAlertDraft', (t) =>
  t.field({
    type: AlertPayload,
    authScopes: writeScope,
    args: { input: t.arg({ type: SaveInput, required: true }) },
    resolve: (_root, args, ctx) => alerts(ctx).saveAlertDraft(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'saveAlertDraft', writeScope);

builder.mutationField('deleteAlertDraft', (t) =>
  t.field({
    type: DeletePayload,
    authScopes: writeScope,
    args: { input: t.arg({ type: IdInput, required: true }) },
    resolve: (_root, args, ctx) => alerts(ctx).deleteAlertDraft(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'deleteAlertDraft', writeScope);

builder.mutationField('sendTestAlert', (t) =>
  t.field({
    type: TestPayload,
    authScopes: writeScope,
    args: { input: t.arg({ type: IdInput, required: true }) },
    resolve: (_root, args, ctx) => alerts(ctx).sendTestAlert(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'sendTestAlert', writeScope);

builder.mutationField('sendAlert', (t) =>
  t.field({
    type: AlertPayload,
    authScopes: sendScope,
    args: { input: t.arg({ type: SendInput, required: true }) },
    resolve: (_root, args, ctx) => alerts(ctx).sendAlert(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'sendAlert', sendScope);

builder.mutationField('duplicateAlertAsDraft', (t) =>
  t.field({
    type: AlertPayload,
    authScopes: writeScope,
    args: { input: t.arg({ type: IdInput, required: true }) },
    resolve: (_root, args, ctx) => alerts(ctx).duplicateAlertAsDraft(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'duplicateAlertAsDraft', writeScope);
