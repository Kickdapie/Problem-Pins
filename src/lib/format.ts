import { isDemo } from '../config';

/** The sample data is frozen in mid-October 2026 so day counts match the designs. */
export const DEMO_TODAY = '2026-10-14';

const NY_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** A timestamp as a New York calendar date, `YYYY-MM-DD`. */
export function nyDate(ts: string | number | Date = Date.now()) {
  return NY_DATE.format(new Date(ts));
}

/** Today as `YYYY-MM-DD`: frozen in demo mode, New York time in live mode. */
export function today() {
  return isDemo ? DEMO_TODAY : nyDate();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parse(date: string) {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function daysBetween(from: string, to: string = today()) {
  return Math.max(0, Math.round((parse(to) - parse(from)) / 86400000));
}

export function shortDate(date: string) {
  const [, m, d] = date.slice(0, 10).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function addDays(date: string, days: number) {
  const t = new Date(parse(date) + days * 86400000);
  return t.toISOString().slice(0, 10);
}

/** `plural(1, 'neighbor')` → "1 neighbor", `plural(3, 'neighbor')` → "3 neighbors". */
export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Hours as "5.2 h", or days past two days ("3.1 days"); "—" when there's no figure. */
export function formatHours(h: number | null) {
  if (h === null) return '—';
  return h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`;
}

export function formatMeters(m: number) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

export function median(values: number[]) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Deterministic pseudo-random daily vote counts that sum to `total`, ramping up recently. */
export function votesPerDay(id: string, days: number, total: number) {
  const n = Math.max(1, Math.min(days, 17));
  let seed = [...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 2147483647;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const weights = Array.from({ length: n }, (_, i) => 0.5 + rand() + (i > n * 0.75 ? 1.2 : 0) + (i === 3 ? 0.8 : 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => Math.max(1, Math.round((w / sum) * total)));
}
