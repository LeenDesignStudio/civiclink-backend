import { EnvelopArmorPlugin } from '@escape.tech/graphql-armor';
import { GraphQLError, Kind, type ValidationRule } from 'graphql';
import type { Plugin } from 'graphql-yoga';

export const MAX_QUERY_DEPTH = 8;

function isAstField(node: unknown): boolean {
  return typeof node === 'object' && node !== null && 'kind' in node && node.kind === Kind.FIELD;
}

export function depthLimitRule(maxDepth = MAX_QUERY_DEPTH): ValidationRule {
  return (context) => ({
    Field(_node, _key, _parent, _path, ancestors) {
      let depth = 1;
      for (const ancestor of ancestors) {
        if (isAstField(ancestor)) depth += 1;
      }
      if (depth > maxDepth) {
        context.reportError(new GraphQLError(`Query depth of ${String(depth)} exceeds the maximum of ${String(maxDepth)}.`));
      }
    },
  });
}

export function armorPlugin(): Plugin {
  return EnvelopArmorPlugin({
    maxDepth: { n: 8, enabled: true },
    maxAliases: { n: 10, enabled: true },
    maxDirectives: { n: 20, enabled: true },
    maxTokens: { n: 2000, enabled: true },
    costLimit: { maxCost: 5000, enabled: true },
    blockFieldSuggestion: { enabled: process.env.APP_ENV === 'production' },
  }) as Plugin;
}
