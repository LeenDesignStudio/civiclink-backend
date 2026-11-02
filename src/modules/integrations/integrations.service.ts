import { z } from 'zod';
import type { EnvSource } from '../../config/env.js';
import { parseEnv } from '../../config/env.js';
import { upsertEnvLines } from '../../config/env-file.js';
import type { RunTx } from '../../auth/tx.js';
import type { ServiceContext } from '../../graphql/context.js';
import { ForbiddenError, InternalError, ValidationError, fromZod } from '../../lib/errors.js';
import type { AuditService } from '../audit/audit.service.js';
import {
  INTEGRATION_ENTITY_ID,
  INTEGRATION_FIELDS,
  hintForKey,
  integrationField,
  type IntegrationField,
  type IntegrationKey,
} from './integrations.catalog.js';

const updateSchema = z
  .object({
    settings: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).max(80),
            value: z.string().max(20_000),
          })
          .strict(),
      )
      .min(1)
      .max(INTEGRATION_FIELDS.length),
  })
  .strict();

export interface IntegrationSetting {
  key: IntegrationKey;
  label: string;
  group: string;
  secret: boolean;
  multiline: boolean;
  value: string;
}

export interface IntegrationSettingsDeps {
  readSource: () => EnvSource;
  currentValues: () => Record<IntegrationKey, string>;
  readEnvFile: () => Promise<string>;
  writeEnvFile: (contents: string) => Promise<void>;
  apply: (updates: Record<string, string>) => void;
  rebindStripe: (apiKey: string) => void;
  audit: AuditService;
  runTx: RunTx;
}

export class IntegrationSettingsService {
  constructor(private readonly deps: IntegrationSettingsDeps) {}

  list(ctx: ServiceContext): IntegrationSetting[] {
    ctx.authz.require('admin.users:manage');
    return this.snapshot();
  }

  async update(ctx: ServiceContext, input: unknown): Promise<IntegrationSetting[]> {
    ctx.authz.require('admin.users:manage');
    const actor = ctx.authz.requireAdmin();
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) throw fromZod(parsed.error);

    const updates: Record<string, string> = {};
    for (const setting of parsed.data.settings) {
      if (!integrationField(setting.key)) {
        throw new ValidationError('That setting is not one of the integration keys.', [
          { path: setting.key, code: 'invalid', message: 'That setting is not one of the integration keys.' },
        ]);
      }
      updates[setting.key] = setting.value;
    }

    const merged: EnvSource = { ...this.deps.readSource(), ...updates };
    const checked = parseEnv(merged);
    if (!checked.ok) {
      const editable = checked.keys.filter((key) => integrationField(key));
      throw new ValidationError(
        'Check the highlighted keys.',
        editable.map((key) => ({ path: key, code: 'invalid', message: hintForKey(key) })),
      );
    }

    try {
      const existing = await this.deps.readEnvFile();
      await this.deps.writeEnvFile(upsertEnvLines(existing, updates));
    } catch (err) {
      if (err instanceof ValidationError || err instanceof ForbiddenError) throw err;
      throw new InternalError('The key file could not be saved.', { cause: err });
    }

    this.deps.apply(updates);
    if (updates.STRIPE_SECRET_KEY) this.deps.rebindStripe(updates.STRIPE_SECRET_KEY);
    const updatedKeys = Object.keys(updates).sort();
    await this.deps.runTx((tx) =>
      this.deps.audit.record(tx, {
        actorType: 'ADMIN',
        actorId: actor.adminId,
        entityType: 'integration_settings',
        entityId: INTEGRATION_ENTITY_ID,
        action: 'integration.keys_updated',
        before: null,
        after: { updatedKeys },
        requestId: ctx.requestId,
      }),
    );
    return this.snapshot();
  }

  private snapshot(): IntegrationSetting[] {
    const values = this.deps.currentValues();
    return INTEGRATION_FIELDS.map((field: IntegrationField) => ({
      key: field.key as IntegrationKey,
      label: field.label,
      group: field.group,
      secret: field.secret,
      multiline: field.multiline,
      value: values[field.key as IntegrationKey],
    }));
  }
}
