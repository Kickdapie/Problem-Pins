import { describe, expect, it } from 'vitest';
import { at } from '../data/geo';
import { fallbackLabel, formatStreet, labelFromReverse, toAddressResults } from './geocode';

describe('formatStreet', () => {
  it('writes City address-file spellings the way people do', () => {
    expect(formatStreet('WEST 17 STREET')).toBe('W 17th St');
    expect(formatStreet('9 AVENUE')).toBe('9th Ave');
    expect(formatStreet('EAST 101 STREET')).toBe('E 101st St');
    expect(formatStreet('AVENUE OF THE AMERICAS')).toBe('Avenue of the Americas');
    expect(formatStreet('WEST END AVENUE')).toBe('West End Ave');
    expect(formatStreet('WEST STREET')).toBe('West St');
    expect(formatStreet('BROADWAY')).toBe('Broadway');
    expect(formatStreet('AVENUE A')).toBe('Avenue A');
    expect(formatStreet('BEACH 116 STREET')).toBe('Beach 116th St');
    expect(formatStreet('WEST 22 STREET')).toBe('W 22nd St');
  });
});

const feature = (props: Record<string, unknown>, coords: [number, number] = [-74.0045, 40.7429]) => ({
  geometry: { coordinates: coords },
  properties: { gid: `g-${Math.random()}`, layer: 'venue', ...props },
});

describe('labelFromReverse', () => {
  it('prefers a house number over a building name', () => {
    const place = labelFromReverse([
      feature({ name: 'FULTON HOUSES BUILDING 3', street: 'FULTON HOUSES BUILDING 3', distance: 0.01 }),
      feature({ housenumber: '412', street: 'WEST 17 STREET', distance: 0.02 }),
    ]);
    expect(place).toEqual({ label: '412 W 17th St', source: 'address', meters: 20 });
  });

  it('says "Near" when the address point is not right there', () => {
    expect(labelFromReverse([feature({ housenumber: '103', street: '9 AVENUE', distance: 0.07 })])?.label).toBe('Near 103 9th Ave');
  });

  it('gives up when the nearest address is too far to describe the spot', () => {
    expect(labelFromReverse([feature({ housenumber: '1', street: 'MAIN STREET', distance: 2.5 })])).toBeNull();
    expect(labelFromReverse([])).toBeNull();
  });
});

describe('fallbackLabel', () => {
  it('uses the street grid in the demo area', () => {
    expect(fallbackLabel(at(16, 0.5))).toEqual({ label: 'W 16th St, 9th–10th Ave', source: 'grid' });
  });

  it('uses coordinates elsewhere', () => {
    expect(fallbackLabel({ lat: 40.678, lng: -73.944 })).toEqual({ label: '40.67800, -73.94400', source: 'coordinates' });
  });
});

describe('toAddressResults', () => {
  it('formats suggestions and drops aliases at the same spot', () => {
    const results = toAddressResults([
      feature({ housenumber: '450', street: 'WEST 17 STREET', neighbourhood: 'Chelsea', borough: 'Manhattan' }, [-74.0064, 40.7435]),
      feature({ housenumber: '450', street: 'WEST 17 STREET', neighbourhood: 'Chelsea', borough: 'Manhattan' }, [-74.0064, 40.7435]),
      feature({ housenumber: '450', street: 'W 17 ST', neighbourhood: 'Chelsea', borough: 'Manhattan' }, [-74.0064, 40.7435]),
      feature({ name: 'CHELSEA MARKET', borough: 'Manhattan' }, [-74.006, 40.742]),
    ]);
    expect(results.map((r) => [r.label, r.detail])).toEqual([
      ['450 W 17th St', 'Chelsea, Manhattan'],
      ['Chelsea Market', 'Manhattan'],
    ]);
    expect(results[0]).toMatchObject({ lat: 40.7435, lng: -74.0064 });
  });
});
