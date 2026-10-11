import { isAppError, UpstreamError, ValidationError } from '../../lib/errors.js';
import { extractElements, extractField, textContent } from './html.js';
import { robotsDisallows } from './robots.js';
import {
  DEFAULT_TIGER_YEAR,
  keepTigerFeature,
  stateFips,
  TIGER_FETCH_TIMEOUT_MS,
  tigerLayerPlan,
  tigerManifest,
  tigerRecordsFromFeatures,
  type TigerFeature,
} from './tiger.js';
import {
  sha256Bytes,
  snapshotFrom,
  USER_AGENT,
  type Collector,
  type CollectorContext,
  type NormalisedRecord,
  type RawSnapshot,
  type Selector,
  type SourceConfig,
} from './types.js';

const snapshotConfigs = new WeakMap<RawSnapshot, SourceConfig>();
const tigerPrepared = new WeakMap<RawSnapshot, NormalisedRecord[]>();
const decoder = new TextDecoder();

async function load(
  ctx: CollectorContext,
  url: string,
  timeoutMs = 60_000,
): Promise<{ status: number; body: Uint8Array; contentType: string }> {
  let response: { status: number; body: Uint8Array; contentType: string };
  try {
    response = await ctx.fetch.get(url, {
      maxBytes: ctx.maxBytes,
      timeoutMs,
      headers: {
        'user-agent': ctx.userAgent ?? USER_AGENT,
        accept: 'application/json,text/csv,text/html,application/zip,application/octet-stream',
      },
    });
  } catch (err) {
    if (isAppError(err)) throw err;
    throw new UpstreamError(undefined, { cause: err });
  }
  if (response.status >= 500) throw new UpstreamError();
  return response;
}

export const tigerCollector: Collector = {
  key: 'tiger.boundaries',
  async fetch(ctx) {
    const state = ctx.source.config.state;
    if (!state || !ctx.convertZip) {
      const url = ctx.source.config.urls?.[0] ?? ctx.source.url;
      const response = await load(ctx, url);
      return snapshotFrom(response.body, response.contentType || 'application/geo+json');
    }
    const year = ctx.source.config.tigerYear ?? DEFAULT_TIGER_YEAR;
    const postal = state.toUpperCase();
    const fips = stateFips(postal);
    const files: { id: string; sha256: string; bytes: number }[] = [];
    const features: TigerFeature[] = [];
    let stateClip: Uint8Array | undefined;
    for (const layer of tigerLayerPlan(year, postal)) {
      const response = await load(ctx, layer.url, TIGER_FETCH_TIMEOUT_MS);
      if (response.status !== 200) throw new UpstreamError();
      if (response.body.byteLength > ctx.maxBytes) throw new ValidationError('Download exceeded the size cap.');
      assertZip(response.contentType);
      if (layer.clip && !stateClip) throw new ValidationError('State boundary is required before ZCTA.');
      const geojson = await ctx.convertZip({
        zip: response.body,
        layer: layer.id,
        ...(layer.where ? { where: layer.where } : {}),
        ...(layer.clip && stateClip ? { clipGeoJson: stateClip } : {}),
      });
      if (layer.id === 'STATE') stateClip = geojson;
      let parsed: unknown;
      try {
        parsed = JSON.parse(decoder.decode(geojson)) as unknown;
      } catch {
        throw new ValidationError('Boundary file could not be parsed.');
      }
      for (const feature of featuresOf(parsed)) {
        const props = objectOf(feature.properties);
        if (!keepTigerFeature(props, layer.id, postal, fips)) continue;
        features.push({ geometry: feature.geometry, properties: { ...props, tigerLayer: layer.id } });
      }
      files.push({ id: layer.id, sha256: sha256Bytes(response.body), bytes: response.body.byteLength });
    }
    const snap = snapshotFrom(tigerManifest(files), 'application/json');
    tigerPrepared.set(snap, tigerRecordsFromFeatures(features, year, postal));
    return snap;
  },
  normalise(raw) {
    const prepared = tigerPrepared.get(raw);
    if (prepared) return prepared;
    const parsed: unknown = JSON.parse(decoder.decode(raw.body));
    const records: NormalisedRecord[] = [];
    for (const feature of featuresOf(parsed)) {
      const props = objectOf(feature.properties);
      const geoid = stringOf(props.GEOID) ?? stringOf(props.geoid);
      if (!geoid) continue;
      records.push({
        matchKey: `tiger:${geoid}`,
        entityType: 'JURISDICTION',
        fields: {
          name: stringOf(props.NAME) ?? stringOf(props.name) ?? geoid,
          geoid,
          state: stringOf(props.STATE) ?? stringOf(props.state),
          type: stringOf(props.type) ?? 'COUNTY',
          level: stringOf(props.level) ?? 'COUNTY',
        },
      });
    }
    return records;
  },
};

export const congressCollector: Collector = {
  key: 'congress.legislators',
  async fetch(ctx) {
    const response = await load(ctx, ctx.source.config.urls?.[0] ?? ctx.source.url);
    const snap = snapshotFrom(response.body, 'application/json');
    snapshotConfigs.set(snap, ctx.source.config);
    return snap;
  },
  normalise(raw) {
    const text = decoder.decode(raw.body);
    const parsed: unknown = text.trim().startsWith('[') || text.trim().startsWith('{') ? JSON.parse(text) : parseSimpleYaml(text);
    const rows = Array.isArray(parsed) ? parsed : [];
    const want = snapshotConfigs.get(raw)?.state?.toUpperCase();
    const records: NormalisedRecord[] = [];
    for (const row of rows) {
      const item = objectOf(row);
      const id = objectOf(item.id);
      const bioguide = stringOf(id.bioguide);
      const name = objectOf(item.name);
      const fullName = stringOf(name.official_full) ?? stringOf(item.fullName);
      if (!bioguide || !fullName) continue;
      const terms = Array.isArray(item.terms) ? item.terms : [];
      const latest = objectOf(terms[terms.length - 1]);
      const state = stringOf(latest.state);
      if (want && state?.toUpperCase() !== want) continue;
      records.push({
        matchKey: `bioguide:${bioguide}`,
        entityType: 'OFFICIAL',
        fields: {
          fullName,
          party: stringOf(latest.party),
          state,
        },
      });
    }
    return records;
  },
};

export const openStatesCollector: Collector = {
  key: 'openstates.people',
  async fetch(ctx) {
    const response = await load(ctx, openStatesUrl(ctx.source.config, ctx.source.url));
    const snap = snapshotFrom(response.body, 'text/csv');
    snapshotConfigs.set(snap, ctx.source.config);
    return snap;
  },
  normalise(raw) {
    const want = snapshotConfigs.get(raw)?.state?.toUpperCase();
    const records: NormalisedRecord[] = [];
    for (const row of parseCsv(decoder.decode(raw.body))) {
      const id = row.id ?? row.openstates_id;
      const fullName = row.name ?? row.full_name;
      if (!id || !fullName) continue;
      const state = row.state ?? null;
      if (want && (state ?? '').toUpperCase() !== want) continue;
      records.push({
        matchKey: `openstates:${id}`,
        entityType: 'OFFICIAL',
        fields: {
          fullName,
          party: row.party ?? null,
          state,
        },
      });
    }
    return records;
  },
};

const DEFAULT_ITEM: Selector = { tag: 'article', className: 'directory-item' };
const DEFAULT_FIELDS: Record<string, Selector> = {
  fullName: { tag: 'h2' },
  phone: { tag: 'span', className: 'phone' },
  email: { tag: 'a', className: 'email', attr: 'href' },
};

export const pageCollector: Collector = {
  key: 'page.directory',
  async fetch(ctx) {
    const rawUrl = ctx.source.config.pageUrl ?? ctx.source.config.urls?.[0] ?? ctx.source.url;
    let pageUrl: URL;
    try {
      pageUrl = new URL(rawUrl);
    } catch {
      throw new ValidationError('Page URL is invalid.');
    }
    if (pageUrl.protocol !== 'https:') throw new ValidationError('Page URL must use https.');
    const allowed = ctx.source.config.allowedHosts;
    if (allowed && allowed.length > 0 && !allowed.includes(pageUrl.host)) {
      throw new ValidationError('Page host is not allowed for this source.');
    }
    await ctx.pace?.wait();
    const robotsUrl = new URL('/robots.txt', pageUrl.origin).toString();
    const robots = await load(ctx, robotsUrl);
    if (robots.status === 200 && robotsDisallows(decoder.decode(robots.body), pageUrl.pathname)) {
      return snapshotFrom(new Uint8Array(), 'text/html', 'robots');
    }
    await ctx.pace?.wait();
    const response = await load(ctx, pageUrl.toString());
    if (response.body.byteLength <= ctx.maxBytes) assertPage(response.contentType);
    const snap = snapshotFrom(response.body, response.contentType || 'text/html');
    snapshotConfigs.set(snap, ctx.source.config);
    return snap;
  },
  normalise(raw) {
    if (raw.skipped === 'robots') return [];
    const config = snapshotConfigs.get(raw);
    const html = decoder.decode(raw.body);
    const item = config?.item ?? (config?.selectors ? { tag: 'article' } : DEFAULT_ITEM);
    const fields = pageFields(config);
    const blocks = extractElements(html, item);
    const records: NormalisedRecord[] = [];
    const officeId = config?.officeId && isUuid(config.officeId) ? config.officeId : undefined;
    for (const block of blocks) {
      const fullName = cleanValue(extractField(block, fields.fullName ?? DEFAULT_FIELDS.fullName ?? { tag: 'h2' }), 'text');
      if (!fullName) continue;
      const title = fields.title ? cleanValue(extractField(block, fields.title), 'text') : undefined;
      const phone = fields.phone ? cleanValue(extractField(block, fields.phone), 'phone') : undefined;
      const email = fields.email ? cleanValue(extractField(block, fields.email), 'email') : undefined;
      const address = fields.address ? cleanValue(extractField(block, fields.address), 'text') : undefined;
      const officialFields: Record<string, string | null> = { fullName };
      if (title !== undefined) officialFields.title = title;
      const contacts: Record<string, string | null> = {};
      if (phone !== undefined) contacts.phone = phone;
      if (email !== undefined) contacts.email = email;
      if (address !== undefined) contacts.address = address;
      const matchKey = config?.jurisdictionGeoid
        ? `page:${config.jurisdictionGeoid}:${fullName.toLowerCase()}`
        : `page:${fullName.toLowerCase()}`;
      if (officeId && Object.keys(contacts).length > 0) {
        records.push({ matchKey, entityType: 'OFFICIAL', fields: officialFields });
        records.push({
          matchKey: `office:${officeId}:${fullName.toLowerCase()}`,
          entityType: 'OFFICE',
          entityId: officeId,
          fields: contacts,
        });
      } else {
        records.push({ matchKey, entityType: 'OFFICIAL', fields: { ...officialFields, ...contacts } });
      }
    }
    const configured = Boolean(config?.selectors || config?.item || config?.fields);
    if (records.length === 0 && !configured) {
      const loose = textContent(html);
      if (loose.length > 0) {
        records.push({
          matchKey: `page:${loose.slice(0, 40).toLowerCase()}`,
          entityType: 'OFFICIAL',
          fields: { fullName: loose.slice(0, 120), phone: null, email: null },
        });
      }
    }
    return records;
  },
};

export function collectorFor(key: string): Collector | undefined {
  return [tigerCollector, congressCollector, openStatesCollector, pageCollector].find((item) => item.key === key);
}

export function isKnownCollector(key: string): boolean {
  return collectorFor(key) !== undefined;
}

export function openStatesUrl(config: SourceConfig, sourceUrl: string): string {
  const base = config.urls?.[0] ?? sourceUrl;
  const state = config.state?.toLowerCase();
  if (state && (base.endsWith('/') || base.endsWith('/current'))) {
    const root = base.endsWith('/') ? base : `${base}/`;
    return `${root}${state}.csv`;
  }
  return base;
}

function pageFields(config: SourceConfig | undefined): Record<string, Selector> {
  const fields: Record<string, Selector> = { ...DEFAULT_FIELDS, ...config?.fields };
  const selectors = config?.selectors;
  if (selectors?.name) fields.fullName = selectors.name;
  if (selectors?.title) fields.title = selectors.title;
  if (selectors?.phone) fields.phone = selectors.phone;
  if (selectors?.email) fields.email = selectors.email;
  if (selectors?.address) fields.address = selectors.address;
  return fields;
}

function assertZip(contentType: string): void {
  const type = contentType.toLowerCase();
  if (type.includes('html') || type.includes('json') || type.startsWith('text/')) {
    throw new ValidationError('Download was not a boundary file.');
  }
}

function assertPage(contentType: string): void {
  const type = contentType.toLowerCase();
  if (!type || type.includes('html') || type.includes('text/plain') || type.includes('xml')) return;
  throw new ValidationError('Download was not an HTML page.');
}

function cleanValue(value: string | undefined, kind: 'text' | 'email' | 'phone'): string | null {
  if (!value) return null;
  const text = textContent(value).trim();
  if (!text) return null;
  if (kind === 'email') {
    const email = text.replace(/^mailto:/i, '').split('?')[0]?.trim() ?? '';
    return email.length > 0 ? email : null;
  }
  if (kind === 'phone') {
    const phone = text.replace(/^tel:/i, '').trim();
    return phone.length > 0 ? phone : null;
  }
  return text;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function featuresOf(value: unknown): TigerFeature[] {
  if (!value || typeof value !== 'object' || !('features' in value) || !Array.isArray(value.features)) return [];
  return value.features.filter((item): item is TigerFeature => Boolean(item) && typeof item === 'object');
}

function objectOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringOf(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = splitCsv(text).filter((line) => line.some((cell) => cell.length > 0));
  const header = lines[0];
  if (!header) return [];
  return lines.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    header.forEach((key, index) => {
      const value = cells[index];
      if (value !== undefined) row[key.trim()] = value.trim();
    });
    return row;
  });
}

function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char ?? '';
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') cell += char ?? '';
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/** Minimal YAML for a top-level list of maps, including one nested map and one list of maps. */
export function parseSimpleYaml(text: string): unknown[] {
  const rows: Record<string, unknown>[] = [];
  let current: Record<string, unknown> | undefined;
  let mapTarget: Record<string, unknown> | undefined;
  let listKey: string | undefined;
  let listItem: Record<string, unknown> | undefined;

  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (indent === 0 && line.startsWith('- ')) {
      current = {};
      rows.push(current);
      mapTarget = current;
      listKey = undefined;
      listItem = undefined;
      const opened = assignKey(current, line.slice(2));
      if (opened) {
        mapTarget = opened.child;
        listKey = opened.key;
      }
      continue;
    }
    if (!current) continue;
    if (line.startsWith('- ') && listKey) {
      const items = Array.isArray(current[listKey]) ? (current[listKey] as Record<string, unknown>[]) : [];
      current[listKey] = items;
      listItem = {};
      items.push(listItem);
      mapTarget = listItem;
      assignKey(listItem, line.slice(2));
      continue;
    }
    const target = listItem && indent >= 4 ? listItem : mapTarget && indent >= 4 ? mapTarget : current;
    const opened = assignKey(target, line);
    if (opened && target === current) {
      mapTarget = opened.child;
      listKey = opened.key;
      listItem = undefined;
    }
  }
  return rows;
}

function assignKey(target: Record<string, unknown>, body: string): { key: string; child: Record<string, unknown> } | undefined {
  const split = body.indexOf(':');
  if (split <= 0) return undefined;
  const key = body.slice(0, split).trim();
  const rawValue = body.slice(split + 1).trim();
  if (!key) return undefined;
  if (rawValue.length === 0) {
    const child: Record<string, unknown> = {};
    target[key] = child;
    return { key, child };
  }
  target[key] = scalar(rawValue);
  return undefined;
}

function scalar(value: string): string | null {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '');
  return trimmed.length > 0 ? trimmed : null;
}
