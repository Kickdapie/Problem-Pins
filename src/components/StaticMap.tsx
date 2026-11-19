import { config } from '../config';
import markerSvg from '../../brand/map-marker.svg?raw';

const TILE = 256;
// The resident shell is at most 430px wide (ResidentShell), so a few tiles always cover it.
const MAX_WIDTH = 430;

/** Web Mercator: a position in world pixels at zoom `z`. */
function worldPixel(lat: number, lng: number, z: number) {
  const scale = TILE * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function tileUrl(z: number, x: number, y: number) {
  const retina = typeof window !== 'undefined' && window.devicePixelRatio > 1 ? '@2x' : '';
  return config.mapTiles.url
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{r}', retina)
    .replace('{s}', 'a');
}

/**
 * A picture of the map around one point: the same tiles as the live map, the orange pin in the
 * middle, and no Leaflet. Issue detail is often the first screen after a scan, on mobile data, so it
 * doesn't download the map library for a picture.
 */
export default function StaticMap({
  lat,
  lng,
  zoom = 16,
  height = 144,
  label,
  onOpen,
}: {
  lat: number;
  lng: number;
  zoom?: number;
  height?: number;
  /** What the picture shows, for screen readers and the button. */
  label: string;
  onOpen?: () => void;
}) {
  const center = worldPixel(lat, lng, zoom);
  const half = { x: MAX_WIDTH / 2, y: height / 2 };
  const tiles: { x: number; y: number }[] = [];
  for (let y = Math.floor((center.y - half.y) / TILE); y <= Math.floor((center.y + half.y) / TILE); y++) {
    for (let x = Math.floor((center.x - half.x) / TILE); x <= Math.floor((center.x + half.x) / TILE); x++) tiles.push({ x, y });
  }

  const picture = (
    <>
      <div className="static-map-tiles absolute inset-0" aria-hidden>
        {tiles.map((t) => (
          <img
            key={`${t.x}/${t.y}`}
            src={tileUrl(zoom, t.x, t.y)}
            alt=""
            loading="lazy"
            draggable={false}
            className="absolute max-w-none select-none"
            style={{
              width: TILE,
              height: TILE,
              left: `calc(50% + ${Math.round(t.x * TILE - center.x)}px)`,
              top: `calc(50% + ${Math.round(t.y * TILE - center.y)}px)`,
            }}
          />
        ))}
      </div>
      {/* Same pin and anchor as the live map (28×36, tip at 14,34). */}
      <span
        aria-hidden
        className="absolute h-9 w-7"
        style={{ left: 'calc(50% - 14px)', top: 'calc(50% - 34px)' }}
        dangerouslySetInnerHTML={{ __html: markerSvg }}
      />
    </>
  );

  return (
    <div className="relative overflow-hidden bg-[#eef0f3]" style={{ height }}>
      {onOpen ? (
        <button type="button" onClick={onOpen} aria-label={label} className="absolute inset-0">
          {picture}
        </button>
      ) : (
        <div role="img" aria-label={label} className="absolute inset-0">
          {picture}
        </div>
      )}
      {/* Outside the button: the credits are links of their own. */}
      <span
        className="absolute bottom-0 right-0 bg-white/80 px-1 text-[10px] leading-4 text-slate-600 [&_a]:text-slate-600"
        dangerouslySetInnerHTML={{ __html: config.mapTiles.attribution }}
      />
    </div>
  );
}
