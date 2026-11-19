import { describe, expect, it } from 'vitest';
import { SAMPLE_ISSUES } from '../data/sampleData';
import type { Issue } from '../data/types';
import { DEMO_DISTRICT, DEMO_SCAN_POINTS } from '../data/demoDistrict';
import { applyChanges, optimisticFollow, optimisticVote } from './changes';
import type { Snapshot, SnapshotChanges } from './types';

const snapshot = (): Snapshot => ({
  district: structuredClone(DEMO_DISTRICT),
  issues: structuredClone(SAMPLE_ISSUES),
  scanPoints: structuredClone(DEMO_SCAN_POINTS),
  me: { voted: ['PP-2431'], following: [], confirmed: {}, reported: [] },
  cursor: '1',
});

const changes = (prev: Snapshot, issues: Issue[] = [], removed: string[] = []): SnapshotChanges => ({
  district: structuredClone(prev.district),
  issues,
  removed,
  scanPoints: structuredClone(prev.scanPoints),
  me: structuredClone(prev.me),
  cursor: '2',
});

describe('applyChanges', () => {
  it('keeps every object when nothing changed', () => {
    const prev = snapshot();
    const next = applyChanges(prev, changes(prev, [structuredClone(prev.issues[3])]));
    expect(next.issues).toBe(prev.issues);
    expect(next.district).toBe(prev.district);
    expect(next.scanPoints).toBe(prev.scanPoints);
    expect(next.me).toBe(prev.me);
    expect(next.cursor).toBe('2');
  });

  it('replaces a changed issue in place and keeps the others', () => {
    const prev = snapshot();
    const changed = { ...structuredClone(prev.issues[2]), votes: 99 };
    const next = applyChanges(prev, { ...changes(prev, [changed]), me: { ...prev.me, voted: ['PP-2431', changed.id] } });
    expect(next.issues[2]).toBe(changed);
    expect(next.issues.filter((i, n) => i !== prev.issues[n])).toEqual([changed]);
    expect(next.issues).toHaveLength(prev.issues.length);
    expect(next.me.voted).toContain(changed.id);
  });

  it('drops removed issues and puts new ones first among the same day', () => {
    const prev = snapshot();
    const newest = prev.issues[0];
    const added = { ...structuredClone(newest), id: 'PP-9999', title: 'New one' };
    const gone = prev.issues[5].id;
    const next = applyChanges(prev, changes(prev, [added], [gone]));
    expect(next.issues[0]).toBe(added);
    expect(next.issues.map((i) => i.id)).not.toContain(gone);
    expect(next.issues).toHaveLength(prev.issues.length);
  });

  it('puts an older issue that came back (unhidden) where its date belongs', () => {
    const prev = snapshot();
    const back = { ...structuredClone(prev.issues.at(-1)!), id: 'PP-1000', createdAt: '2000-01-01' };
    const next = applyChanges(prev, changes(prev, [back]));
    expect(next.issues.at(-1)).toBe(back);
  });
});

describe('optimistic changes', () => {
  const id = 'PP-2440';
  const votesOf = (s: Snapshot) => s.issues.find((i) => i.id === id)!.votes;

  it('shows a +1 at once and does nothing once the server has it', () => {
    const before = snapshot();
    const shown = optimisticVote(id, true)(before);
    expect(votesOf(shown)).toBe(votesOf(before) + 1);
    expect(shown.me.voted).toContain(id);
    // The server's answer counts the +1 and lists it in `me`: applying the change again adds nothing.
    expect(optimisticVote(id, true)(shown)).toBe(shown);
  });

  it('survives a change ping read before the +1 landed', () => {
    const prev = optimisticVote(id, true)(snapshot());
    // Another device's change, read before this device's +1 was saved: the issue comes back without it.
    const stale = { ...structuredClone(snapshot().issues.find((i) => i.id === id)!), following: 99 };
    const merged = applyChanges(prev, { ...changes(prev, [stale]), me: structuredClone(snapshot().me) });
    expect(votesOf(merged)).toBe(votesOf(snapshot()));
    const shown = optimisticVote(id, true)(merged);
    expect(votesOf(shown)).toBe(votesOf(snapshot()) + 1);
    expect(shown.issues.find((i) => i.id === id)!.following).toBe(99);
  });

  it('takes a +1 or a follow back, and ignores issues it doesn’t have', () => {
    const voted = optimisticVote(id, true)(snapshot());
    const back = optimisticVote(id, false)(voted);
    expect(votesOf(back)).toBe(votesOf(snapshot()));
    expect(back.me.voted).not.toContain(id);

    const followed = optimisticFollow(id, true)(snapshot());
    expect(followed.me.following).toEqual([id]);
    expect(optimisticFollow(id, false)(followed).issues.find((i) => i.id === id)!.following).toBe(
      snapshot().issues.find((i) => i.id === id)!.following,
    );
    const s = snapshot();
    expect(optimisticVote('PP-0000', true)(s)).toBe(s);
  });
});
