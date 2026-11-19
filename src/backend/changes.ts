import type { Issue } from '../data/types';
import type { Snapshot, SnapshotChanges } from './types';

/**
 * Folds the answer to `loadChanges` into the snapshot the store holds. Whatever didn't change
 * keeps its object, so memoized lists, rows and map markers skip it: one +1 re-renders one row.
 */
export function applyChanges(prev: Snapshot, changes: SnapshotChanges): Snapshot {
  const gone = new Set(changes.removed);
  const old = new Map(prev.issues.map((i) => [i.id, i]));
  // An issue sent again unchanged (the cursor errs on the early side) keeps its object too.
  const fresh = new Map<string, Issue>();
  for (const issue of changes.issues) {
    const before = old.get(issue.id);
    if (!before || !sameJson(before, issue)) fresh.set(issue.id, issue);
  }

  let issues = prev.issues;
  if (fresh.size || prev.issues.some((i) => gone.has(i.id))) {
    const kept = prev.issues.filter((i) => !gone.has(i.id)).map((i) => fresh.get(i.id) ?? i);
    const added = [...fresh.values()].filter((i) => !old.has(i.id));
    issues = added.length ? byNewest(kept, added) : kept;
  }

  return {
    district: sameJson(prev.district, changes.district) ? prev.district : changes.district,
    issues,
    scanPoints: sameJson(prev.scanPoints, changes.scanPoints) ? prev.scanPoints : changes.scanPoints,
    me: sameJson(prev.me, changes.me) ? prev.me : changes.me,
    cursor: changes.cursor,
  };
}

function sameJson(a: unknown, b: unknown) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Puts new issues where a snapshot would have them: newest pin first. A new pin goes before the
 * ones pinned the same day (it is the latest); dates are days, so that is the best we can tell.
 */
function byNewest(kept: Issue[], added: Issue[]) {
  const incoming = [...added].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const out: Issue[] = [];
  let n = 0;
  for (const issue of kept) {
    while (n < incoming.length && incoming[n].createdAt >= issue.createdAt) out.push(incoming[n++]);
    out.push(issue);
  }
  while (n < incoming.length) out.push(incoming[n++]);
  return out;
}

/**
 * An optimistic change the store shows before the server has it. It is applied again to every
 * snapshot that arrives until its mutation has been answered, so a change ping read before the
 * mutation landed doesn't take the +1 back for a moment. It decides by `me`, which every answer
 * carries in full, so it does nothing once the server has the change (no +1 counted twice).
 */
export type Optimistic = (s: Snapshot) => Snapshot;

function patchIssue(s: Snapshot, id: string, fn: (issue: Issue) => Issue) {
  return s.issues.map((i) => (i.id === id ? fn(i) : i));
}

export function optimisticVote(id: string, on: boolean): Optimistic {
  return (s) => {
    if (s.me.voted.includes(id) === on || !s.issues.some((i) => i.id === id)) return s;
    const step = on ? 1 : -1;
    return {
      ...s,
      me: { ...s.me, voted: on ? [...s.me.voted, id] : s.me.voted.filter((v) => v !== id) },
      issues: patchIssue(s, id, (i) => ({
        ...i,
        votes: Math.max(0, i.votes + step),
        votesThisWeek: Math.max(0, i.votesThisWeek + step),
      })),
    };
  };
}

export function optimisticFollow(id: string, on: boolean): Optimistic {
  return (s) => {
    if (s.me.following.includes(id) === on || !s.issues.some((i) => i.id === id)) return s;
    return {
      ...s,
      me: { ...s.me, following: on ? [...s.me.following, id] : s.me.following.filter((f) => f !== id) },
      issues: patchIssue(s, id, (i) => ({ ...i, following: Math.max(0, i.following + (on ? 1 : -1)) })),
    };
  };
}
