import { describe, expect, it } from 'vitest';
import { DEMO_DISTRICT } from '../data/demoDistrict';
import { SAMPLE_ISSUES } from '../data/sampleData';
import type { Issue } from '../data/types';
import { cityFigures, fixedFigures, todoList } from './dashboard';
import { issueList, tabCount, type Row } from './issueList';
import { RULES, TODAY, issue, partner, request, resident } from './testFixtures';

const pools = (issues: Issue[], hidden: Issue[] = []) => ({ issues, hidden });
const ids = (rows: Row[]) => rows.map((r) => r.issue.id);
const notes = (rows: Row[]) => rows.map((r) => [r.issue.id, r.note?.text ?? null, r.note?.urgent ?? null]);

describe('issueList', () => {
  it('lists the Overview’s to-do items first, in its order, then the rest newest first', () => {
    const issues = [
      issue({ id: 'PP-old-scheduled', status: 'scheduled', createdAt: '2026-10-01', updates: [partner('2026-10-10')] }),
      issue({ id: 'PP-new-scheduled', status: 'scheduled', createdAt: '2026-10-12', updates: [partner('2026-10-12')] }),
      issue({ id: 'PP-new', createdAt: '2026-10-13' }),
      issue({ id: 'PP-reply', status: 'in_review', updates: [partner('2026-10-01'), resident('2026-10-13')] }),
      // Neighbors say the fix didn't hold, so it's back in the Inbox; a settled fix isn't.
      issue({ id: 'PP-disputed', status: 'fixed', fixedOn: '2026-10-04', notFixed: 2 }),
      issue({ id: 'PP-fixed', status: 'fixed', fixedOn: '2026-10-10', confirmedFixed: 1 }),
    ];
    const { rows, summary } = issueList('inbox', pools(issues), RULES, TODAY);
    const todos = todoList(issues, RULES, TODAY).map((t) => t.issue.id);
    expect(ids(rows)).toEqual([...todos, 'PP-new-scheduled', 'PP-old-scheduled']);
    expect(todos).toEqual(['PP-new', 'PP-disputed', 'PP-reply']);
    expect(summary).toBe('5 issues · 3 to-dos first, as on the Overview');
    expect(notes(rows).slice(0, 2)).toEqual([
      ['PP-new', 'Not answered yet · 1 day', true],
      ['PP-disputed', 'Residents waiting for a reply · 10 days', true],
    ]);
    expect(rows[3].note).toBeNull();
  });

  it('lists City requests by how long since anyone chased them', () => {
    const issues = [
      issue({ id: 'PP-a', status: 'sent_to_city', cityRequest: request('2026-10-10'), updates: [partner('2026-10-10')] }),
      issue({ id: 'PP-b', status: 'sent_to_city', cityRequest: request('2026-09-01', '2026-10-14'), updates: [partner('2026-09-01')] }),
      issue({ id: 'PP-c', status: 'sent_to_city', cityRequest: request('2026-09-20'), updates: [partner('2026-09-20')] }),
      // No SR number, so nothing to chase: not on this tab, and not in the Overview's count either.
      issue({ id: 'PP-no-sr', status: 'sent_to_city' }),
    ];
    const { rows, summary } = issueList('city', pools(issues), RULES, TODAY);
    expect(notes(rows)).toEqual([
      ['PP-c', 'NYC DOT · 24 days since filing', true],
      ['PP-a', 'NYC DOT · 4 days since filing', false],
      ['PP-b', 'NYC DOT · followed up today', false],
    ]);
    expect(summary).toBe('3 issues · longest wait first');
    expect(tabCount('city', pools(issues), RULES, TODAY)).toBe(cityFigures(issues, TODAY).count);
  });

  it('shows what neighbors said about each fix from the last 30 days', () => {
    const issues = [
      issue({ id: 'PP-confirmed', status: 'fixed', fixedOn: '2026-10-01', confirmedFixed: 3 }),
      issue({ id: 'PP-disputed', status: 'fixed', fixedOn: '2026-10-04', notFixed: 1 }),
      issue({ id: 'PP-unconfirmed', status: 'fixed', fixedOn: '2026-10-12' }),
      issue({ id: 'PP-before', status: 'fixed', fixedOn: '2026-09-14', confirmedFixed: 5 }), // the day before the window
    ];
    const { rows, summary } = issueList('fixed', pools(issues), RULES, TODAY);
    expect(notes(rows)).toEqual([
      ['PP-unconfirmed', 'Fixed Oct 12 · not confirmed yet', false],
      ['PP-disputed', 'Fixed Oct 4 · 1 neighbor says it isn’t', true],
      ['PP-confirmed', 'Fixed Oct 1 · 3 neighbors confirmed', false],
    ]);
    expect(summary).toBe('3 issues fixed in the last 30 days · newest first');
    expect(tabCount('fixed', pools(issues), RULES, TODAY)).toBe(fixedFigures(issues, TODAY).count);
  });

  it('searches every issue whatever the tab, old fixes and hidden pins included', () => {
    const issues = [
      issue({ id: 'PP-1', title: 'Bench broken on W 16th St', status: 'fixed', fixedOn: '2026-06-01' }),
      issue({ id: 'PP-2', title: 'Streetlight out', locationLabel: 'W 16th St', status: 'sent_to_city', cityRequest: request('2026-10-01') }),
      issue({ id: 'PP-3', title: 'Graffiti on W 17th St' }),
    ];
    const hidden = [issue({ id: 'PP-4', title: 'Spam on W 16th St', hidden: true })];
    const { rows, summary } = issueList('inbox', pools(issues, hidden), RULES, TODAY, ' 16th ');
    expect(notes(rows)).toEqual([
      ['PP-2', 'Follow up with the City · 13 days', true],
      ['PP-1', 'Fixed Jun 1 · not confirmed yet', false],
      ['PP-4', null, null],
    ]);
    expect(summary).toBe('3 matches in all issues');
    // A caller may only have the SR number.
    expect(ids(issueList('fixed', pools(issues), RULES, TODAY, '12345678').rows)).toEqual(['PP-2']);
  });

  it('keeps the sample’s tabs in step with the Overview: same to-dos in the same order, same counts', () => {
    const rules = DEMO_DISTRICT.rules;
    const sample = pools(
      SAMPLE_ISSUES.filter((i) => !i.hidden && !i.mergedInto),
      SAMPLE_ISSUES.filter((i) => i.hidden || i.mergedInto),
    );
    const todos = todoList(SAMPLE_ISSUES, rules, TODAY).map((t) => t.issue.id);
    expect(ids(issueList('inbox', sample, rules, TODAY).rows).slice(0, todos.length)).toEqual(todos);
    expect(tabCount('city', sample, rules, TODAY)).toBe(cityFigures(SAMPLE_ISSUES, TODAY).count);
    expect(tabCount('fixed', sample, rules, TODAY)).toBe(fixedFigures(SAMPLE_ISSUES, TODAY).count);
  });
});
