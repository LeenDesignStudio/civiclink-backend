import SchemaBuilder from '@pothos/core';
import ScopeAuthPlugin, { AuthScopeFailureType, type AuthFailure } from '@pothos/plugin-scope-auth';
import {
  AccountDeletedError,
  AccountPendingDeletionError,
  ForbiddenError,
  TermsRequiredError,
  UnauthenticatedError,
} from '../lib/errors.js';
import type { Permission } from '../authz/permissions.js';
import type { GraphQLContext } from './context.js';

export const rootFieldScopes = new Map<string, string>();

function failedPermissions(failure: AuthFailure): string[] {
  switch (failure.kind) {
    case AuthScopeFailureType.AuthScope:
      return failure.scope === 'permission' && typeof failure.parameter === 'string'
        ? [failure.parameter]
        : [failure.scope];
    case AuthScopeFailureType.AllAuthScopes:
    case AuthScopeFailureType.AnyAuthScopes:
      return failure.failures.flatMap(failedPermissions);
    default:
      return [];
  }
}

export const builder = new SchemaBuilder<{
  Context: GraphQLContext;
  AuthScopes: {
    public: boolean;
    resident: boolean;
    residentActive: boolean;
    permission: Permission;
  };
  Scalars: {
    DateTime: { Input: Date; Output: Date };
    URL: { Input: string; Output: string };
    UUID: { Input: string; Output: string };
  };
}>({
  plugins: [ScopeAuthPlugin],
  scopeAuth: {
    authScopes: (ctx) => ({
      public: true,
      resident: ctx.principal.kind === 'resident',
      residentActive:
        ctx.principal.kind === 'resident' &&
        ctx.principal.status === 'ACTIVE' &&
        ctx.principal.termsAccepted,
      permission: (permission) => ctx.authz.can(permission),
    }),
    unauthorizedError: (_parent, ctx, _info, result) => {
      const failed = failedPermissions(result.failure);
      if (ctx.principal.kind === 'anonymous') return new UnauthenticatedError();
      if (ctx.principal.kind === 'resident') {
        const adminish = failed.some(
          (scope) => scope.startsWith('admin.') || scope.startsWith('system.') || scope === 'permission',
        );
        const onlyAdmin =
          failed.length > 0 &&
          failed.every((scope) => scope.startsWith('admin.') || scope.startsWith('system.'));
        if (onlyAdmin || (adminish && failed.some((scope) => scope.startsWith('admin.')))) {
          return new ForbiddenError();
        }
        if (ctx.principal.status === 'PENDING_DELETION') return new AccountPendingDeletionError();
        if (ctx.principal.status === 'DELETED') return new AccountDeletedError();
        if (!ctx.principal.termsAccepted) return new TermsRequiredError();
      }
      return new ForbiddenError();
    },
  },
});

builder.scalarType('DateTime', {
  serialize: (value) => value.toISOString(),
  parseValue: (value) => {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
      throw new Error('Invalid DateTime');
    }
    return new Date(value);
  },
});

builder.scalarType('URL', {
  serialize: (value) => value,
  parseValue: (value) => {
    if (typeof value !== 'string' || !/^https?:\/\//.test(value)) throw new Error('Invalid URL');
    return value;
  },
});

builder.scalarType('UUID', {
  serialize: (value) => value,
  parseValue: (value) => {
    if (
      typeof value !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ) {
      throw new Error('Invalid UUID');
    }
    return value;
  },
});

builder.queryType({});
builder.mutationType({});

export function rememberScope(kind: 'Query' | 'Mutation', name: string, scopes: object): void {
  rootFieldScopes.set(`${kind}.${name}`, JSON.stringify(scopes));
}
