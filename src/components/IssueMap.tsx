import { memo, useCallback, useEffect, useMemo } from 'react';
import L from 'leaflet';
import { Circle, CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import { config } from '../config';
import { STATUSES } from '../data/meta';
import type { DistrictBoundary, Issue } from '../data/types';
import { boundaryLatLngs } from '../lib/geometry';
import { useLatest } from '../lib/useLatest';
import { useStore } from '../store';
import markerSvg from '../../brand/map-marker.svg?raw';

interface LatLng {
  lat: number;
  lng: number;
}

interface Props {
  issues: Issue[];
  selectedId?: string | null;
  onSelect?: (issue: Issue) => void;
  center?: LatLng;
  zoom?: number;
  sizeByVotes?: boolean;
  voteLabelsAbove?: number;
  /** Draws the resident's dot at `you`. Nothing is drawn while the position is unknown. */
  showYou?: boolean;
  /** The resident's position; `accuracy` (meters) draws a faint circle when it's wide enough to matter. */
  you?: (LatLng & { accuracy?: number | null }) | null;
  /** The orange pin. With `onPick` it can be dragged, and tapping the map moves it. */
  pick?: LatLng | null;
  onPick?: (p: LatLng) => void;
  /** Change it to fly to `center` again even if `center` is unchanged (e.g. a "locate me" tap). */
  centerKey?: string | number;
  /**
   * Open on the whole district (its boundary, or the issues when it has none) instead of a fixed zoom,
   * keeping it clear of panels drawn over the map: `[left, top]` and `[right, bottom]` in pixels.
   * Ignored when `center` is given.
   */
  fit?: { topLeft: [number, number]; bottomRight: [number, number] };
  /** Outline the district and dim what's outside it. On by default when the district has a boundary. */
  showBoundary?: boolean;
  /** +/- buttons, in the top left unless `zoomPosition` says otherwise. */
  zoomControl?: boolean;
  zoomPosition?: L.ControlPosition;
  interactive?: boolean;
  className?: string;
}

const pinIcon = L.divIcon({
  className: '',
  iconSize: [28, 36],
  iconAnchor: [14, 34],
  html: markerSvg,
});

function radiusFor(issue: Issue, sizeByVotes: boolean) {
  return sizeByVotes ? 4 + Math.sqrt(issue.votes) * 0.85 : 6;
}

/**
 * One issue's dot. Memoized: react-leaflet restyles and moves a marker whenever it re-renders, so
 * with 2,000 issues a +1 would otherwise touch 2,000 markers. Now it touches the one that changed.
 */
const IssueMarker = memo(function IssueMarker({
  issue,
  selected,
  sizeByVotes,
  label,
  onSelect,
}: {
  issue: Issue;
  selected: boolean;
  sizeByVotes: boolean;
  label: boolean;
  onSelect: (issue: Issue) => void;
}) {
  const color = STATUSES[issue.status].color;
  const r = radiusFor(issue, sizeByVotes);
  return (
    <CircleMarker
      center={[issue.lat, issue.lng]}
      radius={selected ? r + 4 : r}
      pathOptions={{
        color: selected ? '#141b2d' : 'white',
        weight: selected ? 2 : 1.5,
        dashArray: selected ? '3 3' : undefined,
        fillColor: color,
        fillOpacity: 0.95,
      }}
      eventHandlers={{ click: () => onSelect(issue) }}
    >
      {label && (
        <Tooltip permanent direction="right" offset={[r, 0]} className="vote-label">
          {issue.votes}
        </Tooltip>
      )}
    </CircleMarker>
  );
});

function FlyTo({ center, zoom, centerKey }: { center?: LatLng; zoom?: number; centerKey?: string | number }) {
  const map = useMap();
  useEffect(() => {
    if (!center) return;
    const target: [number, number] = [center.lat, center.lng];
    const z = zoom ?? map.getZoom();
    // flyTo divides by the map's size, so in a hidden (0×0) box it computes NaN and throws.
    const box = map.getContainer();
    if (box.clientWidth && box.clientHeight) map.flyTo(target, z, { duration: 0.6 });
    else map.setView(target, z, { animate: false });
  }, [center?.lat, center?.lng, centerKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Once, when the map opens: frame the district, so it fills the window whatever the window's size. */
function FitDistrict({ points, fit }: { points: [number, number][]; fit: NonNullable<Props['fit']> }) {
  const map = useMap();
  useEffect(() => {
    const box = map.getContainer();
    if (!points.length || !box.clientWidth || !box.clientHeight) return;
    map.fitBounds(L.latLngBounds(points), { paddingTopLeft: fit.topLeft, paddingBottomRight: fit.bottomRight, animate: false });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Everything outside the district, as one polygon with the district cut out (even-odd fill). */
const WORLD: [number, number][] = [
  [-85, -179.9],
  [85, -179.9],
  [85, 179.9],
  [-85, 179.9],
];

function Boundary({ boundary }: { boundary: DistrictBoundary }) {
  const polygons = useMemo(() => boundaryLatLngs(boundary), [boundary]);
  const mask = useMemo(() => [WORLD, ...polygons.map((rings) => rings[0])], [polygons]);
  return (
    <>
      <Polygon positions={mask} interactive={false} pathOptions={{ stroke: false, fillColor: '#141b2d', fillOpacity: 0.07 }} />
      {/* A polyline, not a polygon: Leaflet clips polygons to the view and would stroke the cut edge. */}
      {polygons.map((rings, i) => (
        <Polyline
          key={i}
          positions={rings}
          interactive={false}
          pathOptions={{ color: '#141b2d', weight: 1.5, opacity: 0.45, dashArray: '5 5' }}
        />
      ))}
    </>
  );
}

function ClickToPick({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

/** Leaflet's own "Leaflet" link is optional; dropping it keeps the provider credit on one line. */
function AttributionPrefix() {
  const map = useMap();
  useEffect(() => {
    map.attributionControl?.setPrefix(false);
  }, [map]);
  return null;
}

/**
 * A map inside a form: the wheel scrolls the page instead of zooming the map. A trackpad pinch
 * arrives as a wheel event with ctrl held, and that still zooms, like the buttons and a touch pinch.
 */
function WheelScrollsPage() {
  const map = useMap();
  useEffect(() => {
    const box = map.getContainer();
    // In the capture phase, so Leaflet's own wheel listener is on or off before the event reaches it.
    const onWheel = (e: WheelEvent) => map.scrollWheelZoom[e.ctrlKey ? 'enable' : 'disable']();
    box.addEventListener('wheel', onWheel, true);
    return () => box.removeEventListener('wheel', onWheel, true);
  }, [map]);
  return null;
}

function ResizeWatcher() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

export default function IssueMap({
  issues,
  selectedId,
  onSelect,
  center,
  zoom = 16,
  sizeByVotes = true,
  voteLabelsAbove,
  showYou = false,
  you,
  pick,
  onPick,
  centerKey,
  fit,
  showBoundary = true,
  zoomControl = false,
  zoomPosition = 'topleft',
  interactive = true,
  className = '',
}: Props) {
  const { district } = useStore();
  const start = center ?? district.center;
  const ordered = useMemo(() => [...issues].sort((a, b) => a.votes - b.votes), [issues]);
  // Callers pass a new arrow function on every render; the markers get one that calls the latest.
  const latestSelect = useLatest(onSelect);
  const select = useCallback((issue: Issue) => latestSelect.current?.(issue), [latestSelect]);

  return (
    <MapContainer
      center={[start.lat, start.lng]}
      zoom={zoom}
      // Framing the district rarely lands on a whole zoom level; quarter steps let it fill the window.
      zoomSnap={fit ? 0.25 : 1}
      zoomControl={false}
      attributionControl
      dragging={interactive}
      scrollWheelZoom={interactive && !onPick}
      doubleClickZoom={interactive}
      touchZoom={interactive}
      className={`h-full w-full ${className}`}
    >
      <TileLayer url={config.mapTiles.url} attribution={config.mapTiles.attribution} />
      <ResizeWatcher />
      <AttributionPrefix />
      {/* A child rather than MapContainer's zoomControl option, which is read only once, when the map is made. */}
      {zoomControl && <ZoomControl position={zoomPosition} />}
      <FlyTo center={center} zoom={zoom} centerKey={centerKey} />
      {fit && !center && (
        <FitDistrict
          fit={fit}
          points={
            district.boundary
              ? boundaryLatLngs(district.boundary).flatMap((rings) => rings[0])
              : issues.map((i) => [i.lat, i.lng] as [number, number])
          }
        />
      )}
      {onPick && <ClickToPick onPick={onPick} />}
      {onPick && interactive && <WheelScrollsPage />}
      {showBoundary && district.boundary && <Boundary boundary={district.boundary} />}

      {ordered.map((issue) => {
        const selected = issue.id === selectedId;
        return (
          <IssueMarker
            key={`${issue.id}-${selected}`}
            issue={issue}
            selected={selected}
            sizeByVotes={sizeByVotes}
            label={voteLabelsAbove !== undefined && issue.votes >= voteLabelsAbove}
            onSelect={select}
          />
        );
      })}

      {selectedId &&
        issues
          .filter((i) => i.id === selectedId)
          .map((i) => (
            <CircleMarker
              key="halo"
              center={[i.lat, i.lng]}
              radius={radiusFor(i, sizeByVotes) + 14}
              interactive={false}
              pathOptions={{ stroke: false, fillColor: STATUSES[i.status].color, fillOpacity: 0.18 }}
            />
          ))}

      {showYou && you && you.accuracy != null && you.accuracy > 15 && (
        <Circle
          center={[you.lat, you.lng]}
          radius={you.accuracy}
          interactive={false}
          pathOptions={{ color: '#2563eb', weight: 1, opacity: 0.35, fillColor: '#2563eb', fillOpacity: 0.08 }}
        />
      )}
      {showYou && you && (
        <CircleMarker
          center={[you.lat, you.lng]}
          radius={6}
          interactive={false}
          pathOptions={{ color: 'white', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}
        />
      )}

      {pick && (
        <Marker
          key={`${pick.lat},${pick.lng}`}
          position={[pick.lat, pick.lng]}
          icon={pinIcon}
          draggable={Boolean(onPick)}
          autoPan
          eventHandlers={
            onPick
              ? {
                  dragend: (e) => {
                    const p = (e.target as L.Marker).getLatLng();
                    onPick({ lat: p.lat, lng: p.lng });
                  },
                }
              : undefined
          }
        />
      )}
    </MapContainer>
  );
}
