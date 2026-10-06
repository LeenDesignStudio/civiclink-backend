import { builder, rememberScope } from '../../graphql/builder.js';
import { clearAdminCookie } from '../../auth/cookies.js';
import { PageInfoRef } from '../audit/audit.graphql.js';
import type { AdminMeDto, AdminUserDto } from './admin-users.dto.js';

const AdminRoleEnum = builder.enumType('AdminRole', {
  values: ['VIEWER', 'EDITOR', 'COMMUNICATIONS', 'SUPER_ADMIN'] as const,
});

const AdminStatusEnum = builder.enumType('AdminStatus', {
  values: ['INVITED', 'ACTIVE', 'DEACTIVATED'] as const,
});

const AdminStatusChangeEnum = builder.enumType('AdminStatusChange', {
  values: ['ACTIVE', 'DEACTIVATED'] as const,
});

const AdminUserRef = builder.objectRef<AdminUserDto>('AdminUser').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    email: t.exposeString('email'),
    name: t.exposeString('name', { nullable: true }),
    role: t.field({ type: AdminRoleEnum, resolve: (row) => row.role }),
    status: t.field({ type: AdminStatusEnum, resolve: (row) => row.status }),
    lastLoginAt: t.field({ type: 'DateTime', nullable: true, resolve: (row) => row.lastLoginAt }),
    createdAt: t.field({ type: 'DateTime', resolve: (row) => row.createdAt }),
  }),
});

const AdminMeRef = builder.objectRef<AdminMeDto>('AdminMe').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    email: t.exposeString('email'),
    name: t.exposeString('name', { nullable: true }),
    role: t.field({ type: AdminRoleEnum, resolve: (row) => row.role }),
    permissions: t.field({ type: ['String'], resolve: (row) => [...row.permissions] }),
  }),
});

const AdminUserEdge = builder
  .objectRef<{ cursor: string; node: AdminUserDto }>('AdminUserEdge')
  .implement({
    fields: (t) => ({
      cursor: t.exposeString('cursor'),
      node: t.field({ type: AdminUserRef, resolve: (edge) => edge.node }),
    }),
  });

const AdminUserConnection = builder
  .objectRef<{
    edges: { cursor: string; node: AdminUserDto }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    totalCount: number;
  }>('AdminUserConnection')
  .implement({
    fields: (t) => ({
      edges: t.field({ type: [AdminUserEdge], resolve: (page) => page.edges }),
      pageInfo: t.field({ type: PageInfoRef, resolve: (page) => page.pageInfo }),
      totalCount: t.int({ resolve: (page) => page.totalCount }),
    }),
  });

const InviteAdminInput = builder.inputType('InviteAdminInput', {
  fields: (t) => ({
    email: t.string({ required: true }),
    name: t.string({ required: false }),
    role: t.field({ type: AdminRoleEnum, required: true }),
  }),
});

const UpdateAdminRoleInput = builder.inputType('UpdateAdminRoleInput', {
  fields: (t) => ({
    adminId: t.field({ type: 'UUID', required: true }),
    role: t.field({ type: AdminRoleEnum, required: true }),
  }),
});

const SetAdminStatusInput = builder.inputType('SetAdminStatusInput', {
  fields: (t) => ({
    adminId: t.field({ type: 'UUID', required: true }),
    status: t.field({ type: AdminStatusChangeEnum, required: true }),
  }),
});

const AdminUserFilter = builder.inputType('AdminUserFilter', {
  fields: (t) => ({
    role: t.field({ type: AdminRoleEnum, required: false }),
    status: t.field({ type: AdminStatusEnum, required: false }),
  }),
});

const AdminUserPayload = builder.objectRef<{ adminUser: AdminUserDto }>('AdminUserPayload').implement({
  fields: (t) => ({
    adminUser: t.field({ type: AdminUserRef, resolve: (payload) => payload.adminUser }),
  }),
});

const AdminSignOutPayload = builder.objectRef<{ signedOut: boolean }>('AdminSignOutPayload').implement({
  fields: (t) => ({
    signedOut: t.exposeBoolean('signedOut'),
  }),
});

const anyAdmin = { permission: 'admin.dashboard:read' as const };

builder.queryField('adminMe', (t) =>
  t.field({
    type: AdminMeRef,
    authScopes: anyAdmin,
    resolve: (_root, _args, ctx) => ctx.services.adminUsers.adminMe(ctx),
  }),
);
rememberScope('Query', 'adminMe', anyAdmin);

builder.mutationField('adminSignOut', (t) =>
  t.field({
    type: AdminSignOutPayload,
    authScopes: anyAdmin,
    resolve: async (_root, _args, ctx) => {
      await ctx.services.adminUsers.adminSignOut(ctx);
      clearAdminCookie(ctx.reply);
      return { signedOut: true };
    },
  }),
);
rememberScope('Mutation', 'adminSignOut', anyAdmin);

const usersRead = { permission: 'admin.users:read' as const };
builder.queryField('adminUsers', (t) =>
  t.field({
    type: AdminUserConnection,
    authScopes: usersRead,
    args: {
      filter: t.arg({ type: AdminUserFilter, required: false }),
      first: t.arg.int({ required: false }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.adminUsers.adminUsers(ctx, {
        first: args.first,
        after: args.after,
        filter: args.filter
          ? {
              ...(args.filter.role != null ? { role: args.filter.role } : {}),
              ...(args.filter.status != null ? { status: args.filter.status } : {}),
            }
          : null,
      }),
  }),
);
rememberScope('Query', 'adminUsers', usersRead);

const usersManage = { permission: 'admin.users:manage' as const };

builder.mutationField('inviteAdmin', (t) =>
  t.field({
    type: AdminUserPayload,
    authScopes: usersManage,
    args: { input: t.arg({ type: InviteAdminInput, required: true }) },
    resolve: async (_root, args, ctx) => ({
      adminUser: await ctx.services.adminUsers.inviteAdmin(ctx, {
        email: args.input.email,
        role: args.input.role,
        ...(args.input.name != null ? { name: args.input.name } : {}),
      }),
    }),
  }),
);
rememberScope('Mutation', 'inviteAdmin', usersManage);

builder.mutationField('updateAdminRole', (t) =>
  t.field({
    type: AdminUserPayload,
    authScopes: usersManage,
    args: { input: t.arg({ type: UpdateAdminRoleInput, required: true }) },
    resolve: async (_root, args, ctx) => ({
      adminUser: await ctx.services.adminUsers.updateAdminRole(ctx, args.input),
    }),
  }),
);
rememberScope('Mutation', 'updateAdminRole', usersManage);

builder.mutationField('setAdminStatus', (t) =>
  t.field({
    type: AdminUserPayload,
    authScopes: usersManage,
    args: { input: t.arg({ type: SetAdminStatusInput, required: true }) },
    resolve: async (_root, args, ctx) => ({
      adminUser: await ctx.services.adminUsers.setAdminStatus(ctx, args.input),
    }),
  }),
);
rememberScope('Mutation', 'setAdminStatus', usersManage);
