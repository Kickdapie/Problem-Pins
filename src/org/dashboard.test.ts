import { describe, expect, it } from 'vitest';
import { DEMO_DISTRICT } from '../data/demoDistrict';
import { SAMPLE_ISSUES } from '../data/sampleData';
import type { AnalyticsEvent, Issue } from '../data/types';
import { addDays } from '../lib/format';
import { cityFigures, firstResponse, fixedFigures, intakeFigures, todoFor, todoHeadline, todoList, untouched, waited } from './dashboard';
import { RULES, TODAY, issue, partner, request, resident } from './testFixtures';

describe('todoFor', () => {
  it('lists every issue nobody has answered, however few neighbors +1’d it', () => {
    const t = todoFor(issue({ createdAt: '2026-10-14', votes: 1 }), RULES, TODAY);
    expect(t).toMatchObject({ kind: 'new', days: 0, reason: 'Pinned Oct 14 · 1 neighbor' });
    expect(todoFor(issue({ createdAt: '2026-10-11', votes: 3 }), RULES, TODAY)).toMatchObject({ days: 3, reason: 'Pinned Oct 11 · 3 neighbors' });
  });

  it('has a note without the date, for rows that show the days beside it', () => {
    const note = (i: Issue) => todoFor(i, RULES, TODAY)?.note;
    expect(note(issue({ createdAt: '2026-10-11', votes: 3 }))).toBe('3 neighbors');
    expect(note(issue({ status: 'fixed', fixedOn: '2026-09-04', notFixed: 2 }))).toBe('Marked fixed · 2 neighbors say it isn’t');
    expect(note(issue({ status: 'in_review', updates: [resident('2026-10-12', 'Still dark.')] }))).toBe('A neighbor: “Still dark.”');
    expect(note(issue({ status: 'sent_to_city', cityRequest: request('2026-09-01') }))).toBe('NYC DOT · SR 311-12345678 · no follow-up yet');
    expect(note(issue({ status: 'sent_to_city', cityRequest: request('2026-09-01', '2026-09-20') }))).toBe(
      'NYC DOT · SR 311-12345678 · since the last follow-up',
    );
    expect(note(issue({ status: 'scheduled', updates: [partner('2026-09-20')] }))).toBe('Scheduled · nothing since the last update');
  });

  it('says how long an item has waited', () => {
    expect([waited(0), waited(1), waited(34)]).toEqual(['Today', '1 day', '34 days']);
    const item = (kind: 'new' | 'city', days: number) => ({ issue: issue({}), kind, days, reason: '', note: '' });
    expect([todoHeadline(item('new', 34)), todoHeadline(item('city', 0))]).toEqual([
      'Not answered yet · 34 days',
      'Follow up with the City · today',
    ]);
  });

  it('stops calling a pin new once the district does anything with it', () => {
    expect(untouched(issue({}))).toBe(true);
    expect(untouched(issue({ status: 'in_review' }))).toBe(false);
    expect(untouched(issue({ owner: 'Maya' }))).toBe(false);
    expect(untouched(issue({ updates: [partner('2026-10-02')] }))).toBe(false);
    expect(untouched(issue({ status: 'sent_to_city', cityRequest: request('2026-10-02') }))).toBe(false);
    // A resident comment alone doesn't count as a response.
    expect(untouched(issue({ updates: [resident('2026-10-02')] }))).toBe(true);
  });

  it('flags a resident comment that came after the last update', () => {
    const waiting = issue({ status: 'in_review', updates: [partner('2026-10-05'), resident('2026-10-12', 'Any news?')] });
    expect(todoFor(waiting, RULES, TODAY)).toMatchObject({ kind: 'residents', days: 2, reason: 'A neighbor commented Oct 12: “Any news?”' });
    const answered = issue({ status: 'in_review', updates: [resident('2026-10-12'), partner('2026-10-13')] });
    expect(todoFor(answered, RULES, TODAY)).toBeNull();
  });

  it('flags a fix neighbors dispute, and nothing else about fixed issues', () => {
    const disputed = issue({ status: 'fixed', fixedOn: '2026-10-04', notFixed: 2, updates: [resident('2026-10-13')] });
    expect(todoFor(disputed, RULES, TODAY)).toMatchObject({ kind: 'residents', days: 10, reason: 'Marked fixed Oct 4 · 2 neighbors say it isn’t' });
    expect(todoFor(issue({ status: 'fixed', fixedOn: '2026-10-04', notFixed: 1 }), RULES, TODAY)?.reason).toContain('1 neighbor says');
    // A thank-you on a fixed issue doesn't need a reply.
    expect(todoFor(issue({ status: 'fixed', fixedOn: '2026-10-04', updates: [resident('2026-10-13', 'Thanks!')] }), RULES, TODAY)).toBeNull();
  });

  it('flags City requests by days without a follow-up, never by votes', () => {
    const stale = issue({ status: 'sent_to_city', votes: 2, cityRequest: request('2026-10-04'), updates: [partner('2026-10-04')] });
    expect(todoFor(stale, RULES, TODAY)).toMatchObject({ kind: 'city', days: 10, reason: 'NYC DOT · SR 311-12345678 · sent Oct 4' });
    const fresh = issue({ status: 'sent_to_city', votes: 200, cityRequest: request('2026-10-05'), updates: [partner('2026-10-05')] });
    expect(todoFor(fresh, RULES, TODAY)).toBeNull();
    const followedUp = issue({ status: 'sent_to_city', cityRequest: request('2026-09-01', '2026-10-10'), updates: [partner('2026-09-01')] });
    expect(todoFor(followedUp, RULES, TODAY)).toBeNull();
  });

  it('flags issues the district holds when residents have seen nothing new for a while', () => {
    const quiet = issue({ status: 'scheduled', owner: 'Maya', updates: [partner('2026-09-30')] });
    expect(todoFor(quiet, RULES, TODAY)).toMatchObject({ kind: 'quiet', days: 14, reason: 'Last update Sep 30 · Scheduled' });
    expect(todoFor(issue({ status: 'scheduled', updates: [partner('2026-10-01')] }), RULES, TODAY)).toBeNull();
  });

  it('counts a status change or a new owner as news for residents, not only written updates', () => {
    const pin = { date: '2026-09-20', text: 'Pinned via Map' };
    const held = (fields: Partial<Issue>) => issue({ status: 'in_review', createdAt: '2026-09-20', history: [pin], ...fields });
    const changed = held({ history: [pin, { date: '2026-09-25', text: 'Status changed to In review' }], updates: [partner('2026-09-21')] });
    expect(todoFor(changed, RULES, TODAY)).toMatchObject({ kind: 'quiet', days: 19, reason: 'Last change Sep 25: Status changed to In review' });
    expect(todoFor(held({ history: [pin, { date: '2026-10-06', text: 'Assigned to Maya' }] }), RULES, TODAY)).toBeNull();
    // An update posted with the status change reads as the update.
    const both = held({ history: [pin, { date: '2026-09-28', text: 'Status changed to In review' }], updates: [partner('2026-09-28')] });
    expect(todoFor(both, RULES, TODAY)).toMatchObject({ days: 16, reason: 'Last update Sep 28 · In review' });
    // The status moved but nothing says when: count from the pin.
    expect(todoFor(held({}), RULES, TODAY)).toMatchObject({ days: 24, reason: 'Pinned Sep 20, nothing since · In review' });
  });

  it('puts a pin residents reported first, until staff hide it or dismiss the reports', () => {
    const reports = { count: 3, since: '2026-10-12', reasons: [{ reason: 'spam' as const, count: 2 }, { reason: 'other' as const, count: 1 }] };
    // Ahead of any other reason to be on the list, a disputed fix included.
    const reported = issue({ status: 'fixed', fixedOn: '2026-10-04', notFixed: 1, reports });
    expect(todoFor(reported, RULES, TODAY)).toMatchObject({ kind: 'reported', days: 2, reason: '3 reports · Spam or advertising (2), Something else' });
    expect(todoHeadline(todoFor(reported, RULES, TODAY)!)).toBe('Reported by residents · 2 days');
    expect(todoFor(issue({ reports, hidden: true }), RULES, TODAY)).toBeNull();
  });

  it('doesn’t count a line only staff see as news for residents', () => {
    const pin = { date: '2026-09-20', text: 'Pinned via Map' };
    const dismissed = { date: '2026-10-13', text: 'Kept the pin, dismissed 1 report', staffName: 'Maya Ruiz', staffOnly: true };
    const held = issue({ status: 'in_review', createdAt: '2026-09-20', history: [pin, { date: '2026-09-25', text: 'Assigned to Maya' }, dismissed] });
    expect(todoFor(held, RULES, TODAY)).toMatchObject({ kind: 'quiet', days: 19, reason: 'Last change Sep 25: Assigned to Maya' });
  });

  it('leaves out hidden and merged issues', () => {
    expect(todoFor(issue({ hidden: true }), RULES, TODAY)).toBeNull();
    expect(todoFor(issue({ mergedInto: 'PP-2' }), RULES, TODAY)).toBeNull();
  });
});

describe('todoList', () => {
  it('orders by group, then longest wait, then votes', () => {
    const list = todoList(
      [
        issue({ id: 'PP-quiet', status: 'in_review', createdAt: '2026-09-01' }),
        issue({ id: 'PP-new-busy', createdAt: '2026-10-13', votes: 9 }),
        issue({ id: 'PP-new-old', createdAt: '2026-10-10' }),
        issue({ id: 'PP-new-quiet', createdAt: '2026-10-13', votes: 1 }),
        issue({ id: 'PP-city', status: 'sent_to_city', cityRequest: request('2026-09-01'), updates: [partner('2026-09-01')] }),
        issue({ id: 'PP-reply', status: 'in_review', updates: [partner('2026-10-01'), resident('2026-10-13')] }),
        issue({ id: 'PP-reported', status: 'in_review', reports: { count: 1, since: '2026-10-14', reasons: [{ reason: 'offensive', count: 1 }] } }),
      ],
      RULES,
      TODAY,
    );
    expect(list.map((t) => t.issue.id)).toEqual(['PP-reported', 'PP-new-old', 'PP-new-busy', 'PP-new-quiet', 'PP-reply', 'PP-city', 'PP-quiet']);
  });

  it('gives the sample district a list with something in every group', () => {
    const kinds = new Set(todoList(SAMPLE_ISSUES, DEMO_DISTRICT.rules, TODAY).map((t) => t.kind));
    expect([...kinds].sort()).toEqual(['city', 'new', 'quiet', 'residents']);
  });
});

describe('figures', () => {
  it('counts what was pinned in the last 7 days, how much of it has an answer, and the 7 days before', () => {
    const issues = [
      issue({ id: 'A', createdAt: '2026-10-14' }), // today, nobody has touched it
      issue({ id: 'B', createdAt: '2026-10-08', status: 'in_review' }), // first day of the window, answered
      issue({ id: 'C', createdAt: '2026-10-10', updates: [partner('2026-10-11')] }), // answered with an update
      issue({ id: 'D', createdAt: '2026-10-07' }), // last day of the window before
      issue({ id: 'E', createdAt: '2026-10-01' }), // first day of the window before
      issue({ id: 'F', createdAt: '2026-09-30' }), // too old for either
      issue({ id: 'G', createdAt: '2026-10-12', hidden: true }), // hidden pins don't count
      issue({ id: 'H', createdAt: '2026-10-12', mergedInto: 'A' }), // nor do merged duplicates
    ];
    expect(intakeFigures(issues, TODAY)).toEqual({ count: 3, answered: 2, before: 2 });
    expect(intakeFigures([], TODAY)).toEqual({ count: 0, answered: 0, before: 0 });
  });

  it('counts what is waiting on the City, by agency', () => {
    const f = cityFigures(
      [
        issue({ status: 'sent_to_city', cityRequest: request('2026-09-01') }),
        issue({ status: 'sent_to_city', cityRequest: { ...request('2026-10-01'), agency: 'NYC Parks' } }),
        issue({ status: 'sent_to_city', cityRequest: request('2026-10-10') }),
        issue({ status: 'fixed', cityRequest: request('2026-08-01') }),
      ],
      TODAY,
    );
    expect(f).toEqual({ count: 3, oldestDays: 43, byAgency: [{ agency: 'NYC DOT', count: 2 }, { agency: 'NYC Parks', count: 1 }] });
    expect(cityFigures([], TODAY)).toEqual({ count: 0, oldestDays: null, byAgency: [] });
  });

  it('counts what got fixed in the last 30 days, and what neighbors said about it', () => {
    const f = fixedFigures(
      [
        issue({ status: 'fixed', fixedOn: '2026-10-10', confirmedFixed: 2 }),
        issue({ status: 'fixed', fixedOn: '2026-09-15', confirmedFixed: 1, notFixed: 1 }), // first day of the window
        issue({ status: 'fixed', fixedOn: '2026-10-12' }),
        issue({ status: 'fixed', fixedOn: '2026-09-14', confirmedFixed: 3 }), // the day before it
        issue({ status: 'fixed', fixedOn: '2026-10-12', hidden: true }),
        issue({ status: 'in_review', fixedOn: '2026-10-01' }), // reopened since
      ],
      TODAY,
    );
    expect(f).toEqual({ count: 3, confirmed: 2, disputed: 1 });
    expect(fixedFigures([], TODAY)).toEqual({ count: 0, confirmed: 0, disputed: 0 });
  });

  it('keeps the sample’s weekly +1s possible: a pin from this week got every vote this week', () => {
    for (const i of SAMPLE_ISSUES) if (i.createdAt >= addDays(TODAY, -6)) expect(i.votesThisWeek, i.id).toBe(i.votes);
  });

  it('gives every fixed sample issue a history line for the day it was marked fixed', () => {
    for (const i of SAMPLE_ISSUES.filter((s: Issue) => s.status === 'fixed')) {
      expect(
        i.history.some((h) => h.date === i.fixedOn && h.text.startsWith('Marked fixed')),
        i.id,
      ).toBe(true);
    }
  });

  it('measures first responses for pins from one 30-day window at a time', () => {
    const e = (name: AnalyticsEvent['name'], issueId: string, at: string): AnalyticsEvent => ({ name, issueId, at });
    const events = [
      e('pin_submit', 'PP-old', '2026-09-01T14:00:00Z'),
      e('staff_update', 'PP-old', '2026-09-03T14:00:00Z'),
      e('pin_submit', 'PP-a', '2026-10-10T14:00:00Z'),
      e('staff_status', 'PP-a', '2026-10-10T18:00:00Z'),
      e('pin_submit', 'PP-b', '2026-10-13T14:00:00Z'),
    ];
    expect(firstResponse(events, TODAY)).toMatchObject({ pins: 2, responded: 1, waiting: 1, medianHours: 4 });
    // The 30 days before that, for the comparison on the Overview.
    expect(firstResponse(events, addDays(TODAY, -30))).toMatchObject({ pins: 1, responded: 1, medianHours: 48 });
  });
});
