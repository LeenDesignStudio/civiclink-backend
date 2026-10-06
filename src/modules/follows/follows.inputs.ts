import { z } from 'zod';

export const followSchema = z
  .object({
    officeId: z.uuid(),
    officialId: z.uuid().optional(),
  })
  .strict();

export const unfollowSchema = z
  .object({
    officeId: z.uuid(),
  })
  .strict();

export const followsQuerySchema = z
  .object({
    first: z.number().int().optional(),
    after: z.string().min(1).optional(),
  })
  .strict();

export type FollowInput = z.infer<typeof followSchema>;
export type UnfollowInput = z.infer<typeof unfollowSchema>;
export type FollowsQuery = z.infer<typeof followsQuerySchema>;
