/** Permission catalogue. Must match docs/02-RBAC-PERMISSIONS.md exactly. */

export const PUBLIC_PERMISSIONS = [
  'public.civic:read',
  'public.lookup:create',
  'public.plans:read',
  'public.contact:create',
  'public.legal:read',
] as const;

export const RESIDENT_PERMISSIONS = [
  'self.profile:read',
  'self.profile:update',
  'self.session:manage',
  'self.account:delete',
  'self.locations:manage',
  'self.follows:manage',
  'self.notifications:manage',
  'self.corrections:create',
  'self.corrections:read',
  'self.billing:manage',
] as const;

export const ADMIN_PERMISSIONS = [
  'admin.dashboard:read',
  'admin.civic:read',
  'admin.civic:write',
  'admin.civic:retire',
  'admin.source:write',
  'admin.source:run',
  'admin.source:decide',
  'admin.correction:read',
  'admin.correction:resolve',
  'admin.alert:read',
  'admin.alert:write',
  'admin.alert:send',
  'admin.changelog:read',
  'admin.export:csv',
  'admin.users:read',
  'admin.users:manage',
] as const;

export const SYSTEM_PERMISSIONS = [
  'system.pipeline:run',
  'system.notifications:deliver',
  'system.billing:sync',
  'system.retention:run',
  'system.locations:reresolve',
] as const;

export const PERMISSIONS = [
  ...PUBLIC_PERMISSIONS,
  ...RESIDENT_PERMISSIONS,
  ...ADMIN_PERMISSIONS,
  ...SYSTEM_PERMISSIONS,
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type RoleName = 'Resident' | 'VIEWER' | 'EDITOR' | 'COMMUNICATIONS' | 'SUPER_ADMIN' | 'System';

const viewer: Permission[] = [
  'admin.dashboard:read',
  'admin.civic:read',
  'admin.correction:read',
  'admin.alert:read',
  'admin.changelog:read',
  'admin.export:csv',
];

const editor: Permission[] = [
  ...viewer,
  'admin.civic:write',
  'admin.civic:retire',
  'admin.source:write',
  'admin.source:run',
  'admin.source:decide',
  'admin.correction:resolve',
];

const communications: Permission[] = [
  ...viewer,
  'admin.alert:write',
  'admin.alert:send',
];

const superAdmin: Permission[] = [
  ...editor.filter((p) => !communications.includes(p) || editor.includes(p)),
  'admin.alert:write',
  'admin.alert:send',
  'admin.users:read',
  'admin.users:manage',
];

export const ROLE_PERMISSIONS: Record<RoleName, readonly Permission[]> = {
  Resident: RESIDENT_PERMISSIONS,
  VIEWER: viewer,
  EDITOR: editor,
  COMMUNICATIONS: communications,
  SUPER_ADMIN: [...new Set(superAdmin)],
  System: SYSTEM_PERMISSIONS,
};
