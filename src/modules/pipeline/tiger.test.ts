import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../lib/errors.js';
import { tigerCollector } from './collectors.js';
import { ogrArguments } from './ogr.js';
import type { SourceRow } from './records.js';
import { congressNumber, stateFips, tigerLayerPlan, tigerRecordsFromFeatures, tigerShapefileName, TIGER_FETCH_TIMEOUT_MS } from './tiger.js';
import { BULK_CAP, type HttpFetcher } from './types.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/tiger-md.geojson', import.meta.url), 'utf8')) as {
  features: { properties: { tigerLayer: string } }[];
};

const source = (config: SourceRow['config'] = {}): SourceRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Census TIGER/Line',
  publisher: 'U.S. Census Bureau',
  url: 'https://www2.census.gov/geo/tiger/TIGER2025/',
  termsUrl: 'https://www.census.gov/programs-surveys/geography/guidance/tiger-data-products-guide.html',
  method: 'BULK',
  schedule: 'QUARTERLY',
  freshnessDays: 90,
  levels: ['STATE'],
  collectorKey: 'tiger.boundaries',
  active: true,
  lastRunAt: null,
  config,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
});

describe('tiger layer plan', () => {
  it('builds the 119th Congress layers for Maryland in 2025', () => {
    expect(congressNumber(2025)).toBe(119);
    expect(congressNumber(2026)).toBe(119);
    expect(stateFips('MD')).toBe('24');
    const plan = tigerLayerPlan(2025, 'MD');
    expect(plan.map((layer) => layer.id)).toEqual([
      'STATE',
      'CD',
      'SLDU',
      'SLDL',
      'COUNTY',
      'PLACE',
      'COUSUB',
      'UNSD',
      'ELSD',
      'SCSD',
      'ZCTA520',
    ]);
    expect(plan[0]?.url).toBe('https://www2.census.gov/geo/tiger/TIGER2025/STATE/tl_2025_us_state.zip');
    expect(tigerShapefileName(plan[0]?.url ?? '')).toBe('tl_2025_us_state.shp');
    expect(plan.find((layer) => layer.id === 'CD')?.url).toBe('https://www2.census.gov/geo/tiger/TIGER2025/CD/tl_2025_24_cd119.zip');
    expect(plan.find((layer) => layer.id === 'COUNTY')?.url).toContain('cb_2025_us_county_500k.zip');
    expect(plan.find((layer) => layer.id === 'ELSD')?.missingOk).toBe(true);
    expect(plan.find((layer) => layer.id === 'PLACE')?.url).toContain('tl_2025_24_place.zip');
    expect(plan.find((layer) => layer.id === 'ZCTA520')?.clip).toBe(true);
    expect(ogrArguments({ zipPath: 'layer.zip', outPath: 'out.geojson', where: "STUSPS='MD'" })).toContain('-where');
    expect(ogrArguments({ zipPath: 'layer.zip', outPath: 'out.geojson', clipPath: 'clip.geojson' })).toContain('-clipsrc');
    expect(
      ogrArguments({ zipPath: '/tmp/layer.zip', outPath: 'out.geojson', shapefile: 'tl_2025_us_state.shp' }).at(-1),
    ).toBe('/vsizip//tmp/layer.zip/tl_2025_us_state.shp');
  });

  it('maps a saved GeoJSON extract to parented jurisdictions', () => {
    const records = tigerRecordsFromFeatures(fixture.features, 2025, 'MD');
    expect(records.map((row) => row.fields.type)).toEqual(['STATE', 'COUNTY', 'MUNICIPALITY']);
    const state = records[0];
    const county = records[1];
    const place = records[2];
    expect(state?.fields.geoid).toBe('24');
    expect(state?.fields.parentGeoid).toBeUndefined();
    expect(state?.fields.boundaryVintage).toBe('TIGER2025');
    expect(state?.fields.geometry).toContain('Polygon');
    expect(county?.matchKey).toBe('tiger:24031');
    expect(county?.fields.parentType).toBe('STATE');
    expect(county?.fields.parentGeoid).toBe('24');
    expect(place?.fields.parentType).toBe('COUNTY');
    expect(place?.fields.parentGeoid).toBe('24031');
    expect(place?.fields.name).toBe('Rockville');
  });
});

describe('tiger collector', () => {
  it('downloads each layer under the size cap and stores a checksum manifest', async () => {
    const plan = tigerLayerPlan(2025, 'MD');
    const calls: { url: string; timeoutMs: number; maxBytes: number }[] = [];
    const converted: string[] = [];
    const fetch: HttpFetcher = {
      get(url, init) {
        calls.push({ url, timeoutMs: init.timeoutMs, maxBytes: init.maxBytes });
        return Promise.resolve({ status: 200, body: new Uint8Array([1, 2, 3, 4]), contentType: 'application/zip' });
      },
    };
    const snap = await tigerCollector.fetch({
      source: source({ state: 'MD', tigerYear: 2025 }),
      fetch,
      maxBytes: BULK_CAP,
      convertZip: (request) => {
        converted.push(request.layer);
        if (request.layer === 'ZCTA520') expect(request.clipGeoJson).toBeInstanceOf(Uint8Array);
        const features = request.layer === 'COUNTY' ? fixture.features.filter((feature) => feature.properties.tigerLayer === 'COUNTY') : [];
        return Promise.resolve(new TextEncoder().encode(JSON.stringify({ type: 'FeatureCollection', features })));
      },
    });
    expect(calls.map((call) => call.url)).toEqual(plan.map((layer) => layer.url));
    expect(calls[0]?.timeoutMs).toBe(TIGER_FETCH_TIMEOUT_MS);
    expect(calls[0]?.maxBytes).toBe(BULK_CAP);
    expect(converted).toHaveLength(11);
    expect(snap.sha256).toMatch(/^[a-f0-9]{64}$/);
    const manifest = JSON.parse(new TextDecoder().decode(snap.body)) as { files: { sha256: string }[] };
    expect(manifest.files).toHaveLength(11);
    expect(manifest.files[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    const records = tigerCollector.normalise(snap);
    expect(records.map((row) => row.fields.geoid)).toEqual(['24031']);
  });

  it('refuses a layer over the size cap before conversion', async () => {
    let converted = 0;
    const plan = tigerLayerPlan(2025, 'MD');
    await expect(
      tigerCollector.fetch({
        source: source({ state: 'MD', tigerYear: 2025 }),
        maxBytes: 8,
        fetch: {
          get: (url) =>
            Promise.resolve({
              status: 200,
              body: url === plan[0]?.url ? new Uint8Array(9) : new Uint8Array([1]),
              contentType: 'application/zip',
            }),
        },
        convertZip: () => {
          converted += 1;
          return Promise.resolve(new Uint8Array());
        },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(converted).toBe(0);
  });

  it('skips school-district files Census does not publish and a ZCTA file over the cap', async () => {
    const plan = tigerLayerPlan(2025, 'MD');
    const snap = await tigerCollector.fetch({
      source: source({ state: 'MD', tigerYear: 2025 }),
      maxBytes: 8,
      fetch: {
        get: (url) => {
          const layer = plan.find((item) => item.url === url);
          if (layer?.id === 'ELSD' || layer?.id === 'SCSD') {
            return Promise.resolve({ status: 404, body: new Uint8Array(), contentType: 'text/html' });
          }
          if (layer?.id === 'ZCTA520') {
            return Promise.resolve({ status: 200, body: new Uint8Array(), contentType: 'application/zip', contentLength: 9 });
          }
          return Promise.resolve({ status: 200, body: new Uint8Array([1]), contentType: 'application/zip' });
        },
      },
      convertZip: (request) => {
        const features = request.layer === 'COUNTY' ? fixture.features.filter((feature) => feature.properties.tigerLayer === 'COUNTY') : [];
        return Promise.resolve(new TextEncoder().encode(JSON.stringify({ type: 'FeatureCollection', features })));
      },
    });
    expect(snap.notice).toContain('ELSD skipped');
    expect(snap.notice).toContain('SCSD skipped');
    expect(snap.notice).toContain('ZCTA520 skipped');
    const manifest = JSON.parse(new TextDecoder().decode(snap.body)) as { files: { id: string }[] };
    expect(manifest.files.map((file) => file.id)).not.toContain('ZCTA520');
    expect(tigerCollector.normalise(snap).map((row) => row.fields.geoid)).toEqual(['24031']);
  });
});
