import { z } from 'zod';

export const contactTopicSchema = z.enum([
  'GENERAL',
  'DATA_ACCURACY',
  'BILLING',
  'PARTNERSHIPS',
  'PRESS',
  'OTHER',
]);

const plain = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), 'Contains unsupported characters');

export const submitContactSchema = z
  .object({
    name: plain(2, 80),
    email: z.email().max(254).transform((value) => value.toLowerCase()),
    topic: contactTopicSchema,
    message: plain(10, 2000),
    consent: z.literal(true),
    turnstileToken: z.string().trim().min(1).max(2048),
  })
  .strict();

export type SubmitContactInput = z.infer<typeof submitContactSchema>;
