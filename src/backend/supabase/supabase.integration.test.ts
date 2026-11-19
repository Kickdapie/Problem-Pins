import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nyDate } from '../../lib/format';
import type { Backend, NewIssueDraft } from '../types';
import { createSupabaseBackend } from '.';
import { localStack } from './localStack';

/**
 * Runs against the local Supabase stack (`supabase start`). Skipped when it isn't running,
 * so `npm test` passes anywhere. Uses two throwaway districts, removed afterwards; the
 * seeded sample district is left alone.
 */

const stack = await localStack();
const run = Math.random().toString(36).slice(2, 8);
const A = `test-a-${run}`;
const B = `test-b-${run}`;

// A 0.01° square around Union Square.
const square = (lat: number, lng: number) => ({
  type: 'Polygon' as const,
  coordinates: [[[lng, lat], [lng + 0.01, lat], [lng + 0.01, lat + 0.01], [lng, lat + 0.01], [lng, lat]]],
});
const INSIDE = { lat: 40.735, lng: -73.995 };

const draft = (title: string, extra: Partial<NewIssueDraft> = {}): NewIssueDraft => ({
  title,
  description: 'Test issue',
  category: 'lighting',
  ...INSIDE,
  locationLabel: 'Union Sq',
  photos: [],
  via: 'Map · test',
  ...extra,
});

describe.skipIf(!stack)('Supabase backend (local stack)', { timeout: 20000 }, () => {
  const { url, anonKey, serviceKey } = stack ?? { url: '', anonKey: '', serviceKey: '' };
  const backend = (districtId = A) => createSupabaseBackend({ supabaseUrl: url, supabaseAnonKey: anonKey, districtId });
  let admin: SupabaseClient;
  const staffIds: string[] = [];
  const password = `pw-${run}-${Math.random().toString(36).slice(2)}`;

  // Two residents (separate devices) and staff for A and for B.
  let alice: Backend;
  let bob: Backend;
  let staffA: Backend;
  let staffB: Backend;

  async function makeStaff(district: string, name: string) {
    const email = `${name.toLowerCase()}-${run}@test.example`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    staffIds.push(data.user.id);
    const insert = await admin.from('staff').insert({ user_id: data.user.id, district_id: district, name, role: 'Tester' });
    if (insert.error) throw insert.error;
    const b = backend(district);
    await b.signIn(email, password);
    return b;
  }

  const find = async (b: Backend, id: string) => (await b.load()).issues.find((i) => i.id === id);
  // A fresh device per test that pins: one device may pin only 10 times an hour.
  const carolFor = () => backend();

  beforeAll(async () => {
    admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const districts = [A, B].map((id) => ({
      id,
      name: id === A ? 'Test District A' : 'Test District B',
      area: 'Union Square',
      center_lat: 40.735,
      center_lng: -73.995,
      zoom: 16,
      boundary: square(40.73, -74.0),
      categories: ['lighting', 'litter', 'other'],
      teams: ['Crew'],
      rules: { cityNoReplyDays: 10, quietDays: 14 },
    }));
    const { error } = await admin.from('districts').insert(districts);
    if (error) throw error;
    alice = backend();
    bob = backend();
    staffA = await makeStaff(A, 'Avery');
    staffB = await makeStaff(B, 'Blake');
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from('events').delete().in('district_id', [A, B]);
    await admin.from('scan_points').delete().in('district_id', [A, B]);
    await admin.from('issues').update({ merged_into: null }).in('district_id', [A, B]);
    await admin.from('issues').delete().in('district_id', [A, B]);
    await admin.from('districts').delete().in('id', [A, B]);
    for (const id of staffIds) await admin.auth.admin.deleteUser(id);
  });

  let pinned: string;

  it('creates an issue with a server ID, one vote and one follow from the reporter', async () => {
    pinned = await alice.createIssue(draft('Street light out'));
    expect(pinned).toMatch(/^PP-\d+$/);
    expect(Number(pinned.slice(3))).toBeGreaterThanOrEqual(2461);

    const snap = await alice.load();
    const issue = snap.issues.find((i) => i.id === pinned)!;
    expect(snap.district).toMatchObject({ id: A, name: 'Test District A', categories: ['lighting', 'litter', 'other'] });
    expect(issue).toMatchObject({ votes: 1, votesThisWeek: 1, following: 1, status: 'open', isUserReport: true, createdAt: nyDate() });
    expect(issue.history.map((h) => h.text)).toEqual(['Pinned via Map · test']);
    expect(snap.me.voted).toContain(pinned);
    expect(snap.me.following).toContain(pinned);
  });

  it('refuses pins outside the district boundary and bad input', async () => {
    await expect(alice.createIssue(draft('Far away', { lat: 40.8, lng: -73.95 }))).rejects.toThrow(/outside/);
    await expect(alice.createIssue(draft('x'))).rejects.toThrow('Give the problem a short title.');
    await expect(alice.createIssue(draft('Noise', { category: 'noise' }))).rejects.toThrow('Pick a category.');
    await expect(alice.createIssue(draft('Photo', { photos: ['https://evil.example/pixel.gif'] }))).rejects.toThrow(/uploaded/);
  });

  it('counts one vote per device', async () => {
    const other = (await bob.load()).issues.find((i) => i.id === pinned)!;
    expect(other.isUserReport).toBeUndefined();

    await bob.vote(pinned);
    await bob.vote(pinned);
    await alice.vote(pinned);
    const issue = (await find(bob, pinned))!;
    expect(issue.votes).toBe(2);
    expect(issue.history).toHaveLength(1); // votes don't add to the history
  });

  it('shows resident notes as "Neighbor", and as "You" to their author', async () => {
    await bob.comment(pinned, '  Still dark tonight.  ');
    const forBob = (await find(bob, pinned))!.updates.at(-1)!;
    const forAlice = (await find(alice, pinned))!.updates.at(-1)!;
    expect(forBob).toMatchObject({ author: 'You', role: 'resident', text: 'Still dark tonight.', mine: true });
    expect(forAlice).toMatchObject({ author: 'Neighbor', role: 'resident' });
    expect(forAlice.mine).toBeUndefined();
    await expect(bob.comment(pinned, '   ')).rejects.toThrow('Write something first.');
  });

  it('keeps follow contacts private', async () => {
    await bob.follow(pinned, { email: 'bob@example.com' });
    await bob.follow(pinned, { phone: '(212) 555-0100' });
    expect((await find(alice, pinned))!.following).toBe(2);
    await expect(bob.follow(pinned, { email: 'not-an-email' })).rejects.toThrow(/email/);

    const resident = createClient(url, anonKey, { auth: { persistSession: false } });
    await resident.auth.signInAnonymously();
    const read = await resident.from('follow_contacts').select('*');
    expect(read.error?.message).toMatch(/permission denied/);

    const { data } = await admin.from('follow_contacts').select('email, phone').eq('issue_id', pinned);
    expect(data).toEqual([{ email: 'bob@example.com', phone: '2125550100' }]);
  });

  it('records one fix confirmation per device, once the issue is marked fixed', async () => {
    const id = await alice.createIssue(draft('Broken lamp'));
    await expect(bob.confirmFix(id, 'yes')).rejects.toThrow('This hasn’t been marked fixed yet.');
    await staffA.setStatus(id, 'fixed');
    await bob.confirmFix(id, 'yes');
    await bob.confirmFix(id, 'no');
    const snap = await bob.load();
    expect(snap.me.confirmed[id]).toBe('yes');
    expect(snap.issues.find((i) => i.id === id)!.confirmedFixed).toBe(1);
  });

  it('counts "not fixed" answers only since the issue was last marked fixed', async () => {
    const id = await alice.createIssue(draft('Overflowing bin', { category: 'litter' }));
    await staffA.setStatus(id, 'fixed');
    await bob.confirmFix(id, 'no');
    expect((await find(staffA, id))!.notFixed).toBe(1);
    await staffA.setStatus(id, 'in_review');
    expect((await find(staffA, id))!.notFixed).toBe(0);
    await staffA.setStatus(id, 'fixed');
    expect((await find(staffA, id))!.notFixed).toBe(0);
  });

  it('gives residents no direct table access', async () => {
    const resident = createClient(url, anonKey, { auth: { persistSession: false } });
    await resident.auth.signInAnonymously();
    for (const table of ['issues', 'issue_updates', 'votes', 'follows', 'events', 'reports']) {
      expect((await resident.from(table).select('*')).error?.message).toMatch(/permission denied/);
    }
    expect((await resident.from('votes').insert({ issue_id: pinned, user_id: crypto.randomUUID() })).error).toBeTruthy();
    expect((await resident.from('issues').update({ status: 'fixed' }).eq('id', pinned)).error).toBeTruthy();
    expect((await resident.from('staff').insert({ user_id: crypto.randomUUID(), district_id: A, name: 'x' })).error).toBeTruthy();
  });

  it('rejects staff actions from residents', async () => {
    await expect(alice.hideIssue(pinned, 'spam')).rejects.toThrow('Sign in as staff to do that.');
    await expect(alice.postUpdate(pinned, 'Fixed it')).rejects.toThrow('Sign in as staff to do that.');
    await expect(alice.sendToCity(pinned, { sr: '311-1', agency: 'NYC DOT' })).rejects.toThrow('Sign in as staff to do that.');
    await expect(alice.mergeIssue(pinned, pinned)).rejects.toThrow();
    await expect(alice.listEvents()).rejects.toThrow('Sign in as staff to do that.');
    await expect(alice.saveScanPoint({ code: 'Q-1', name: 'x', detail: '', ...INSIDE })).rejects.toThrow('Sign in as staff');
    expect(await alice.getStaff()).toBeNull();
  });

  it('signs staff in and resolves their staff row', async () => {
    expect(await staffA.getStaff()).toMatchObject({ name: 'Avery', role: 'Tester', districtId: A });
    const outsider = backend(B);
    await expect(outsider.signIn(`avery-${run}@test.example`, password)).rejects.toThrow(/isn’t set up as staff/);
    await expect(outsider.signIn(`avery-${run}@test.example`, 'wrong-password')).rejects.toThrow('Wrong email or password.');
    expect(await outsider.getStaff()).toBeNull();
  });

  it('keeps staff of one district out of another', async () => {
    await expect(staffB.postUpdate(pinned, 'Not mine')).rejects.toThrow('Sign in as staff to do that.');
    await expect(staffB.hideIssue(pinned, 'x')).rejects.toThrow('Sign in as staff to do that.');
    const asB = backend(A);
    await asB.signIn(`blake-${run}@test.example`, password).catch(() => {});
    await expect(asB.listEvents()).rejects.toThrow();
  });

  it('assigns, posts updates and marks fixed', async () => {
    await staffA.assign(pinned, 'Crew');
    let issue = (await find(staffA, pinned))!;
    expect(issue).toMatchObject({ owner: 'Crew', status: 'in_review' });
    expect(issue.history.at(-1)!.text).toBe('Assigned to Crew');

    await staffA.postUpdate(pinned, 'Crew is on it.', 'fixed');
    issue = (await find(alice, pinned))!;
    expect(issue).toMatchObject({ status: 'fixed', fixedOn: nyDate() });
    expect(issue.updates.at(-1)).toMatchObject({ author: 'Test District A', role: 'partner', text: 'Crew is on it.' });
    expect(issue.history.at(-1)!.text).toBe('Status changed to Fixed');

    await staffA.setStatus(pinned, 'open');
    expect((await find(alice, pinned))!.fixedOn).toBeUndefined();
  });

  it('sends to the City only with an SR number, then nudges', async () => {
    await expect(staffA.sendToCity(pinned)).rejects.toThrow('Enter the 311 service request number.');
    await staffA.sendToCity(pinned, { sr: '311-22001234', agency: 'NYC DOT', routedTo: 'NYC DOT · Street Lighting' });
    let issue = (await find(alice, pinned))!;
    expect(issue).toMatchObject({ status: 'sent_to_city', owner: 'NYC DOT' });
    // Residents don't see which staff member filed it.
    expect(issue.cityRequest).toEqual({ sr: '311-22001234', agency: 'NYC DOT', routedTo: 'NYC DOT · Street Lighting', sentOn: nyDate() });
    expect((await find(staffA, pinned))!.cityRequest!.sentBy).toBe('Avery');
    expect(issue.updates.at(-1)!.text).toContain('SR 311-22001234) with 2 neighbors attached');

    await staffA.nudgeCity(pinned);
    issue = (await find(alice, pinned))!;
    expect(issue.cityRequest!.lastFollowUp).toBe(nyDate());
    expect(issue.history.at(-1)!.text).toBe('Followed up with the City, 2 neighbors attached');
  });

  it('hides issues from residents but not from staff', async () => {
    const id = await bob.createIssue(draft('Spam'));
    await staffA.hideIssue(id, 'Not a public-space problem');
    expect(await find(alice, id)).toBeUndefined();
    expect(await find(bob, id)).toBeUndefined();
    await expect(alice.vote(id)).rejects.toThrow(`Problem ${id} doesn’t exist.`);
    expect(await find(staffA, id)).toMatchObject({ hidden: true, hiddenReason: 'Not a public-space problem' });
    expect(await find(staffB, id)).toBeUndefined();

    await staffA.unhideIssue(id);
    expect(await find(alice, id)).toBeDefined();
  });

  it('merges a duplicate, counting a device on both once', async () => {
    const into = await alice.createIssue(draft('Bins overflowing', { category: 'litter' }));
    const dup = await bob.createIssue(draft('Trash everywhere', { category: 'litter' }));
    await alice.vote(dup);
    await staffA.mergeIssue(dup, into);

    const snap = await bob.load();
    const target = snap.issues.find((i) => i.id === into)!;
    const merged = snap.issues.find((i) => i.id === dup)!;
    expect(target).toMatchObject({ votes: 2, following: 2, duplicatesMerged: 1 });
    expect(target.history.at(-1)!.text).toBe(`Merged duplicate ${dup} · 2 neighbors`);
    expect(merged).toMatchObject({ mergedInto: into, votes: 0 });
    expect(snap.me.voted).toContain(into);

    await expect(staffA.mergeIssue(dup, into)).rejects.toThrow(`${dup} was already merged into ${into}.`);
    await expect(bob.vote(dup)).rejects.toThrow(/merged into/);
  });

  // These pin from a device of their own: alice is near the 10-pins-per-hour limit by now.
  it('takes back a +1, but not the one on your own pin', async () => {
    const pinner = backend();
    const id = await pinner.createIssue(draft('Flickering lamp'));
    await bob.vote(id);
    expect((await find(alice, id))!.votes).toBe(2);
    await bob.unvote(id);
    await bob.unvote(id);
    expect((await find(alice, id))!.votes).toBe(1);
    expect((await bob.load()).me.voted).not.toContain(id);
    await expect(pinner.unvote(id)).rejects.toThrow('You pinned this, so your +1 stays.');
  });

  it('stops following and deletes the contact left for it', async () => {
    const pinner = backend();
    const id = await pinner.createIssue(draft('Dark corner'));
    await bob.follow(id, { email: 'bob@example.com' });
    expect((await find(alice, id))!.following).toBe(2);
    await bob.unfollow(id);
    expect((await find(alice, id))!.following).toBe(1);
    expect((await bob.load()).me.following).not.toContain(id);
    const { data } = await admin.from('follow_contacts').select('email').eq('issue_id', id);
    expect(data).toEqual([]);
  });

  it('deletes a note only for the device that wrote it', async () => {
    const pinner = backend();
    const id = await pinner.createIssue(draft('Lamp out by the gate'));
    await bob.comment(id, 'I can be reached at 212 555 0100');
    const note = (await find(bob, id))!.updates.at(-1)!;
    await expect(pinner.deleteNote(id, note.id)).rejects.toThrow('Only the phone that wrote a note can delete it.');
    await expect(staffA.deleteNote(id, note.id)).rejects.toThrow('Only the phone that wrote a note can delete it.');
    await bob.deleteNote(id, note.id);
    expect((await find(alice, id))!.updates).toEqual([]);
  });

  it('lets the device that pinned it remove its pin until a neighbor +1s it or the office acts', async () => {
    const pinner = backend();
    const id = await pinner.createIssue(draft('Pinned by mistake'));
    await expect(bob.removeIssue(id)).rejects.toThrow('Only the phone that pinned this can remove it.');
    await bob.vote(id);
    await expect(pinner.removeIssue(id)).rejects.toThrow('Neighbors have +1’d this, so it stays on the map. You can still add a note.');
    await bob.unvote(id);

    await pinner.removeIssue(id);
    expect(await find(alice, id)).toBeUndefined();
    expect(await find(bob, id)).toBeUndefined();
    const forStaff = (await find(staffA, id))!;
    expect(forStaff).toMatchObject({ hidden: true, hiddenReason: 'Removed by the person who pinned it' });
    expect(forStaff.history.at(-1)).toEqual({ date: nyDate(), text: 'Removed by the person who pinned it' });

    await staffA.unhideIssue(id);
    expect(await find(alice, id)).toBeDefined();
    await staffA.assign(id, 'Crew');
    await expect(pinner.removeIssue(id)).rejects.toThrow('Test District A has picked this up, so it stays on the map. You can still add a note.');
  });

  it('keeps reports from residents: staff see how many and why, a device only that it reported', async () => {
    const pinner = backend();
    const id = await pinner.createIssue(draft('Cheap watches, call now'));
    const carol = backend();
    await bob.reportIssue(id, 'spam');
    await bob.reportIssue(id, 'offensive'); // one report per device
    await carol.reportIssue(id, 'spam');
    await expect(bob.reportIssue(id, 'rude' as never)).rejects.toThrow('Pick a reason.');

    expect((await bob.load()).me.reported).toContain(id);
    expect((await pinner.load()).me.reported).not.toContain(id);
    for (const device of [pinner, bob]) expect(await find(device, id)).not.toHaveProperty('reports');
    expect((await find(staffA, id))!.reports).toEqual({ count: 2, since: nyDate(), reasons: [{ reason: 'spam', count: 2 }] });

    const resident = createClient(url, anonKey, { auth: { persistSession: false } });
    await resident.auth.signInAnonymously();
    const raw = await resident.rpc('get_snapshot', { p_district: A });
    expect(raw.data.issues.find((i: { id: string }) => i.id === id).reports).toBeNull();

    await expect(bob.dismissReports(id)).rejects.toThrow('Sign in as staff to do that.');
    await expect(staffB.dismissReports(id)).rejects.toThrow('Sign in as staff to do that.');
    await staffA.dismissReports(id);
    const kept = (await find(staffA, id))!;
    expect(kept).not.toHaveProperty('reports');
    expect(kept.history.at(-1)).toEqual({ date: nyDate(), text: 'Kept the pin, dismissed 2 reports', staffName: 'Avery', staffOnly: true });
    expect((await find(alice, id))!.history.map((h) => h.text)).toEqual(['Pinned via Map · test']);

    // A new report brings it back; hiding the pin settles that one too.
    await backend().reportIssue(id, 'personal_info');
    expect((await find(staffA, id))!.reports?.count).toBe(1);
    await staffA.hideIssue(id, 'Spam');
    expect(await find(staffA, id)).not.toHaveProperty('reports');
  });

  it('records which staff member did each action, and shows it to staff only', async () => {
    const pinner = backend();
    const id = await pinner.createIssue(draft('Who did it'));
    const dup = await bob.createIssue(draft('Same lamp'));
    await staffA.assign(id, 'Crew');
    await staffA.postUpdate(id, 'On it.', 'scheduled');
    await staffA.sendToCity(id, { sr: '311-22009999', agency: 'NYC DOT' });
    await staffA.nudgeCity(id);
    await staffA.hideIssue(id, 'Checking');
    await staffA.unhideIssue(id);
    await staffA.mergeIssue(dup, id);

    const forStaff = (await find(staffA, id))!;
    expect(forStaff.history.slice(1).map((h) => h.staffName)).toEqual(Array(7).fill('Avery'));
    expect(forStaff.updates.map((u) => u.staffName)).toEqual(['Avery', 'Avery']);

    const forPinner = (await find(alice, id))!;
    expect(forPinner.history).toHaveLength(8);
    expect(forPinner.history.some((h) => 'staffName' in h)).toBe(false);
    expect(forPinner.updates.some((u) => 'staffName' in u)).toBe(false);
  });

  it('saves scan points and never reuses a retired code', async () => {
    await staffA.saveScanPoint({ code: 'q-7', name: 'Noticeboard', detail: 'By the gate', ...INSIDE, issueId: pinned });
    expect((await alice.load()).scanPoints).toEqual([{ code: 'Q-7', name: 'Noticeboard', detail: 'By the gate', ...INSIDE, issueId: pinned }]);
    await staffA.deleteScanPoint('Q-7');
    expect((await alice.load()).scanPoints).toEqual([]);
    await expect(staffA.saveScanPoint({ code: 'Q-7', name: 'Again', detail: '', ...INSIDE })).rejects.toThrow(/earlier poster/);
  });

  it('records analytics events and lists them for staff only', async () => {
    alice.track({ name: 'issue_view', issueId: pinned, props: { source: 'test' } });
    let events: Awaited<ReturnType<Backend['listEvents']>> = [];
    for (let i = 0; i < 20 && !events.length; i++) {
      await new Promise((r) => setTimeout(r, 100));
      events = await staffA.listEvents(nyDate());
    }
    expect(events).toEqual([{ name: 'issue_view', issueId: pinned, props: { source: 'test' }, at: expect.any(String) }]);
    expect(await staffB.listEvents()).toEqual([]);
    expect(await staffA.listEvents('2999-01-01')).toEqual([]);
  });

  it('uploads photos as public images and refuses other files', async () => {
    // 1x1 transparent PNG
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) =>
      c.charCodeAt(0),
    );
    const photoUrl = await alice.uploadPhoto(new Blob([png], { type: 'image/png' }));
    expect(photoUrl).toMatch(/\/storage\/v1\/object\/public\/photos\/[0-9a-f-]{36}\.png$/);
    expect((await fetch(photoUrl)).status).toBe(200);

    const id = await alice.createIssue(draft('With a photo', { photos: [photoUrl] }));
    expect((await find(bob, id))!.photos).toEqual([photoUrl]);
    // Only the device that uploaded a photo can attach it, and photos elsewhere are refused.
    await expect(bob.createIssue(draft('Borrowed photo', { photos: [photoUrl] }))).rejects.toThrow(/uploaded/);
    await expect(alice.createIssue(draft('Tracker', { photos: [photoUrl.replace(/^https?:\/\/[^/]+/, 'https://evil.example')] })))
      .resolves.toMatch(/^PP-/); // only the name is sent; the app serves it from our bucket

    await expect(alice.uploadPhoto(new Blob(['hello'], { type: 'text/plain' }))).rejects.toThrow(/Only photos/);
  });

  it('pings other devices over Realtime when something changes', async () => {
    let unsubscribe = () => {};
    const pinged = new Promise<void>((resolve) => {
      unsubscribe = bob.subscribe(resolve);
    });
    await new Promise((r) => setTimeout(r, 1500)); // let the channel join
    await alice.createIssue(draft('Realtime check'));
    await pinged;
    unsubscribe();
  });

  it('lets no device send pings', async () => {
    let pings = 0;
    let pinged = () => {};
    const unsubscribe = bob.subscribe(() => {
      pings++;
      pinged();
    });
    await new Promise((r) => setTimeout(r, 1500)); // let the channel join

    const intruder = createClient(url, anonKey, { auth: { persistSession: false } });
    await intruder.auth.signInAnonymously();
    // Public first: on Realtime v2.103, joining the topic publicly right after leaving it privately
    // stops pings for everyone already listening. Hosted projects turn public channels off
    // (docs/BACKEND.md), which rules that out; the local stack can't, so this test avoids it.
    for (const isPrivate of [false, true]) {
      const channel = intruder.channel(`district:${A}`, { config: { private: isPrivate } });
      await new Promise<void>((resolve) => channel.subscribe(() => resolve())); // joined, or refused
      await channel.send({ type: 'broadcast', event: 'change', payload: { table: 'issues' } });
      await intruder.removeChannel(channel);
    }
    await new Promise((r) => setTimeout(r, 1500));
    expect(pings).toBe(0);

    // Bob was listening all along: a real change still gets through.
    const real = new Promise<void>((resolve) => (pinged = resolve));
    await alice.comment(pinned, 'Still broken.');
    await real;
    unsubscribe();
  });

  it('sends only what changed since a cursor, as each viewer may see it', async () => {
    const carol = backend();
    const id = await carol.createIssue(draft('Bench broken', { category: 'other' }));
    const start = await bob.load();
    const staffStart = await staffA.load();

    // Nothing changed: no issues, the small parts in full.
    const none = (await bob.loadChanges(start.cursor))!;
    expect(none.issues).toEqual([]);
    expect(none.removed).toEqual([]);
    expect(none.me).toEqual(start.me);
    expect(none.district).toEqual(start.district);

    // Another device's +1 and a staff update: that issue, exactly as a whole snapshot shows it.
    await alice.vote(id);
    await staffA.postUpdate(id, 'On it.');
    const some = (await bob.loadChanges(none.cursor))!;
    expect(some.issues.map((i) => i.id)).toEqual([id]);
    expect(some.issues[0]).toEqual(await find(bob, id));
    expect(some.issues[0].updates.at(-1)!.staffName).toBeUndefined();
    const forStaff = (await staffA.loadChanges(staffStart.cursor))!;
    expect(forStaff.issues.find((i) => i.id === id)!.updates.at(-1)!.staffName).toBe('Avery');

    // This device's own +1 comes back in the issue and in `me`.
    await bob.vote(id);
    const mine = (await bob.loadChanges(some.cursor))!;
    expect(mine.issues.map((i) => i.id)).toEqual([id]);
    expect(mine.issues[0].votes).toBe(3);
    expect(mine.me.voted).toContain(id);

    // Taking a +1 back is a change too (the vote row is deleted).
    await bob.unvote(id);
    const undone = (await bob.loadChanges(mine.cursor))!;
    expect(undone.issues[0].votes).toBe(2);
    expect(undone.me.voted).not.toContain(id);

    // Hidden: gone for residents, by id only; still there for staff.
    await staffA.hideIssue(id, 'Duplicate');
    const hidden = (await bob.loadChanges(undone.cursor))!;
    expect(hidden.issues).toEqual([]);
    expect(hidden.removed).toEqual([id]);
    const staffHidden = (await staffA.loadChanges(forStaff.cursor))!;
    expect(staffHidden.issues.find((i) => i.id === id)).toMatchObject({ hidden: true, hiddenReason: 'Duplicate' });
    expect(staffHidden.removed).toEqual([]);

    // A merge changes the issue it went into: one more duplicate.
    const into = await carol.createIssue(draft('Bins full', { category: 'litter' }));
    const dup = await carol.createIssue(draft('Trash piling up', { category: 'litter' }));
    const beforeMerge = await bob.load();
    await staffA.mergeIssue(dup, into);
    const merged = (await bob.loadChanges(beforeMerge.cursor))!;
    expect(merged.issues.find((i) => i.id === into)).toMatchObject({ duplicatesMerged: 1 });
    expect(merged.issues.find((i) => i.id === dup)).toMatchObject({ mergedInto: into });

    // Changes in another district aren't sent.
    const quiet = (await bob.loadChanges(merged.cursor))!;
    await staffB.saveScanPoint({ code: `Z${run.slice(0, 4).toUpperCase()}`, name: 'Elsewhere', detail: '', lat: 40.735, lng: -73.995 });
    expect((await bob.loadChanges(quiet.cursor))!.issues).toEqual([]);

    // Another viewer's cursor, or a made-up one: a whole snapshot instead.
    expect(await alice.loadChanges(quiet.cursor)).toBeNull();
    expect(await bob.loadChanges('not-a-cursor')).toBeNull();
    const reader = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const since of ['bogus', '12:x', '', '99999999999999999999999:r']) {
      expect((await reader.rpc('get_changes', { p_district: A, p_since: since })).data).toEqual({ reload: true });
    }
  });

  it('loads everything again when staff rights change under the same sign-in', async () => {
    const dana = await makeStaff(A, 'Dana');
    const id = await carolFor().createIssue(draft('Graffiti on the wall', { category: 'other' }));
    await staffA.hideIssue(id, 'Spam');
    const asStaff = await dana.load();
    expect(asStaff.issues.find((i) => i.id === id)).toMatchObject({ hidden: true });

    // An admin removes Dana's staff row while Dana stays signed in.
    const { data } = await admin.from('staff').select('user_id').eq('district_id', A).eq('name', 'Dana').single();
    await admin.from('staff').delete().eq('user_id', data!.user_id).eq('district_id', A);
    expect(await dana.loadChanges(asStaff.cursor)).toBeNull();
    const after = await dana.load();
    expect(after.issues.find((i) => i.id === id)).toBeUndefined();
    expect(after.issues.every((i) => !i.reports && i.updates.every((u) => !u.staffName))).toBe(true);
  });

  it('restores the resident identity when staff sign out', async () => {
    const saved = new Map<string, string>();
    const storage = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => void saved.set(key, value),
      removeItem: (key: string) => void saved.delete(key),
    };
    const device = createSupabaseBackend({ supabaseUrl: url, supabaseAnonKey: anonKey, districtId: A }, { storage });
    const id = await device.createIssue(draft('Before sign-in'));
    await device.signIn(`avery-${run}@test.example`, password);
    expect((await device.load()).me.voted).not.toContain(id);
    await device.signOut();
    expect(await device.getStaff()).toBeNull();
    expect((await device.load()).me.voted).toContain(id);
  });
});
