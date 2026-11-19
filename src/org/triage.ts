import { distanceMeters } from '../data/geo';
import type { Issue } from '../data/types';

/** Accepts `311-12345678`, `31112345678` or just the digits; returns `311-…`, or null if it isn't a 311 number. */
export function normalizeSr(input: string) {
  const digits = input.replace(/\s+/g, '').replace(/^311-?/i, '');
  if (!/^\d{7,10}$/.test(digits)) return null;
  return `311-${digits}`;
}

export interface MergeCandidate {
  issue: Issue;
  meters: number;
  sameCategory: boolean;
  open: boolean;
}

/**
 * Issues `duplicate` could be merged into: every other public issue, with nearby open issues
 * in the same category first (closest first), then other open issues, then fixed ones.
 */
export function mergeCandidates(duplicate: Issue, issues: Issue[]): MergeCandidate[] {
  const rank = (c: MergeCandidate) => (c.open ? 0 : 2) + (c.sameCategory ? 0 : 1);
  return issues
    .filter((i) => i.id !== duplicate.id && !i.mergedInto && !i.hidden)
    .map((issue) => ({
      issue,
      meters: distanceMeters(duplicate, issue),
      sameCategory: issue.category === duplicate.category,
      open: issue.status !== 'fixed',
    }))
    .sort((a, b) => rank(a) - rank(b) || a.meters - b.meters);
}

/** Plain-language summary of what a merge moves, for the confirm step. */
export function mergeSummary(duplicate: Issue, into: Issue) {
  return {
    votes: duplicate.votes,
    following: duplicate.following,
    alsoMerged: duplicate.duplicatesMerged,
    votesAfter: into.votes + duplicate.votes,
  };
}
