import { writeFileSync } from 'node:fs';
import { isObjectType, type GraphQLField, type GraphQLSchema } from 'graphql';
import './load-script-env.js';

const { schema } = await import('../src/graphql/schema.js');
const { rootFieldScopes } = await import('../src/graphql/builder.js');

function argsOf(field: GraphQLField<unknown, unknown>): string {
  return field.args.map((arg) => `${arg.name}: ${arg.type.toString()}`).join(', ');
}

function section(kind: 'Query' | 'Mutation', graph: GraphQLSchema): string {
  const type = kind === 'Query' ? graph.getQueryType() : graph.getMutationType();
  if (!type || !isObjectType(type)) return '';
  const lines = [`## ${kind}`, ''];
  for (const field of Object.values(type.getFields())) {
    const scope = rootFieldScopes.get(`${kind}.${field.name}`) ?? 'missing';
    lines.push(`### \`${field.name}\``);
    lines.push('');
    lines.push(`- Arguments: \`${argsOf(field) || 'none'}\``);
    lines.push(`- Returns: \`${field.type.toString()}\``);
    lines.push(`- Scope: \`${scope}\``);
    lines.push('');
  }
  return lines.join('\n');
}

const body = `# API reference

Generated from the GraphQL schema. Do not edit by hand — run \`pnpm docs:api\`.

${section('Query', schema)}
${section('Mutation', schema)}
`;
writeFileSync(new URL('../docs/API-REFERENCE.md', import.meta.url), body);
process.stdout.write('wrote docs/API-REFERENCE.md\n');
