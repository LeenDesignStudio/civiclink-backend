import { z } from 'zod';
import { hasAsciiControls } from '../../lib/text.js';

const plain = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !hasAsciiControls(value), 'Contains unsupported characters');

export const saveLocationSchema = z
  .object({
    lookupToken: z.string().trim().min(1).max(32),
    label: z.enum(['HOME', 'WORK', 'OTHER']),
    customName: plain(1, 40).optional(),
    makeDefault: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.label === 'OTHER' && !value.customName) {
      ctx.addIssue({
        code: 'custom',
        path: ['customName'],
        message: 'A name is required for Other locations.',
      });
    }
  });

export const updateSavedLocationSchema = z
  .object({
    id: z.uuid(),
    label: z.enum(['HOME', 'WORK', 'OTHER']).optional(),
    customName: plain(1, 40).optional(),
  })
  .strict();

export const savedLocationIdSchema = z
  .object({
    id: z.uuid(),
  })
  .strict();

export type SaveLocationInput = z.infer<typeof saveLocationSchema>;
export type UpdateSavedLocationInput = z.infer<typeof updateSavedLocationSchema>;
