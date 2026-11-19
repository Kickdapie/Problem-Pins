import { REPORT_REASONS, STATUSES } from '../data/meta';
import type { AnalyticsEvent, AttentionRules, Issue, IssueUpdate } from '../data/types';
import { addDays, daysBetween, plural, shortDate } from '../lib/format';
import { eventDay, staffResponse, type ResponseSummary } from '../lib/metrics';

/**
 * What the staff dashboard shows, worked out from the issues and analytics events alone.
 * Pure (pass `today` in), so it behaves the same with the demo's frozen date and is tested
 * in `dashboard.test.ts`.
 *
 * The to-do list is for a community district office whose job is to answer residents and
 * chase the City. Every issue gets answered, so neighbor counts never decide whether an issue
 * is on the list; within a group the longest wait comes first. Each issue shows up once, in
 * the first group that applies. A pin residents reported comes first of all: until staff hide it
 * or dismiss the reports, it may be showing something that shouldn't be public.
 */

export type TodoKind = 'reported' | 'new' | 'residents' | 'city' | 'quiet';

export interface TodoItem {
  issue: Issue;
  kind: TodoKind;
  /** Days it has waited on the district: since it was reported or pinned, a resident spoke, the last City contact, or residents last saw an update or change. */
  days: number;
  /** What started the wait and when, in a few words. The wait itself is `days`. */
  reason: string;
  /** The same without the "when", for a row that shows `days` beside it: saying both is saying it twice. */
  note: string;
}

export const TODO_GROUPS: { kind: TodoKind; title: string; rule: (rules: AttentionRules) => string }[] = [
  { kind: 'reported', title: 'Reported by residents', rule: () => 'A resident reported the pin; hide it or dismiss the reports' },
  { kind: 'new', title: 'Not answered yet', rule: () => 'No reply, status change or owner yet' },
  {
    kind: 'residents',
    title: 'Residents waiting for a reply',
    rule: () => 'A comment since your last update, or neighbors saying a fix didn’t hold',
  },
  { kind: 'city', title: 'Follow up with the City', rule: (r) => `Sent to 311, no follow-up in ${r.cityNoReplyDays}+ days` },
  { kind: 'quiet', title: 'No update in a while', rule: (r) => `Nothing new for residents in ${r.quietDays}+ days` },
];

/** How long a to-do item has waited: "Today", "1 day", "34 days". */
export function waited(days: number) {
  return days === 0 ? 'Today' : plural(days, 'day');
}

/** The group and the wait in one line, for places that mix groups: "Not answered yet · 34 days". */
export function todoHeadline(todo: TodoItem) {
  const title = TODO_GROUPS.find((g) => g.kind === todo.kind)!.title;
  return `${title} · ${todo.days === 0 ? 'today' : waited(todo.days)}`;
}

function lastUpdateBy(issue: Issue, role: IssueUpdate['role']) {
  for (let n = issue.updates.length - 1; n >= 0; n--) if (issue.updates[n].role === role) return issue.updates[n];
  return undefined;
}

/** Nobody at the district has done anything with it: no reply, no status change, no owner, not filed. */
export function untouched(issue: Issue) {
  return issue.status === 'open' && !issue.owner && !issue.cityRequest && !lastUpdateBy(issue, 'partner');
}

/** "3 reports · Spam or advertising (2), Something else" */
export function reportsNote(issue: Issue) {
  const r = issue.reports;
  if (!r) return '';
  const reasons = r.reasons.map((x) => (x.count > 1 ? `${REPORT_REASONS[x.reason]} (${x.count})` : REPORT_REASONS[x.reason]));
  return `${plural(r.count, 'report')} · ${reasons.join(', ')}`;
}

export function todoFor(issue: Issue, rules: AttentionRules, today: string): TodoItem | null {
  if (issue.hidden || issue.mergedInto) return null;
  const item = (kind: TodoKind, since: string, reason: string, note: string): TodoItem => ({
    issue,
    kind,
    days: daysBetween(since, today),
    reason,
    note,
  });

  if (issue.reports?.count) return item('reported', issue.reports.since, reportsNote(issue), reportsNote(issue));

  if (issue.status === 'fixed') {
    if (!issue.notFixed) return null;
    const fixedOn = issue.fixedOn ?? issue.createdAt;
    const who = issue.notFixed === 1 ? '1 neighbor says' : `${issue.notFixed} neighbors say`;
    return item('residents', fixedOn, `Marked fixed ${shortDate(fixedOn)} · ${who} it isn’t`, `Marked fixed · ${who} it isn’t`);
  }

  if (untouched(issue)) {
    const neighbors = plural(issue.votes, 'neighbor');
    return item('new', issue.createdAt, `Pinned ${shortDate(issue.createdAt)} · ${neighbors}`, neighbors);
  }

  // A note the office hid isn't waiting for an answer.
  const last = issue.updates.filter((u) => !u.hidden).at(-1);
  if (last?.role === 'resident') {
    const who = last.author === 'Neighbor' || last.author === 'You' ? 'A neighbor' : last.author;
    return item('residents', last.date, `${who} commented ${shortDate(last.date)}: “${last.text}”`, `${who}: “${last.text}”`);
  }

  const req = issue.cityRequest;
  if (issue.status === 'sent_to_city' && req) {
    // Waiting on the City: residents already see that, so the job is chasing the City.
    const since = req.lastFollowUp ?? req.sentOn;
    if (daysBetween(since, today) < rules.cityNoReplyDays) return null;
    return item(
      'city',
      since,
      `${req.agency} · SR ${req.sr} · ${req.lastFollowUp ? 'last follow-up' : 'sent'} ${shortDate(since)}`,
      // The days count from the last contact, so the note says which contact that was.
      `${req.agency} · SR ${req.sr} · ${req.lastFollowUp ? 'since the last follow-up' : 'no follow-up yet'}`,
    );
  }

  // What residents last saw from the district: a written update, or a line in the history
  // (a status change, an owner, a merged duplicate). The history starts with the pin itself;
  // lines only staff see (dismissed reports) are no news for residents.
  const update = lastUpdateBy(issue, 'partner');
  const seen = issue.history.filter((h) => !h.staffOnly);
  const change = seen.length > 1 ? seen[seen.length - 1] : undefined;
  const status = STATUSES[issue.status].label;
  const quiet = (since: string, reason: string, note: string) =>
    daysBetween(since, today) < rules.quietDays ? null : item('quiet', since, reason, note);
  if (update && !(change && change.date > update.date))
    return quiet(update.date, `Last update ${shortDate(update.date)} · ${status}`, `${status} · nothing since the last update`);
  if (change) return quiet(change.date, `Last change ${shortDate(change.date)}: ${change.text}`, `Last change: ${change.text}`);
  return quiet(issue.createdAt, `Pinned ${shortDate(issue.createdAt)}, nothing since · ${status}`, `${status} · nothing since it was pinned`);
}

/** The whole list: group by group, longest wait first, then most neighbors. */
export function todoList(issues: Issue[], rules: AttentionRules, today: string): TodoItem[] {
  const order = TODO_GROUPS.map((g) => g.kind);
  return issues
    .map((i) => todoFor(i, rules, today))
    .filter((t): t is TodoItem => t !== null)
    .sort(
      (a, b) =>
        order.indexOf(a.kind) - order.indexOf(b.kind) ||
        b.days - a.days ||
        b.issue.votes - a.issue.votes ||
        a.issue.id.localeCompare(b.issue.id),
    );
}

export interface CityFigures {
  /** Issues waiting on the City. */
  count: number;
  /** Days since the oldest of them was sent; null when there are none. */
  oldestDays: number | null;
  /** Most first. */
  byAgency: { agency: string; count: number }[];
}

export function cityFigures(issues: Issue[], today: string): CityFigures {
  const waiting = issues.filter((i) => i.status === 'sent_to_city' && i.cityRequest && !i.hidden && !i.mergedInto);
  const counts = new Map<string, number>();
  for (const i of waiting) counts.set(i.cityRequest!.agency, (counts.get(i.cityRequest!.agency) ?? 0) + 1);
  const oldest = waiting.reduce<string | null>((min, i) => (!min || i.cityRequest!.sentOn < min ? i.cityRequest!.sentOn : min), null);
  return {
    count: waiting.length,
    oldestDays: oldest === null ? null : daysBetween(oldest, today),
    byAgency: [...counts]
      .map(([agency, count]) => ({ agency, count }))
      .sort((a, b) => b.count - a.count || a.agency.localeCompare(b.agency)),
  };
}

export interface IntakeFigures {
  /** Issues pinned in the last `days` days, today included. */
  count: number;
  /** Of those, how many the office has done something with. */
  answered: number;
  /** Issues pinned in the `days` days before that. */
  before: number;
}

/** What came in lately and how much of it has an answer: whether the office is keeping up. */
export function intakeFigures(issues: Issue[], today: string, days = 7): IntakeFigures {
  const from = addDays(today, -(days - 1));
  const earlier = addDays(from, -days);
  const shown = issues.filter((i) => !i.hidden && !i.mergedInto);
  const recent = shown.filter((i) => i.createdAt >= from && i.createdAt <= today);
  return {
    count: recent.length,
    answered: recent.filter((i) => !untouched(i)).length,
    before: shown.filter((i) => i.createdAt >= earlier && i.createdAt < from).length,
  };
}

export interface FixedFigures {
  /** Issues still marked fixed whose fix date falls in the window. */
  count: number;
  /** Of those, how many at least one neighbor confirmed. */
  confirmed: number;
  /** Of those, how many a neighbor says aren't fixed. */
  disputed: number;
}

/** Still marked fixed, with a fix date in the last `days` days, today included. */
export function fixedWithin(issue: Issue, today: string, days = 30) {
  const from = addDays(today, -(days - 1));
  return issue.status === 'fixed' && Boolean(issue.fixedOn) && issue.fixedOn! >= from && issue.fixedOn! <= today;
}

/** What got fixed in the last `days` days: the same issues as the Fixed tab on the Issues page. */
export function fixedFigures(issues: Issue[], today: string, days = 30): FixedFigures {
  const fixed = issues.filter((i) => fixedWithin(i, today, days) && !i.hidden && !i.mergedInto);
  return {
    count: fixed.length,
    confirmed: fixed.filter((i) => i.confirmedFixed > 0).length,
    disputed: fixed.filter((i) => i.notFixed > 0).length,
  };
}

/**
 * Time from a pin to the district's first action on it, for pins from the `days` days up to
 * `today`. For the window before, pass `addDays(today, -days)` as `today`.
 */
export function firstResponse(events: AnalyticsEvent[], today: string, days = 30): ResponseSummary {
  const from = addDays(today, -(days - 1));
  const pins = events.filter((e) => e.name === 'pin_submit' && eventDay(e) >= from && eventDay(e) <= today);
  return staffResponse(pins, events);
}
