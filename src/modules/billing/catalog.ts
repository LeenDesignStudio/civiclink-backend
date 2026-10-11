import type { PlanLimits } from './entitlements.service.js';

export interface ListedPrice {
  id: string;
  unit_amount: number | null;
  currency: string;
  recurring: { interval: string } | null;
  product: { name?: string; deleted?: boolean; metadata?: Record<string, string> } | string | null;
}

export interface CatalogPrice {
  stripePriceId: string;
  name: string;
  amountCents: number;
  currency: string;
  interval: string;
  features: string[];
  entitlements: Partial<PlanLimits>;
}

export function featuresFromMetadata(metadata: Record<string, string>): string[] {
  const raw = metadata.features;
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, 20);
    }
  } catch {
    // Fall through to a comma-separated list.
  }
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 20);
}

export function entitlementsFromMetadata(metadata: Record<string, string>): Partial<PlanLimits> {
  const raw = metadata.entitlements;
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const out: Partial<PlanLimits> = {};
    if (positiveInt(record.maxSavedLocations)) out.maxSavedLocations = record.maxSavedLocations;
    if (positiveInt(record.maxFollows)) out.maxFollows = record.maxFollows;
    return out;
  } catch {
    return {};
  }
}

export function catalogPrice(price: ListedPrice): CatalogPrice | null {
  if (price.product && typeof price.product === 'object' && price.product.deleted) return null;
  const product = price.product && typeof price.product === 'object' ? price.product : null;
  const metadata = product?.metadata ?? {};
  const rawName = product?.name?.trim() || price.id;
  return {
    stripePriceId: price.id,
    name: rawName.slice(0, 60),
    amountCents: price.unit_amount ?? 0,
    currency: price.currency.toLowerCase().slice(0, 3),
    interval: (price.recurring?.interval ?? 'one_time').slice(0, 10),
    features: featuresFromMetadata(metadata),
    entitlements: entitlementsFromMetadata(metadata),
  };
}

function positiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
