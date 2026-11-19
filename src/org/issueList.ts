import type { AttentionRules, CityRequest, Issue } from '../data/types';
import { daysBetween, plural, shortDate } from '../lib/format';
import { TODO_GROUPS, fixedWithin, todoFor, todoHeadline, type TodoItem } from './dashboard';

/**
 * The list on the Issues page: what each tab holds, in what order, and the line under each
 * row that says why an issue needs the office or where it stands. Pure, like `dashboard.ts`,
 * and tested in `issueList.test.ts`.
 *
 * The Inbox keeps the Overview's to-do order, so after answering one issue the next is right
 * below; neighbor counts only break ties. A search looks through every issue, whatever the tab,
 * because a resident on the phone may ask about one that was fixed months ago.
 */

export type TabId = 'inbox' | 'unassigned' | 'city' | 'fixed' | 'hidden';

export const TABS: { id: TabId; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'city', label: 'Waiting on the City' },
  { id: 'fixed', label: 'Fixed' },
  { id: 'hidden', label: 'Hidden & merged' },
];

export interface Pools {
  /** What residents can see. */
  issues: Issue[];
  /** Hidden and merged issues, which only staff see. */
  hidden: Issue[];
}

export interface Row {
  issue: Issue;
  todo: TodoItem | null;
  /** Why it needs the office (`urgent`) or where it stands, in a few words. Null when the tags say it all. */
  note: { text: string; urgent: boolean } | null;
}

type Context = TabId | 'search';

function inTab(tab: TabId, issue: Issue, todo: TodoItem | null, today: string) {
  switch (tab) {
    case 'inbox':
      // A fix neighbors dispute is back on the to-do list, so it's back in the Inbox too.
      return issue.status !== 'fixed' || todo !== null;
    case 'unassigned':
      return issue.status !== 'fixed' && !issue.owner;
    case 'city':
      return issue.status === 'sent_to_city' && Boolean(issue.cityRequest);
    case 'fixed':
      return fixedWithin(issue, today);
    case 'hidden':
      return true;
  }
}

const poolFor = (tab: TabId, pools: Pools) => (tab === 'hidden' ? pools.hidden : pools.issues);

export function tabCount(tab: TabId, pools: Pools, rules: AttentionRules, today: string) {
  return poolFor(tab, pools).filter((i) => inTab(tab, i, todoFor(i, rules, today), today)).length;
}

/** Days since the office last contacted the City about it: the filing or the last follow-up. */
function cityDays(issue: Issue, today: string) {
  const req = issue.cityRequest;
  return req ? daysBetween(req.lastFollowUp ?? req.sentOn, today) : -1;
}

/** "12 days since filing", "3 days since the last follow-up", "filed today". */
export function cityWait(req: CityRequest, today: string) {
  const days = daysBetween(req.lastFollowUp ?? req.sentOn, today);
  if (req.lastFollowUp) return days === 0 ? 'followed up today' : `${plural(days, 'day')} since the last follow-up`;
  return days === 0 ? 'filed today' : `${plural(days, 'day')} since filing`;
}

/** "Fixed Oct 4 · 2 neighbors say it isn’t", "Fixed Sep 19 · 9 neighbors confirmed", "Fixed Nov 3 · not confirmed yet". */
export function fixedNote(issue: Issue) {
  const said =
    issue.notFixed > 0
      ? `${plural(issue.notFixed, 'neighbor')} ${issue.notFixed === 1 ? 'says' : 'say'} it isn’t`
      : issue.confirmedFixed > 0
        ? `${plural(issue.confirmedFixed, 'neighbor')} confirmed`
        : 'not confirmed yet';
  return `Fixed ${shortDate(issue.fixedOn ?? issue.createdAt)} · ${said}`;
}

function noteFor(context: Context, issue: Issue, todo: TodoItem | null, rules: AttentionRules, today: string): Row['note'] {
  const req = issue.cityRequest;
  if (context === 'city' && req) {
    return { text: `${req.agency} · ${cityWait(req, today)}`, urgent: cityDays(issue, today) >= rules.cityNoReplyDays };
  }
  if (context === 'fixed' && issue.status === 'fixed') return { text: fixedNote(issue), urgent: issue.notFixed > 0 };
  if (todo) return { text: todoHeadline(todo), urgent: true };
  if (issue.status === 'sent_to_city' && req) return { text: `${req.agency} · ${cityWait(req, today)}`, urgent: false };
  if (issue.status === 'fixed') return { text: fixedNote(issue), urgent: false };
  return null;
}

const GROUPS = TODO_GROUPS.map((g) => g.kind);
const byNeighbors = (a: Row, b: Row) => b.issue.votes - a.issue.votes || a.issue.id.localeCompare(b.issue.id);
const newestFix = (a: Row, b: Row) => (b.issue.fixedOn ?? '').localeCompare(a.issue.fixedOn ?? '') || byNeighbors(a, b);
const newestPin = (a: Row, b: Row) => b.issue.createdAt.localeCompare(a.issue.createdAt) || byNeighbors(a, b);

/** To-do items in the Overview's order, then open issues newest first, then fixed ones, then hidden or merged ones. */
function workOrder(a: Row, b: Row) {
  const rank = (r: Row) => (r.todo ? 0 : r.issue.hidden || r.issue.mergedInto ? 3 : r.issue.status === 'fixed' ? 2 : 1);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (a.todo && b.todo) return GROUPS.indexOf(a.todo.kind) - GROUPS.indexOf(b.todo.kind) || b.todo.days - a.todo.days || byNeighbors(a, b);
  return ra === 2 ? newestFix(a, b) : newestPin(a, b);
}

function orderFor(context: Context, today: string): (a: Row, b: Row) => number {
  if (context === 'city') return (a, b) => cityDays(b.issue, today) - cityDays(a.issue, today) || byNeighbors(a, b);
  if (context === 'fixed') return newestFix;
  if (context === 'hidden') return newestPin;
  return workOrder;
}

function summaryFor(context: Context, rows: Row[]) {
  const n = rows.length;
  const count = plural(n, 'issue');
  const then = (order: string) => (n > 1 ? ` · ${order}` : '');
  switch (context) {
    case 'search':
      return `${plural(n, 'match', 'matches')} in all issues`;
    case 'city':
      return `${count}${then('longest wait first')}`;
    case 'fixed':
      return `${count} fixed in the last 30 days${then('newest first')}`;
    case 'hidden':
      return `${count}${then('newest first')}`;
    default: {
      const todos = rows.filter((r) => r.todo).length;
      return `${count}${todos ? ` · ${plural(todos, 'to-do')} first, as on the Overview` : then('newest first')}`;
    }
  }
}

/** The rows for a tab, or for a search across all issues when `query` isn't blank, plus one line saying what's listed and in what order. */
export function issueList(tab: TabId, pools: Pools, rules: AttentionRules, today: string, query = '') {
  const q = query.trim().toLowerCase();
  const context: Context = q ? 'search' : tab;
  const matches = (i: Issue) =>
    `${i.id} ${i.title} ${i.locationLabel} ${i.description} ${i.cityRequest?.sr ?? ''} ${i.cityRequest?.agency ?? ''}`.toLowerCase().includes(q);
  const rows: Row[] = (q ? [...pools.issues, ...pools.hidden].filter(matches) : poolFor(tab, pools))
    .map((issue) => ({ issue, todo: todoFor(issue, rules, today) }))
    .filter((r) => q || inTab(tab, r.issue, r.todo, today))
    .map((r) => ({ ...r, note: noteFor(context, r.issue, r.todo, rules, today) }))
    .sort(orderFor(context, today));
  return { rows, summary: summaryFor(context, rows) };
}
