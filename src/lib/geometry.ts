/**
 * Pure geometry for district boundaries. Coordinates follow GeoJSON: [lng, lat].
 * No imports beyond types, so `scripts/fetch-district-boundary.ts` can run this file under Node.
 */
import type { DistrictBoundary } from '../data/types';

export interface Point {
  lat: number;
  lng: number;
}

type Ring = [number, number][];

/** Ray casting. Points exactly on an edge may land either way; that's fine at street scale. */
function inRing([x, y]: [number, number], ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A GeoJSON polygon: the first ring is the outline, later rings are holes. */
function inPolygon(p: [number, number], rings: Ring[]) {
  if (!rings.length || !inRing(p, rings[0])) return false;
  return !rings.slice(1).some((hole) => inRing(p, hole));
}

function polygons(boundary: DistrictBoundary): Ring[][] {
  return boundary.type === 'Polygon' ? [boundary.coordinates] : boundary.coordinates;
}

export function pointInBoundary(point: Point, boundary: DistrictBoundary) {
  const p: [number, number] = [point.lng, point.lat];
  return polygons(boundary).some((rings) => inPolygon(p, rings));
}

/** A district without a boundary takes pins anywhere. */
export function insideDistrict(point: Point, district: { boundary?: DistrictBoundary }) {
  return !district.boundary || pointInBoundary(point, district.boundary);
}

/** Rings as Leaflet `[lat, lng]` positions, one array of rings per polygon. */
export function boundaryLatLngs(boundary: DistrictBoundary): [number, number][][][] {
  return polygons(boundary).map((rings) => rings.map((ring) => ring.map(([lng, lat]) => [lat, lng] as [number, number])));
}

export function boundaryBounds(boundary: DistrictBoundary) {
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const rings of polygons(boundary)) {
    for (const [lng, lat] of rings[0] ?? []) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }
  }
  return { minLat, minLng, maxLat, maxLng };
}

/** Signed area (shoelace) and centroid of one ring, in degree units. */
function ringCentroid(ring: Ring) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j];
    const [x1, y1] = ring[i];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  a /= 2;
  return a === 0 ? null : { area: Math.abs(a), lng: cx / (6 * a), lat: cy / (6 * a) };
}

/**
 * A reasonable map center: the centroid of the largest polygon's outline, or the middle of the
 * bounding box when that centroid falls outside (odd shapes like a crescent).
 */
export function boundaryCenter(boundary: DistrictBoundary): Point {
  const outlines = polygons(boundary)
    .map((rings) => ringCentroid(rings[0] ?? []))
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((x, y) => y.area - x.area);
  const best = outlines[0];
  if (best && pointInBoundary(best, boundary)) return { lat: best.lat, lng: best.lng };
  const b = boundaryBounds(boundary);
  return { lat: (b.minLat + b.maxLat) / 2, lng: (b.minLng + b.maxLng) / 2 };
}
