/**
 * The resident's position, shared by every screen (one geolocation watch for the whole app).
 *
 * Where the position comes from is explicit:
 * - live mode: the device (`navigator.geolocation`), only after the browser's permission prompt.
 * - demo mode: a fixed point in West Chelsea (`DEMO_YOU_ARE_HERE`), so presentations start in the
 *   demo district wherever the laptop is.
 * - `?geo=device` (before the `#`, like `?mode=demo`) uses the device in demo mode too, for testing;
 *   `?geo=demo` forces the fixed point in live mode.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { isDemo } from '../config';
import { DEMO_YOU_ARE_HERE } from '../data/geo';

export type LocationSource = 'device' | 'demo';

/**
 * prompt: not asked yet, or the browser is asking. granted: we have a position.
 * denied: the person or the browser blocked it. unavailable: no geolocation, or no fix possible.
 * timeout: asked, but no fix arrived in time (indoors, weak GPS).
 */
export type LocationStatus = 'prompt' | 'granted' | 'denied' | 'unavailable' | 'timeout';

export interface Fix {
  lat: number;
  lng: number;
  /** Meters (95% confidence radius per the spec). Null for the demo point. */
  accuracy: number | null;
}

export interface LocationState {
  source: LocationSource;
  status: LocationStatus;
  /** The latest fix. Kept after a later error so the dot doesn't vanish on a GPS hiccup. */
  position: Fix | null;
  /** A request is in flight and no fix has arrived yet. */
  locating: boolean;
}

function pickSource(): LocationSource {
  const flag = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('geo');
  if (flag === 'device' || flag === 'demo') return flag;
  return isDemo ? 'demo' : 'device';
}

export const LOCATION_SOURCE: LocationSource = pickSource();

const WATCH_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 };
/** Keep watching this long after the last screen using it unmounts, so navigation doesn't re-ask. */
const STOP_AFTER_MS = 15_000;

const geolocation = () => (typeof navigator === 'undefined' ? undefined : navigator.geolocation);

let state: LocationState =
  LOCATION_SOURCE === 'demo'
    ? { source: 'demo', status: 'granted', position: { ...DEMO_YOU_ARE_HERE, accuracy: null }, locating: false }
    : { source: 'device', status: geolocation() ? 'prompt' : 'unavailable', position: null, locating: false };

const listeners = new Set<() => void>();
let watchId: number | null = null;
let stopTimer: number | undefined;

function set(patch: Partial<LocationState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

function stop() {
  const geo = geolocation();
  if (watchId !== null && geo) geo.clearWatch(watchId);
  watchId = null;
}

function start() {
  if (state.source === 'demo' || watchId !== null) return;
  const geo = geolocation();
  if (!geo) {
    set({ status: 'unavailable', locating: false });
    return;
  }
  set({ locating: true });
  watchId = geo.watchPosition(
    (p) =>
      set({
        status: 'granted',
        locating: false,
        position: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null },
      }),
    (error) => {
      if (error.code === error.PERMISSION_DENIED) {
        stop();
        set({ status: 'denied', locating: false, position: null });
      } else if (!state.position) {
        // The watch keeps trying after a timeout or a failed fix; a later fix flips this to granted.
        set({ status: error.code === error.TIMEOUT ? 'timeout' : 'unavailable', locating: false });
      }
    },
    WATCH_OPTIONS,
  );
}

/** Asks for the position now (shows the browser prompt if needed). Call it from a tap when possible. */
export function requestLocation() {
  stop();
  start();
}

/** Starts watching without a prompt if the site already has permission; notes a block up front. */
async function startIfAllowed() {
  if (state.source === 'demo' || watchId !== null) return;
  try {
    const permission = await navigator.permissions?.query({ name: 'geolocation' });
    if (permission?.state === 'granted') start();
    else if (permission?.state === 'denied' && state.status === 'prompt') set({ status: 'denied' });
  } catch {
    // No Permissions API (older Safari): wait for an explicit request.
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.clearTimeout(stopTimer);
  return () => {
    listeners.delete(fn);
    if (!listeners.size) stopTimer = window.setTimeout(stop, STOP_AFTER_MS);
  };
}

const getSnapshot = () => state;

/**
 * The resident's position and how we got it.
 * `ask: true` requests it on mount (the pin flow, where the intent is clear).
 * `ask: false` only uses it if the browser already allowed this site; call `request()` from a tap.
 */
export function useUserLocation({ ask = false }: { ask?: boolean } = {}) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (ask) start();
    else void startIfAllowed();
  }, [ask]);
  return { ...snapshot, request: requestLocation };
}
