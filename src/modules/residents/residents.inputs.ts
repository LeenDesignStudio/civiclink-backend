import { z } from 'zod';

const noControls = (value: string) => !/[\u0000-\u001F\u007F]/.test(value);

export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine(noControls, 'Remove unsupported characters.');

export const acceptTermsSchema = z
  .object({
    termsVersion: z.string().trim().min(1).max(20),
    privacyVersion: z.string().trim().min(1).max(20),
    displayName: displayNameSchema,
    marketingOptIn: z.boolean(),
  })
  .strict();

export const updateProfileSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    marketingOptIn: z.boolean().optional(),
  })
  .strict();

export const signOutSchema = z
  .object({
    everywhere: z.boolean().optional(),
  })
  .strict();

export const requestDeletionSchema = z
  .object({
    reason: z.enum(['NOT_USEFUL', 'PRIVACY', 'TOO_MANY_NOTIFICATIONS', 'OTHER']).optional(),
    reasonText: z.string().trim().max(500).refine(noControls, 'Remove unsupported characters.').optional(),
    confirm: z.literal('DELETE'),
  })
  .strict();

export type AcceptTermsInput = z.infer<typeof acceptTermsSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type SignOutInput = z.infer<typeof signOutSchema>;
export type RequestDeletionInput = z.infer<typeof requestDeletionSchema>;
