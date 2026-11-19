import { describe, expect, it, vi } from 'vitest';
import { GENERIC_ERROR, mapIssue, toError, toUploadError, type IssueRow } from './map';

const row: IssueRow = {
  id: 'PP-2500',
  title: 'Bench broken',
  description: '',
  category: 'seating',
  status: 'open',
  lat: 40.74,
  lng: -74.0,
  location_label: 'W 16th St',
  location_detail: null,
  photos: [],
  via: 'Map · problempins.org',
  owner: null,
  agency: null,
  hidden: false,
  hidden_reason: null,
  merged_into: null,
  fixed_at: null,
  // 02:30 UTC is still the previous evening in New York.
  created_at: '2026-11-13T02:30:00+00:00',
  is_user_report: false,
  votes: 3,
  votes_this_week: 2,
  following: 1,
  confirmed_fixed: 0,
  not_fixed: 0,
  duplicates_merged: 0,
  city_request: null,
  updates: [
    { id: 'a', role: 'partner', author: null, text: 'On it', created_at: '2026-11-13T15:00:00Z', mine: false },
    { id: 'b', role: 'resident', author: null, text: 'Thanks', created_at: '2026-11-13T16:00:00Z', mine: false },
    { id: 'c', role: 'resident', author: null, text: 'Me too', created_at: '2026-11-13T17:00:00Z', mine: true },
  ],
  history: [{ text: 'Pinned via Map · problempins.org', created_at: '2026-11-13T02:30:00Z' }],
};

describe('Supabase row mapping', () => {
  it('maps timestamps to New York dates and leaves unset optional fields out', () => {
    const issue = mapIssue(row, 'West Side District');
    expect(issue.createdAt).toBe('2026-11-12');
    expect(issue.history).toEqual([{ date: '2026-11-12', text: 'Pinned via Map · problempins.org' }]);
    for (const key of ['locationDetail', 'agency', 'fixedOn', 'cityRequest', 'hidden', 'mergedInto', 'isUserReport']) {
      expect(issue).not.toHaveProperty(key);
    }
  });

  it('names update authors: the district, "Neighbor", or "You"', () => {
    const [partner, neighbor, mine] = mapIssue(row, 'West Side District').updates;
    expect(partner).toMatchObject({ author: 'West Side District', role: 'partner' });
    expect(neighbor).toMatchObject({ author: 'Neighbor', role: 'resident' });
    expect(neighbor).not.toHaveProperty('mine');
    expect(mine).toMatchObject({ author: 'You', mine: true });
  });

  it('maps a city request', () => {
    const issue = mapIssue(
      {
        ...row,
        city_request: {
          sr: '311-1',
          agency: 'NYC DOT',
          routed_to: 'NYC DOT · Signals',
          sent_at: '2026-11-10T14:00:00Z',
          sent_by: 'Maya Ruiz',
          last_follow_up_at: null,
        },
      },
      'West Side District',
    );
    expect(issue.cityRequest).toEqual({ sr: '311-1', agency: 'NYC DOT', routedTo: 'NYC DOT · Signals', sentOn: '2026-11-10', sentBy: 'Maya Ruiz' });
  });
});

describe('Supabase staff-only fields', () => {
  it('maps reports, staff names and staff-only history lines when staff receive them', () => {
    const issue = mapIssue(
      {
        ...row,
        reports: { count: 2, since: '2026-11-13T02:00:00Z', reasons: [{ reason: 'spam', count: 2 }] },
        updates: [{ ...row.updates[0], staff_name: 'Maya Ruiz' }],
        history: [
          { text: 'Assigned to Crew', created_at: '2026-11-13T15:00:00Z', staff_name: 'Maya Ruiz', staff_only: false },
          { text: 'Kept the pin, dismissed 2 reports', created_at: '2026-11-13T16:00:00Z', staff_name: 'Maya Ruiz', staff_only: true },
        ],
      },
      'West Side District',
    );
    expect(issue.reports).toEqual({ count: 2, since: '2026-11-12', reasons: [{ reason: 'spam', count: 2 }] });
    expect(issue.updates[0].staffName).toBe('Maya Ruiz');
    expect(issue.history).toEqual([
      { date: '2026-11-13', text: 'Assigned to Crew', staffName: 'Maya Ruiz' },
      { date: '2026-11-13', text: 'Kept the pin, dismissed 2 reports', staffName: 'Maya Ruiz', staffOnly: true },
    ]);
  });

  it('leaves them out for residents, who get nulls', () => {
    const issue = mapIssue({ ...row, reports: null, history: [{ ...row.history[0], staff_name: null, staff_only: false }] }, 'West Side District');
    expect(issue).not.toHaveProperty('reports');
    expect(issue.history[0]).toEqual({ date: '2026-11-12', text: 'Pinned via Map · problempins.org' });
  });
});

describe('Supabase errors', () => {
  it('passes our own database messages through and hides everything else', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toError({ code: 'P0001', message: 'Pick a category.' }).message).toBe('Pick a category.');
    expect(toError({ code: '23505', message: 'duplicate key value violates unique constraint' }).message).toBe(GENERIC_ERROR);
    expect(toError(new TypeError('Failed to fetch')).message).toMatch(/connection/);
    expect(toUploadError({ message: 'The object exceeded the maximum allowed size', statusCode: '413' }).message).toMatch(/too large/);
  });
});
