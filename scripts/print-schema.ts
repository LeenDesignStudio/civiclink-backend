import { writeFileSync } from 'node:fs';
import { printSchema } from 'graphql';
import './load-script-env.js';

const { schema } = await import('../src/graphql/schema.js');
const printed = `${printSchema(schema)}\n`;
writeFileSync(new URL('../schema.graphql', import.meta.url), printed);
process.stdout.write('wrote schema.graphql\n');
