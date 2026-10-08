import { z } from 'zod';
import { hasAsciiControls } from '../../lib/text.js';

const control = (value: string) => !hasAsciiControls(value);

const plain = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(control, 'Contains unsupported characters');

export const submitCorrectionSchema = z
  .object({
    entityType: z.enum(['JURISDICTION', 'OFFICE', 'OFFICIAL', 'SERVICE']),
    entityId: z.uuid(),
    field: z.enum([
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
    ]),
    proposedValue: z.string().trim().max(500).optional(),
    details: plain(1, 1000).optional(),
    evidenceUrl: z.string().trim().max(2048).optional(),
    lookupToken: z.string().trim().min(1).max(32).optional(),
  })
  .strict();

export const myCorrectionsSchema = z
  .object({
    first: z.number().int().optional(),
    after: z.string().min(1).optional(),
  })
  .strict();

export const adminCorrectionsSchema = z
  .object({
    filter: z
      .object({
        status: z.enum(['SUBMITTED', 'IN_REVIEW', 'APPLIED', 'DISMISSED']).optional(),
        level: z.enum(['FEDERAL', 'STATE', 'COUNTY', 'MUNICIPAL', 'EDUCATION', 'SPECIAL']).optional(),
        entityType: z.enum(['JURISDICTION', 'OFFICE', 'OFFICIAL', 'SERVICE']).optional(),
        olderThanDays: z.number().int().positive().max(3650).optional(),
        assignedToMe: z.boolean().optional(),
      })
      .strict()
      .optional(),
    first: z.number().int().optional(),
    after: z.string().min(1).optional(),
  })
  .strict();

export const correctionIdSchema = z.object({ id: z.uuid() }).strict();

export const assignCorrectionSchema = z
  .object({
    id: z.uuid(),
    assigneeId: z.uuid().optional(),
  })
  .strict();

export const applyCorrectionSchema = z
  .object({
    id: z.uuid(),
    value: z.string().trim().max(500).optional(),
    sourceId: z.uuid().optional(),
    sourceUrl: z.string().trim().max(2048).optional(),
    notifyFollowers: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.sourceId && value.sourceUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceUrl'],
        message: 'Provide a source or a URL, not both.',
      });
    }
  });

export const dismissCorrectionSchema = z
  .object({
    id: z.uuid(),
    reason: z.enum(['ALREADY_CORRECT', 'INSUFFICIENT_EVIDENCE', 'OUT_OF_SCOPE', 'DUPLICATE', 'OTHER']),
    note: plain(1, 500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.reason === 'OTHER' && !value.note) {
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'A note is required when the reason is Other.',
      });
    }
  });

export const addCorrectionNoteSchema = z
  .object({
    id: z.uuid(),
    body: plain(1, 2000),
  })
  .strict();
