/**
 * Street addresses from NYC GeoSearch (NYC Planning Labs, free, no key, CORS open):
 * https://geosearch.planninglabs.nyc/docs/ — `/v2/reverse` for a pin's label, `/v2/autocomplete`
 * for the search box. Results are cached per session. When the service can't be reached the
 * label falls back to the demo grid formula (West Side only) or plain coordinates.
 */
import { describeLocation, onDemoGrid } from '../data/geo';
import type { Point } from './geometry';

const GEOSEARCH = 'https://geosearch.planninglabs.nyc/v2';
const TIMEOUT_MS = 4000;
/** Farther than this from the nearest known address, the pin is labelled "Near …". */
const NEAR_METERS = 40;
/** Farther than this, the nearest address doesn't describe the spot (a park, a pier, outside NYC). */
const MAX_METERS = 150;

interface GeoSearchFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    gid: string;
    layer: string;
    name?: string;
    housenumber?: string;
    street?: string;
    neighbourhood?: string;
    borough?: string;
    /** Kilometers, reverse only. */
    distance?: number;
  };
}

// ---------- formatting (pure) ----------

const SUFFIX: Record<string, string> = {
  STREET: 'St',
  AVENUE: 'Ave',
  PLACE: 'Pl',
  ROAD: 'Rd',
  BOULEVARD: 'Blvd',
  DRIVE: 'Dr',
  PARKWAY: 'Pkwy',
  LANE: 'Ln',
  TERRACE: 'Ter',
  EXPRESSWAY: 'Expy',
  HIGHWAY: 'Hwy',
  SQUARE: 'Sq',
  COURT: 'Ct',
};
const DIRECTION: Record<string, string> = { WEST: 'W', EAST: 'E', NORTH: 'N', SOUTH: 'S' };
const LOWER = new Set(['OF', 'THE', 'AND', 'AT']);

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function titleCase(word: string) {
  return word.charAt(0) + word.slice(1).toLowerCase();
}

/**
 * GeoSearch spells streets the way the City's address file does ("WEST 17 STREET", "9 AVENUE").
 * Turns that into what people write: "W 17th St", "9th Ave", "Avenue of the Americas".
 */
export function formatStreet(street: string) {
  const words = street.trim().toUpperCase().split(/\s+/).filter(Boolean);
  return words
    .map((w, i) => {
      const last = i === words.length - 1;
      if (/^\d+$/.test(w)) return ordinal(Number(w));
      if (DIRECTION[w] && i === 0 && /^\d+$/.test(words[1] ?? '')) return DIRECTION[w];
      if (last && i > 0 && SUFFIX[w]) return SUFFIX[w];
      if (i > 0 && LOWER.has(w)) return w.toLowerCase();
      return w.split('-').map(titleCase).join('-');
    })
    .join(' ');
}

export function formatPlaceName(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((w, i) => (i > 0 && LOWER.has(w.toUpperCase()) ? w.toLowerCase() : w.split('-').map(titleCase).join('-')))
    .join(' ');
}

function featureLabel(f: GeoSearchFeature) {
  const { housenumber, street, name } = f.properties;
  if (housenumber && street) return `${housenumber} ${formatStreet(street)}`;
  if (street) return formatStreet(street);
  return name ? formatPlaceName(name) : null;
}

// ---------- reverse geocoding ----------

export interface PlaceLabel {
  label: string;
  /** address = from GeoSearch; grid = demo street formula; coordinates = last resort. */
  source: 'address' | 'grid' | 'coordinates';
  /** Distance from the pin to the address point, meters (address only). */
  meters?: number;
}

/** What to call a spot when GeoSearch has nothing or can't be reached. */
export function fallbackLabel(p: Point): PlaceLabel {
  if (onDemoGrid(p.lat, p.lng)) return { label: describeLocation(p.lat, p.lng), source: 'grid' };
  return { label: `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`, source: 'coordinates' };
}

/** Picks the closest feature with a house number (venues without one are building names). */
export function labelFromReverse(features: GeoSearchFeature[]): PlaceLabel | null {
  const usable = features
    .filter((f) => f.properties.distance !== undefined && f.properties.distance * 1000 <= MAX_METERS)
    .sort((a, b) => Number(Boolean(b.properties.housenumber)) - Number(Boolean(a.properties.housenumber)) || a.properties.distance! - b.properties.distance!);
  const best = usable[0];
  const text = best && featureLabel(best);
  if (!best || !text) return null;
  const meters = Math.round(best.properties.distance! * 1000);
  return { label: meters > NEAR_METERS ? `Near ${text}` : text, source: 'address', meters };
}

async function getJson(url: string) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline');
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GeoSearch ${res.status}`);
  return (await res.json()) as { features?: GeoSearchFeature[] };
}

const reverseCache = new Map<string, Promise<PlaceLabel>>();

/** ~1 m precision; nearby lookups share a cache entry. */
const key = (p: Point) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

/** The nearest street address for a spot. Never rejects: falls back to `fallbackLabel`. */
export function labelFor(p: Point): Promise<PlaceLabel> {
  const k = key(p);
  const cached = reverseCache.get(k);
  if (cached) return cached;
  const url = `${GEOSEARCH}/reverse?point.lat=${p.lat.toFixed(6)}&point.lon=${p.lng.toFixed(6)}&size=10`;
  const job = getJson(url)
    .then((data) => labelFromReverse(data.features ?? []) ?? fallbackLabel(p))
    .catch(() => {
      reverseCache.delete(k); // try again next time
      return fallbackLabel(p);
    });
  reverseCache.set(k, job);
  return job;
}

/** Synchronous peek: the label if it's already been looked up. */
export function cachedLabel(p: Point) {
  return reverseCache.get(key(p));
}

// ---------- address search ----------

export interface AddressResult {
  id: string;
  label: string;
  /** Neighborhood and borough, e.g. "Chelsea, Manhattan". */
  detail: string;
  lat: number;
  lng: number;
}

export function toAddressResults(features: GeoSearchFeature[]): AddressResult[] {
  const seen = new Set<string>();
  const out: AddressResult[] = [];
  for (const f of features) {
    const label = featureLabel(f);
    if (!label) continue;
    const { neighbourhood, borough } = f.properties;
    const detail = [neighbourhood, borough].filter(Boolean).join(', ');
    const [lng, lat] = f.geometry.coordinates;
    // The City's address file lists aliases ("120 B'way" next to "120 Broadway") at the same point.
    const sameSpot = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (seen.has(label + detail) || seen.has(sameSpot)) continue;
    seen.add(label + detail);
    seen.add(sameSpot);
    out.push({ id: f.properties.gid, label, detail, lat, lng });
  }
  return out;
}

const searchCache = new Map<string, Promise<AddressResult[]>>();

/** NYC address suggestions, nudged toward `focus` (the district). Rejects when offline. */
export function searchAddresses(text: string, focus?: Point): Promise<AddressResult[]> {
  const q = text.trim().replace(/\s+/g, ' ');
  const k = `${q.toLowerCase()}|${focus ? key(focus) : ''}`;
  const cached = searchCache.get(k);
  if (cached) return cached;
  const params = new URLSearchParams({ text: q });
  if (focus) {
    params.set('focus.point.lat', focus.lat.toFixed(5));
    params.set('focus.point.lon', focus.lng.toFixed(5));
  }
  const job = getJson(`${GEOSEARCH}/autocomplete?${params}`)
    .then((data) => toAddressResults(data.features ?? []).slice(0, 5))
    .catch((error) => {
      searchCache.delete(k);
      throw error;
    });
  searchCache.set(k, job);
  return job;
}
