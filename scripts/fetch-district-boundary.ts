/**
 * Fetches an NYC community district boundary from NYC Open Data and prints what a `District`
 * needs: the boundary (GeoJSON, [lng, lat]), a suggested center and zoom.
 *
 *   node scripts/fetch-district-boundary.ts 108            # Manhattan CD 8
 *   node scripts/fetch-district-boundary.ts 308 > cd308.json
 *   node scripts/fetch-district-boundary.ts 108 --tolerance=0.00005   # simplify more
 *   node scripts/fetch-district-boundary.ts 108 --raw                 # no simplification
 *
 * BoroCD = borough digit (1 Manhattan, 2 Bronx, 3 Brooklyn, 4 Queens, 5 Staten Island) followed by
 * the two-digit district number. Data: "Community Districts" (shoreline-clipped), dataset 5crt-au7u,
 * https://data.cityofnewyork.us/d/5crt-au7u. Needs Node 22.18+ (runs TypeScript directly), no packages.
 */
import { boundaryBounds, boundaryCenter } from '../src/lib/geometry.ts';

type Ring = [number, number][];
type Boundary = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };

const DATASET = 'https://data.cityofnewyork.us/resource/5crt-au7u.json';
const BOROUGHS: Record<string, string> = { '1': 'Manhattan', '2': 'Bronx', '3': 'Brooklyn', '4': 'Queens', '5': 'Staten Island' };
/** About 2 m at NYC's latitude: invisible at street zoom, cuts the point count a lot. */
const DEFAULT_TOLERANCE = 0.00002;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const code = args.find((a) => /^\d{3}$/.test(a));
if (!code || !BOROUGHS[code[0]]) {
  fail('Usage: node scripts/fetch-district-boundary.ts <BoroCD, e.g. 108 or 308> [--tolerance=0.00002] [--raw]');
}
const raw = args.includes('--raw');
const toleranceArg = args.find((a) => a.startsWith('--tolerance='));
const tolerance = toleranceArg ? Number(toleranceArg.split('=')[1]) : DEFAULT_TOLERANCE;
if (!Number.isFinite(tolerance) || tolerance < 0) fail('--tolerance must be a number of degrees, e.g. 0.00002');

/** Douglas–Peucker on one closed ring; keeps the closing point. */
function simplifyRing(ring: Ring, tol: number): Ring {
  if (ring.length <= 4 || tol === 0) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i];
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst !== -1 && worstD > tol) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring; // never collapse a ring below a triangle
}

const round = ([x, y]: [number, number]): [number, number] => [Number(x.toFixed(6)), Number(y.toFixed(6))];
const clean = (ring: Ring) => (raw ? ring : simplifyRing(ring, tolerance)).map(round);
const countPoints = (b: Boundary) =>
  (b.type === 'Polygon' ? [b.coordinates] : b.coordinates).reduce((n, rings) => n + rings.reduce((m, r) => m + r.length, 0), 0);

const res = await fetch(`${DATASET}?boro_cd=${code}`, { headers: { Accept: 'application/json' } });
if (!res.ok) fail(`NYC Open Data answered ${res.status} ${res.statusText}`);
const rows = (await res.json()) as { boro_cd: string; the_geom?: Boundary }[];
const geom = rows[0]?.the_geom;
if (!geom) fail(`No community district ${code}. Codes look like 101–112 (Manhattan), 201–212, 301–318, 401–414, 501–503.`);

const boundary: Boundary =
  geom.type === 'Polygon'
    ? { type: 'Polygon', coordinates: geom.coordinates.map(clean) }
    : { type: 'MultiPolygon', coordinates: geom.coordinates.map((rings) => rings.map(clean)) };

const center = boundaryCenter(boundary);
const b = boundaryBounds(boundary);
// Zoom that fits the district in a phone-sized map (~390 x 480 px), clamped to street-level range.
const lngSpan = b.maxLng - b.minLng;
const latSpan = (b.maxLat - b.minLat) / Math.cos((center.lat * Math.PI) / 180);
const fit = Math.min(Math.log2((390 * 360) / (256 * lngSpan)), Math.log2((480 * 360) / (256 * latSpan)));
const zoom = Math.max(12, Math.min(17, Math.floor(fit)));

const borough = BOROUGHS[code[0]];
const number = Number(code.slice(1));
console.error(
  `${borough} Community District ${number}: ${countPoints(geom)} points` +
    (raw ? '' : ` → ${countPoints(boundary)} after simplifying at ${tolerance}°`),
);
console.log(
  JSON.stringify(
    {
      boroCd: Number(code),
      name: `${borough} Community District ${number}`,
      center: { lat: Number(center.lat.toFixed(6)), lng: Number(center.lng.toFixed(6)) },
      zoom,
      boundary,
      source: `NYC Open Data, Community Districts (5crt-au7u), fetched ${new Date().toISOString().slice(0, 10)}`,
    },
    null,
    1,
  ),
);
