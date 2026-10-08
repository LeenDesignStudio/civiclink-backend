import { z } from 'zod';
import { hasAsciiControls } from '../../lib/text.js';

const noControls = (value: string) => !hasAsciiControls(value);

export const adminRoleSchema = z.enum(['VIEWER', 'EDITOR', 'COMMUNICATIONS', 'SUPER_ADMIN']);
export const adminStatusSchema = z.enum(['INVITED', 'ACTIVE', 'DEACTIVATED']);

export const inviteAdminSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    name: z.string().trim().max(100).refine(noControls, 'Remove unsupported characters.').optional(),
    role: adminRoleSchema,
  })
  .strict();

export const updateAdminRoleSchema = z
  .object({
    adminId: z.uuid(),
    role: adminRoleSchema,
  })
  .strict();

export const setAdminStatusSchema = z
  .object({
    adminId: z.uuid(),
    status: z.enum(['ACTIVE', 'DEACTIVATED']),
  })
  .strict();

export const adminUserFilterSchema = z
  .object({
    role: adminRoleSchema.optional(),
    status: adminStatusSchema.optional(),
  })
  .strict();

export const adminUserListSchema = z
  .object({
    filter: adminUserFilterSchema.nullish(),
    first: z.number().int().min(1).max(100).nullish(),
    after: z.string().min(1).max(500).nullish(),
  })
  .strict();
