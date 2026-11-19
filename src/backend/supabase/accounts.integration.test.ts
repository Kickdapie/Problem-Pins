import { createClient, type SupabaseClient, type SupportedStorage } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Backend, NewIssueDraft } from '../types';
import { createSupabaseBackend } from '.';
import { localStack } from './localStack';

/**
 * Optional resident accounts against the local Supabase stack (`supabase start`), reading the
 * 6-digit codes from its mail catcher (Mailpit). Skipped when the stack isn't running. Uses a
 * throwaway district and throwaway users, removed afterwards.
 */

/** What a browser's localStorage does for one device: the session and the pending code. */
function deviceStorage(): SupportedStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

const found = await localStack();
// The code emails are read from Mailpit, so these tests need it too.
const stack = found?.mailUrl ? found : null;
const run = Math.random().toString(36).slice(2, 8);
const D = `test-acct-${run}`;
const INSIDE = { lat: 40.735, lng: -73.995 };

const draft = (title: string): NewIssueDraft => ({
  title,
  description: '',
  category: 'lighting',
  ...INSIDE,
  locationLabel: 'Union Sq',
  photos: [],
  via: 'Map · test',
});

describe.skipIf(!stack)('Resident accounts (local stack)', { timeout: 30000 }, () => {
  const { url, anonKey, serviceKey, mailUrl } = stack ?? { url: '', anonKey: '', serviceKey: '', mailUrl: '' };
  const device = () => createSupabaseBackend({ supabaseUrl: url, supabaseAnonKey: anonKey, districtId: D }, { storage: deviceStorage() });
  const email = (name: string) => `${name}-${run}@example.test`;
  let admin: SupabaseClient;
  const password = `pw-${run}-${Math.random().toString(36).slice(2)}`;
  let staffEmail: string;
  let staffId: string;

  /** The newest code Auth emailed to `to`, read from Mailpit (and deleted there). */
  async function codeFor(to: string) {
    for (let i = 0; i < 40; i++) {
      const found = await (await fetch(`${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json();
      const message = found.messages?.[0];
      if (message) {
        const full = await (await fetch(`${mailUrl}/api/v1/message/${message.ID}`)).json();
        await fetch(`${mailUrl}/api/v1/messages`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ IDs: [message.ID] }),
        });
        expect(full.Subject).toBe('Your Problem Pins code');
        const code = /\b(\d{6})\b/.exec(full.Text ?? '')?.[1];
        if (code) return code;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`No code arrived for ${to}`);
  }

  // Auth sends one email per address per `max_frequency` (1s locally, 60s on hosted projects).
  const lastAsked = new Map<string, number>();
  async function askForCode(b: Backend, address: string) {
    const wait = (lastAsked.get(address) ?? 0) + 1100 - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastAsked.set(address, Date.now());
    return b.requestResidentCode(address);
  }

  async function signInWithEmail(b: Backend, address: string) {
    await askForCode(b, address);
    return b.verifyResidentCode(address, await codeFor(address));
  }

  const issueOn = async (b: Backend, id: string) => (await b.load()).issues.find((i) => i.id === id)!;

  const userIdOf = async (address: string) => {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    return data.users.find((u) => u.email === address)?.id;
  };

  beforeAll(async () => {
    admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await admin.from('districts').insert({
      id: D,
      name: 'Test District Accounts',
      area: 'Union Square',
      center_lat: 40.735,
      center_lng: -73.995,
      zoom: 16,
      boundary: null,
      categories: ['lighting', 'other'],
      teams: ['Crew'],
      rules: { cityNoReplyDays: 10, quietDays: 14 },
    });
    if (error) throw error;
    staffEmail = email('staff');
    const created = await admin.auth.admin.createUser({ email: staffEmail, password, email_confirm: true });
    if (created.error) throw created.error;
    staffId = created.data.user.id;
    const staffRow = await admin.from('staff').insert({ user_id: staffId, district_id: D, name: 'Sam Staff', role: 'Tester' });
    if (staffRow.error) throw staffRow.error;
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from('events').delete().eq('district_id', D);
    await admin.from('issues').delete().eq('district_id', D);
    await admin.from('districts').delete().eq('id', D);
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const user of data.users) if (user.email?.endsWith(`-${run}@example.test`)) await admin.auth.admin.deleteUser(user.id);
  });

  let pin: string;
  let other: string;
  const alex = email('alex');

  it('turns this device into a new account in place: same identity, every record kept', async () => {
    const phone = device();
    pin = await phone.createIssue(draft('Dark stairs'));
    other = await phone.createIssue(draft('Broken bench'));
    await phone.comment(pin, 'Since Monday');
    expect((await phone.load()).me.account).toBeUndefined();

    const result = await signInWithEmail(phone, alex);
    expect(result).toEqual({ returning: false });

    const snap = await phone.load();
    expect(snap.me.account).toEqual({ email: alex, since: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    const issue = snap.issues.find((i) => i.id === pin)!;
    expect(issue.isUserReport).toBe(true);
    expect(issue.updates.at(-1)).toMatchObject({ author: 'You', mine: true });
    expect(snap.me.voted).toEqual(expect.arrayContaining([pin, other]));
  });

  it('refuses a wrong code, an unasked one, and a second account on a signed-in device', async () => {
    const phone = device();
    await expect(phone.verifyResidentCode(email('nobody'), '123456')).rejects.toThrow('Ask for a new code first.');
    await askForCode(phone, email('wrong'));
    await codeFor(email('wrong'));
    await expect(phone.verifyResidentCode(email('wrong'), '000000')).rejects.toThrow(/doesn’t match/);
    await expect(phone.requestResidentCode('not-an-email')).rejects.toThrow(/name@example.com/);
  });

  it('signs in to an existing account on another phone and counts one person once', async () => {
    const phone2 = device();
    await phone2.vote(pin); // the same person, +1 again from a second phone
    const fresh = await phone2.createIssue(draft('Overflowing bin'));
    expect((await issueOn(phone2, pin)).votes).toBe(2);

    const result = await signInWithEmail(phone2, alex);
    expect(result).toEqual({ returning: true });

    const snap = await phone2.load();
    expect(snap.me.account?.email).toBe(alex);
    const issue = snap.issues.find((i) => i.id === pin)!;
    expect(issue.votes).toBe(1); // one person, counted once
    expect(issue.isUserReport).toBe(true); // the account's pin is now on this phone too
    expect(snap.issues.find((i) => i.id === fresh)!.isUserReport).toBe(true);
    expect(snap.me.voted).toEqual(expect.arrayContaining([pin, other, fresh]));
  });

  it('keeps one follow, fix answer and report per person when phones merge (the first answer stays)', async () => {
    const office = device();
    await office.signIn(staffEmail, password);
    const kim = email('kim');
    const phone1 = device();
    const id = await phone1.createIssue(draft('Loose railing'));
    await office.setStatus(id, 'fixed');
    await phone1.confirmFix(id, 'yes');
    await phone1.reportIssue(id, 'spam');
    await signInWithEmail(phone1, kim);

    const phone2 = device();
    await phone2.follow(id);
    await phone2.confirmFix(id, 'no');
    await phone2.reportIssue(id, 'other');
    expect(await issueOn(office, id)).toMatchObject({ following: 2, confirmedFixed: 1, notFixed: 1, reports: { count: 2 } });

    await signInWithEmail(phone2, kim);
    expect(await issueOn(office, id)).toMatchObject({
      following: 1,
      confirmedFixed: 1,
      notFixed: 0,
      reports: { count: 1, reasons: [{ reason: 'spam', count: 1 }] },
    });
    expect((await phone2.load()).me.confirmed[id]).toBe('yes');
  });

  it('signs out to a fresh device; signing in again brings everything back', async () => {
    const phone = device();
    await signInWithEmail(phone, alex);
    expect((await phone.load()).me.voted).toContain(pin);

    await phone.signOutResident();
    const after = await phone.load();
    expect(after.me.account).toBeUndefined();
    expect(after.me.voted).toEqual([]);
    expect(after.issues.find((i) => i.id === pin)!.isUserReport).toBeUndefined();
    expect(after.issues.find((i) => i.id === pin)!.votes).toBe(1); // the +1 still counts

    await phone.vote(pin);
    expect((await issueOn(phone, pin)).votes).toBe(2);
    await signInWithEmail(phone, alex);
    expect((await issueOn(phone, pin)).votes).toBe(1);
  });

  it('keeps staff sessions and resident accounts apart', async () => {
    // Staff can't start a resident account from their session.
    const office = device();
    await office.signIn(staffEmail, password);
    await expect(office.requestResidentCode(email('staff-own'))).rejects.toThrow('This phone is signed in to the staff app. Sign out there first.');

    // A staff email used as a resident account is refused, and the phone stays as it was.
    const phone = device();
    await phone.vote(other);
    await askForCode(phone, staffEmail);
    await expect(phone.verifyResidentCode(staffEmail, await codeFor(staffEmail))).rejects.toThrow(/district office account/);
    expect(await phone.getStaff()).toBeNull();
    const snap = await phone.load();
    expect(snap.me.account).toBeUndefined();
    expect(snap.me.voted).toContain(other);

    // Staff signing in on a phone with a resident account get the account back when they sign out.
    const shared = device();
    await signInWithEmail(shared, alex);
    await shared.signIn(staffEmail, password);
    expect((await shared.getStaff())?.name).toBe('Sam Staff');
    expect((await shared.load()).me.account).toBeUndefined();
    await shared.signOut();
    expect(await shared.getStaff()).toBeNull();
    expect((await shared.load()).me.account?.email).toBe(alex);
  });

  it('deletes the account: the email is gone, the records stay on the map and on this phone', async () => {
    const phone = device();
    await signInWithEmail(phone, alex);
    const elsewhere = device();
    await signInWithEmail(elsewhere, alex);
    const accountId = await userIdOf(alex);
    expect(accountId).toBeTruthy();

    await phone.deleteResidentAccount();
    expect(await userIdOf(alex)).toBeUndefined();

    const snap = await phone.load();
    expect(snap.me.account).toBeUndefined();
    const issue = snap.issues.find((i) => i.id === pin)!;
    expect(issue.isUserReport).toBe(true);
    expect(issue.votes).toBe(1);
    expect(snap.me.voted).toEqual(expect.arrayContaining([pin, other]));

    // The other phone is no longer signed in to it.
    expect((await elsewhere.load()).me.account).toBeUndefined();

    // The email can make a new, empty account.
    const later = device();
    expect(await signInWithEmail(later, alex)).toEqual({ returning: false });
    expect((await later.load()).me.voted).toEqual([]);
  });

  it('guards the account functions', async () => {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    // No session: none of them.
    expect((await anon.rpc('resident_account')).error?.message).toMatch(/permission denied/);
    expect((await anon.rpc('device_claim')).error?.message).toMatch(/permission denied/);

    await anon.auth.signInAnonymously();
    // An anonymous device can't merge or delete; a made-up claim is refused.
    expect((await anon.rpc('merge_device', { p_claim: 'x' })).error?.message).toBe('Sign in with your email first.');
    expect((await anon.rpc('delete_resident_account', { p_claim: 'x' })).error?.message).toBe('Sign in with your email first.');
    expect((await anon.rpc('resident_account')).data).toBeNull();
    // Claims aren't readable, and there are at most 10 open ones per device.
    expect((await anon.schema('private').from('device_claims').select('*')).error).toBeTruthy();
    for (let i = 0; i < 10; i++) expect((await anon.rpc('device_claim')).error).toBeNull();
    expect((await anon.rpc('device_claim')).error?.message).toMatch(/Too many sign-in attempts/);

    // Staff aren't resident accounts.
    const office = createClient(url, anonKey, { auth: { persistSession: false } });
    await office.auth.signInWithPassword({ email: staffEmail, password });
    expect((await office.rpc('resident_account')).data).toBeNull();
    expect((await office.rpc('merge_device', { p_claim: 'x' })).error?.message).toMatch(/district office account/);
  });
});
