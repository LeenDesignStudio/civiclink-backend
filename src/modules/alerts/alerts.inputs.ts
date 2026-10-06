import { z } from 'zod';

const httpsUrl = z
  .url()
  .max(2048)
  .refine((value) => value.startsWith('https://'), 'Use an https link.');

export const saveAlertSchema = z
  .object({
    id: z.uuid().optional(),
    targetOfficeId: z.uuid().optional(),
    targetOfficialId: z.uuid().optional(),
    title: z.string().trim().min(5).max(80),
    body: z.string().trim().min(10).max(1000),
    link: httpsUrl.optional(),
    channels: z.array(z.enum(['EMAIL', 'PUSH'])).max(2).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const office = value.targetOfficeId !== undefined;
    const official = value.targetOfficialId !== undefined;
    if (office === official) {
      ctx.addIssue({ code: 'custom', message: 'Choose exactly one target.', path: ['targetOfficeId'] });
    }
  });

export const alertIdSchema = z.object({ id: z.uuid() }).strict();

export const sendAlertSchema = z
  .object({
    id: z.uuid(),
    confirmRecipientCount: z.number().int().nonnegative(),
  })
  .strict();

export const adminAlertsSchema = z
  .object({
    filter: z
      .object({
        status: z.enum(['DRAFT', 'SENDING', 'SENT']).optional(),
        targetOfficeId: z.uuid().optional(),
      })
      .strict()
      .optional(),
    first: z.number().int().min(1).max(100).optional(),
    after: z.string().min(1).max(500).optional(),
  })
  .strict();
