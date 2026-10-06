import { z } from 'zod';

export const notificationFilterSchema = z.enum(['ALL', 'UNREAD', 'ALERTS', 'UPDATES']);

const uuid = z.uuid();

export const notificationsQuerySchema = z
  .object({
    filter: notificationFilterSchema.optional(),
    first: z.number().int().min(1).max(50).optional(),
    after: z.string().min(1).max(500).optional(),
  })
  .strict();

export const markReadSchema = z
  .object({
    ids: z.array(uuid).min(1).max(100).optional(),
    all: z.literal(true).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasIds = value.ids !== undefined;
    const hasAll = value.all === true;
    if (hasIds === hasAll) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide either ids or all.',
        path: ['ids'],
      });
    }
  });

export const deleteNotificationSchema = z
  .object({
    id: uuid,
  })
  .strict();

export const updatePreferenceSchema = z
  .object({
    category: z.enum(['ALERTS', 'UPDATES']),
    channel: z.enum(['IN_APP', 'EMAIL', 'PUSH']),
    enabled: z.boolean(),
  })
  .strict();

export const pushTokenSchema = z
  .object({
    token: z.string().trim().min(1).max(2048),
    userAgent: z.string().trim().min(1).max(400).optional(),
  })
  .strict();

export const removePushSchema = z
  .object({
    token: z.string().trim().min(1).max(2048),
  })
  .strict();

export const fanoutSchema = z
  .object({
    type: z.enum(['ALERT', 'RECORD_UPDATE', 'SYSTEM']),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(1000),
    link: z.string().trim().min(1).max(2048).optional(),
    sourceRef: z.string().trim().min(1).max(80),
    officeId: uuid.optional(),
    officialId: uuid.optional(),
    userIds: z.array(uuid).max(5000).optional(),
    channels: z.array(z.enum(['IN_APP', 'EMAIL', 'PUSH'])).min(1).max(3),
  })
  .strict();

export const deliveryJobSchema = z
  .object({
    deliveryId: uuid,
  })
  .strict();

export const finalizeAlertSchema = z
  .object({
    alertId: uuid,
    recipientCount: z.number().int().nonnegative(),
  })
  .strict();

export type FanoutInput = z.infer<typeof fanoutSchema>;
