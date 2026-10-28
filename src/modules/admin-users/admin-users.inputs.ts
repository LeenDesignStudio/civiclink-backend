import { z } from 'zod';
import { hasAsciiControls } from '../../lib/text.js';

const noControls = (value: string) => !hasAsciiControls(value);

export const adminRoleSchema = z.enum(['SUPER_ADMIN', 'ADMIN_STAFF']);
export const adminStatusSchema = z.enum(['INVITED', 'ACTIVE', 'DEACTIVATED']);

export const inviteAdminSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    name: z.string().trim().min(1).max(100).refine(noControls, 'Remove unsupported characters.'),
    role: adminRoleSchema,
  })
  .strict();

export const updateAdminRoleSchema = z
  .object({
    adminId: z.uuid(),
    role: adminRoleSchema,
  })
  .strict();

const adminNameSchema = z.string().trim().min(1).max(100).refine(noControls, 'Remove unsupported characters.');

export const updateAdminUserSchema = z
  .object({
    adminId: z.uuid(),
    role: adminRoleSchema.optional(),
    name: adminNameSchema.optional(),
  })
  .strict()
  .refine((value) => value.role !== undefined || value.name !== undefined, {
    message: 'Enter a name or a role.',
  });

export const adminUserIdSchema = z
  .object({
    adminId: z.uuid(),
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

export const updateMyProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(100).refine(noControls, 'Remove unsupported characters.'),
  })
  .strict();

export const changeMyPasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(10_000),
    newPassword: z.string().min(1).max(10_000),
  })
  .strict();

export const adminUserListSchema = z
  .object({
    filter: adminUserFilterSchema.nullish(),
    first: z.number().int().min(1).max(100).nullish(),
    after: z.string().min(1).max(500).nullish(),
  })
  .strict();
