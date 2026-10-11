import { ValidationError } from '../../lib/errors.js';
import type { NormalisedRecord } from './types.js';

export const DEFAULT_TIGER_YEAR = 2025;
export const TIGER_FETCH_TIMEOUT_MS = 120_000;

export type TigerLayerId =
  | 'STATE'
  | 'CD'
  | 'SLDU'
  | 'SLDL'
  | 'COUNTY'
  | 'PLACE'
  | 'COUSUB'
  | 'UNSD'
  | 'ELSD'
  | 'SCSD'
  | 'ZCTA520';

export interface TigerLayerPlan {
  id: TigerLayerId;
  url: string;
  where?: string;
  clip: boolean;
  missingOk?: boolean;
  skipOverCap?: boolean;
}

export interface TigerFeature {
  properties?: unknown;
  geometry?: unknown;
}

const FIPS: Record<string, string> = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10', DC: '11', FL: '12',
  GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19', KS: '20', KY: '21', LA: '22', ME: '23',
  MD: '24', MA: '25', MI: '26', MN: '27', MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33',
  NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44',
  SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53', WV: '54', WI: '55',
  WY: '56',
};

const LAYER_TYPE: Record<TigerLayerId, { type: string; level: string; subtype?: string }> = {
  STATE: { type: 'STATE', level: 'STATE' },
  CD: { type: 'CONGRESSIONAL_DISTRICT', level: 'FEDERAL' },
  SLDU: { type: 'STATE_SENATE_DISTRICT', level: 'STATE' },
  SLDL: { type: 'STATE_HOUSE_DISTRICT', level: 'STATE' },
  COUNTY: { type: 'COUNTY', level: 'COUNTY' },
  PLACE: { type: 'MUNICIPALITY', level: 'MUNICIPAL' },
  COUSUB: { type: 'MUNICIPALITY', level: 'MUNICIPAL', subtype: 'COUSUB' },
  UNSD: { type: 'SCHOOL_DISTRICT', level: 'EDUCATION', subtype: 'UNSD' },
  ELSD: { type: 'SCHOOL_DISTRICT', level: 'EDUCATION', subtype: 'ELSD' },
  SCSD: { type: 'SCHOOL_DISTRICT', level: 'EDUCATION', subtype: 'SCSD' },
  ZCTA520: { type: 'ZCTA', level: 'SPECIAL' },
};

const TYPE_RANK: Record<string, number> = { STATE: 0, COUNTY: 1 };

export function congressNumber(year: number): number {
  return Math.floor((year - 1789) / 2) + 1;
}

export function stateFips(postal: string): string {
  const fips = FIPS[postal.toUpperCase()];
  if (!fips) throw new ValidationError('Unknown state code.');
  return fips;
}

export function tigerShapefileName(url: string): string {
  const name = url.split('/').pop() ?? '';
  if (name.toLowerCase().endsWith('.zip')) return `${name.slice(0, -4)}.shp`;
  return name.length > 0 ? name : 'layer.shp';
}

export function tigerLayerPlan(year: number, postal: string): TigerLayerPlan[] {
  const state = postal.toUpperCase();
  const fips = stateFips(state);
  const congress = String(congressNumber(year));
  const base = `https://www2.census.gov/geo/tiger/TIGER${year}`;
  const national = (folder: string, file: string, where: string): TigerLayerPlan => ({
    id: folder as TigerLayerId,
    url: `${base}/${folder}/${file}`,
    where,
    clip: false,
  });
  const stateFile = (id: TigerLayerId, missingOk = false): TigerLayerPlan => ({
    id,
    url: `${base}/${id}/tl_${year}_${fips}_${id.toLowerCase()}.zip`,
    clip: false,
    ...(missingOk ? { missingOk: true } : {}),
  });
  return [
    national('STATE', `tl_${year}_us_state.zip`, `STUSPS='${state}'`),
    {
      id: 'CD',
      url: `${base}/CD/tl_${year}_${fips}_cd${congress}.zip`,
      where: `STATEFP='${fips}'`,
      clip: false,
    },
    stateFile('SLDU'),
    stateFile('SLDL'),
    {
      id: 'COUNTY',
      url: `https://www2.census.gov/geo/tiger/GENZ${year}/shp/cb_${year}_us_county_500k.zip`,
      where: `STATEFP='${fips}'`,
      clip: false,
    },
    stateFile('PLACE'),
    stateFile('COUSUB'),
    stateFile('UNSD'),
    stateFile('ELSD', true),
    stateFile('SCSD', true),
    { id: 'ZCTA520', url: `${base}/ZCTA520/tl_${year}_us_zcta520.zip`, clip: true, skipOverCap: true },
  ];
}

export function keepTigerFeature(properties: Record<string, unknown>, layer: TigerLayerId, postal: string, fips: string): boolean {
  if (layer === 'ZCTA520') return true;
  const stusps = stringOf(properties.STUSPS);
  if (stusps) return stusps.toUpperCase() === postal.toUpperCase();
  const statefp = stringOf(properties.STATEFP);
  if (statefp) return statefp.padStart(2, '0') === fips;
  const geoid = stringOf(properties.GEOID) ?? stringOf(properties.GEOID20);
  if (geoid && geoid.length >= 2) return geoid.slice(0, 2) === fips;
  return false;
}

export function tigerRecordsFromFeatures(features: TigerFeature[], year: number, postal: string): NormalisedRecord[] {
  const fips = stateFips(postal);
  const vintage = `TIGER${year}`;
  const byKey = new Map<string, NormalisedRecord>();
  for (const feature of features) {
    const props = objectOf(feature.properties);
    const layer = stringOf(props.tigerLayer);
    if (!layer || !(layer in LAYER_TYPE)) continue;
    const layerId = layer as TigerLayerId;
    if (!keepTigerFeature(props, layerId, postal, fips)) continue;
    const geoid = geoidOf(props);
    if (!geoid) continue;
    const meta = LAYER_TYPE[layerId];
    const fields: Record<string, string | null> = {
      name: stringOf(props.NAME) ?? stringOf(props.NAMELSAD) ?? geoid,
      geoid,
      state: postal.toUpperCase(),
      type: meta.type,
      level: meta.level,
      boundaryVintage: vintage,
    };
    if (meta.subtype) fields.subtype = meta.subtype;
    const parent = parentOf(layerId, props, fips);
    if (parent) {
      fields.parentType = parent.type;
      fields.parentGeoid = parent.geoid;
    }
    if (layerId === 'CD') fields.districtCode = geoid;
    if (feature.geometry && typeof feature.geometry === 'object') fields.geometry = JSON.stringify(feature.geometry);
    byKey.set(`${meta.type}:${geoid}`, {
      matchKey: `tiger:${geoid}`,
      entityType: 'JURISDICTION',
      fields,
    });
  }
  return [...byKey.values()].sort((left, right) => rank(left.fields.type) - rank(right.fields.type));
}

export function tigerManifest(files: { id: string; sha256: string; bytes: number }[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ files }));
}

function parentOf(layer: TigerLayerId, props: Record<string, unknown>, fips: string): { type: string; geoid: string } | undefined {
  if (layer === 'STATE') return undefined;
  const county = fipsPart(stringOf(props.COUNTYFP), 3);
  if ((layer === 'PLACE' || layer === 'COUSUB') && county) return { type: 'COUNTY', geoid: `${fips}${county}` };
  return { type: 'STATE', geoid: fips };
}

function rank(type: string | null | undefined): number {
  return TYPE_RANK[type ?? ''] ?? 2;
}

function geoidOf(props: Record<string, unknown>): string | null {
  return stringOf(props.GEOID) ?? stringOf(props.GEOID20) ?? stringOf(props.ZCTA5CE20) ?? stringOf(props.geoid);
}

function fipsPart(value: string | null, width: number): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (!digits) return null;
  return digits.padStart(width, '0');
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
