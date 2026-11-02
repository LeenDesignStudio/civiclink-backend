import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import dotenv from 'dotenv';
import { INTEGRATION_FIELDS } from '../modules/integrations/integrations.catalog.js';

const integrationKeys = new Set<string>(INTEGRATION_FIELDS.map((field) => field.key));

/**
 * Fill missing variables from `.env`, then let saved integration keys replace
 * whatever the process was started with. Database and session keys already
 * present in the process stay as they are.
 */
export function loadIntegrationEnv(cwd = process.cwd()): void {
  const path = join(cwd, '.env');
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  const parsed = dotenv.parse(contents);
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  for (const key of integrationKeys) {
    const value = parsed[key];
    if (value !== undefined) process.env[key] = value;
  }
}

if (process.env.VITEST !== 'true') loadIntegrationEnv();
