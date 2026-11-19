import { beforeEach, describe, expect, it } from 'vitest';
import { DemoBackend, type KeyValueStorage } from './demo';
import type { NewIssueDraft } from './types';

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const draft: NewIssueDraft = {
  title: 'Sandwich board blocks the curb cut',
  description: '',
  category: 'accessibility',
  lat: 40.742,
  lng: -74.004,
  locationLabel: 'W 17th St',
  photos: [],
  via: 'Map · problempins.org',
};

let storage: KeyValueStorage;
let backend: DemoBackend;

beforeEach(() => {
  storage = memoryStorage();
  backend = new DemoBackend(storage);
});

const find = async (id: string) => (await backend.load()).issues.find((i) => i.id === id)!;

describe('DemoBackend', () => {
  it('sends only what changed since a cursor', async () => {
    const start = await backend.load();
    const none = (await backend.loadChanges(start.cursor))!;
    expect(none.issues).toEqual([]);
    expect(none.removed).toEqual([]);
    expect(none.me).toEqual(start.me);

    await backend.vote('PP-2431');
    const some = (await backend.loadChanges(none.cursor))!;
    expect(some.issues.map((i) => i.id)).toEqual(['PP-2431']);
    expect(some.issues[0]).toEqual(await find('PP-2431'));
    expect(some.me.voted).toContain('PP-2431');

    // Staff see hidden issues; once signed out, a resident's snapshot has them removed.
    await backend.hideIssue('PP-2431', 'Spam');
    const later = await backend.load();
    await backend.signOut();
    const resident = (await backend.loadChanges(later.cursor))!;
    expect(resident.removed).toEqual(['PP-2431']);
    expect(resident.issues.every((i) => !i.reports && i.history.every((h) => !h.staffName))).toBe(true);

    expect(await backend.loadChanges('unknown')).toBeNull();
  });

  it('sends what another tab changed once its save arrives', async () => {
    const start = await backend.load();
    const otherTab = new DemoBackend(storage);
    await otherTab.vote('PP-2440');
    await otherTab.hideIssue('PP-2431', 'Spam');
    // What `subscribe` does on the `storage` event (there is no window here): read the saved state.
    const tab = backend as unknown as { state: unknown; read(): unknown };
    tab.state = tab.read();
    const changes = (await backend.loadChanges(start.cursor))!;
    expect(changes.issues.map((i) => i.id).sort()).toEqual(['PP-2431', 'PP-2440']);
    expect(changes.me.voted).toContain('PP-2440');
  });

  it('generates sequential IDs and counts the reporter as a vote and a follower', async () => {
    const a = await backend.createIssue(draft);
    const b = await backend.createIssue(draft);
    expect([a, b]).toEqual(['PP-2461', 'PP-2462']);
    const snap = await backend.load();
    const issue = snap.issues.find((i) => i.id === a)!;
    expect(issue).toMatchObject({ votes: 1, following: 1, status: 'open', isUserReport: true });
    expect(snap.me.voted).toContain(a);
    expect(snap.me.following).toContain(a);
  });

  it('counts one vote per device', async () => {
    const before = (await find('PP-2431')).votes;
    await backend.vote('PP-2431');
    await backend.vote('PP-2431');
    expect((await find('PP-2431')).votes).toBe(before + 1);
  });

  it('counts "not fixed" answers until the issue is reopened', async () => {
    // PP-2362 is marked fixed, and two neighbors already said it isn't.
    expect((await find('PP-2362')).notFixed).toBe(2);
    await backend.confirmFix('PP-2362', 'no');
    expect((await find('PP-2362')).notFixed).toBe(3);
    await backend.setStatus('PP-2362', 'in_review');
    expect((await find('PP-2362')).notFixed).toBe(0);
  });

  it('persists to storage and reloads', async () => {
    const id = await backend.createIssue(draft);
    const again = new DemoBackend(storage);
    expect((await again.load()).issues.some((i) => i.id === id)).toBe(true);
  });

  it('refuses staff actions when signed out', async () => {
    await backend.signOut();
    expect(await backend.getStaff()).toBeNull();
    await expect(backend.postUpdate('PP-2402', 'hello')).rejects.toThrow(/sign in/i);
    await backend.signIn('maya@example.org', 'x');
    await expect(backend.postUpdate('PP-2402', 'hello')).resolves.toBeUndefined();
  });

  it('records a real SR number when staff provide one', async () => {
    await backend.sendToCity('PP-2419', { sr: '311-12345678', agency: 'NYC DOT' });
    const issue = await find('PP-2419');
    expect(issue.status).toBe('sent_to_city');
    expect(issue.cityRequest).toMatchObject({ sr: '311-12345678', agency: 'NYC DOT', sentBy: 'Maya Ruiz' });
  });

  it('merges a duplicate into another issue', async () => {
    const dup = await backend.createIssue(draft);
    const into = await find('PP-2431');
    await backend.mergeIssue(dup, 'PP-2431');
    const snap = await backend.load();
    const merged = snap.issues.find((i) => i.id === dup)!;
    const target = snap.issues.find((i) => i.id === 'PP-2431')!;
    expect(merged.mergedInto).toBe('PP-2431');
    expect(target.votes).toBe(into.votes + 1);
    expect(target.duplicatesMerged).toBe(into.duplicatesMerged + 1);
    expect(snap.me.voted).toContain('PP-2431');
    await expect(backend.mergeIssue('PP-2431', 'PP-2431')).rejects.toThrow();
    await expect(backend.mergeIssue(dup, 'PP-2402')).rejects.toThrow(/already merged/);
  });

  it('hides issues from residents but not from staff', async () => {
    await backend.hideIssue('PP-2440', 'Duplicate of a 311 noise complaint');
    expect((await find('PP-2440')).hidden).toBe(true);
    await backend.signOut();
    expect((await backend.load()).issues.some((i) => i.id === 'PP-2440')).toBe(false);
  });

  it('records analytics events on the demo date', async () => {
    const seeded = (await backend.listEvents('2026-10-14')).length; // the demo event seed
    backend.track({ name: 'scan_view', scanCode: 'Q-12' });
    const events = await backend.listEvents('2026-10-14');
    expect(events).toHaveLength(seeded + 1);
    expect(events.at(-1)).toMatchObject({ name: 'scan_view', scanCode: 'Q-12' });
    expect(events.at(-1)!.at.startsWith('2026-10-14T')).toBe(true);
  });

  it('keeps follow contacts private', async () => {
    await backend.follow('PP-2402', { email: 'resident@example.org' });
    expect(JSON.stringify(await backend.load())).not.toContain('resident@example.org');
  });

  it('takes back a +1, but never the one on your own pin', async () => {
    const before = await find('PP-2431');
    await backend.vote('PP-2431');
    await backend.unvote('PP-2431');
    await backend.unvote('PP-2431');
    const after = await find('PP-2431');
    expect([after.votes, after.votesThisWeek]).toEqual([before.votes, before.votesThisWeek]);
    expect((await backend.load()).me.voted).not.toContain('PP-2431');

    const mine = await backend.createIssue(draft);
    await expect(backend.unvote(mine)).rejects.toThrow('You pinned this, so your +1 stays.');
  });

  it('stops following and forgets the contact', async () => {
    const before = (await find('PP-2402')).following;
    await backend.follow('PP-2402', { email: 'resident@example.org' });
    await backend.unfollow('PP-2402');
    expect((await find('PP-2402')).following).toBe(before);
    expect((await backend.load()).me.following).not.toContain('PP-2402');
    expect(storage.getItem('problem-pins-demo-v7')).not.toContain('resident@example.org');
  });

  it('deletes only your own notes', async () => {
    await backend.comment('PP-2440', 'Wrong pin, sorry');
    const note = (await find('PP-2440')).updates.at(-1)!;
    await backend.deleteNote('PP-2440', note.id);
    expect((await find('PP-2440')).updates.some((u) => u.id === note.id)).toBe(false);
    const someoneElse = (await find('PP-2402')).updates.find((u) => u.role === 'resident')!;
    await expect(backend.deleteNote('PP-2402', someoneElse.id)).rejects.toThrow('Only the phone that wrote a note can delete it.');
  });

  it('keeps replies one level deep, and deletes them with their note', async () => {
    await backend.comment('PP-2440', 'Same on my block');
    const note = (await find('PP-2440')).updates.at(-1)!;
    await backend.replyToNote('PP-2440', note.id, 'We asked the shop to start later');
    const answer = (await find('PP-2440')).updates.at(-1)!;
    expect(answer).toMatchObject({ role: 'partner', replyTo: note.id });
    // A reply to a reply goes under the same note.
    await backend.comment('PP-2440', 'Thanks!', answer.id);
    expect((await find('PP-2440')).updates.at(-1)).toMatchObject({ role: 'resident', replyTo: note.id, mine: true });
    // A district update isn't a note: there is nothing to reply under.
    const update = (await find('PP-2402')).updates.find((u) => u.role === 'partner' && !u.replyTo)!;
    await expect(backend.comment('PP-2402', 'Hi', update.id)).rejects.toThrow('That note was deleted.');

    await backend.deleteNote('PP-2440', note.id);
    expect((await find('PP-2440')).updates.some((u) => u.id === note.id || u.replyTo === note.id)).toBe(false);
  });

  it('lets staff hide a neighbor’s note and show it again', async () => {
    const note = (await find('PP-2402')).updates.find((u) => u.role === 'resident')!;
    await backend.hideNote('PP-2402', note.id);
    expect((await find('PP-2402')).updates.find((u) => u.id === note.id)).toMatchObject({ hidden: true, hiddenBy: 'Maya Ruiz' });
    await expect(backend.comment('PP-2402', 'Me too', note.id)).rejects.toThrow('hid that note');
    const update = (await find('PP-2402')).updates.find((u) => u.role === 'partner')!;
    await expect(backend.hideNote('PP-2402', update.id)).rejects.toThrow('That note was deleted.');

    // Neighbors get the row without its words or who hid it.
    await backend.signOut();
    expect((await find('PP-2402')).updates.find((u) => u.id === note.id)).toMatchObject({ hidden: true, text: '' });
    expect((await find('PP-2402')).updates.find((u) => u.id === note.id)!.hiddenBy).toBeUndefined();
    await expect(backend.unhideNote('PP-2402', note.id)).rejects.toThrow();

    await backend.signIn('maya@example.org', 'x');
    await backend.unhideNote('PP-2402', note.id);
    expect((await find('PP-2402')).updates.find((u) => u.id === note.id)!.hidden).toBeUndefined();
  });

  it('lets the device that pinned it remove its pin until neighbors +1 it or the office acts', async () => {
    await expect(backend.removeIssue('PP-2440')).rejects.toThrow('Only the phone that pinned this can remove it.');

    const id = await backend.createIssue(draft);
    await backend.removeIssue(id);
    const removed = await find(id);
    expect(removed).toMatchObject({ hidden: true, hiddenReason: 'Removed by the person who pinned it' });
    expect(removed.history.at(-1)).toEqual({ date: '2026-10-14', text: 'Removed by the person who pinned it' });
    await backend.unhideIssue(id); // staff can restore it

    const answered = await backend.createIssue(draft);
    await backend.assign(answered, 'District office staff');
    await expect(backend.removeIssue(answered)).rejects.toThrow('West Side District has picked this up, so it stays on the map. You can still add a note.');

    // The demo has one device, so a second +1 stands in for a neighbor's.
    const popular = await backend.createIssue(draft);
    const state = JSON.parse(storage.getItem('problem-pins-demo-v7')!);
    state.issues.find((i: { id: string }) => i.id === popular).votes = 2;
    storage.setItem('problem-pins-demo-v7', JSON.stringify(state));
    await expect(new DemoBackend(storage).removeIssue(popular)).rejects.toThrow('Neighbors have +1’d this');
  });

  it('takes one report per device, shows reports to staff only, and clears them on dismiss or hide', async () => {
    await backend.reportIssue('PP-2440', 'spam');
    await backend.reportIssue('PP-2440', 'offensive');
    expect((await backend.load()).me.reported).toEqual(['PP-2440']);
    expect((await find('PP-2440')).reports).toEqual({ count: 1, since: '2026-10-14', reasons: [{ reason: 'spam', count: 1 }] });

    await backend.signOut();
    expect(await find('PP-2440')).not.toHaveProperty('reports');
    await backend.signIn('maya@example.org', 'x');

    await backend.dismissReports('PP-2440');
    const kept = await find('PP-2440');
    expect(kept).not.toHaveProperty('reports');
    expect(kept.history.at(-1)).toEqual({ date: '2026-10-14', text: 'Kept the pin, dismissed 1 report', staffName: 'Maya Ruiz', staffOnly: true });

    await backend.reportIssue('PP-2431', 'personal_info');
    await backend.hideIssue('PP-2431', 'Personal information in the text or photo');
    expect(await find('PP-2431')).not.toHaveProperty('reports');
  });

  it('records which staff member did each action, for staff only', async () => {
    await backend.assign('PP-2440', 'District office staff');
    await backend.postUpdate('PP-2440', 'Looking into it.');
    const issue = await find('PP-2440');
    expect(issue.history.at(-1)).toEqual({ date: '2026-10-14', text: 'Assigned to District office staff', staffName: 'Maya Ruiz' });
    expect(issue.updates.at(-1)).toMatchObject({ role: 'partner', staffName: 'Maya Ruiz' });

    await backend.dismissReports('PP-2440'); // nothing to dismiss: no history line
    await backend.reportIssue('PP-2440', 'spam');
    await backend.dismissReports('PP-2440');
    await backend.signOut();
    const forResidents = await find('PP-2440');
    expect(forResidents.history.some((h) => h.staffOnly || h.staffName)).toBe(false);
    expect(forResidents.updates.some((u) => u.staffName)).toBe(false);
    expect((await find('PP-2402')).cityRequest).not.toHaveProperty('sentBy');
  });

  it('resets to the sample data', async () => {
    const id = await backend.createIssue(draft);
    await backend.reset();
    expect((await backend.load()).issues.some((i) => i.id === id)).toBe(false);
  });
});

describe('DemoBackend resident accounts', () => {
  const signIn = async (email: string) => {
    const { demoCode } = await backend.requestResidentCode(email);
    return backend.verifyResidentCode(email, demoCode!);
  };

  it('refuses a bad email, a wrong code and a code that was never asked for', async () => {
    await expect(backend.requestResidentCode('not-an-email')).rejects.toThrow(/email address/);
    await expect(backend.verifyResidentCode('ana@example.com', '123456')).rejects.toThrow(/new code/);
    const { demoCode } = await backend.requestResidentCode('ana@example.com');
    const wrong = demoCode === '000000' ? '111111' : '000000';
    await expect(backend.verifyResidentCode('ana@example.com', wrong)).rejects.toThrow(/doesn’t match/);
    expect((await backend.load()).me.account).toBeUndefined();
  });

  it('keeps what the device did, takes it off on sign-out and brings it back on sign-in', async () => {
    const pin = await backend.createIssue(draft);
    await backend.vote('PP-2431');
    await backend.comment('PP-2431', 'Still out tonight');
    const votes = (await find('PP-2431')).votes;

    expect(await signIn('Ana@Example.com ')).toEqual({ returning: false });
    expect((await backend.load()).me.account).toEqual({ email: 'ana@example.com', since: expect.any(String) });

    await backend.signOutResident();
    let snap = await backend.load();
    expect(snap.me).toEqual({ voted: [], following: [], confirmed: {}, reported: [] });
    expect(snap.issues.find((i) => i.id === pin)!.isUserReport).toBeUndefined();
    expect((await find('PP-2431')).updates.some((u) => u.mine)).toBe(false);
    expect((await find('PP-2431')).votes).toBe(votes); // the +1 is still counted

    expect(await signIn('ana@example.com')).toEqual({ returning: true });
    snap = await backend.load();
    expect(snap.me.voted).toEqual(expect.arrayContaining([pin, 'PP-2431']));
    expect(snap.issues.find((i) => i.id === pin)!.isUserReport).toBe(true);
    expect((await find('PP-2431')).updates.some((u) => u.mine)).toBe(true);
    expect((await find('PP-2431')).votes).toBe(votes);
  });

  it('counts a person once when the device and the account both +1’d', async () => {
    await backend.vote('PP-2431');
    await signIn('ana@example.com');
    await backend.signOutResident();
    const votes = (await find('PP-2431')).votes;
    await backend.vote('PP-2431'); // the signed-out device +1s again
    expect((await find('PP-2431')).votes).toBe(votes + 1);
    await signIn('ana@example.com');
    expect((await find('PP-2431')).votes).toBe(votes);
  });

  it('forgets the email on delete but leaves the device’s records', async () => {
    await backend.vote('PP-2431');
    await signIn('ana@example.com');
    await backend.deleteResidentAccount();
    const { me } = await backend.load();
    expect(me.account).toBeUndefined();
    expect(me.voted).toContain('PP-2431');
    expect(await signIn('ana@example.com')).toEqual({ returning: false });
  });
});
