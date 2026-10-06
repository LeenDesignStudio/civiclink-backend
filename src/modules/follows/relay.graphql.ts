import { builder } from '../../graphql/builder.js';

export { PageInfoRef as PageInfoType } from '../audit/audit.graphql.js';

export const GovLevelEnum = builder.enumType('GovLevel', {
  values: ['FEDERAL', 'STATE', 'COUNTY', 'MUNICIPAL', 'EDUCATION', 'SPECIAL'] as const,
});

export function withoutNulls(input: unknown): unknown {
  if (Array.isArray(input)) return input.map((item) => withoutNulls(item));
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value === null || value === undefined) continue;
      out[key] = withoutNulls(value);
    }
    return out;
  }
  return input;
}
