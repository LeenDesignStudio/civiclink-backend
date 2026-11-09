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
  tigerShapefileName,
  type TigerFeature,
  type TigerLayerId,
} from './tiger.js';
import { firstHttps, reviewEmail } from './contacts.js';
import {
  sha256Bytes,
  snapshotFrom,
  USER_AGENT,
  type Collector,
  type CollectorContext,
  type HttpResult,
  type NormalisedRecord,
  type RawSnapshot,
  type Selector,
  type SourceConfig,
} from './types.js';
import { congressPhotoUrl } from './photos.js';
import {
  encodePeopleEnvelope,
  parsePersonYaml,
  personById,
  readPeopleEnvelope,
  rolesForSeat,
  type PersonFile,
  type PersonRole,
} from './openstates-yaml.js';
import { chamberKind, seatFields } from './seats.js';
import { historyJson, type HistoryTerm } from './term-years.js';

const snapshotConfigs = new WeakMap<RawSnapshot, SourceConfig>();
const tigerPrepared = new WeakMap<RawSnapshot, NormalisedRecord[]>();
const decoder = new TextDecoder();

async function load(
  ctx: CollectorContext,
  url: string,
  timeoutMs = 60_000,
): Promise<HttpResult> {
  let response: HttpResult;
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
    const notes: string[] = [];
    let stateClip: Uint8Array | undefined;
    for (const layer of tigerLayerPlan(year, postal)) {
      if (layer.remoteClip) {
        if (!stateClip) throw new ValidationError('State boundary is required before ZCTA.');
        const geojson = await ctx.convertZip({
          zip: new Uint8Array(),
          layer: layer.id,
          shapefile: tigerShapefileName(layer.url),
          remoteUrl: layer.url,
          clipGeoJson: stateClip,
        });
        absorbTigerGeoJson(features, geojson, layer.id, postal, fips);
        files.push({ id: layer.id, sha256: sha256Bytes(geojson), bytes: geojson.byteLength });
        continue;
      }
      let response: HttpResult;
      try {
        response = await load(ctx, layer.url, TIGER_FETCH_TIMEOUT_MS);
      } catch (err) {
        if (isAppError(err) && !(err instanceof UpstreamError)) throw err;
        const timedOut = err instanceof UpstreamError && err.message === 'Download timed out.';
        throw new UpstreamError(timedOut ? `Boundary download timed out for ${layer.id}.` : `Boundary download failed for ${layer.id}.`);
      }
      if (response.status === 404 && layer.missingOk) {
        notes.push(`${layer.id} skipped: Census has no file for this state.`);
        continue;
      }
      if (response.status !== 200) throw new UpstreamError(`Boundary download failed for ${layer.id} (HTTP ${response.status}).`);
      const size = response.contentLength ?? response.body.byteLength;
      if (size > ctx.maxBytes) {
        if (layer.skipOverCap) {
          notes.push(`${layer.id} skipped: file is over the 50 MB cap.`);
          continue;
        }
        throw new ValidationError(`Download exceeded the size cap for ${layer.id}.`);
      }
      assertZip(response.contentType);
      if (layer.clip && !stateClip) throw new ValidationError('State boundary is required before ZCTA.');
      const geojson = await ctx.convertZip({
        zip: response.body,
        layer: layer.id,
        shapefile: tigerShapefileName(layer.url),
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
    if (notes.length > 0) snap.notice = notes.join(' ');
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
      const fullName = stringOf(name.official_full) ?? stringOf(item.fullName) ?? joinName(name);
      if (!bioguide || !fullName) continue;
      const terms = Array.isArray(item.terms) ? item.terms : [];
      const latest = objectOf(terms[terms.length - 1]);
      const state = stringOf(latest.state);
      if (want && state?.toUpperCase() !== want) continue;
      const history: HistoryTerm[] = [];
      for (const term of terms) {
        const itemTerm = objectOf(term);
        const seated = seatFields({
          state: stringOf(itemTerm.state),
          kind: chamberKind(stringOf(itemTerm.type)),
          district: stringOf(itemTerm.district),
          senateClass: stringOf(itemTerm.class),
          stateRank: stringOf(itemTerm.state_rank),
          personKey: bioguide,
          start: stringOf(itemTerm.start),
          end: stringOf(itemTerm.end),
          email: null,
          photoUrl: null,
          website: null,
        });
        if (!seated.officeKey || !seated.jurisdictionType || !seated.jurisdictionGeoid) continue;
        history.push({
          officeKey: seated.officeKey,
          officeName: seated.officeName ?? 'Office',
          jurisdictionType: seated.jurisdictionType,
          jurisdictionGeoid: seated.jurisdictionGeoid,
          seatLabel: seated.seatLabel ?? null,
          start: seated.termStart ?? null,
          end: seated.termEnd ?? null,
        });
      }
      const seat = seatFields({
        state,
        kind: chamberKind(stringOf(latest.type)),
        district: stringOf(latest.district),
        senateClass: stringOf(latest.class),
        stateRank: stringOf(latest.state_rank),
        personKey: bioguide,
        start: stringOf(latest.start),
        end: stringOf(latest.end),
        email: null,
        photoUrl: congressPhotoUrl(bioguide),
        website: stringOf(latest.url),
        phone: stringOf(latest.phone),
        address: stringOf(latest.address),
        contactForm: stringOf(latest.contact_form),
      });
      const past = historyJson(history);
      records.push({
        matchKey: `bioguide:${bioguide}`,
        entityType: 'OFFICIAL',
        fields: {
          fullName,
          party: stringOf(latest.party),
          state,
          ...seat,
          ...(past ? { termsJson: past } : {}),
        },
      });
    }
    return records;
  },
};

const OPENSTATES_YAML_CAP = 500;
const OPENSTATES_YAML_BYTES = 200_000;

export const openStatesCollector: Collector = {
  key: 'openstates.people',
  async fetch(ctx) {
    const response = await load(ctx, openStatesUrl(ctx.source.config, ctx.source.url));
    const people = await loadOpenStatesYaml(ctx);
    const body = people.length > 0 ? encodePeopleEnvelope(decoder.decode(response.body), people) : response.body;
    const snap = snapshotFrom(body, people.length > 0 ? 'application/json' : 'text/csv');
    snapshotConfigs.set(snap, ctx.source.config);
    return snap;
  },
  normalise(raw) {
    const want = snapshotConfigs.get(raw)?.state?.toUpperCase();
    const envelope = readPeopleEnvelope(raw.body);
    const people = personById(envelope.people);
    const records: NormalisedRecord[] = [];
    for (const row of parseCsv(envelope.csv)) {
      const id = row.id ?? row.openstates_id;
      const fullName = row.name ?? row.full_name;
      if (!id || !fullName) continue;
      const stateColumn = row.state;
      if (want && stateColumn && stateColumn.toUpperCase() !== want) continue;
      const state = stateColumn ?? want ?? null;
      const reviewed = reviewEmail(row.email ?? null, fullName);
      const chamber = chamberKind(row.current_chamber ?? row.chamber ?? null);
      const district = row.current_district ?? row.district ?? null;
      const dated = rolesForSeat(people.get(id), chamber, district);
      const seat = seatFields({
        state,
        kind: chamber,
        district,
        senateClass: null,
        stateRank: null,
        personKey: id,
        start: dated.current?.start ?? null,
        end: dated.current?.end ?? null,
        email: reviewed.publish,
        photoUrl: row.image ?? null,
        website: firstHttps(row.links ?? null),
        phone: row.capitol_voice ?? row.district_voice ?? row.voice ?? null,
        capitolAddress: row.capitol_address ?? null,
        districtAddress: row.district_address ?? null,
      });
      const past = historyJson(
        openStatesHistory(state, id, chamber, dated.current ? [...dated.earlier, dated.current] : dated.earlier),
      );
      records.push({
        matchKey: `openstates:${id}`,
        entityType: 'OFFICIAL',
        fields: {
          fullName,
          party: row.party ?? row.current_party ?? null,
          state,
          ...seat,
          ...(past ? { termsJson: past } : {}),
          ...(reviewed.review ? { emailReview: reviewed.review } : {}),
        },
      });
    }
    return records;
  },
};

function openStatesHistory(
  state: string | null,
  personKey: string,
  chamber: ReturnType<typeof chamberKind>,
  roles: PersonRole[],
): HistoryTerm[] {
  if (!state || !chamber) return [];
  const terms: HistoryTerm[] = [];
  for (const role of roles) {
    const seated = seatFields({
      state,
      kind: chamber,
      district: role.district,
      senateClass: null,
      stateRank: null,
      personKey,
      start: role.start,
      end: role.end,
      email: null,
      photoUrl: null,
      website: null,
    });
    if (!seated.officeKey || !seated.jurisdictionType || !seated.jurisdictionGeoid) continue;
    terms.push({
      officeKey: seated.officeKey,
      officeName: seated.officeName ?? 'Office',
      jurisdictionType: seated.jurisdictionType,
      jurisdictionGeoid: seated.jurisdictionGeoid,
      seatLabel: seated.seatLabel ?? null,
      start: seated.termStart ?? null,
      end: seated.termEnd ?? null,
    });
  }
  return terms;
}

async function loadOpenStatesYaml(ctx: CollectorContext): Promise<PersonFile[]> {
  const state = ctx.source.config.state?.trim().toLowerCase();
  if (!state || !/^[a-z]{2}$/.test(state)) return [];
  const listUrl = `https://api.github.com/repos/openstates/people/contents/data/${state}/legislature?ref=main`;
  let listing: HttpResult;
  try {
    listing = await load(ctx, listUrl, 30_000);
  } catch {
    return [];
  }
  if (listing.status !== 200) return [];
  const files = yamlDownloadUrls(listing.body).slice(0, OPENSTATES_YAML_CAP);
  const people: PersonFile[] = [];
  for (const url of files) {
    if (ctx.pace) await ctx.pace.wait();
    let file: HttpResult;
    try {
      file = await ctx.fetch.get(url, {
        maxBytes: OPENSTATES_YAML_BYTES,
        timeoutMs: 30_000,
        headers: { 'user-agent': ctx.userAgent ?? USER_AGENT, accept: 'text/yaml' },
      });
    } catch {
      continue;
    }
    if (file.status !== 200 || file.body.byteLength > OPENSTATES_YAML_BYTES) continue;
    const parsed = parsePersonYaml(decoder.decode(file.body));
    if (parsed) people.push(parsed);
  }
  return people;
}

function yamlDownloadUrls(body: Uint8Array): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(body));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const urls: string[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { type?: unknown; name?: unknown; download_url?: unknown };
    if (row.type !== 'file' || typeof row.name !== 'string' || !row.name.endsWith('.yml')) continue;
    if (typeof row.download_url !== 'string' || !row.download_url.startsWith('https://')) continue;
    urls.push(row.download_url);
  }
  return urls;
}

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
      const matchKey = config?.jurisdictionGeoid
        ? `page:${config.jurisdictionGeoid}:${fullName.toLowerCase()}`
        : `page:${fullName.toLowerCase()}`;
      const directory = JSON.stringify({
        officeId: officeId ?? null,
        officeName: (config?.officeName ?? title ?? 'Office').slice(0, 150),
        jurisdictionGeoid: config?.jurisdictionGeoid ?? null,
        fullName,
        title: title ?? null,
        phone: phone ?? null,
        email: email ?? null,
        address: address ?? null,
      });
      records.push({
        matchKey,
        entityType: 'OFFICE',
        ...(officeId ? { entityId: officeId } : {}),
        fields: { directory },
      });
    }
    const configured = Boolean(config?.selectors || config?.item || config?.fields);
    if (records.length === 0 && !configured) {
      const loose = textContent(html);
      if (loose.length > 0) {
        const fullName = loose.slice(0, 120);
        records.push({
          matchKey: `page:${fullName.slice(0, 40).toLowerCase()}`,
          entityType: 'OFFICE',
          fields: {
            directory: JSON.stringify({
              officeId: null,
              officeName: 'Office',
              jurisdictionGeoid: null,
              fullName,
              title: null,
              phone: null,
              email: null,
              address: null,
            }),
          },
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

function absorbTigerGeoJson(
  features: TigerFeature[],
  geojson: Uint8Array,
  layerId: TigerLayerId,
  postal: string,
  fips: string,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(geojson)) as unknown;
  } catch {
    throw new ValidationError('Boundary file could not be parsed.');
  }
  for (const feature of featuresOf(parsed)) {
    const props = objectOf(feature.properties);
    if (!keepTigerFeature(props, layerId, postal, fips)) continue;
    features.push({ geometry: feature.geometry, properties: { ...props, tigerLayer: layerId } });
  }
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

/**
 * Minimal YAML for legislators-current.yaml: a top-level list of maps, nested maps,
 * a list of scalars (id.fec), and a list of maps (terms) at indent 2 or 4.
 */
export function parseSimpleYaml(text: string): unknown[] {
  const rows: Record<string, unknown>[] = [];
  let current: Record<string, unknown> | undefined;
  const frames: { indent: number; record: Record<string, unknown> }[] = [];
  let pending: { indent: number; owner: Record<string, unknown>; key: string } | undefined;
  let seq: { indent: number; record: Record<string, unknown> } | undefined;

  const parentAt = (indent: number): Record<string, unknown> | undefined => {
    if (seq && indent > seq.indent) return seq.record;
    if (seq && indent <= seq.indent) seq = undefined;
    while (frames.length > 1 && (frames[frames.length - 1]?.indent ?? 0) >= indent) frames.pop();
    return frames[frames.length - 1]?.record;
  };

  const openMap = (owner: Record<string, unknown>, opened: { key: string; child: Record<string, unknown> }, keyIndent: number) => {
    frames.push({ indent: keyIndent, record: opened.child });
    pending = { indent: keyIndent, owner, key: opened.key };
  };

  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (line === '---' || line === '...') continue;

    if (indent === 0 && line.startsWith('- ')) {
      current = {};
      rows.push(current);
      frames.length = 0;
      frames.push({ indent: 0, record: current });
      pending = undefined;
      seq = undefined;
      const opened = assignKey(current, line.slice(2));
      if (opened) openMap(current, opened, 2);
      continue;
    }
    if (!current) continue;
    if (pending && !line.startsWith('- ') && indent <= pending.indent) pending = undefined;

    if (line.startsWith('- ')) {
      if (!pending || indent < pending.indent) continue;
      const items = Array.isArray(pending.owner[pending.key]) ? (pending.owner[pending.key] as unknown[]) : [];
      pending.owner[pending.key] = items;
      const body = line.slice(2).trim();
      if (body.includes(':')) {
        const item: Record<string, unknown> = {};
        items.push(item);
        seq = { indent, record: item };
        const opened = assignKey(item, body);
        if (opened) openMap(item, opened, indent + 2);
      } else {
        items.push(scalar(body));
        seq = undefined;
      }
      continue;
    }

    const owner = parentAt(indent);
    if (!owner) continue;
    const opened = assignKey(owner, line);
    if (opened) openMap(owner, opened, indent);
  }
  return rows;
}

function joinName(name: Record<string, unknown>): string | null {
  const first = stringOf(name.first);
  const last = stringOf(name.last);
  const full = [first, last].filter((part) => part !== null).join(' ');
  return full.length > 0 ? full : null;
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
