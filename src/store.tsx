import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createBackend, type Backend, type NewIssueDraft, type Snapshot } from './backend';
import { applyChanges, optimisticFollow, optimisticVote, type Optimistic } from './backend/changes';
import type { DataMode } from './config';
import type {
  AnalyticsEvent,
  CityRequestInput,
  District,
  FollowContact,
  Issue,
  ReportReason,
  ResidentAccount,
  ScanPoint,
  StaffUser,
  Status,
} from './data/types';

/**
 * The one place screens get data and actions from. It holds the latest backend snapshot and
 * asks the backend what changed after every mutation (and when the backend pings a change),
 * keeping the objects of issues that didn't change so screens re-render only what did. It
 * turns errors into toasts. Actions resolve to `true` on success and never throw.
 */
interface Store {
  mode: DataMode;
  district: District;
  /** Public issues: not hidden, not merged. What residents see. */
  issues: Issue[];
  /** Staff only: hidden or merged issues. */
  hiddenIssues: Issue[];
  scanPoints: ScanPoint[];
  voted: string[];
  following: string[];
  confirmed: Record<string, 'yes' | 'no'>;
  /** Issues this device reported. */
  reported: string[];
  /** The resident account signed in on this device, if any (optional; `residentAccounts` in config). */
  account: ResidentAccount | null;
  staff: StaffUser | null;
  lastCreatedId: string | null;
  clearLastCreated: () => void;
  /** Finds any issue this viewer can see, including merged ones (for redirects). */
  getIssue: (id: string) => Issue | undefined;
  refresh: () => Promise<void>;

  // residents (undoing something is not an analytics event)
  vote: (id: string, source?: string) => Promise<boolean>;
  unvote: (id: string) => Promise<boolean>;
  follow: (id: string, contact?: FollowContact) => Promise<boolean>;
  unfollow: (id: string) => Promise<boolean>;
  /** Uploads the photos, creates the issue and resolves to its new ID (null on failure). */
  addIssue: (draft: Omit<NewIssueDraft, 'photos'>, photos?: Blob[]) => Promise<string | null>;
  /** With `replyTo`, a reply under a neighbor's note. */
  addComment: (id: string, text: string, replyTo?: string) => Promise<boolean>;
  deleteNote: (id: string, noteId: string) => Promise<boolean>;
  confirmFix: (id: string, answer: 'yes' | 'no') => Promise<boolean>;
  removeIssue: (id: string) => Promise<boolean>;
  reportIssue: (id: string, reason: ReportReason) => Promise<boolean>;

  // resident accounts: sign-in screens show these errors in place, so they return them
  requestResidentCode: (email: string) => Promise<{ error: string } | { demoCode?: string }>;
  verifyResidentCode: (email: string, code: string, source?: string) => Promise<{ error: string } | { returning: boolean }>;
  signOutResident: () => Promise<boolean>;
  deleteResidentAccount: () => Promise<boolean>;

  // staff
  postUpdate: (id: string, text: string, status?: Status) => Promise<boolean>;
  replyToNote: (id: string, noteId: string, text: string) => Promise<boolean>;
  hideNote: (id: string, noteId: string) => Promise<boolean>;
  unhideNote: (id: string, noteId: string) => Promise<boolean>;
  setStatus: (id: string, status: Status) => Promise<boolean>;
  assign: (id: string, owner: string | null) => Promise<boolean>;
  sendToCity: (id: string, request?: CityRequestInput) => Promise<boolean>;
  nudgeCity: (id: string) => Promise<boolean>;
  hideIssue: (id: string, reason: string) => Promise<boolean>;
  unhideIssue: (id: string) => Promise<boolean>;
  dismissReports: (id: string) => Promise<boolean>;
  mergeIssue: (duplicateId: string, intoId: string) => Promise<boolean>;
  saveScanPoint: (point: ScanPoint) => Promise<boolean>;
  deleteScanPoint: (code: string) => Promise<boolean>;
  listEvents: (since?: string) => Promise<AnalyticsEvent[]>;
  /** Resolves to null once signed in, or to a message the sign-in page can show. */
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<boolean>;

  track: (event: Omit<AnalyticsEvent, 'at'>) => void;
  /** Demo only. */
  reset: () => Promise<boolean>;
  toast: (message: string) => void;
  toastMessage: string | null;
}

const StoreContext = createContext<Store | null>(null);

function message(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Something went wrong. Please try again.';
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [snapshot, setSnapshotState] = useState<Snapshot | null>(null);
  // The snapshot as of the last change, for merging what `loadChanges` returns into it.
  const latest = useRef<Snapshot | null>(null);
  const setSnapshot = useCallback((next: Snapshot | null) => {
    latest.current = next;
    setSnapshotState(next);
  }, []);
  // Optimistic changes whose mutation hasn't been answered yet, applied again to every snapshot
  // that arrives meanwhile (`Optimistic` in src/backend/changes.ts).
  const pending = useRef(new Map<number, Optimistic>());
  const pendingSeq = useRef(0);
  const fromServer = useCallback(
    (next: Snapshot) => setSnapshot([...pending.current.values()].reduce((s, fn) => fn(s), next)),
    [setSnapshot],
  );
  const [staff, setStaff] = useState<StaffUser | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastCreatedId, setLastCreatedId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const loadSeq = useRef(0);
  const refreshTimer = useRef<number | undefined>(undefined);

  const toast = useCallback((text: string) => {
    setToastMessage(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMessage(null), 2800);
  }, []);

  /**
   * Brings the snapshot up to date: only what changed, unless `full` or the backend says only a
   * whole snapshot will do (the viewer or the day changed). Out-of-order responses are ignored.
   */
  const reload = useCallback(
    async (b: Backend, full = false) => {
      const seq = ++loadSeq.current;
      const cursor = full ? null : latest.current?.cursor;
      // If asking for changes fails, a whole snapshot may still work (and fails the same way if not).
      const changes = cursor ? await b.loadChanges(cursor).catch(() => null) : null;
      if (changes) {
        if (seq === loadSeq.current && latest.current) fromServer(applyChanges(latest.current, changes));
        return;
      }
      const next = await b.load();
      if (seq === loadSeq.current) fromServer(next);
    },
    [fromServer],
  );

  // Start: pick the backend, load data and the staff session, listen for changes.
  useEffect(() => {
    let cancelled = false;
    let cleanups: (() => void)[] = [];
    (async () => {
      try {
        const b = await createBackend();
        if (cancelled) return;
        const [, signedIn] = await Promise.all([reload(b), b.getStaff()]);
        if (cancelled) return;
        setStaff(signedIn);
        setBackend(b);
        // Catch up at most once per second however many pings arrive: a burst of changes (or a
        // flood) costs one small read of what changed per second per open app.
        const soon = () => {
          if (refreshTimer.current !== undefined) return;
          refreshTimer.current = window.setTimeout(() => {
            refreshTimer.current = undefined;
            void reload(b).catch(() => {});
          }, 1000);
        };
        // Back in front (a phone that slept, a staff tab left open overnight): catch up, which
        // also notices a new day ("this week" counts change without any record changing).
        const onVisible = () => {
          if (document.visibilityState === 'visible') soon();
        };
        document.addEventListener('visibilitychange', onVisible);
        cleanups = [
          b.subscribe(soon),
          () => document.removeEventListener('visibilitychange', onVisible),
          b.onAuthChange((s) => {
            setStaff(s);
            void reload(b, true).catch(() => {});
          }),
        ];
      } catch (error) {
        if (!cancelled) setLoadError(message(error));
      }
    })();
    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = undefined;
    };
  }, [reload]);

  // Derived once per snapshot, not on every toast: screens memoize on these arrays.
  const issues = snapshot?.issues;
  const lists = useMemo(() => {
    const all = issues ?? [];
    return {
      visible: all.filter((i) => !i.hidden && !i.mergedInto),
      hidden: all.filter((i) => i.hidden || i.mergedInto),
      byId: new Map(all.map((i) => [i.id, i])),
    };
  }, [issues]);

  const store = useMemo<Store | null>(() => {
    if (!backend || !snapshot) return null;
    const b = backend;

    /**
     * Runs a mutation, reloads what changed, and reports failure as a toast. `optimistic` is shown
     * at once and kept until the mutation is answered. A failed one reloads everything: an
     * optimistic change to an issue the server didn't change wouldn't be sent back.
     */
    const run = async (fn: () => Promise<unknown>, event?: Omit<AnalyticsEvent, 'at'>, optimistic?: Optimistic) => {
      const key = ++pendingSeq.current;
      if (optimistic && latest.current) {
        pending.current.set(key, optimistic);
        setSnapshot(optimistic(latest.current));
      }
      try {
        await fn();
      } catch (error) {
        pending.current.delete(key);
        toast(message(error));
        await reload(b, true).catch(() => {});
        return false;
      }
      // Saved. If reading it back fails (offline for a moment), the next ping or action catches up.
      if (event) b.track(event);
      await reload(b)
        .catch(() => {})
        .finally(() => pending.current.delete(key));
      return true;
    };

    return {
      mode: b.mode,
      district: snapshot.district,
      issues: lists.visible,
      hiddenIssues: lists.hidden,
      scanPoints: snapshot.scanPoints,
      voted: snapshot.me.voted,
      following: snapshot.me.following,
      confirmed: snapshot.me.confirmed,
      reported: snapshot.me.reported,
      account: snapshot.me.account ?? null,
      staff,
      lastCreatedId,
      toastMessage,
      toast,
      clearLastCreated: () => setLastCreatedId(null),
      getIssue: (id) => lists.byId.get(id),
      refresh: () => reload(b),

      vote: (id, source) => {
        if (snapshot.me.voted.includes(id)) return Promise.resolve(true);
        return run(() => b.vote(id), { name: 'vote', issueId: id, props: source ? { source } : undefined }, optimisticVote(id, true));
      },

      unvote: (id) => {
        if (!snapshot.me.voted.includes(id)) return Promise.resolve(true);
        return run(() => b.unvote(id), undefined, optimisticVote(id, false));
      },

      follow: (id, contact) =>
        run(
          () => b.follow(id, contact),
          { name: 'follow', issueId: id, props: { contact: contact?.email ? 'email' : contact?.phone ? 'phone' : 'none' } },
          optimisticFollow(id, true),
        ),

      unfollow: (id) => run(() => b.unfollow(id), undefined, optimisticFollow(id, false)),

      addIssue: async (draft, photos = []) => {
        try {
          const urls = await Promise.all(photos.map((p) => b.uploadPhoto(p)));
          const id = await b.createIssue({ ...draft, photos: urls });
          b.track({ name: 'pin_submit', issueId: id, scanCode: draft.scanCode, props: { category: draft.category, photos: photos.length } });
          setLastCreatedId(id);
          await reload(b);
          return id;
        } catch (error) {
          toast(message(error));
          return null;
        }
      },

      addComment: (id, text, replyTo) =>
        run(() => b.comment(id, text, replyTo), { name: 'comment', issueId: id, props: replyTo ? { reply: true } : undefined }),
      deleteNote: (id, noteId) => run(() => b.deleteNote(id, noteId)),
      confirmFix: (id, answer) => run(() => b.confirmFix(id, answer), { name: 'confirm_fix', issueId: id, props: { answer } }),
      removeIssue: (id) => run(() => b.removeIssue(id)),
      reportIssue: (id, reason) => run(() => b.reportIssue(id, reason), { name: 'report', issueId: id, props: { reason } }),

      requestResidentCode: async (email) => {
        try {
          return await b.requestResidentCode(email);
        } catch (error) {
          return { error: message(error) };
        }
      },
      verifyResidentCode: async (email, code, source) => {
        try {
          const result = await b.verifyResidentCode(email, code);
          b.track({ name: 'account_signin', props: { returning: result.returning, ...(source ? { source } : {}) } });
          await reload(b);
          return result;
        } catch (error) {
          return { error: message(error) };
        }
      },
      signOutResident: () => run(() => b.signOutResident()),
      deleteResidentAccount: () => run(() => b.deleteResidentAccount()),

      postUpdate: (id, text, status) =>
        run(() => b.postUpdate(id, text, status), { name: 'staff_update', issueId: id, props: status ? { status } : undefined }),
      replyToNote: (id, noteId, text) =>
        run(() => b.replyToNote(id, noteId, text), { name: 'staff_update', issueId: id, props: { reply: true } }),
      hideNote: (id, noteId) => run(() => b.hideNote(id, noteId), { name: 'staff_hide', issueId: id, props: { note: true } }),
      unhideNote: (id, noteId) => run(() => b.unhideNote(id, noteId)),
      setStatus: (id, status) => run(() => b.setStatus(id, status), { name: 'staff_status', issueId: id, props: { status } }),
      assign: (id, owner) => run(() => b.assign(id, owner), { name: 'staff_assign', issueId: id, props: { assigned: Boolean(owner) } }),
      sendToCity: (id, request) => run(() => b.sendToCity(id, request), { name: 'staff_send_to_city', issueId: id }),
      nudgeCity: (id) => run(() => b.nudgeCity(id), { name: 'staff_nudge', issueId: id }),
      hideIssue: (id, reason) => run(() => b.hideIssue(id, reason), { name: 'staff_hide', issueId: id }),
      unhideIssue: (id) => run(() => b.unhideIssue(id)),
      dismissReports: (id) => run(() => b.dismissReports(id)),
      mergeIssue: (duplicateId, intoId) =>
        run(() => b.mergeIssue(duplicateId, intoId), { name: 'staff_merge', issueId: intoId, props: { duplicate: duplicateId } }),
      saveScanPoint: (point) => run(() => b.saveScanPoint(point)),
      deleteScanPoint: (code) => run(() => b.deleteScanPoint(code)),
      listEvents: async (since) => {
        try {
          return await b.listEvents(since);
        } catch (error) {
          toast(message(error));
          return [];
        }
      },
      signIn: async (email, password) => {
        try {
          await b.signIn(email, password);
          await reload(b);
          return null;
        } catch (error) {
          await reload(b).catch(() => {});
          return message(error);
        }
      },
      signOut: () => run(() => b.signOut()),

      track: (event) => b.track(event),
      reset: () =>
        run(async () => {
          await b.reset?.();
          setLastCreatedId(null);
        }),
    };
  }, [backend, snapshot, lists, staff, lastCreatedId, toastMessage, toast, reload, setSnapshot]);

  if (loadError) return <StartupScreen error={loadError} />;
  if (!store) return <StartupScreen />;
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

function StartupScreen({ error }: { error?: string }) {
  return (
    <div className="grid h-full place-items-center bg-slate-100 p-6 text-center">
      {error ? (
        <div className="max-w-sm">
          <p className="font-semibold">Problem Pins couldn’t load.</p>
          <p className="mt-1 text-sm text-slate-600">{error}</p>
          <button onClick={() => window.location.reload()} className="mt-4 font-semibold text-brand">
            Try again
          </button>
        </div>
      ) : (
        <p className="text-sm text-slate-500" role="status">
          Loading…
        </p>
      )}
    </div>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
