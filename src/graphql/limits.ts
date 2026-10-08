import {
  GraphQLError,
  Kind,
  parse,
  type FieldNode,
  type ParseOptions,
  type Source,
  type FragmentDefinitionNode,
  type SelectionNode,
  type ValidationContext,
  type ValidationRule,
} from 'graphql';
import type { Plugin } from 'graphql-yoga';

export const MAX_QUERY_DEPTH = 8;
export const MAX_ALIASES = 10;
export const MAX_DIRECTIVES = 20;
export const MAX_TOKENS = 2000;
export const MAX_COST = 5000;

function isAstField(node: unknown): boolean {
  return typeof node === 'object' && node !== null && 'kind' in node && node.kind === Kind.FIELD;
}

function reject(context: ValidationContext, message: string): void {
  context.reportError(new GraphQLError(message, { extensions: { code: 'BAD_REQUEST' } }));
}

export function depthLimitRule(maxDepth = MAX_QUERY_DEPTH): ValidationRule {
  return (context) => ({
    Field(_node, _key, _parent, _path, ancestors) {
      let depth = 1;
      for (const ancestor of ancestors) {
        if (isAstField(ancestor)) depth += 1;
      }
      if (depth > maxDepth) {
        reject(context, `Query depth of ${String(depth)} exceeds the maximum of ${String(maxDepth)}.`);
      }
    },
  });
}

function walk(
  selections: readonly SelectionNode[],
  context: ValidationContext,
  seen: Set<string>,
  visit: (selection: SelectionNode) => void,
): void {
  for (const selection of selections) {
    visit(selection);
    if (selection.kind === Kind.FIELD || selection.kind === Kind.INLINE_FRAGMENT) {
      const nested = selection.selectionSet?.selections;
      if (nested) walk(nested, context, seen, visit);
      continue;
    }
    if (seen.has(selection.name.value)) continue;
    seen.add(selection.name.value);
    const fragment = context.getFragment(selection.name.value);
    if (!fragment) continue;
    visitFragmentDirectives(fragment, visit);
    walk(fragment.selectionSet.selections, context, seen, visit);
  }
}

function visitFragmentDirectives(fragment: FragmentDefinitionNode, visit: (selection: SelectionNode) => void): void {
  if (!fragment.directives || fragment.directives.length === 0) return;
  visit({ kind: Kind.INLINE_FRAGMENT, selectionSet: fragment.selectionSet, directives: fragment.directives });
}

function countAliases(selections: readonly SelectionNode[], context: ValidationContext): number {
  let aliases = 0;
  walk(selections, context, new Set(), (selection) => {
    if (selection.kind === Kind.FIELD && selection.alias) aliases += 1;
  });
  return aliases;
}

function countDirectives(selections: readonly SelectionNode[], context: ValidationContext): number {
  let directives = 0;
  walk(selections, context, new Set(), (selection) => {
    directives += selection.directives?.length ?? 0;
  });
  return directives;
}

export function aliasLimitRule(maxAliases = MAX_ALIASES): ValidationRule {
  return (context) => ({
    OperationDefinition(operation) {
      const aliases = countAliases(operation.selectionSet.selections, context);
      if (aliases > maxAliases) {
        reject(context, `Query has ${String(aliases)} aliases, which exceeds the maximum of ${String(maxAliases)}.`);
      }
    },
  });
}

export function directiveLimitRule(maxDirectives = MAX_DIRECTIVES): ValidationRule {
  return (context) => ({
    OperationDefinition(operation) {
      const directives = (operation.directives?.length ?? 0) + countDirectives(operation.selectionSet.selections, context);
      if (directives > maxDirectives) {
        reject(context, `Query has ${String(directives)} directives, which exceeds the maximum of ${String(maxDirectives)}.`);
      }
    },
  });
}

interface FieldMap {
  [name: string]: { args: readonly { name: string }[]; type?: unknown };
}

function unwrap(type: unknown): { getFields: () => FieldMap } | undefined {
  let current = type;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ('ofType' in current && current.ofType) {
      current = current.ofType;
      continue;
    }
    break;
  }
  if (
    current &&
    typeof current === 'object' &&
    'getFields' in current &&
    typeof current.getFields === 'function'
  ) {
    return current as { getFields: () => FieldMap };
  }
  return undefined;
}

function firstMultiplier(field: FieldNode, connection: boolean): number {
  const argument = field.arguments?.find((item) => item.name.value === 'first');
  if (!argument) return connection ? 20 : 1;
  if (argument.value.kind === Kind.INT) {
    const value = Number.parseInt(argument.value.value, 10);
    if (Number.isNaN(value)) return 100;
    return Math.min(Math.max(value, 0), 100);
  }
  return 100;
}

function selectionCost(
  selections: readonly SelectionNode[],
  parent: unknown,
  context: ValidationContext,
  seen: Set<string>,
): number {
  let total = 0;
  for (const selection of selections) {
    if (selection.kind === Kind.FIELD) {
      if (selection.name.value === '__schema' || selection.name.value === '__type') continue;
      const definition = unwrap(parent)?.getFields()[selection.name.value];
      const connection = definition?.args.some((argument) => argument.name === 'first') ?? false;
      const children = selection.selectionSet
        ? selectionCost(selection.selectionSet.selections, definition?.type, context, seen)
        : 0;
      const multiplier = selection.selectionSet ? firstMultiplier(selection, connection) : 1;
      total += 1 + children * multiplier;
      continue;
    }
    if (selection.kind === Kind.INLINE_FRAGMENT) {
      const conditioned = selection.typeCondition
        ? context.getSchema().getType(selection.typeCondition.name.value)
        : parent;
      total += selectionCost(selection.selectionSet.selections, conditioned, context, seen);
      continue;
    }
    if (seen.has(selection.name.value)) continue;
    seen.add(selection.name.value);
    const fragment = context.getFragment(selection.name.value);
    if (!fragment) continue;
    const conditioned = context.getSchema().getType(fragment.typeCondition.name.value);
    total += selectionCost(fragment.selectionSet.selections, conditioned, context, seen);
  }
  return total;
}

export function costLimitRule(maxCost = MAX_COST): ValidationRule {
  return (context) => ({
    OperationDefinition(operation) {
      const schema = context.getSchema();
      const root =
        operation.operation === 'mutation'
          ? schema.getMutationType()
          : operation.operation === 'subscription'
            ? schema.getSubscriptionType()
            : schema.getQueryType();
      const cost = selectionCost(operation.selectionSet.selections, root ?? undefined, context, new Set());
      if (cost > maxCost) {
        reject(context, `Query cost of ${String(cost)} exceeds the maximum of ${String(maxCost)}.`);
      }
    },
  });
}

export function limitsPlugin(): Plugin {
  return {
    onParse({ setParseFn }) {
      setParseFn((source: string | Source, options?: ParseOptions) =>
        parse(source, { ...options, maxTokens: MAX_TOKENS }),
      );
    },
    onValidate({ addValidationRule }) {
      addValidationRule(aliasLimitRule());
      addValidationRule(directiveLimitRule());
      addValidationRule(costLimitRule());
    },
  };
}
