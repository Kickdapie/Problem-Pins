import type { AnalyticsEvent, Issue, Status } from './types';
import { DEMO_SCAN_POINTS } from './demoDistrict';
import { SAMPLE_ISSUES } from './sampleData';

/**
 * Analytics events for the demo, so the Reports experiments panel has something to show.
 * Deterministic (seeded), built from the sample issues so it agrees with them:
 * one `pin_submit` per sample issue on its created date, staff actions on the dates in
 * each issue's history, fix confirmations matching `confirmedFixed`, and scans of the
 * one demo poster (Q-12) from late September. Everything else (map views, +1s) is
 * made-up traffic at a plausible volume. All of it is SAMPLE DATA, not results.
 */

const START = '2026-08-10';
const END = '2026-10-14'; // DEMO_TODAY
const POSTER_UP = '2026-09-24';
// The demo date is frozen but the clock isn't: keep seeded events on the last day early,
// so anything you do in the demo today lands after them.
const LAST_DAY_CUTOFF = 10 * 60;

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addDays(date: string, n: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

/** New York local time (EDT, UTC−4, for the whole demo window) → ISO timestamp. */
function at(date: string, minutes: number) {
  const m = date === END ? Math.min(minutes, LAST_DAY_CUTOFF) : minutes;
  return new Date(Date.parse(`${date}T04:00:00Z`) + Math.round(m) * 60000).toISOString();
}

function minutesOf(iso: string) {
  const t = new Date(Date.parse(iso) - 4 * 3600000);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}

function dayOf(iso: string) {
  return new Date(Date.parse(iso) - 4 * 3600000).toISOString().slice(0, 10);
}

function staffEventFor(text: string): Pick<AnalyticsEvent, 'name' | 'props'> | null {
  if (/^Assigned to/.test(text)) return { name: 'staff_assign', props: { assigned: true } };
  if (/^Sent to NYC 311/.test(text)) return { name: 'staff_send_to_city' };
  if (/^Marked fixed/.test(text)) return { name: 'staff_status', props: { status: 'fixed' satisfies Status } };
  if (/reviewing/.test(text)) return { name: 'staff_status', props: { status: 'in_review' satisfies Status } };
  if (/^Scheduled/.test(text)) return { name: 'staff_status', props: { status: 'scheduled' satisfies Status } };
  return null;
}

function build(): AnalyticsEvent[] {
  const rand = rng(303);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const int = (lo: number, hi: number) => Math.floor(between(lo, hi + 1));
  const events: AnalyticsEvent[] = [];
  const push = (e: AnalyticsEvent) => events.push(e);
  const qr = DEMO_SCAN_POINTS[0];
  const submitted = new Map<string, string>();

  // Pins: one start + submit per sample issue, on its created date.
  for (const issue of SAMPLE_ISSUES) {
    const fromQr = issue.id === qr.issueId;
    const t = between(8 * 60, 20 * 60);
    if (fromQr) push({ name: 'scan_view', scanCode: qr.code, props: { src: 'qr', known: true }, at: at(issue.createdAt, t - 6) });
    push({ name: 'pin_start', scanCode: fromQr ? qr.code : undefined, props: { via: fromQr ? 'qr' : 'map' }, at: at(issue.createdAt, t - 4) });
    const submit = at(issue.createdAt, t);
    submitted.set(issue.id, submit);
    push({
      name: 'pin_submit',
      issueId: issue.id,
      scanCode: fromQr ? qr.code : undefined,
      props: { category: issue.category, photos: issue.photos.length },
      at: submit,
    });
  }

  // Staff actions, on the dates the sample history and partner updates give.
  const staffAt = (issue: Issue, date: string) => {
    const submit = submitted.get(issue.id)!;
    if (date === dayOf(submit)) return at(date, minutesOf(submit) + between(60, 300));
    return at(date, between(9 * 60, 17 * 60));
  };
  for (const issue of SAMPLE_ISSUES) {
    let acted = false;
    for (const h of issue.history) {
      const e = staffEventFor(h.text);
      if (!e) continue;
      push({ ...e, issueId: issue.id, at: staffAt(issue, h.date) });
      acted = true;
    }
    for (const u of issue.updates) {
      if (u.role !== 'partner') continue;
      push({ name: 'staff_update', issueId: issue.id, at: staffAt(issue, u.date) });
      acted = true;
    }
    // Owned or moved along, but the history doesn't say when: someone assigned it soon after.
    if (!acted && (issue.owner || issue.status !== 'open')) {
      const date = addDays(issue.createdAt, int(0, 2));
      push({ name: 'staff_assign', issueId: issue.id, props: { assigned: true }, at: staffAt(issue, date > END ? END : date) });
    }
  }

  // Residents confirming fixes, matching each fixed issue's `confirmedFixed`.
  for (const issue of SAMPLE_ISSUES) {
    if (!issue.fixedOn) continue;
    for (let i = 0; i < issue.confirmedFixed; i++) {
      push({ name: 'confirm_fix', issueId: issue.id, props: { answer: 'yes' }, at: at(addDays(issue.fixedOn, int(0, 9)), between(7 * 60, 22 * 60)) });
    }
  }

  // Everyday traffic: map views, problems opened, +1s, follows.
  for (let day = START; day <= END; day = addDays(day, 1)) {
    const live = SAMPLE_ISSUES.filter((i) => i.createdAt < day && !(i.fixedOn && i.fixedOn < day));
    const weekend = [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
    const base = day < '2026-09-01' ? 2 : day < '2026-10-01' ? 5 : 8;
    const views = Math.max(0, Math.round(base * (weekend ? 0.7 : 1) + between(-2, 2)));
    for (let v = 0; v < views; v++) {
      const t = between(7 * 60, 22 * 60);
      push({ name: 'map_view', at: at(day, t) });
      if (!live.length || rand() > 0.5) continue;
      // Busier problems get opened more.
      const total = live.reduce((s, i) => s + i.votes, 0);
      let pick = rand() * total;
      const issue = live.find((i) => (pick -= i.votes) <= 0) ?? live[0];
      push({ name: 'issue_view', issueId: issue.id, at: at(day, t + 1) });
      if (rand() < 0.35) push({ name: 'vote', issueId: issue.id, props: { source: 'issue' }, at: at(day, t + 2) });
      else if (rand() < 0.1) push({ name: 'follow', issueId: issue.id, props: { contact: 'email' }, at: at(day, t + 3) });
    }
  }

  // The Q-12 poster: QR scans from the day it went up, some leading to a pin or a +1.
  const linkedCreated = SAMPLE_ISSUES.find((i) => i.id === qr.issueId)?.createdAt ?? END;
  for (let day = POSTER_UP; day <= END; day = addDays(day, 1)) {
    const weekend = [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
    const scans = int(weekend ? 3 : 2, weekend ? 8 : 6);
    for (let s = 0; s < scans; s++) {
      const t = between(7 * 60, 21 * 60);
      push({ name: 'scan_view', scanCode: qr.code, props: { src: 'qr', known: true }, at: at(day, t) });
      const r = rand();
      if (day > linkedCreated && r < 0.3) {
        push({ name: 'vote', issueId: qr.issueId, props: { source: `scan:${qr.code}` }, at: at(day, t + 1) });
        if (rand() < 0.3) push({ name: 'issue_view', issueId: qr.issueId, at: at(day, t + 2) });
      } else if (r > 0.88) {
        // Started a pin but didn't finish it (the one finished pin is PP-2402, above).
        push({ name: 'pin_start', scanCode: qr.code, props: { via: 'qr' }, at: at(day, t + 1) });
      }
    }
    if (rand() < 0.25) push({ name: 'scan_view', scanCode: qr.code, props: { src: 'link', known: true }, at: at(day, between(9 * 60, 20 * 60)) });
  }

  // Neighbors saying a fix didn't hold, matching `notFixed`. Fixed times (no random draws),
  // so the events above stay the same.
  for (const issue of SAMPLE_ISSUES) {
    if (!issue.fixedOn) continue;
    for (let i = 0; i < issue.notFixed; i++) {
      push({ name: 'confirm_fix', issueId: issue.id, props: { answer: 'no' }, at: at(addDays(issue.fixedOn, 3 + 4 * i), 19 * 60) });
    }
  }

  return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export const DEMO_EVENTS: AnalyticsEvent[] = build();
