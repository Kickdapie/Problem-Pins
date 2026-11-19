import { describe, expect, it } from 'vitest';
import type { AnalyticsEvent, Issue, ScanPoint } from '../data/types';
import { SAMPLE_ISSUES } from '../data/sampleData';
import { DEMO_SCAN_POINTS } from '../data/demoDistrict';
import { DEMO_EVENTS } from '../data/demoEvents';
import { toCsv } from './csv';
import { EXPERIMENT_THRESHOLDS, type Threshold } from './experimentSettings';
import {
  checkThreshold,
  eventsInMonth,
  funnelTotals,
  monthLabel,
  monthReport,
  rate,
  reportMonths,
  residentActivity,
  scanFunnels,
  scansPerWeek,
  shiftMonth,
  staffResponse,
  waitingByAgency,
} from './metrics';
import { isValidCode, nextFreeCode, normalizeCode, usedCodes } from './scanCodes';

function issue(over: Partial<Issue>): Issue {
  return {
    id: 'PP-1',
    title: 't',
    description: '',
    category: 'litter',
    status: 'open',
    lat: 0,
    lng: 0,
    locationLabel: '',
    votes: 1,
    votesThisWeek: 0,
    createdAt: '2026-10-01',
    owner: null,
    photos: [],
    updates: [],
    history: [],
    via: '',
    following: 0,
    duplicatesMerged: 0,
    confirmedFixed: 0,
    notFixed: 0,
    ...over,
  };
}

const ev = (name: AnalyticsEvent['name'], at: string, extra: Partial<AnalyticsEvent> = {}): AnalyticsEvent => ({ name, at, ...extra });

describe('months', () => {
  it('shifts across years and labels', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(monthLabel('2026-09')).toBe('September 2026');
  });

  it('lists months from the first pin to today, newest first', () => {
    expect(reportMonths([issue({ createdAt: '2026-08-12' })], '2026-10-14')).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(reportMonths([], '2026-10-14')).toEqual(['2026-10']);
  });
});

describe('monthReport', () => {
  const issues = [
    issue({ id: 'A', createdAt: '2026-09-02', status: 'fixed', fixedOn: '2026-09-06', confirmedFixed: 2 }),
    issue({ id: 'B', createdAt: '2026-09-10', status: 'fixed', fixedOn: '2026-09-20', category: 'seating' }),
    issue({ id: 'C', createdAt: '2026-09-15', category: 'seating' }),
    issue({ id: 'D', createdAt: '2026-09-16', hidden: true }),
    issue({ id: 'E', createdAt: '2026-09-17', mergedInto: 'C', category: 'seating' }),
    issue({ id: 'F', createdAt: '2026-08-30' }),
  ];

  it('counts pins, fixes and confirmations for the month', () => {
    const r = monthReport(issues, '2026-09', '2026-10-14', ['litter', 'seating']);
    expect(r.pinned).toBe(4); // A, B, C, E (merged still counts; hidden D does not)
    expect(r.pinnedPrev).toBe(1);
    expect(r.hidden).toBe(1);
    expect(r.fixed).toBe(2);
    expect(r.confirmed).toBe(1);
    expect(r.medianDaysToFix).toBe(7); // 4 and 10
    expect(r.topCategory).toEqual({ category: 'seating', pinned: 3 });
    expect(r.byCategory.find((c) => c.category === 'seating')?.medianDaysToFix).toBe(10);
    expect(r.partial).toBe(false);
    expect(r.through).toBe('2026-09-30');
  });

  it('returns null medians and no top category when there is no data', () => {
    const r = monthReport(issues, '2026-10', '2026-10-14', ['litter']);
    expect(r).toMatchObject({ pinned: 0, fixed: 0, medianDaysToFix: null, topCategory: null, partial: true, through: '2026-10-14' });
  });

  it('counts what was still open on the last day of the month', () => {
    const backlog = [
      issue({ id: 'A', createdAt: '2026-08-10' }), // open, 51 days old on Sep 30
      issue({ id: 'B', createdAt: '2026-09-20', status: 'in_review' }),
      issue({ id: 'C', createdAt: '2026-08-01', status: 'fixed', fixedOn: '2026-09-12' }), // fixed in the month
      issue({ id: 'D', createdAt: '2026-08-05', status: 'fixed', fixedOn: '2026-10-03' }), // fixed after it: still open then
      issue({ id: 'E', createdAt: '2026-10-02' }), // pinned after it
      issue({ id: 'F', createdAt: '2026-09-01', hidden: true }),
      issue({ id: 'G', createdAt: '2026-09-01', mergedInto: 'B' }),
    ];
    expect(monthReport(backlog, '2026-09', '2026-10-14', ['litter'])).toMatchObject({ open: 3, openLong: 2 }); // A, B, D; A and D over 30 days
    expect(monthReport(backlog, '2026-10', '2026-10-14', ['litter'])).toMatchObject({ open: 3, openLong: 1 }); // A, B, E; only A
  });

  it('counts 311 requests by the month they were filed, and how many still wait', () => {
    const req = (sentOn: string) => ({ sr: '311-1', agency: 'NYC DOT', routedTo: '', sentOn });
    const sent = [
      issue({ id: 'A', createdAt: '2026-08-20', status: 'sent_to_city', cityRequest: req('2026-09-03') }), // pinned in August, filed in September
      issue({ id: 'B', createdAt: '2026-09-05', status: 'fixed', fixedOn: '2026-09-25', cityRequest: req('2026-09-08') }),
      issue({ id: 'C', createdAt: '2026-09-06', status: 'sent_to_city', cityRequest: req('2026-10-01') }),
      issue({ id: 'D', createdAt: '2026-09-07', status: 'sent_to_city', cityRequest: req('2026-09-09'), hidden: true }),
      issue({ id: 'E', createdAt: '2026-09-07', status: 'sent_to_city', cityRequest: req('2026-09-09'), mergedInto: 'A' }),
    ];
    expect(monthReport(sent, '2026-09', '2026-10-14', ['litter'])).toMatchObject({ sentToCity: 2, sentStillWaiting: 1 });
    expect(monthReport(sent, '2026-08', '2026-10-14', ['litter'])).toMatchObject({ sentToCity: 0, sentStillWaiting: 0 });
  });
});

describe('waitingByAgency', () => {
  const req = (agency: string, sentOn: string) => ({ sr: '311-1', agency, routedTo: '', sentOn });
  const sent = (id: string, agency: string, sentOn: string, over: Partial<Issue> = {}) =>
    issue({ id, status: 'sent_to_city', agency, cityRequest: req(agency, sentOn), ...over });

  it('groups by agency, most issues first then by name, longest wait first inside a group', () => {
    const groups = waitingByAgency(
      [
        sent('A', 'NYC Parks', '2026-08-17'),
        sent('B', 'NYC DOT', '2026-10-02'),
        sent('C', 'NYC DOT', '2026-09-03'),
        sent('D', 'DSNY', '2026-10-10'),
      ],
      '2026-10-14',
    );
    expect(groups.map((g) => [g.agency, g.rows.map((r) => `${r.issue.id} ${r.days}`)])).toEqual([
      ['NYC DOT', ['C 41', 'B 12']],
      ['DSNY', ['D 4']],
      ['NYC Parks', ['A 58']],
    ]);
  });

  it('includes issues that name an agency but are not filed yet, counted from the pin', () => {
    const groups = waitingByAgency(
      [
        issue({ id: 'A', agency: 'NYC DEP', createdAt: '2026-10-08' }),
        issue({ id: 'B', agency: 'NYC DEP', createdAt: '2026-09-01', status: 'fixed', fixedOn: '2026-09-09' }),
        issue({ id: 'C', createdAt: '2026-10-01' }), // no agency: the district's own
        sent('D', 'NYC DOT', '2026-10-02', { hidden: true }),
        sent('E', 'NYC DOT', '2026-10-02', { mergedInto: 'A' }),
        sent('F', 'NYC DOT', '2026-09-03', { status: 'scheduled' }), // the City answered: no longer waiting
      ],
      '2026-10-14',
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ agency: 'NYC DEP', rows: [{ days: 6 }] });
  });
});

describe('scanFunnels', () => {
  const points: ScanPoint[] = [
    { code: 'Q-1', name: 'Board', detail: '', lat: 0, lng: 0, issueId: 'PP-9' },
    { code: 'Q-2', name: 'Bench', detail: '', lat: 0, lng: 0 },
  ];
  const events = [
    ev('scan_view', '2026-10-01T15:00:00Z', { scanCode: 'Q-1', props: { src: 'qr' } }),
    ev('scan_view', '2026-10-01T15:01:00Z', { scanCode: 'Q-1', props: { src: 'qr' } }),
    ev('scan_view', '2026-10-01T15:02:00Z', { scanCode: 'Q-1', props: { src: 'link' } }),
    ev('pin_start', '2026-10-01T15:03:00Z', { scanCode: 'Q-1' }),
    ev('pin_submit', '2026-10-01T15:05:00Z', { scanCode: 'Q-1', issueId: 'PP-10' }),
    ev('vote', '2026-10-01T15:06:00Z', { issueId: 'PP-9', props: { source: 'scan:Q-1' } }),
    ev('vote', '2026-10-01T15:07:00Z', { issueId: 'PP-9', props: { source: 'scan' } }),
    ev('vote', '2026-10-01T15:08:00Z', { issueId: 'PP-9', props: { source: 'map' } }),
    ev('scan_view', '2026-10-01T15:09:00Z', { scanCode: 'Q-0', props: { src: 'qr' } }),
    ev('pin_start', '2026-10-01T15:10:00Z'),
  ];

  it('builds one row per point, including retired codes seen in events', () => {
    const rows = scanFunnels(events, points);
    expect(rows.map((r) => r.code)).toEqual(['Q-1', 'Q-0', 'Q-2']);
    expect(rows[0]).toEqual({ code: 'Q-1', name: 'Board', qrScans: 2, otherVisits: 1, pinStarts: 1, pinSubmits: 1, votes: 2, firstQrScan: '2026-10-01' });
    expect(scansPerWeek(rows[0], '2026-09-01', '2026-10-07')).toBe(2); // 2 scans over 7 days
    expect(scansPerWeek(rows[2], '2026-09-01', '2026-10-07')).toBeNull();
    expect(rows[1].name).toBeNull();
    expect(rows[2]).toMatchObject({ qrScans: 0, votes: 0 });
    expect(funnelTotals(rows)).toEqual({ qrScans: 3, otherVisits: 1, pinStarts: 1, pinSubmits: 1, votes: 2 });
  });

  it('counts pin starts by origin', () => {
    const a = residentActivity(events);
    expect(a.pinStartsFromQr).toBe(1);
    expect(a.pinStartsFromMap).toBe(1);
    expect(a.counts.find((c) => c.name === 'vote')?.count).toBe(3);
  });

  it('rate is null when there is nothing to divide by', () => {
    expect(rate(1, 4)).toBe(0.25);
    expect(rate(0, 0)).toBeNull();
  });

  it('groups events by New York day, not UTC', () => {
    // 01:00 UTC on Nov 1 is still Oct 31 in New York.
    expect(eventsInMonth([ev('map_view', '2026-11-01T01:00:00Z')], '2026-10')).toHaveLength(1);
  });
});

describe('staffResponse', () => {
  it('measures submit → first staff action, and counts merges for the duplicate', () => {
    const events = [
      ev('pin_submit', '2026-10-01T12:00:00Z', { issueId: 'A' }),
      ev('staff_status', '2026-10-01T18:00:00Z', { issueId: 'A' }),
      ev('staff_update', '2026-10-01T15:00:00Z', { issueId: 'A' }),
      ev('pin_submit', '2026-10-02T12:00:00Z', { issueId: 'B' }),
      ev('staff_merge', '2026-10-03T12:00:00Z', { issueId: 'A', props: { duplicate: 'B' } }),
      ev('pin_submit', '2026-10-03T12:00:00Z', { issueId: 'C' }),
      ev('staff_assign', '2026-09-30T12:00:00Z', { issueId: 'C' }), // before the pin: ignored
    ];
    const r = staffResponse(events, events);
    expect(r.pins).toBe(3);
    expect(r.responded).toBe(2);
    expect(r.waiting).toBe(1);
    expect(r.hours).toEqual([3, 24]);
    expect(r.medianHours).toBe(13.5);
  });

  it('is empty without pins', () => {
    expect(staffResponse([], [])).toMatchObject({ pins: 0, medianHours: null });
  });
});

describe('thresholds', () => {
  const t: Threshold = { label: 'x', unit: 'hours', direction: 'at_most', value: 24 };
  it('reports unset until the team sets a value', () => {
    expect(checkThreshold(10, { ...t, value: null })).toBe('unset');
    expect(checkThreshold(null, t)).toBe('no_data');
    expect(checkThreshold(10, t)).toBe('meets');
    expect(checkThreshold(30, t)).toBe('misses');
    expect(checkThreshold(30, { ...t, direction: 'at_least' })).toBe('meets');
  });

  it('ships with every threshold unset (the team sets them)', () => {
    expect(Object.values(EXPERIMENT_THRESHOLDS).every((x) => x.value === null)).toBe(true);
  });
});

describe('scan codes', () => {
  it('suggests the next Q-n after the highest ever used, never filling gaps', () => {
    expect(nextFreeCode([])).toBe('Q-1');
    expect(nextFreeCode(['Q-12', 'Q-3', 'BENCH'])).toBe('Q-13');
    const used = usedCodes([{ code: 'Q-2' }], [{ scanCode: 'q-9' }, {}], ['Q-4']);
    expect([...used].sort()).toEqual(['Q-2', 'Q-4', 'Q-9']);
    expect(nextFreeCode(used)).toBe('Q-10');
  });

  it('validates codes that go into a URL path', () => {
    expect(normalizeCode(' q-7 ')).toBe('Q-7');
    expect(isValidCode('Q-7')).toBe(true);
    expect(isValidCode('Q 7')).toBe(false);
    expect(isValidCode('Q/7')).toBe(false);
    expect(isValidCode('')).toBe(false);
  });
});

describe('csv', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(toCsv(['a', 'b'], [['x, y', 'say "hi"'], [1, null], ['line\nbreak', undefined]])).toBe(
      'a,b\r\n"x, y","say ""hi"""\r\n1,\r\n"line\nbreak",\r\n',
    );
  });
});

describe('demo event seed', () => {
  it('is deterministic, sorted, and only references real issues and scan points', () => {
    const ids = new Set(SAMPLE_ISSUES.map((i) => i.id));
    const codes = new Set(DEMO_SCAN_POINTS.map((p) => p.code));
    expect(DEMO_EVENTS.length).toBeGreaterThan(100);
    expect(DEMO_EVENTS.length).toBeLessThan(1500); // the demo backend keeps at most 2000
    for (let i = 1; i < DEMO_EVENTS.length; i++) expect(DEMO_EVENTS[i].at >= DEMO_EVENTS[i - 1].at).toBe(true);
    for (const e of DEMO_EVENTS) {
      if (e.issueId) expect(ids.has(e.issueId)).toBe(true);
      if (e.scanCode) expect(codes.has(e.scanCode)).toBe(true);
      expect(e.at <= '2026-10-14T23:59:59Z').toBe(true);
    }
  });

  it('has one pin_submit per sample issue, on its created date, and the seeded QR pin is PP-2402', () => {
    const submits = DEMO_EVENTS.filter((e) => e.name === 'pin_submit');
    expect(submits).toHaveLength(SAMPLE_ISSUES.length);
    for (const s of submits) {
      const i = SAMPLE_ISSUES.find((x) => x.id === s.issueId)!;
      expect(eventsInMonth([s], i.createdAt.slice(0, 7))).toHaveLength(1);
    }
    expect(submits.filter((e) => e.scanCode).map((e) => e.issueId)).toEqual(['PP-2402']);
  });

  it('gives the experiments panel something to show', () => {
    const rows = scanFunnels(DEMO_EVENTS, DEMO_SCAN_POINTS);
    expect(rows[0].qrScans).toBeGreaterThan(rows[0].pinStarts);
    expect(rows[0].votes).toBeGreaterThan(0);
    expect(staffResponse(DEMO_EVENTS, DEMO_EVENTS).responded).toBeGreaterThan(5);
  });
});
