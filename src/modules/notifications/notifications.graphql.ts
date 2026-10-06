import { builder, rememberScope } from '../../graphql/builder.js';
import type { Connection } from '../../lib/pagination.js';
import { PageInfoType, withoutNulls } from '../follows/relay.graphql.js';
import type { NotificationDto, PreferenceDto } from './notifications.dto.js';
import { NotificationsService } from './notifications.service.js';

const residentScope = { residentActive: true };

const NotificationTypeEnum = builder.enumType('NotificationType', {
  values: ['ALERT', 'RECORD_UPDATE', 'SYSTEM'] as const,
});

export const NotificationCategoryEnum = builder.enumType('NotificationCategory', {
  values: ['ALERTS', 'UPDATES'] as const,
});

export const NotificationChannelEnum = builder.enumType('NotificationChannel', {
  values: ['IN_APP', 'EMAIL', 'PUSH'] as const,
});

const NotificationFilterEnum = builder.enumType('NotificationFilter', {
  values: ['ALL', 'UNREAD', 'ALERTS', 'UPDATES'] as const,
});

const NotificationType = builder.objectRef<NotificationDto>('Notification').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    type: t.field({ type: NotificationTypeEnum, resolve: (row) => row.type }),
    title: t.exposeString('title'),
    body: t.exposeString('body'),
    link: t.exposeString('link', { nullable: true }),
    readAt: t.field({ type: 'DateTime', nullable: true, resolve: (row) => row.readAt }),
    createdAt: t.field({ type: 'DateTime', resolve: (row) => row.createdAt }),
  }),
});

const NotificationEdge = builder
  .objectRef<{ cursor: string; node: NotificationDto }>('NotificationEdge')
  .implement({
    fields: (t) => ({
      cursor: t.exposeString('cursor'),
      node: t.field({ type: NotificationType, resolve: (edge) => edge.node }),
    }),
  });

const NotificationConnection = builder.objectRef<Connection<NotificationDto>>('NotificationConnection').implement({
  fields: (t) => ({
    edges: t.field({ type: [NotificationEdge], resolve: (page) => page.edges }),
    pageInfo: t.field({ type: PageInfoType, resolve: (page) => page.pageInfo }),
  }),
});

const PreferenceType = builder.objectRef<PreferenceDto>('NotificationPreference').implement({
  fields: (t) => ({
    category: t.field({ type: NotificationCategoryEnum, resolve: (row) => row.category }),
    channel: t.field({ type: NotificationChannelEnum, resolve: (row) => row.channel }),
    enabled: t.exposeBoolean('enabled'),
  }),
});

const MarkReadPayload = builder.objectRef<{ updatedCount: number }>('MarkNotificationsReadPayload').implement({
  fields: (t) => ({
    updatedCount: t.exposeInt('updatedCount'),
  }),
});

const DeletePayload = builder.objectRef<{ notification: NotificationDto }>('DeleteNotificationPayload').implement({
  fields: (t) => ({
    notification: t.field({ type: NotificationType, resolve: (row) => row.notification }),
  }),
});

const PreferencePayload = builder
  .objectRef<{ preference: PreferenceDto }>('UpdateNotificationPreferencePayload')
  .implement({
    fields: (t) => ({
      preference: t.field({ type: PreferenceType, resolve: (row) => row.preference }),
    }),
  });

const PushPayload = builder.objectRef<{ registered: boolean }>('RegisterPushSubscriptionPayload').implement({
  fields: (t) => ({
    registered: t.exposeBoolean('registered'),
  }),
});

const RemovePushPayload = builder.objectRef<{ removed: boolean }>('RemovePushSubscriptionPayload').implement({
  fields: (t) => ({
    removed: t.exposeBoolean('removed'),
  }),
});

const TestPayload = builder.objectRef<{ notification: NotificationDto }>('SendTestNotificationPayload').implement({
  fields: (t) => ({
    notification: t.field({ type: NotificationType, resolve: (row) => row.notification }),
  }),
});

const MarkReadInput = builder.inputType('MarkNotificationsReadInput', {
  fields: (t) => ({
    ids: t.field({ type: ['UUID'], required: false }),
    all: t.boolean({ required: false }),
  }),
});

const DeleteInput = builder.inputType('DeleteNotificationInput', {
  fields: (t) => ({
    id: t.field({ type: 'UUID', required: true }),
  }),
});

const PreferenceInput = builder.inputType('UpdateNotificationPreferenceInput', {
  fields: (t) => ({
    category: t.field({ type: NotificationCategoryEnum, required: true }),
    channel: t.field({ type: NotificationChannelEnum, required: true }),
    enabled: t.boolean({ required: true }),
  }),
});

const PushInput = builder.inputType('RegisterPushSubscriptionInput', {
  fields: (t) => ({
    token: t.string({ required: true }),
    userAgent: t.string({ required: false }),
  }),
});

const RemovePushInput = builder.inputType('RemovePushSubscriptionInput', {
  fields: (t) => ({
    token: t.string({ required: true }),
  }),
});

function service(ctx: { services: unknown }): NotificationsService {
  return (ctx.services as { notifications: NotificationsService }).notifications;
}

builder.queryField('notifications', (t) =>
  t.field({
    type: NotificationConnection,
    authScopes: residentScope,
    args: {
      filter: t.arg({ type: NotificationFilterEnum, required: false }),
      first: t.arg.int({ required: false }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) => service(ctx).notifications(ctx, withoutNulls(args)),
  }),
);
rememberScope('Query', 'notifications', residentScope);

builder.queryField('unreadNotificationCount', (t) =>
  t.int({
    authScopes: residentScope,
    resolve: (_root, _args, ctx) => service(ctx).unreadNotificationCount(ctx),
  }),
);
rememberScope('Query', 'unreadNotificationCount', residentScope);

builder.queryField('notificationPreferences', (t) =>
  t.field({
    type: [PreferenceType],
    authScopes: residentScope,
    resolve: (_root, _args, ctx) => service(ctx).notificationPreferences(ctx),
  }),
);
rememberScope('Query', 'notificationPreferences', residentScope);

builder.mutationField('markNotificationsRead', (t) =>
  t.field({
    type: MarkReadPayload,
    authScopes: residentScope,
    args: { input: t.arg({ type: MarkReadInput, required: true }) },
    resolve: (_root, args, ctx) => service(ctx).markNotificationsRead(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'markNotificationsRead', residentScope);

builder.mutationField('deleteNotification', (t) =>
  t.field({
    type: DeletePayload,
    authScopes: residentScope,
    args: { input: t.arg({ type: DeleteInput, required: true }) },
    resolve: (_root, args, ctx) => service(ctx).deleteNotification(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'deleteNotification', residentScope);

builder.mutationField('updateNotificationPreference', (t) =>
  t.field({
    type: PreferencePayload,
    authScopes: residentScope,
    args: { input: t.arg({ type: PreferenceInput, required: true }) },
    resolve: (_root, args, ctx) => service(ctx).updateNotificationPreference(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'updateNotificationPreference', residentScope);

builder.mutationField('registerPushSubscription', (t) =>
  t.field({
    type: PushPayload,
    authScopes: residentScope,
    args: { input: t.arg({ type: PushInput, required: true }) },
    resolve: (_root, args, ctx) => service(ctx).registerPushSubscription(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'registerPushSubscription', residentScope);

builder.mutationField('removePushSubscription', (t) =>
  t.field({
    type: RemovePushPayload,
    authScopes: residentScope,
    args: { input: t.arg({ type: RemovePushInput, required: true }) },
    resolve: (_root, args, ctx) => service(ctx).removePushSubscription(ctx, withoutNulls(args.input)),
  }),
);
rememberScope('Mutation', 'removePushSubscription', residentScope);

builder.mutationField('sendTestNotification', (t) =>
  t.field({
    type: TestPayload,
    authScopes: residentScope,
    resolve: (_root, _args, ctx) => service(ctx).sendTestNotification(ctx),
  }),
);
rememberScope('Mutation', 'sendTestNotification', residentScope);
