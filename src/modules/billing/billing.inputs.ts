import { z } from 'zod';

export const checkoutSchema = z
  .object({
    planId: z.uuid(),
  })
  .strict();

export const invoicesQuerySchema = z
  .object({
    first: z.number().int().optional(),
    after: z.string().min(1).optional(),
  })
  .strict();
