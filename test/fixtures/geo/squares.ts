/**
 * Small GeoJSON polygons and points for lookup unit tests and later PostGIS tests.
 *
 * The scene sits around lng -77.03, lat 38.895 (Washington, DC).
 *
 * Metres per degree at latitude 38.895:
 *   latitude  ≈ 111_320 m
 *   longitude ≈ 111_320 * cos(38.895°) ≈ 86_685 m
 *
 * District A (west) and District B (east) share the meridian longitude -77.03.
 * Both span latitude 38.89–38.90 (about 1.1 km) and 0.01° of longitude (about 867 m).
 *
 *   pointInsideA     [-77.035, 38.895]   centre of A, ≈ 433 m from the shared border
 *   pointInsideB     [-77.025, 38.895]   centre of B, ≈ 433 m from the shared border
 *   pointNearBorder  [-77.0302307, 38.895]
 *       20 m west of the shared border (20 / 86_685 ≈ 0.0002307°), inside A,
 *       and within 50 m of District B
 *   pointOutside     [-77.08, 38.895]    west of the county, outside every polygon
 *
 * The ZCTA rectangle covers both districts. The county rectangle covers the ZCTA,
 * both districts, and the municipality. The municipality sits inside A and contains
 * pointInsideA only.
 */

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface GeoJsonPoint {
  type: 'Point';
  coordinates: [number, number];
}

function ring(points: Array<[number, number]>): number[][][] {
  const first = points[0];
  if (!first) return [[]];
  return [[...points, first]];
}

/** West district. Longitude -77.04 .. -77.03, latitude 38.89 .. 38.90. */
export const districtA: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: ring([
    [-77.04, 38.89],
    [-77.03, 38.89],
    [-77.03, 38.9],
    [-77.04, 38.9],
  ]),
};

/** East district, adjacent to A along longitude -77.03. Longitude -77.03 .. -77.02. */
export const districtB: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: ring([
    [-77.03, 38.89],
    [-77.02, 38.89],
    [-77.02, 38.9],
    [-77.03, 38.9],
  ]),
};

/** ZIP code tabulation area covering both districts. Longitude -77.045 .. -77.015, latitude 38.885 .. 38.905. */
export const zcta: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: ring([
    [-77.045, 38.885],
    [-77.015, 38.885],
    [-77.015, 38.905],
    [-77.045, 38.905],
  ]),
};

/** County covering the ZCTA, both districts, and the municipality. Longitude -77.06 .. -77.00, latitude 38.87 .. 38.92. */
export const county: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: ring([
    [-77.06, 38.87],
    [-77.0, 38.87],
    [-77.0, 38.92],
    [-77.06, 38.92],
  ]),
};

/** City inside District A. Contains pointInsideA and not pointInsideB or pointNearBorder. */
export const municipality: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: ring([
    [-77.038, 38.892],
    [-77.032, 38.892],
    [-77.032, 38.898],
    [-77.038, 38.898],
  ]),
};

export const pointInsideA: GeoJsonPoint = {
  type: 'Point',
  coordinates: [-77.035, 38.895],
};

export const pointInsideB: GeoJsonPoint = {
  type: 'Point',
  coordinates: [-77.025, 38.895],
};

/** About 20 m west of the A/B border, inside A. */
export const pointNearBorder: GeoJsonPoint = {
  type: 'Point',
  coordinates: [-77.0302307, 38.895],
};

/** West of the county extent. */
export const pointOutside: GeoJsonPoint = {
  type: 'Point',
  coordinates: [-77.08, 38.895],
};
