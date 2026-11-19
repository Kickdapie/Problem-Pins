import type { DataMode } from '../config';
import type {
  AnalyticsEvent,
  Category,
  CityRequestInput,
  District,
  FollowContact,
  Issue,
  MyState,
  ReportReason,
  ScanPoint,
  StaffUser,
  Status,
} from '../data/types';

/**
 * The contract between the UI (via `src/store.tsx`) and a data backend.
 *
 * Two implementations: `demo.ts` (sample data in localStorage, frozen date) and
 * `supabase/` (shared Postgres, real dates). The UI never talks to a backend directly;
 * it goes through the store, which loads a snapshot once and then asks for what changed
 * (`loadChanges`) after every mutation and change ping.
 *
 * Rules every implementation follows:
 * - Mutations resolve when the change is saved and reject with an `Error` whose message
 *   is safe to show to the user. The store catches and toasts it.
 * - Counts (`votes`, `votesThisWeek`, `following`, ...) are derived from records, never set.
 * - The backend, not the browser, generates issue IDs (`PP-2461`) and timestamps.
 * - Staff methods fail unless a staff user is signed in (live mode).
 * - Staff-only data (reports, staff names on history, updates and City requests, staff-only
 *   history lines) is only in a staff snapshot. Every staff action records who did it.
 */
export interface Backend {
  readonly mode: DataMode;

  /** Everything the app shows. Called on start and when the viewer changes (sign-in, sign-out). */
  load(): Promise<Snapshot>;
  /**
   * What changed since `cursor` (from `load` or an earlier `loadChanges`), for the same viewer.
   * Called after every mutation and on change pings. Resolves to null when only a whole snapshot
   * will do (the viewer, their staff rights or the day changed; an unknown cursor): the store then
   * calls `load`.
   * May return an issue that didn't change; never leaves out one that did.
   */
  loadChanges(cursor: string): Promise<SnapshotChanges | null>;
  /** Calls `onChange` when data changed elsewhere (another device, staff). Returns unsubscribe. */
  subscribe(onChange: () => void): () => void;

  // ---- Residents (no account; one identity per device) ----
  /** Creates the issue with one vote and one follow from this device. Resolves to the new ID. */
  createIssue(draft: NewIssueDraft): Promise<string>;
  /** Stores an already-resized photo (EXIF stripped by the canvas). Resolves to a URL for `<img src>`. */
  uploadPhoto(photo: Blob): Promise<string>;
  /** Idempotent: one vote per device per issue. */
  vote(issueId: string): Promise<void>;
  /** Takes back this device's +1. Refused on the device's own pin, whose +1 stays. */
  unvote(issueId: string): Promise<void>;
  follow(issueId: string, contact?: FollowContact): Promise<void>;
  /** Stops following and forgets any contact this device left for the issue. */
  unfollow(issueId: string): Promise<void>;
  /** A note, or with `replyTo` a reply under a neighbor's note (one level: a reply's own id answers its note). */
  comment(issueId: string, text: string, replyTo?: string): Promise<void>;
  /** Deletes a note this device wrote (`mine`), and the replies under it. */
  deleteNote(issueId: string, noteId: string): Promise<void>;
  confirmFix(issueId: string, answer: 'yes' | 'no'): Promise<void>;
  /**
   * The device that pinned an issue takes it off the map, while the office hasn't acted on it and
   * no other device has +1’d it (`removalBlocker` in src/lib/ownPin.ts). Not deleted: it is hidden
   * with the reason `REMOVED_BY_PINNER`, so staff still find it under Hidden and can restore it.
   */
  removeIssue(issueId: string): Promise<void>;
  /** One report per device per issue; a second one is ignored. Only staff see reports. */
  reportIssue(issueId: string, reason: ReportReason): Promise<void>;

  // ---- Resident accounts (optional; `residentAccounts` in config, docs/BACKEND.md) ----
  /**
   * Emails a 6-digit code that signs this device in to `email` (a new account, or one made on
   * another phone). The demo sends no email and resolves to the code, so the screen can show it.
   * Refused while staff are signed in on the device or an account already is.
   */
  requestResidentCode(email: string): Promise<{ demoCode?: string }>;
  /**
   * Signs this device in. A new account keeps what the device has done (same identity); a returning
   * one brings back its records and takes in the device's own, counting one person once.
   */
  verifyResidentCode(email: string, code: string): Promise<{ returning: boolean }>;
  /** Takes the account's records off this device, which starts over as a new one. Signing in again brings them back. */
  signOutResident(): Promise<void>;
  /**
   * Forgets the email and signs the account out everywhere. Its records stay on the map and on this
   * device, which keeps them without an email.
   */
  deleteResidentAccount(): Promise<void>;

  // ---- Staff ----
  postUpdate(issueId: string, text: string, status?: Status): Promise<void>;
  /** The district answers a neighbor's note, under it. Not an update: the status card keeps the last one. */
  replyToNote(issueId: string, noteId: string, text: string): Promise<void>;
  /** Hides a neighbor's note or reply from neighbors (`hidden`), or shows it again. */
  hideNote(issueId: string, noteId: string): Promise<void>;
  unhideNote(issueId: string, noteId: string): Promise<void>;
  setStatus(issueId: string, status: Status): Promise<void>;
  assign(issueId: string, owner: string | null): Promise<void>;
  /** Records a 311 request staff filed. `request` is required in live mode (the real SR number). */
  sendToCity(issueId: string, request?: CityRequestInput): Promise<void>;
  nudgeCity(issueId: string): Promise<void>;
  /** Also settles the issue's open reports: hiding is one answer to them. */
  hideIssue(issueId: string, reason: string): Promise<void>;
  unhideIssue(issueId: string): Promise<void>;
  /** Keeps the pin up and settles its open reports, which takes it off the to-do list. */
  dismissReports(issueId: string): Promise<void>;
  /** Moves votes and follows from the duplicate onto `intoId` and hides the duplicate. */
  mergeIssue(duplicateId: string, intoId: string): Promise<void>;
  /** Creates or updates by `code`. */
  saveScanPoint(point: ScanPoint): Promise<void>;
  deleteScanPoint(code: string): Promise<void>;
  /** Analytics events since a `YYYY-MM-DD` date (inclusive), oldest first. Staff only. */
  listEvents(since?: string): Promise<AnalyticsEvent[]>;

  // ---- Staff sign-in ----
  getStaff(): Promise<StaffUser | null>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  onAuthChange(callback: (staff: StaffUser | null) => void): () => void;

  // ---- Analytics: fire and forget, never throws ----
  track(event: Omit<AnalyticsEvent, 'at'>): void;

  /** Demo only: restore the sample data. */
  reset?(): Promise<void>;
}

export interface Snapshot {
  district: District;
  /** Everything this viewer may see. For staff this includes hidden and merged issues. */
  issues: Issue[];
  scanPoints: ScanPoint[];
  me: MyState;
  /** Opaque; pass it to `loadChanges`. */
  cursor: string;
}

/** The answer to `loadChanges`: the small parts in full, and only the issues that changed. */
export interface SnapshotChanges {
  district: District;
  /** Issues added or changed since the cursor, in full, as `load` would return them. */
  issues: Issue[];
  /** Issues this viewer could see before and no longer can (e.g. hidden by staff). */
  removed: string[];
  scanPoints: ScanPoint[];
  me: MyState;
  cursor: string;
}

export interface NewIssueDraft {
  title: string;
  description: string;
  category: Category;
  lat: number;
  lng: number;
  locationLabel: string;
  locationDetail?: string;
  /** URLs returned by `uploadPhoto`. */
  photos: string[];
  /** Human-readable source, e.g. "QR · Community noticeboard, W 16th St Q-12" or "the map". */
  via: string;
  /** Set when the pin started from a QR scan. */
  scanCode?: string;
}
