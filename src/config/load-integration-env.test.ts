import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadIntegrationEnv } from './load-integration-env.js';

const touched = new Map<string, string | undefined>();

function remember(key: string): void {
  if (!touched.has(key)) touched.set(key, process.env[key]);
}

afterEach(() => {
  for (const [key, value] of touched) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  touched.clear();
});

describe('loadIntegrationEnv', () => {
  it('replaces integration keys from the file and keeps an existing database url', () => {
    const dir = mkdtempSync(join(tmpdir(), 'civiclink-env-'));
    writeFileSync(
      join(dir, '.env'),
      'DATABASE_URL="postgresql://from-file/db"\nGOOGLE_MAPS_API_KEY="from-file"\nONLY_IN_FILE=yes\n',
    );
    remember('DATABASE_URL');
    remember('GOOGLE_MAPS_API_KEY');
    remember('ONLY_IN_FILE');
    process.env.DATABASE_URL = 'postgresql://from-process/db';
    process.env.GOOGLE_MAPS_API_KEY = 'from-process';
    delete process.env.ONLY_IN_FILE;

    loadIntegrationEnv(dir);

    expect(process.env.DATABASE_URL).toBe('postgresql://from-process/db');
    expect(process.env.GOOGLE_MAPS_API_KEY).toBe('from-file');
    expect(process.env.ONLY_IN_FILE).toBe('yes');
  });
});
