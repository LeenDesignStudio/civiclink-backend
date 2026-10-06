import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { SpatialRepo } from './spatial.repo.js';
import { appDb, ownerDb, truncateAll } from '../../test/setup/db.js';
import { createJurisdiction, createSource } from '../../test/factories/index.js';
import {
  county,
  districtA,
  districtB,
  municipality,
  pointInsideA,
  pointInsideB,
  pointNearBorder,
  pointOutside,
  zcta,
} from '../../test/fixtures/geo/squares.js';

describe('spatial queries', () => {
  let app: PrismaClient;
  let owner: PrismaClient;
  let spatial: SpatialRepo;
  let ids: { a: string; b: string; county: string; city: string; zcta: string };

  beforeAll(async () => {
    app = appDb();
    owner = ownerDb();
    await truncateAll(owner);
    spatial = new SpatialRepo(app);
    const source = await createSource(app);
    const a = await createJurisdiction(app, source.id, {
      name: 'District A',
      type: 'CONGRESSIONAL_DISTRICT',
      level: 'FEDERAL',
    });
    const b = await createJurisdiction(app, source.id, {
      name: 'District B',
      type: 'CONGRESSIONAL_DISTRICT',
      level: 'FEDERAL',
    });
    const countyRow = await createJurisdiction(app, source.id, { name: 'County', type: 'COUNTY', level: 'COUNTY' });
    const city = await createJurisdiction(app, source.id, {
      name: 'City',
      type: 'MUNICIPALITY',
      level: 'MUNICIPAL',
    });
    const zip = await createJurisdiction(app, source.id, {
      name: '20001',
      type: 'ZCTA',
      level: 'SPECIAL',
      geoid: '20001',
    });
    await spatial.upsertBoundary(a.id, JSON.stringify(districtA), '2026');
    await spatial.upsertBoundary(b.id, JSON.stringify(districtB), '2026');
    await spatial.upsertBoundary(countyRow.id, JSON.stringify(county), '2026');
    await spatial.upsertBoundary(city.id, JSON.stringify(municipality), '2026');
    await spatial.upsertBoundary(zip.id, JSON.stringify(zcta), '2026');
    ids = { a: a.id, b: b.id, county: countyRow.id, city: city.id, zcta: zip.id };
    expect([ids.a, ids.b, ids.county, ids.city, ids.zcta]).toHaveLength(5);
  });

  afterAll(async () => {
    await app.$disconnect();
    await owner.$disconnect();
  });

  it('contains the right jurisdictions for each fixture point', async () => {
    const insideA = names(await spatial.jurisdictionsContainingPoint(...pointInsideA.coordinates));
    expect(insideA).toEqual(expect.arrayContaining(['District A', 'County', 'City']));
    expect(insideA).not.toContain('District B');

    const insideB = names(await spatial.jurisdictionsContainingPoint(...pointInsideB.coordinates));
    expect(insideB).toContain('District B');
    expect(insideB).not.toContain('District A');

    const outside = await spatial.jurisdictionsContainingPoint(...pointOutside.coordinates);
    expect(outside).toEqual([]);
  });

  it('detects a district within 50 metres of the shared border', async () => {
    const [lng, lat] = pointNearBorder.coordinates;
    expect(await spatial.nearBoundary(ids.a, lng, lat, 50)).toBe(true);
  });

  it('resolves a ZCTA by ZIP', async () => {
    expect(await spatial.zctaByZip('20001')).toBe(ids.zcta);
  });
});

function names(rows: { name: string }[]): string[] {
  return rows.map((row) => row.name);
}
