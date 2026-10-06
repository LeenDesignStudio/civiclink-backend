import { describe, expect, it } from 'vitest';
import { rootFieldScopes } from '../src/graphql/builder.js';
import { schema } from '../src/graphql/schema.js';

function fieldNames(type: { getFields?: () => Record<string, unknown> } | null | undefined): string[] {
  return type?.getFields ? Object.keys(type.getFields()) : [];
}

describe('schema guard', () => {
  it('gives every Query and Mutation field an auth scope', () => {
    const roots = [
      ['Query', schema.getQueryType()],
      ['Mutation', schema.getMutationType()],
    ] as const;
    const missing: string[] = [];
    for (const [kind, type] of roots) {
      for (const name of fieldNames(type)) {
        if (!rootFieldScopes.has(`${kind}.${name}`)) missing.push(`${kind}.${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
