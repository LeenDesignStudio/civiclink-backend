import type { GovLevel, JurisdictionType } from '../generated/prisma/enums.js';
import { dbCall, type Db } from './prisma.js';

export interface ContainingJurisdiction {
  id: string;
  level: GovLevel;
  type: JurisdictionType;
  name: string;
}

export interface IntersectingJurisdiction {
  id: string;
  level: GovLevel;
  type: JurisdictionType;
  share: number;
}

export class SpatialRepo {
  constructor(private readonly db: Db) {}

  jurisdictionsContainingPoint(lng: number, lat: number): Promise<ContainingJurisdiction[]> {
    return dbCall(() =>
      this.db.$queryRaw<ContainingJurisdiction[]>`
        SELECT j.id, j.level::text AS level, j.type::text AS type, j.name
        FROM jurisdictions j
        WHERE j.status = 'ACTIVE'
          AND j.boundary IS NOT NULL
          AND ST_Contains(j.boundary, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))
      `,
    );
  }

  jurisdictionsIntersectingArea(
    areaJurisdictionId: string,
    minShare = 0.01,
  ): Promise<IntersectingJurisdiction[]> {
    return dbCall(() =>
      this.db.$queryRaw<IntersectingJurisdiction[]>`
        WITH area AS (
          SELECT boundary FROM jurisdictions WHERE id = ${areaJurisdictionId}::uuid
        )
        SELECT j.id,
               j.level::text AS level,
               j.type::text AS type,
               (ST_Area(ST_Intersection(j.boundary, area.boundary)::geography)
                 / NULLIF(ST_Area(area.boundary::geography), 0))::float8 AS share
        FROM jurisdictions j
        CROSS JOIN area
        WHERE j.status = 'ACTIVE'
          AND j.id <> ${areaJurisdictionId}::uuid
          AND j.boundary IS NOT NULL
          AND area.boundary IS NOT NULL
          AND ST_Intersects(j.boundary, area.boundary)
          AND (ST_Area(ST_Intersection(j.boundary, area.boundary)::geography)
                / NULLIF(ST_Area(area.boundary::geography), 0)) >= ${minShare}
      `,
    );
  }

  async nearBoundary(jurisdictionId: string, lng: number, lat: number, meters = 50): Promise<boolean> {
    const rows = await dbCall(() =>
      this.db.$queryRaw<{ near: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM jurisdictions other
          JOIN jurisdictions origin ON origin.id = ${jurisdictionId}::uuid
          WHERE other.id <> origin.id
            AND other.type = origin.type
            AND other.status = 'ACTIVE'
            AND other.boundary IS NOT NULL
            AND ST_DWithin(
              other.boundary::geography,
              ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
              ${meters}
            )
        ) AS near
      `,
    );
    return rows[0]?.near ?? false;
  }

  setSavedLocationPoint(id: string, lng: number, lat: number): Promise<number> {
    return dbCall(() =>
      this.db.$executeRaw`
        UPDATE saved_locations
        SET point = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326),
            updated_at = now()
        WHERE id = ${id}::uuid
      `,
    );
  }

  setLookupGeom(id: string, geojson: string): Promise<number> {
    return dbCall(() =>
      this.db.$executeRaw`
        UPDATE lookups
        SET geom = ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326),
            updated_at = now()
        WHERE id = ${id}::uuid
      `,
    );
  }

  upsertBoundary(id: string, geojson: string, vintage?: string): Promise<number> {
    return dbCall(() =>
      this.db.$executeRaw`
        UPDATE jurisdictions
        SET boundary = ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326))),
            boundary_vintage = COALESCE(${vintage ?? null}, boundary_vintage),
            updated_at = now()
        WHERE id = ${id}::uuid
      `,
    );
  }

  async zctaByZip(zip: string): Promise<string | undefined> {
    const rows = await dbCall(() =>
      this.db.$queryRaw<{ id: string }[]>`
        SELECT id FROM jurisdictions
        WHERE type = 'ZCTA' AND status = 'ACTIVE' AND geoid = ${zip}
        LIMIT 1
      `,
    );
    return rows[0]?.id;
  }

  async placeByNameState(name: string, state: string): Promise<string | undefined> {
    const rows = await dbCall(() =>
      this.db.$queryRaw<{ id: string }[]>`
        SELECT id FROM jurisdictions
        WHERE type = 'MUNICIPALITY'
          AND status = 'ACTIVE'
          AND state = ${state}
          AND lower(name) = lower(${name})
        LIMIT 1
      `,
    );
    return rows[0]?.id;
  }
}
