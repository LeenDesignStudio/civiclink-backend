import { env } from '../../config/env.js';

export interface PlanLimits {
  maxSavedLocations: number;
  maxFollows: number;
}

export interface Entitlements {
  limits(userId: string): Promise<PlanLimits>;
}

/** Active subscription plan entitlements, or null when the resident is not subscribed. */
export interface EntitlementSource {
  entitlementsFor(userId: string): Promise<Partial<PlanLimits> | null>;
}

const ENTITLED = new Set(['ACTIVE', 'TRIALING', 'PAST_DUE']);

export function isEntitledStatus(status: string): boolean {
  return ENTITLED.has(status);
}

function pick(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Plan limits for a resident. An ACTIVE, TRIALING, or PAST_DUE subscription contributes
 * `plans.entitlements`, merged over `LIMIT_DEFAULT_*`. PAST_DUE keeps access during Stripe retries.
 */
export class EntitlementsService implements Entitlements {
  constructor(
    private readonly source: EntitlementSource,
    private readonly fallback: PlanLimits = {
      maxSavedLocations: env.LIMIT_DEFAULT_MAX_SAVED_LOCATIONS,
      maxFollows: env.LIMIT_DEFAULT_MAX_FOLLOWS,
    },
  ) {}

  async limits(userId: string): Promise<PlanLimits> {
    const plan = await this.source.entitlementsFor(userId);
    return {
      maxSavedLocations: pick(plan?.maxSavedLocations, this.fallback.maxSavedLocations),
      maxFollows: pick(plan?.maxFollows, this.fallback.maxFollows),
    };
  }
}
