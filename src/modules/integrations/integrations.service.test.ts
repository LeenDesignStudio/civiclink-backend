import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { directTx } from '../../auth/tx.js';
import { Authz } from '../../authz/authz.js';
import { parseEnv, type EnvSource } from '../../config/env.js';
import type { ServiceContext } from '../../graphql/context.js';
import { ForbiddenError, ValidationError } from '../../lib/errors.js';
import { AuditService } from '../audit/audit.service.js';
import type { ChangeLogEntry } from '../audit/audit.dto.js';
import type { AuditStore } from '../audit/audit.store.js';
import { integrationValues } from './integrations.catalog.js';
import { IntegrationSettingsService } from './integrations.service.js';

function pem(): string {
  return generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
}

function validSource(overrides: EnvSource = {}): EnvSource {
  const privateKey = pem();
  return {
    APP_ENV: 'test',
    PUBLIC_WEB_URL: 'http://localhost:3000',
    CORS_ORIGINS: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://civiclink_app:pw@localhost:5432/civiclink_test',
    MIGRATION_DATABASE_URL: 'postgresql://civiclink_owner:pw@localhost:5432/civiclink_test',
    JWT_PRIVATE_KEY: privateKey,
    JWT_PUBLIC_KEY: generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      .publicKey.export({ type: 'spki', format: 'pem' })
      .toString(),
    JWT_KEY_ID: 'test',
    COOKIE_ENC_KEY: randomBytes(32).toString('base64'),
    LINK_SIGNING_SECRET: 'x'.repeat(32),
    IP_HASH_SECRET: 'y'.repeat(32),
    GOOGLE_CLIENT_ID: 'g',
    GOOGLE_CLIENT_SECRET: 'gs',
    APPLE_CLIENT_ID: 'a',
    APPLE_TEAM_ID: 't',
    APPLE_KEY_ID: 'k',
    APPLE_PRIVATE_KEY: privateKey,
    BOOTSTRAP_SUPER_ADMIN_EMAIL: 'root@qubalink.com',
    GOOGLE_MAPS_API_KEY: 'maps-old',
    STRIPE_SECRET_KEY: 'sk_test_old',
    STRIPE_WEBHOOK_SECRET: 'whsec_old',
    EMAIL_PROVIDER: 'console',
    EMAIL_FROM: 'CivicLink <no-reply@civiclink.local>',
    CONTACT_INBOX: 'hello@qubalink.com',
    PUSH_PROVIDER: 'console',
    TURNSTILE_SECRET_KEY: 'turnstile',
    AWS_REGION: 'us-east-1',
    S3_BUCKET_EXPORTS: 'exports',
    S3_BUCKET_SNAPSHOTS: 'snapshots',
    ...overrides,
  };
}

class MemoryAudit implements AuditStore {
  entries: ChangeLogEntry[] = [];
  insert(_tx: unknown, entry: ChangeLogEntry) {
    this.entries.push(entry);
    return Promise.resolve();
  }
  list() {
    return Promise.resolve({ rows: [], total: 0 });
  }
}

function ctx(role: 'SUPER_ADMIN' | 'ADMIN_STAFF'): ServiceContext {
  const principal = {
    kind: 'admin' as const,
    adminId: '00000000-0000-4000-8000-000000000001',
    role,
    sessionId: 'sess-1',
  };
  return { requestId: 'req-1', principal, authz: new Authz(principal), ipHash: 'ip' };
}

describe('IntegrationSettingsService', () => {
  it('writes the env file, applies the key, and audits the key name only', async () => {
    const source = validSource();
    const initial = parseEnv(source);
    if (!initial.ok) throw new Error('fixture env is invalid');
    let file = 'GOOGLE_MAPS_API_KEY=maps-old\n';
    let values = integrationValues(initial.env);
    const stripeKeys: string[] = [];
    const auditStore = new MemoryAudit();
    const service = new IntegrationSettingsService({
      readSource: () => source,
      currentValues: () => values,
      readEnvFile: () => Promise.resolve(file),
      writeEnvFile: (contents) => {
        file = contents;
        return Promise.resolve();
      },
      apply: (updates) => {
        Object.assign(source, updates);
        const parsed = parseEnv(source);
        if (!parsed.ok) throw new Error('parse failed');
        values = integrationValues(parsed.env);
      },
      rebindStripe: (apiKey) => {
        stripeKeys.push(apiKey);
      },
      audit: new AuditService(auditStore),
      runTx: directTx,
    });

    const saved = await service.update(ctx('SUPER_ADMIN'), {
      settings: [
        { key: 'GOOGLE_MAPS_API_KEY', value: 'maps-new' },
        { key: 'STRIPE_SECRET_KEY', value: 'sk_test_from_admin' },
      ],
    });
    expect(saved.find((row) => row.key === 'GOOGLE_MAPS_API_KEY')?.value).toBe('maps-new');
    expect(file).toContain('GOOGLE_MAPS_API_KEY="maps-new"');
    expect(file).toContain('STRIPE_SECRET_KEY="sk_test_from_admin"');
    expect(stripeKeys).toEqual(['sk_test_from_admin']);
    const recorded = JSON.stringify(auditStore.entries);
    expect(recorded).toContain('GOOGLE_MAPS_API_KEY');
    expect(recorded).not.toContain('sk_test_from_admin');
    expect(recorded).not.toContain('maps-new');
  });

  it('rejects a staff admin and an invalid stripe key without writing', async () => {
    const source = validSource();
    let writes = 0;
    const service = new IntegrationSettingsService({
      readSource: () => source,
      currentValues: () => integrationValues(parseEnv(source) as never),
      readEnvFile: () => Promise.resolve(''),
      writeEnvFile: () => {
        writes += 1;
        return Promise.resolve();
      },
      apply: () => undefined,
      rebindStripe: () => undefined,
      audit: new AuditService(new MemoryAudit()),
      runTx: directTx,
    });

    expect(() => service.list(ctx('ADMIN_STAFF'))).toThrow(ForbiddenError);
    await expect(
      service.update(ctx('SUPER_ADMIN'), { settings: [{ key: 'STRIPE_SECRET_KEY', value: 'not-a-key' }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(writes).toBe(0);
  });
});
