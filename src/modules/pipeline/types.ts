import { createHash } from 'node:crypto';
import type { CivicEntityType } from '../../generated/prisma/enums.js';
import type { SourceRow } from './records.js';

export type { SourceRow, RunRow } from './records.js';

export interface SourceConfig {
  urls?: string[];
  states?: string[];
  layers?: string[];
  item?: Selector;
  fields?: Record<string, Selector>;
  allowedHosts?: string[];
  state?: string;
  county?: string;
  tigerYear?: number;
  pageUrl?: string;
  officeId?: string;
  jurisdictionGeoid?: string;
  selectors?: PageSelectors;
}

export interface PageSelectors {
  name?: Selector;
  title?: Selector;
  phone?: Selector;
  email?: Selector;
  address?: Selector;
}

export interface Selector {
  tag: string;
  className?: string;
  attr?: string;
}

export interface RawSnapshot {
  body: Uint8Array;
  contentType: string;
  sha256: string;
  skipped?: 'robots';
}

export interface NormalisedRecord {
  matchKey: string;
  entityType: CivicEntityType;
  entityId?: string;
  fields: Record<string, string | null>;
}

export interface RunCounts {
  skipped: boolean;
  added: number;
  changed: number;
  retired: number;
  pending: number;
  sha: string | null;
}

export interface ZipConvertRequest {
  zip: Uint8Array;
  layer: string;
  where?: string;
  clipGeoJson?: Uint8Array;
}

export interface HttpResult {
  status: number;
  body: Uint8Array;
  contentType: string;
}

export interface HttpFetcher {
  get(
    url: string,
    init: { maxBytes: number; timeoutMs: number; headers?: Record<string, string> },
  ): Promise<HttpResult>;
}

export interface CollectorContext {
  source: SourceRow;
  fetch: HttpFetcher;
  maxBytes: number;
  userAgent?: string;
  pace?: { wait(): Promise<void> };
  convertZip?: (request: ZipConvertRequest) => Promise<Uint8Array>;
}

export interface Collector {
  key: string;
  fetch(ctx: CollectorContext): Promise<RawSnapshot>;
  normalise(raw: RawSnapshot): NormalisedRecord[];
}

export function sha256Bytes(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}

export function snapshotFrom(body: Uint8Array, contentType: string, skipped?: 'robots'): RawSnapshot {
  const snap: RawSnapshot = { body, contentType, sha256: sha256Bytes(body) };
  if (skipped) snap.skipped = skipped;
  return snap;
}

export const USER_AGENT = 'CivicLinkBot/1.0 (+https://civiclink.example/bot)';
export const BULK_CAP = 50 * 1024 * 1024;
export const PAGE_CAP = 5 * 1024 * 1024;

export function civicLinkUserAgent(contactEmail: string): string {
  return `CivicLinkBot/1.0 (+${contactEmail})`;
}

const NOT_PENDING = new Set([
  'geometry',
  'parentGeoid',
  'parentType',
  'boundaryVintage',
  'subtype',
  'districtCode',
  'officeId',
  'jurisdictionGeoid',
]);

const ATTRIBUTES = [
  'name',
  'geoid',
  'state',
  'type',
  'level',
  'subtype',
  'boundaryVintage',
  'fullName',
  'party',
  'website',
  'phone',
  'email',
  'title',
  'address',
] as const;

export function isPendingField(field: string): boolean {
  return !NOT_PENDING.has(field);
}

export function sameAttributes(left: Record<string, string | null>, right: Record<string, string | null>): boolean {
  for (const key of ATTRIBUTES) {
    if ((left[key] ?? null) !== (right[key] ?? null)) return false;
  }
  return true;
}
