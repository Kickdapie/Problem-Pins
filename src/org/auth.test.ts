import { describe, expect, it } from 'vitest';
import { loginPath, safeNext } from './auth';

describe('safeNext', () => {
  it('keeps dashboard paths, with their query', () => {
    expect(safeNext('/org/issues/PP-2402')).toBe('/org/issues/PP-2402');
    expect(safeNext('/org/issues?tab=hidden')).toBe('/org/issues?tab=hidden');
    expect(safeNext('#/org/map')).toBe('/org/map');
    expect(safeNext('/org')).toBe('/org');
  });

  it('falls back to the overview for anything else', () => {
    expect(safeNext(null)).toBe('/org');
    expect(safeNext('')).toBe('/org');
    expect(safeNext('/i/PP-2402')).toBe('/org');
    expect(safeNext('https://example.com/org')).toBe('/org');
    expect(safeNext('/organization')).toBe('/org');
    expect(safeNext('/org/login?next=/org/map')).toBe('/org');
  });
});

describe('loginPath', () => {
  it('encodes the page to come back to', () => {
    expect(loginPath('/org/issues?tab=hidden')).toBe('/org/login?next=%2Forg%2Fissues%3Ftab%3Dhidden');
  });
});
