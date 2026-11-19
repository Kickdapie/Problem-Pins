import { describe, expect, it } from 'vitest';
import { SAMPLE_ISSUES } from '../data/sampleData';
import type { Issue } from '../data/types';
import { mergeCandidates, normalizeSr } from './triage';

describe('normalizeSr', () => {
  it('accepts the usual ways people type an SR number', () => {
    expect(normalizeSr('311-21847390')).toBe('311-21847390');
    expect(normalizeSr(' 311 21847390 ')).toBe('311-21847390');
    expect(normalizeSr('21847390')).toBe('311-21847390');
  });

  it('refuses anything that is not a 311 number', () => {
    expect(normalizeSr('')).toBeNull();
    expect(normalizeSr('311-')).toBeNull();
    expect(normalizeSr('SR 12')).toBeNull();
    expect(normalizeSr('311-2184abc')).toBeNull();
  });
});

describe('mergeCandidates', () => {
  const base = SAMPLE_ISSUES[0];
  const near = (id: string, fields: Partial<Issue>): Issue => ({ ...base, id, ...fields });

  it('puts nearby open issues in the same category first, closest first', () => {
    const dup = near('dup', { category: 'lighting', status: 'open' });
    const list = [
      near('far-same', { category: 'lighting', lat: base.lat + 0.01 }),
      near('close-other', { category: 'litter' }),
      near('close-same', { category: 'lighting', lat: base.lat + 0.0005 }),
      near('fixed-same', { category: 'lighting', status: 'fixed' }),
      dup,
    ];
    expect(mergeCandidates(dup, list).map((c) => c.issue.id)).toEqual(['close-same', 'far-same', 'close-other', 'fixed-same']);
  });

  it('never offers the issue itself, hidden or already-merged issues', () => {
    const dup = near('dup', {});
    const list = [dup, near('merged', { mergedInto: 'x' }), near('hidden', { hidden: true }), near('ok', {})];
    expect(mergeCandidates(dup, list).map((c) => c.issue.id)).toEqual(['ok']);
  });
});
