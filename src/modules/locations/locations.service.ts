import { z } from 'zod';
import type { ServiceContext } from '../../graphql/context.js';
import type { Clock } from '../../lib/clock.js';
import { fromZod, LocationLabelTakenError, LookupNotFoundError, NotFoundError, SavedLocationLimitError, ValidationError } from '../../lib/errors.js';
import type { Entitlements } from '../billing/entitlements.service.js';
import type { SavedLocationDto } from './locations.dto.js';
import { savedLocationIdSchema, saveLocationSchema, updateSavedLocationSchema } from './locations.inputs.js';
import type { LocationsRepo, LookupReader, LookupRecord, SavedLocationGeometry, TxRunner } from './locations.ports.js';

const ID_PATHS = new Set(['id', 'officeId', 'officialId', 'entityId', 'planId', 'assigneeId']);

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const onlyIds = result.error.issues.every((issue) =>
    issue.path.some((part) => ID_PATHS.has(String(part))),
  );
  if (onlyIds) throw new NotFoundError();
  throw fromZod(result.error);
}

export interface LocationsDeps {
  repo: LocationsRepo;
  lookups: LookupReader;
  geometry: SavedLocationGeometry;
  entitlements: Entitlements;
  withTx: TxRunner;
  clock: Clock;
}

/**
 * Limit checks and default-location updates run inside `withTx(..., { isolation: 'Serializable' })`.
 * The real `withTx` in `src/db/prisma.ts` opens a Serializable transaction, so two overlapping saves
 * cannot both observe the same count. Tests pass a fake that holds one shared lock and runs those
 * callbacks one at a time.
 */
export class LocationsService {
  constructor(private readonly deps: LocationsDeps) {}

  async savedLocations(ctx: ServiceContext): Promise<SavedLocationDto[]> {
    ctx.authz.require('self.locations:manage');
    const userId = ctx.authz.requireResident({ active: true });
    const rows = await this.deps.repo.listOwned(userId);
    return rows.sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      const time = b.createdAt.getTime() - a.createdAt.getTime();
      if (time !== 0) return time;
      return a.id < b.id ? -1 : 1;
    });
  }

  async saveLocation(ctx: ServiceContext, input: unknown): Promise<{ savedLocation: SavedLocationDto }> {
    ctx.authz.require('self.locations:manage');
    const userId = ctx.authz.requireResident({ active: true });
    const parsed = parseInput(saveLocationSchema, input);
    const lookup = await this.deps.lookups.findByToken(parsed.lookupToken);
    if (!this.usable(lookup, this.deps.clock.now())) throw new LookupNotFoundError();
    const limits = await this.deps.entitlements.limits(userId);
    const customName = parsed.label === 'OTHER' ? (parsed.customName ?? null) : (parsed.customName ?? null);
    if (parsed.label === 'OTHER' && !customName) {
      throw new ValidationError('A name is required for Other locations.', [
        { path: 'customName', code: 'custom', message: 'A name is required for Other locations.' },
      ]);
    }
    const savedLocation = await this.deps.withTx(
      async (tx) => {
        if (parsed.label === 'HOME' || parsed.label === 'WORK') {
          const taken = await this.deps.repo.findLabel(userId, parsed.label, tx);
          if (taken) throw new LocationLabelTakenError(parsed.label);
        }
        const count = await this.deps.repo.countOwned(userId, tx);
        if (count >= limits.maxSavedLocations) throw new SavedLocationLimitError(limits.maxSavedLocations);
        const isDefault = count === 0 || parsed.makeDefault === true;
        if (isDefault && count > 0) await this.deps.repo.clearDefault(userId, tx);
        const row = await this.deps.repo.insert(
          {
            userId,
            label: parsed.label,
            customName,
            displayAddress: lookup.displayLabel,
            normalizedAddress: lookup.displayLabel,
            geocodePrecision: lookup.geocodePrecision,
            isDefault,
            jurisdictionIds: [...lookup.jurisdictionIds],
            confidence: lookup.confidence,
            resolvedAt: lookup.createdAt,
          },
          tx,
        );
        if (lookup.hasPoint) await this.deps.geometry.copyPoint(row.id, lookup.token, tx);
        return row;
      },
      { isolation: 'Serializable' },
    );
    return { savedLocation };
  }

  async updateSavedLocation(ctx: ServiceContext, input: unknown): Promise<{ savedLocation: SavedLocationDto }> {
    ctx.authz.require('self.locations:manage');
    const userId = ctx.authz.requireResident({ active: true });
    const parsed = parseInput(updateSavedLocationSchema, input);
    const savedLocation = await this.deps.withTx(
      async (tx) => {
        const current = await this.deps.repo.findOwned(userId, parsed.id, tx);
        if (!current) throw new NotFoundError();
        const label = parsed.label ?? current.label;
        const customName = parsed.customName !== undefined ? parsed.customName : current.customName;
        if (label === 'OTHER' && !customName) {
          throw new ValidationError('A name is required for Other locations.', [
            { path: 'customName', code: 'custom', message: 'A name is required for Other locations.' },
          ]);
        }
        if (label === 'HOME' || label === 'WORK') {
          const taken = await this.deps.repo.findLabel(userId, label, tx);
          if (taken && taken.id !== current.id) throw new LocationLabelTakenError(label);
        }
        const updated = await this.deps.repo.updateOwned(
          userId,
          current.id,
          { label, customName: label === 'OTHER' ? customName : (parsed.customName ?? null) },
          tx,
        );
        if (!updated) throw new NotFoundError();
        return updated;
      },
      { isolation: 'Serializable' },
    );
    return { savedLocation };
  }

  async setDefaultLocation(ctx: ServiceContext, input: unknown): Promise<{ savedLocation: SavedLocationDto }> {
    ctx.authz.require('self.locations:manage');
    const userId = ctx.authz.requireResident({ active: true });
    const parsed = parseInput(savedLocationIdSchema, input);
    const savedLocation = await this.deps.withTx(
      async (tx) => {
        const current = await this.deps.repo.findOwned(userId, parsed.id, tx);
        if (!current) throw new NotFoundError();
        await this.deps.repo.clearDefault(userId, tx);
        const updated = await this.deps.repo.markDefault(userId, current.id, tx);
        if (!updated) throw new NotFoundError();
        return updated;
      },
      { isolation: 'Serializable' },
    );
    return { savedLocation };
  }

  async deleteSavedLocation(ctx: ServiceContext, input: unknown): Promise<{ id: string }> {
    ctx.authz.require('self.locations:manage');
    const userId = ctx.authz.requireResident({ active: true });
    const parsed = parseInput(savedLocationIdSchema, input);
    await this.deps.withTx(
      async (tx) => {
        const current = await this.deps.repo.findOwned(userId, parsed.id, tx);
        if (!current) throw new NotFoundError();
        const removed = await this.deps.repo.deleteOwned(userId, current.id, tx);
        if (!removed) throw new NotFoundError();
        if (current.isDefault) await this.deps.repo.promoteNewest(userId, tx);
      },
      { isolation: 'Serializable' },
    );
    return { id: parsed.id };
  }

  private usable(lookup: LookupRecord | null, now: Date): lookup is LookupRecord {
    if (!lookup) return false;
    if (lookup.expiresAt && lookup.expiresAt.getTime() <= now.getTime()) return false;
    if (lookup.confidence === 'UNRESOLVED') return false;
    if ((lookup.method === 'ADDRESS' || lookup.method === 'DEVICE') && !lookup.hasPoint) return false;
    if ((lookup.method === 'ZIP' || lookup.method === 'CITY_STATE') && !lookup.hasArea) return false;
    return true;
  }
}
