import type { Issue, IssueUpdate } from '../data/types';

/** Shared by the staff-side tests: a fixed "today", the district rules, and a bare issue to build on. */

export const TODAY = '2026-10-14';
export const RULES = { cityNoReplyDays: 10, quietDays: 14 };

export function issue(fields: Partial<Issue>): Issue {
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
    via: 'the map',
    following: 0,
    duplicatesMerged: 0,
    confirmedFixed: 0,
    notFixed: 0,
    ...fields,
  };
}

export const partner = (date: string): IssueUpdate => ({ id: `p-${date}`, author: 'West Side District', role: 'partner', text: 'On it.', date });

export const resident = (date: string, text = 'Still broken.'): IssueUpdate => ({
  id: `r-${date}`,
  author: 'Neighbor',
  role: 'resident',
  text,
  date,
});

export const request = (sentOn: string, lastFollowUp?: string) => ({
  sr: '311-12345678',
  agency: 'NYC DOT',
  routedTo: 'NYC DOT',
  sentOn,
  ...(lastFollowUp ? { lastFollowUp } : {}),
});
