import { describe, expect, it } from 'vitest';
import { DEMO_DISTRICT } from '../data/demoDistrict';
import { at } from '../data/geo';
import type { DistrictBoundary } from '../data/types';
import { boundaryBounds, boundaryCenter, boundaryLatLngs, insideDistrict, pointInBoundary } from './geometry';

// A 10 x 10 square with a 2 x 2 hole in the middle, in [lng, lat].
const square: DistrictBoundary = {
  type: 'Polygon',
  coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
  ],
};

const twoIslands: DistrictBoundary = {
  type: 'MultiPolygon',
  coordinates: [
    [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
    [[[10, 10], [14, 10], [14, 14], [10, 14], [10, 10]]],
  ],
};

const pt = (lng: number, lat: number) => ({ lat, lng });

describe('pointInBoundary', () => {
  it('finds points inside a polygon and outside it', () => {
    expect(pointInBoundary(pt(1, 1), square)).toBe(true);
    expect(pointInBoundary(pt(9.9, 0.1), square)).toBe(true);
    expect(pointInBoundary(pt(-1, 5), square)).toBe(false);
    expect(pointInBoundary(pt(5, 11), square)).toBe(false);
  });

  it('treats holes as outside', () => {
    expect(pointInBoundary(pt(5, 5), square)).toBe(false);
    expect(pointInBoundary(pt(3.9, 5), square)).toBe(true);
  });

  it('handles every polygon of a MultiPolygon', () => {
    expect(pointInBoundary(pt(1, 1), twoIslands)).toBe(true);
    expect(pointInBoundary(pt(12, 12), twoIslands)).toBe(true);
    expect(pointInBoundary(pt(5, 5), twoIslands)).toBe(false);
  });

  it('works for a concave shape', () => {
    // An L: the notch at (3, 3) is outside.
    const ell: DistrictBoundary = {
      type: 'Polygon',
      coordinates: [[[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4], [0, 0]]],
    };
    expect(pointInBoundary(pt(1, 3), ell)).toBe(true);
    expect(pointInBoundary(pt(3, 1), ell)).toBe(true);
    expect(pointInBoundary(pt(3, 3), ell)).toBe(false);
  });

  it('matches the demo district (W 13th to W 23rd St, 8th to 11th Ave)', () => {
    expect(pointInBoundary(at(16, 0.5), DEMO_DISTRICT.boundary!)).toBe(true);
    expect(pointInBoundary(at(30, 0.5), DEMO_DISTRICT.boundary!)).toBe(false);
    expect(pointInBoundary(at(16, -2), DEMO_DISTRICT.boundary!)).toBe(false);
    expect(pointInBoundary(DEMO_DISTRICT.center, DEMO_DISTRICT.boundary!)).toBe(true);
  });
});

describe('insideDistrict', () => {
  it('accepts anywhere when there is no boundary', () => {
    expect(insideDistrict(pt(100, 50), {})).toBe(true);
    expect(insideDistrict(pt(100, 50), { boundary: square })).toBe(false);
  });
});

describe('boundary helpers', () => {
  it('flips coordinates for Leaflet', () => {
    expect(boundaryLatLngs(twoIslands)[1][0][1]).toEqual([10, 14]);
  });

  it('computes bounds over all polygons', () => {
    expect(boundaryBounds(twoIslands)).toEqual({ minLat: 0, minLng: 0, maxLat: 14, maxLng: 14 });
  });

  it('centers on the largest polygon', () => {
    const c = boundaryCenter(twoIslands);
    expect(c.lat).toBeCloseTo(12);
    expect(c.lng).toBeCloseTo(12);
  });
});
