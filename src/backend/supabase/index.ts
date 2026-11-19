import { createClient, type Session, type SupportedStorage } from '@supabase/supabase-js';
import type { config as appConfig } from '../../config';
import type {
  AnalyticsEvent,
  CityRequestInput,
  FollowContact,
  ReportReason,
  ResidentAccount,
  ScanPoint,
  StaffUser,
  Status,
} from '../../data/types';
import type { Backend, NewIssueDraft, Snapshot } from '../types';
import { mapChanges, mapEvent, mapSnapshot, toError, toUploadError, type ChangesRow, type EventRow, type SnapshotRow } from './map';

/**
 * Live backend on Supabase (Postgres + Auth + Storage + Realtime). The database side lives in
 * supabase/migrations; docs/BACKEND.md explains the setup.
 *
 * Residents are anonymous Supabase users, one per device, created on first load. A resident may
 * add an email (an optional account, proved with a 6-digit code) to keep their records beyond the
 * device. Staff sign in with email and password; signing out restores the device's resident
 * identity (anonymous or account), so its votes stay one per person.
 */

export type SupabaseConfig = Pick<typeof appConfig, 'supabaseUrl' | 'supabaseAnonKey' | 'districtId'>;

export interface SupabaseBackendOptions {
  /** Where the auth session is kept. Defaults to localStorage in browsers, memory elsewhere. */
  storage?: SupportedStorage;
}

const PHOTO_BUCKET = 'photos';
const EVENTS_PAGE = 1000;
// The device's anonymous session, set aside while staff are signed in on it.
const RESIDENT_SESSION_KEY = 'problem-pins-resident-refresh';
const CONNECT_ERROR = 'Couldn’t connect this device. Reload the page and try again.';

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// A resident account code that was asked for: which email, and whether it is a returning account.
const RESIDENT_CODE_KEY = 'problem-pins-resident-code';
const CODE_LIFETIME = 60 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WRONG_CODE = 'That code doesn’t match, or it has expired. Check it or ask for a new one.';
const STAFF_HERE = 'This phone is signed in to the staff app. Sign out there first.';

interface PendingCode {
  email: string;
  returning: boolean;
  at: number;
}

/** Supabase Auth errors from the account flow, as messages a resident can act on. */
function codeError(error: { code?: string; status?: number; message?: string }): Error {
  if (error.status === 429 || /rate_limit/.test(error.code ?? '')) {
    return new Error('Too many codes asked for. Wait a minute and try again.');
  }
  if (error.code === 'otp_expired') return new Error(WRONG_CODE);
  if (error.code === 'email_address_invalid' || error.code === 'validation_failed') {
    return new Error('Enter an email address like name@example.com.');
  }
  // Someone else saved problems with this email between the code and now.
  if (error.code === 'email_exists') return new Error('That email was just used on another phone. Ask for a new code.');
  return toError(error);
}

export function createSupabaseBackend(config: SupabaseConfig, options: SupabaseBackendOptions = {}): Backend {
  const districtId = config.districtId;
  if (!districtId) {
    throw new Error('This deployment has no district set. Add VITE_DISTRICT_ID to the environment.');
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: options.storage },
  });

  const keep = options.storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
  const remember = async (key: string, value: string | null) => {
    try {
      if (value === null) await keep?.removeItem(key);
      else await keep?.setItem(key, value);
    } catch {
      /* storage unavailable: the device gets a new identity next time */
    }
  };
  const recall = async (key: string) => {
    try {
      return (await keep?.getItem(key)) ?? null;
    } catch {
      return null;
    }
  };

  // ---- sessions ----

  let sessionReady: Promise<Session> | null = null;

  /** Every device needs a session to write. Residents get an anonymous one on first use. */
  function ensureSession(): Promise<Session> {
    sessionReady ??= (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) return data.session;
      const signedIn = await supabase.auth.signInAnonymously();
      if (signedIn.error || !signedIn.data.session) throw signedIn.error ?? new Error('No session');
      return signedIn.data.session;
    })().catch((error) => {
      sessionReady = null;
      throw error;
    });
    return sessionReady;
  }

  async function requireSession() {
    try {
      return await ensureSession();
    } catch (error) {
      console.error('Problem Pins sign-in failed', error);
      throw new Error(CONNECT_ERROR);
    }
  }

  // The session can end without us: an account deleted on another phone fails to refresh. The
  // next write then signs the device in anonymously again instead of failing with no session.
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') sessionReady = null;
  });

  /** Switches the client to a session we already hold (an anonymous device or a resident account). */
  async function resume(refreshToken: string | null) {
    sessionReady = null;
    if (refreshToken) {
      const { error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      if (!error) return;
    }
    await ensureSession().catch(() => {});
  }

  /** After staff sign out, go back to this device's resident identity (or a new one). */
  async function restoreResident() {
    const refreshToken = await recall(RESIDENT_SESSION_KEY);
    await remember(RESIDENT_SESSION_KEY, null);
    await resume(refreshToken);
  }

  async function currentSession() {
    const { data } = await supabase.auth.getSession();
    return data.session;
  }

  /** The resident account signed in here, if any. Anonymous devices skip the call. */
  async function residentAccount(session: Session | null): Promise<ResidentAccount | undefined> {
    if (!session || session.user.is_anonymous) return undefined;
    const { data, error } = await supabase.rpc('resident_account');
    if (error) throw toError(error);
    return (data as ResidentAccount | null) ?? undefined;
  }

  async function staffFor(session: Session | null): Promise<StaffUser | null> {
    const user = session?.user;
    if (!user || user.is_anonymous) return null;
    const { data, error } = await supabase
      .from('staff')
      .select('name, role')
      .eq('user_id', user.id)
      .eq('district_id', districtId)
      .maybeSingle();
    if (error || !data) return null;
    return { id: user.id, name: data.name, email: user.email ?? '', role: data.role, districtId };
  }

  async function call<T = void>(fn: string, args: Record<string, unknown>): Promise<T> {
    await requireSession();
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw toError(error);
    return data as T;
  }

  const onIssue = (fn: string) => (issueId: string) => call(fn, { p_issue: issueId });

  // The database stores photo names (`<uuid>.jpg`); the app passes public URLs around.
  const photos = supabase.storage.from(PHOTO_BUCKET);
  const photoUrl = (name: string) => photos.getPublicUrl(name).data.publicUrl;
  const photoName = (url: string) => url.slice(url.lastIndexOf('/') + 1);

  /** The database's cursor, the day it was read and who read it (all three must match for get_changes). */
  const cursorFor = (row: SnapshotRow, session: Session | null) => `${row.cursor ?? ''}|${row.today ?? ''}|${session?.user.id ?? ''}`;

  // The client hands back a channel that is still leaving if the same topic is joined again,
  // so a new subscription waits until the previous one has left.
  let leaving: Promise<unknown> = Promise.resolve();

  return {
    mode: 'live',

    async load(): Promise<Snapshot> {
      // A device with a session reads as itself. A new device reads while it signs in: until it has
      // done something it sees what anyone sees, so the read doesn't wait for the sign-in. Reading
      // also works without a session (e.g. if anonymous sign-in is rate limited).
      const existing = await currentSession().catch(() => null);
      const session = existing
        ? Promise.resolve(existing)
        : ensureSession().catch((error) => {
            console.warn('Problem Pins: reading without a session', error);
            return null;
          });
      const [{ data, error }, account, signedIn] = await Promise.all([
        supabase.rpc('get_snapshot', { p_district: districtId }),
        residentAccount(existing),
        session,
      ]);
      if (error) throw toError(error);
      const row = data as SnapshotRow;
      const snapshot = mapSnapshot(row, photoUrl, cursorFor(row, signedIn));
      if (account) snapshot.me.account = account;
      return snapshot;
    },

    async loadChanges(cursor: string) {
      const [since, today, viewer] = cursor.split('|');
      if (!since) return null;
      // What a viewer may see depends on who it is: after a sign-in or sign-out, a whole snapshot.
      const session = await currentSession().catch(() => null);
      if ((session?.user.id ?? '') !== viewer) return null;
      const [{ data, error }, account] = await Promise.all([
        supabase.rpc('get_changes', { p_district: districtId, p_since: since }),
        residentAccount(session),
      ]);
      if (error) throw toError(error);
      const row = data as ChangesRow;
      // Staff rights changed, or "this week" counts moved on with the date on issues nobody touched.
      if (row.reload || row.today !== today) return null;
      const changes = mapChanges(row, photoUrl, cursorFor(row, session));
      if (account) changes.me.account = account;
      return changes;
    },

    subscribe(onChange) {
      let subscribedBefore = false;
      let closed = false;
      let channel: ReturnType<typeof supabase.channel> | null = null;
      // The pings are on a private channel that only signed-in devices may join, so join once
      // this device has its session. Without one (sign-in rate limited) there are no live updates.
      void ensureSession()
        .then(() => leaving)
        .then(() => {
          if (closed) return;
          channel = supabase
            .channel(`district:${districtId}`, { config: { private: true } })
            .on('broadcast', { event: 'change' }, () => onChange())
            .subscribe((status) => {
              if (status !== 'SUBSCRIBED') return;
              // Reconnected after a drop (phone asleep, network change): catch up on what we missed.
              if (subscribedBefore) onChange();
              subscribedBefore = true;
            });
        })
        .catch((error) => console.warn('Problem Pins: no live updates without a session', error));
      return () => {
        closed = true;
        if (channel) leaving = supabase.removeChannel(channel).catch(() => {});
      };
    },

    // ---- residents ----

    async createIssue(draft: NewIssueDraft) {
      return call<string>('create_issue', {
        p_district: districtId,
        p_title: draft.title,
        p_category: draft.category,
        p_lat: draft.lat,
        p_lng: draft.lng,
        p_location_label: draft.locationLabel,
        p_via: draft.via,
        p_description: draft.description,
        p_location_detail: draft.locationDetail ?? null,
        p_photos: draft.photos.map(photoName),
        p_scan_code: draft.scanCode ?? null,
      });
    },

    async uploadPhoto(photo: Blob) {
      await requireSession();
      const type = photo.type || 'image/jpeg';
      // A random name, not a folder per device: public URLs mustn't link one device's photos.
      const name = `${crypto.randomUUID()}.${EXTENSIONS[type] ?? 'jpg'}`;
      const { error } = await photos.upload(name, photo, { contentType: type, cacheControl: '31536000', upsert: false });
      if (error) throw toUploadError(error);
      return photoUrl(name);
    },

    vote: onIssue('vote'),
    unvote: onIssue('unvote'),

    async follow(issueId: string, contact?: FollowContact) {
      await call('follow', { p_issue: issueId, p_email: contact?.email || null, p_phone: contact?.phone || null });
    },

    unfollow: onIssue('unfollow'),

    async comment(issueId: string, text: string, replyTo?: string) {
      // Without a reply, the same call as before the note_replies migration.
      await call('comment', { p_issue: issueId, p_text: text, ...(replyTo ? { p_reply_to: replyTo } : {}) });
    },

    async deleteNote(issueId: string, noteId: string) {
      await call('delete_note', { p_issue: issueId, p_note: noteId });
    },

    removeIssue: onIssue('remove_issue'),

    async reportIssue(issueId: string, reason: ReportReason) {
      await call('report_issue', { p_issue: issueId, p_reason: reason });
    },

    async confirmFix(issueId: string, answer: 'yes' | 'no') {
      await call('confirm_fix', { p_issue: issueId, p_answer: answer });
    },

    // ---- staff (the database checks the caller is staff of the issue's district) ----

    async postUpdate(issueId: string, text: string, status?: Status) {
      await call('post_update', { p_issue: issueId, p_text: text, p_status: status ?? null });
    },

    async replyToNote(issueId: string, noteId: string, text: string) {
      await call('reply_to_note', { p_issue: issueId, p_note: noteId, p_text: text });
    },

    async hideNote(issueId: string, noteId: string) {
      await call('hide_note', { p_issue: issueId, p_note: noteId });
    },

    async unhideNote(issueId: string, noteId: string) {
      await call('unhide_note', { p_issue: issueId, p_note: noteId });
    },

    async setStatus(issueId: string, status: Status) {
      await call('set_status', { p_issue: issueId, p_status: status });
    },

    async assign(issueId: string, owner: string | null) {
      await call('assign', { p_issue: issueId, p_owner: owner });
    },

    async sendToCity(issueId: string, request?: CityRequestInput) {
      if (!request?.sr?.trim()) throw new Error('Enter the 311 service request number.');
      await call('send_to_city', {
        p_issue: issueId,
        p_sr: request.sr,
        p_agency: request.agency || null,
        p_routed_to: request.routedTo || null,
      });
    },

    nudgeCity: onIssue('nudge_city'),

    async hideIssue(issueId: string, reason: string) {
      await call('hide_issue', { p_issue: issueId, p_reason: reason });
    },

    unhideIssue: onIssue('unhide_issue'),
    dismissReports: onIssue('dismiss_reports'),

    async mergeIssue(duplicateId: string, intoId: string) {
      await call('merge_issue', { p_duplicate: duplicateId, p_into: intoId });
    },

    async saveScanPoint(point: ScanPoint) {
      await call('save_scan_point', {
        p_district: districtId,
        p_code: point.code,
        p_name: point.name,
        p_lat: point.lat,
        p_lng: point.lng,
        p_detail: point.detail,
        p_issue_id: point.issueId ?? null,
      });
    },

    async deleteScanPoint(code: string) {
      await call('delete_scan_point', { p_district: districtId, p_code: code });
    },

    async listEvents(since?: string) {
      const events: AnalyticsEvent[] = [];
      let after = 0;
      for (;;) {
        const page = await call<EventRow[]>('list_events', { p_district: districtId, p_since: since ?? null, p_after_id: after });
        events.push(...page.map(mapEvent));
        if (page.length < EVENTS_PAGE) return events;
        after = page[page.length - 1].id;
      }
    },

    // ---- resident accounts (optional; docs/BACKEND.md, "Resident accounts") ----

    async requestResidentCode(email: string) {
      const address = email.trim().toLowerCase();
      if (!EMAIL.test(address)) throw new Error('Enter an email address like name@example.com.');
      await requireSession();
      const session = (await currentSession())!;
      if (!session.user.is_anonymous) {
        if (await staffFor(session)) throw new Error(STAFF_HERE);
        throw new Error(`You’re already signed in as ${session.user.email}.`);
      }
      // A new email becomes this device's own account (same user id, so every record stays).
      // Auth refuses an email that already has an account: then it is a returning sign-in.
      let returning = false;
      const upgrade = await supabase.auth.updateUser({ email: address });
      if (upgrade.error) {
        if (upgrade.error.code !== 'email_exists') throw codeError(upgrade.error);
        const otp = await supabase.auth.signInWithOtp({ email: address, options: { shouldCreateUser: false } });
        if (otp.error) throw codeError(otp.error);
        returning = true;
      }
      const pending: PendingCode = { email: address, returning, at: Date.now() };
      await remember(RESIDENT_CODE_KEY, JSON.stringify(pending));
      return {};
    },

    async verifyResidentCode(email: string, code: string) {
      const address = email.trim().toLowerCase();
      const token = code.replace(/\s/g, '');
      if (!/^\d{6}$/.test(token)) throw new Error('Enter the 6-digit code from the email.');
      let pending: PendingCode | null = null;
      try {
        pending = JSON.parse((await recall(RESIDENT_CODE_KEY)) ?? 'null') as PendingCode | null;
      } catch {
        /* unreadable: ask again */
      }
      if (!pending || pending.email !== address || Date.now() - pending.at > CODE_LIFETIME) {
        throw new Error('Ask for a new code first.');
      }
      await requireSession();
      const device = (await currentSession())!;
      if (!device.user.is_anonymous) throw new Error(`You’re already signed in as ${device.user.email}.`);

      if (!pending.returning) {
        const { data, error } = await supabase.auth.verifyOtp({ email: address, token, type: 'email_change' });
        if (error || !data.session) throw codeError(error ?? {});
        sessionReady = Promise.resolve(data.session);
        await remember(RESIDENT_CODE_KEY, null);
        return { returning: false };
      }

      // Returning: this device proves it holds its anonymous session (a one-time claim) before the
      // client switches to the account, which then takes the device's records (counted once).
      const claim = await call<string>('device_claim', {});
      const { data, error } = await supabase.auth.verifyOtp({ email: address, token, type: 'email' });
      if (error || !data.session) throw codeError(error ?? {});
      sessionReady = Promise.resolve(data.session);
      await remember(RESIDENT_CODE_KEY, null);
      const merged = await supabase.rpc('merge_device', { p_claim: claim });
      if (merged.error) {
        // Back to this device as it was (a staff email ends up here too); nothing was moved.
        await supabase.auth.signOut({ scope: 'local' });
        await resume(device.refresh_token);
        throw toError(merged.error);
      }
      return { returning: true };
    },

    async signOutResident() {
      const session = await currentSession();
      if (!session || session.user.is_anonymous) return;
      if (await staffFor(session)) throw new Error(STAFF_HERE);
      // Only this phone: the account stays signed in elsewhere. This phone starts over as a new device.
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw toError(error);
      await resume(null);
    },

    async deleteResidentAccount() {
      const session = await currentSession();
      if (!session || session.user.is_anonymous) return;
      if (await staffFor(session)) throw new Error(STAFF_HERE);
      // A fresh anonymous identity for this phone, signed in beside the account. The account's
      // records move to it, so they stay on this phone without an email.
      const fresh = createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'problem-pins-handover' },
      });
      const signedIn = await fresh.auth.signInAnonymously();
      if (signedIn.error || !signedIn.data.session) throw new Error(CONNECT_ERROR);
      const claim = await fresh.rpc('device_claim');
      if (claim.error) throw toError(claim.error);
      const deleted = await supabase.rpc('delete_resident_account', { p_claim: claim.data });
      if (deleted.error) throw toError(deleted.error);
      // The account's sessions are gone everywhere; this phone carries on as the fresh device.
      const { access_token, refresh_token } = signedIn.data.session;
      sessionReady = null;
      const switched = await supabase.auth.setSession({ access_token, refresh_token });
      if (switched.error) await resume(refresh_token);
    },

    // ---- staff sign-in ----

    async getStaff() {
      try {
        const { data } = await supabase.auth.getSession();
        return await staffFor(data.session);
      } catch {
        return null;
      }
    },

    async signIn(email: string, password: string) {
      const address = email.trim();
      if (!address) throw new Error('Enter your email.');
      if (!password) throw new Error('Enter your password.');

      // Keep the resident identity (anonymous, or a resident account) aside, not another staff session.
      const before = await currentSession();
      const residentToken = before && (before.user.is_anonymous || !(await staffFor(before))) ? before.refresh_token : null;

      const { data, error } = await supabase.auth.signInWithPassword({ email: address, password });
      if (error) {
        if (error.code === 'invalid_credentials') throw new Error('Wrong email or password.');
        if (error.status === 429) throw new Error('Too many attempts. Wait a few minutes and try again.');
        throw toError(error);
      }
      if (residentToken) await remember(RESIDENT_SESSION_KEY, residentToken);
      sessionReady = Promise.resolve(data.session);

      if (!(await staffFor(data.session))) {
        await supabase.auth.signOut({ scope: 'local' });
        await restoreResident();
        throw new Error('This account isn’t set up as staff for this district.');
      }
    },

    async signOut() {
      await supabase.auth.signOut({ scope: 'local' });
      await restoreResident();
    },

    onAuthChange(callback: (staff: StaffUser | null) => void) {
      let lastUserId: string | null | undefined;
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        const userId = session?.user.id ?? null;
        const first = lastUserId === undefined;
        if (userId === lastUserId) return;
        lastUserId = userId;
        if (first && event === 'INITIAL_SESSION') return; // the store already asked getStaff()
        // Supabase calls this while holding its auth lock; query after it is released.
        setTimeout(() => {
          void staffFor(session).then(callback, () => callback(null));
        }, 0);
      });
      return () => data.subscription.unsubscribe();
    },

    // ---- analytics: fire and forget ----

    track(event: Omit<AnalyticsEvent, 'at'>) {
      void ensureSession()
        .then(() =>
          supabase.from('events').insert({
            district_id: districtId,
            name: event.name,
            issue_id: event.issueId ?? null,
            scan_code: event.scanCode ?? null,
            props: event.props ?? null,
          }),
        )
        .catch(() => {
          /* analytics never breaks the app */
        });
    },
  };
}
