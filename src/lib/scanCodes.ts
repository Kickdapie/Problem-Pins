import type { AnalyticsEvent, ScanPoint } from '../data/types';

/**
 * Scan point codes (`Q-12`) are printed on posters, so a code is never reused once it has
 * existed. The demo backend forgets deleted points, so "used" is everything we can still see:
 * current points, codes that appear in analytics events, and codes this browser retired.
 */

/** What a code may look like: it ends up in a URL path (`/q/Q-12`), so keep it plain. */
export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,15}$/;

export function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

export function isValidCode(code: string) {
  return CODE_PATTERN.test(code);
}

export function usedCodes(points: Pick<ScanPoint, 'code'>[], events: Pick<AnalyticsEvent, 'scanCode'>[], retired: string[] = []) {
  const used = new Set<string>();
  points.forEach((p) => used.add(normalizeCode(p.code)));
  events.forEach((e) => e.scanCode && used.add(normalizeCode(e.scanCode)));
  retired.forEach((c) => used.add(normalizeCode(c)));
  return used;
}

/** The next `Q-n` after the highest `Q-n` ever used. Gaps are never filled. */
export function nextFreeCode(used: Iterable<string>) {
  let max = 0;
  for (const code of used) {
    const m = /^Q-(\d+)$/.exec(normalizeCode(code));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Q-${max + 1}`;
}

// Retired codes, remembered in this browser only. A real backend should keep deleted
// codes itself (e.g. a soft delete); until then this stops the obvious mistake.
const RETIRED_KEY = 'problem-pins-retired-scan-codes';

export function loadRetiredCodes(): string[] {
  try {
    const raw = localStorage.getItem(RETIRED_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((c): c is string => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

export function retireCode(code: string) {
  try {
    const list = new Set(loadRetiredCodes());
    list.add(normalizeCode(code));
    localStorage.setItem(RETIRED_KEY, JSON.stringify([...list]));
  } catch {
    /* storage unavailable: nothing to remember */
  }
}
