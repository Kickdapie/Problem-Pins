import { useEffect, useState } from 'react';
import { fallbackLabel, labelFor, searchAddresses, type AddressResult, type PlaceLabel } from './geocode';
import type { Point } from './geometry';

/**
 * The street address for a pin, looked up after it has stopped moving for `delayMs`.
 * `place` is null until the first answer; `loading` is true while a newer lookup is pending.
 */
export function usePlaceLabel(point: Point | null, delayMs = 500) {
  const [place, setPlace] = useState<PlaceLabel | null>(null);
  const [loading, setLoading] = useState(false);
  const lat = point?.lat;
  const lng = point?.lng;

  useEffect(() => {
    if (lat === undefined || lng === undefined) {
      setPlace(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      labelFor({ lat, lng }).then((result) => {
        if (cancelled) return;
        setPlace(result);
        setLoading(false);
      });
    }, delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [lat, lng, delayMs]);

  return { place, loading, fallback: point ? fallbackLabel(point) : null };
}

/** NYC address suggestions for a search box, debounced. Needs at least 3 characters. */
export function useAddressSearch(query: string, focus?: Point, delayMs = 300) {
  const [results, setResults] = useState<AddressResult[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const text = query.trim();
  const fLat = focus?.lat;
  const fLng = focus?.lng;

  useEffect(() => {
    if (text.length < 3) {
      setResults([]);
      setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    const timer = window.setTimeout(() => {
      const near = fLat !== undefined && fLng !== undefined ? { lat: fLat, lng: fLng } : undefined;
      searchAddresses(text, near).then(
        (r) => {
          if (cancelled) return;
          setResults(r);
          setStatus('done');
        },
        () => {
          if (cancelled) return;
          setResults([]);
          setStatus('error');
        },
      );
    }, delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [text, fLat, fLng, delayMs]);

  return { results, status };
}
