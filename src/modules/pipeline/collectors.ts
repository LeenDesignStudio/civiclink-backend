import { extractElements, extractField, textContent } from './html.js';
import { robotsDisallows } from './robots.js';
import {
  snapshotFrom,
  USER_AGENT,
  type Collector,
  type CollectorContext,
  type NormalisedRecord,
  type RawSnapshot,
  type Selector,
  type SourceConfig,
} from './types.js';

const pageConfigs = new WeakMap<RawSnapshot, SourceConfig>();

const decoder = new TextDecoder();

async function load(ctx: CollectorContext, url: string): Promise<{ status: number; body: Uint8Array; contentType: string }> {
  return ctx.fetch.get(url, {
    maxBytes: ctx.maxBytes,
    timeoutMs: 60_000,
    headers: { 'user-agent': USER_AGENT, accept: 'application/json,text/csv,text/html' },
  });
}

export const tigerCollector: Collector = {
  key: 'tiger.boundaries',
  async fetch(ctx) {
    const url = ctx.source.config.urls?.[0] ?? ctx.source.url;
    const response = await load(ctx, url);
    return snapshotFrom(response.body, response.contentType || 'application/geo+json');
  },
  normalise(raw) {
    const parsed: unknown = JSON.parse(decoder.decode(raw.body));
    const features = featuresOf(parsed);
    const records: NormalisedRecord[] = [];
    for (const feature of features) {
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
    return snapshotFrom(response.body, 'application/json');
  },
  normalise(raw) {
    const text = decoder.decode(raw.body);
    const parsed: unknown = text.trim().startsWith('[') || text.trim().startsWith('{') ? JSON.parse(text) : parseSimpleYaml(text);
    const rows = Array.isArray(parsed) ? parsed : [];
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
      records.push({
        matchKey: `bioguide:${bioguide}`,
        entityType: 'OFFICIAL',
        fields: {
          fullName,
          party: stringOf(latest.party),
          state: stringOf(latest.state),
        },
      });
    }
    return records;
  },
};

export const openStatesCollector: Collector = {
  key: 'openstates.people',
  async fetch(ctx) {
    const response = await load(ctx, ctx.source.config.urls?.[0] ?? ctx.source.url);
    return snapshotFrom(response.body, 'text/csv');
  },
  normalise(raw) {
    const rows = parseCsv(decoder.decode(raw.body));
    const records: NormalisedRecord[] = [];
    for (const row of rows) {
      const id = row.id ?? row['openstates_id'];
      const fullName = row.name ?? row.full_name;
      if (!id || !fullName) continue;
      records.push({
        matchKey: `openstates:${id}`,
        entityType: 'OFFICIAL',
        fields: {
          fullName,
          party: row.party ?? null,
          state: row.state ?? null,
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
    const pageUrl = new URL(ctx.source.config.urls?.[0] ?? ctx.source.url);
    const robotsUrl = new URL('/robots.txt', pageUrl.origin).toString();
    const robots = await load(ctx, robotsUrl);
    if (robots.status === 200 && robotsDisallows(decoder.decode(robots.body), pageUrl.pathname)) {
      return snapshotFrom(new Uint8Array(), 'text/html', 'robots');
    }
    const response = await load(ctx, pageUrl.toString());
    const snap = snapshotFrom(response.body, response.contentType || 'text/html');
    pageConfigs.set(snap, ctx.source.config);
    return snap;
  },
  normalise(raw) {
    if (raw.skipped === 'robots') return [];
    const config = pageConfigs.get(raw);
    const html = decoder.decode(raw.body);
    const item = config?.item ?? DEFAULT_ITEM;
    const fields = { ...DEFAULT_FIELDS, ...config?.fields };
    const blocks = extractElements(html, item);
    const records: NormalisedRecord[] = [];
    for (const block of blocks) {
      const fullName = extractField(block, fields.fullName ?? DEFAULT_FIELDS.fullName ?? { tag: 'h2' });
      if (!fullName) continue;
      const phone = extractField(block, fields.phone ?? { tag: 'span', className: 'phone' });
      const emailSel = fields.email ?? { tag: 'a', className: 'email', attr: 'href' };
      const emailRaw = extractField(block, emailSel);
      records.push({
        matchKey: `page:${fullName.toLowerCase()}`,
        entityType: 'OFFICIAL',
        fields: {
          fullName,
          phone: phone ?? null,
          email: emailRaw?.replace(/^mailto:/i, '') ?? null,
        },
      });
    }
    if (records.length === 0) {
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

function featuresOf(value: unknown): { properties?: unknown }[] {
  if (!value || typeof value !== 'object' || !('features' in value) || !Array.isArray(value.features)) return [];
  return value.features.filter((item): item is { properties?: unknown } => Boolean(item) && typeof item === 'object');
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

/** Minimal YAML for a top-level list of maps, enough for legislator fixtures. */
export function parseSimpleYaml(text: string): unknown[] {
  const rows: Record<string, unknown>[] = [];
  let current: Record<string, unknown> | undefined;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (raw.startsWith('- ')) {
      current = {};
      rows.push(current);
      const rest = raw.slice(2);
      const split = rest.indexOf(':');
      if (split > 0) current[rest.slice(0, split).trim()] = scalar(rest.slice(split + 1));
      continue;
    }
    if (!current) continue;
    const split = raw.indexOf(':');
    if (split < 0) continue;
    current[raw.slice(0, split).trim()] = scalar(raw.slice(split + 1));
  }
  return rows;
}

function scalar(value: string): string | null {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '');
  return trimmed.length > 0 ? trimmed : null;
}
