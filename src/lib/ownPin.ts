import type { Issue } from '../data/types';

/**
 * Why the device that pinned an issue can no longer remove it, or null while it still can.
 * `office`: the district office has done something with it (it isn't Open any more, or it has an
 * owner, a district update, a City request or a merged duplicate). `neighbors`: another device
 * has +1’d it; the pinner's own +1 can't be taken back, so that is any count above one.
 * The same rule as `remove_issue` in supabase/migrations.
 */
export function removalBlocker(issue: Issue): 'office' | 'neighbors' | null {
  const acted =
    issue.status !== 'open' ||
    Boolean(issue.owner) ||
    Boolean(issue.cityRequest) ||
    issue.duplicatesMerged > 0 ||
    issue.updates.some((u) => u.role === 'partner');
  if (acted) return 'office';
  if (issue.votes > 1) return 'neighbors';
  return null;
}
