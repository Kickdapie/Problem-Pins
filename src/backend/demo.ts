import { DEMO_DISTRICT, DEMO_SCAN_POINTS } from '../data/demoDistrict';
import { DEMO_EVENTS } from '../data/demoEvents';
import { REMOVED_BY_PINNER, STATUSES } from '../data/meta';
import { SAMPLE_ISSUES } from '../data/sampleData';
import type {
  AnalyticsEvent,
  CityRequestInput,
  FollowContact,
  HistoryEvent,
  Issue,
  IssueReports,
  IssueUpdate,
  MyState,
  ReportReason,
  ResidentAccount,
  ScanPoint,
  StaffUser,
  Status,
} from '../data/types';
import { DEMO_TODAY, plural } from '../lib/format';
import { removalBlocker } from '../lib/ownPin';
import type { Backend, NewIssueDraft, Snapshot, SnapshotChanges } from './types';

/**
 * Sample-data backend for presentations and UI work. Everything lives in this browser's
 * localStorage, the date is frozen at DEMO_TODAY, and every visitor is both a resident
 * and (once "signed in") West Side District staff. Two tabs stay in sync via `storage` events.
 */

// v7: notes can have replies (`replyTo`), and the sample has one from the district. Older saves
// start over from the sample. (v6: sample notes are signed "Neighbor", as in live mode. v5: residents can report pins
// (`reports`, `me.reported`). v4: the sample became a district office, no BID crew or BID noticeboard.
// v3: issues gained `notFixed`.)
export const DEMO_STORAGE_KEY = 'problem-pins-demo-v7';
const MAX_EVENTS = 2000;
/** How many earlier snapshots `loadChanges` can answer from; older cursors get a whole snapshot. */
const KEPT_CURSORS = 8;

export const DEMO_STAFF: StaffUser = {
  id: 'demo-staff',
  name: 'Maya Ruiz',
  email: 'maya@westside.example',
  role: 'Community Coordinator',
  districtId: DEMO_DISTRICT.id,
};

/** A resident's report on a pin. The demo has one device, so every report is this device's. */
interface DemoReport {
  issueId: string;
  reason: ReportReason;
  date: string;
  /** Staff hid the pin or dismissed the reports. */
  handled: boolean;
}

/**
 * What a signed-out resident account keeps until it signs in again: the device's records, plus the
 * pins and notes it wrote (on a live backend these are rows owned by the account's user id).
 */
interface SavedAccount extends ResidentAccount {
  me: Omit<MyState, 'account'>;
  pinned: string[];
  notes: string[];
}

interface DemoState {
  issues: Issue[];
  scanPoints: ScanPoint[];
  me: MyState;
  /** Contacts left with "Notify me", keyed by issue ID. Never returned by `load`. */
  contacts: Record<string, FollowContact[]>;
  /** Only staff see them, summed up per issue in `load`. */
  reports: DemoReport[];
  nextId: number;
  events: AnalyticsEvent[];
  staffSignedIn: boolean;
  /** Resident accounts that are signed out, by email. The signed-in one is `me.account`. */
  accounts: Record<string, SavedAccount>;
  /** The last sign-in code asked for. The demo shows it instead of emailing it. */
  pendingCode: { email: string; code: string } | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Same text as the live backend's. */
const WRONG_CODE = 'That code doesn’t match, or it has expired. Check it or ask for a new one.';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function initialState(): DemoState {
  return {
    issues: structuredClone(SAMPLE_ISSUES),
    scanPoints: structuredClone(DEMO_SCAN_POINTS),
    me: emptyMe(),
    contacts: {},
    reports: [],
    nextId: 2461,
    events: structuredClone(DEMO_EVENTS),
    staffSignedIn: true,
    accounts: {},
    pendingCode: null,
  };
}

/** The neighbor's note a reply goes under: the note itself, or the note a reply answers. */
function noteRoot(issue: Issue, id: string) {
  const target = issue.updates.find((u) => u.id === id);
  const root = target?.replyTo ?? (target?.role === 'resident' ? target.id : undefined);
  if (!root) throw new Error('That note was deleted.');
  if (issue.updates.find((u) => u.id === root)?.hidden) throw new Error('The district office hid that note, so it can’t take replies.');
  return root;
}

function emptyMe(): MyState {
  return { voted: [], following: [], confirmed: {}, reported: [] };
}

/** What a resident's snapshot leaves out, as `get_snapshot` does for anyone who isn't staff. */
function stripStaffOnly(issue: Issue) {
  delete issue.reports;
  if (issue.cityRequest) delete issue.cityRequest.sentBy;
  issue.history = issue.history.filter((h) => !h.staffOnly);
  for (const h of issue.history) delete h.staffName;
  for (const u of issue.updates) {
    delete u.staffName;
    delete u.hiddenBy;
    // A hidden note's words reach only the device that wrote it (and staff).
    if (u.hidden && !u.mine) u.text = '';
  }
}

async function blobToDataUrl(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
}

export class DemoBackend implements Backend {
  readonly mode = 'demo' as const;
  private state: DemoState;
  private authListeners = new Set<(staff: StaffUser | null) => void>();
  private readonly storage: KeyValueStorage | null;
  /** What each recent cursor's snapshot held: issue ID → the issue as JSON. */
  private sent = new Map<string, Map<string, string>>();
  private cursorSeq = 0;

  constructor(storage: KeyValueStorage | null = typeof localStorage === 'undefined' ? null : localStorage) {
    this.storage = storage;
    this.state = this.read();
  }

  // ---- persistence ----

  private read(): DemoState {
    try {
      const raw = this.storage?.getItem(DEMO_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<DemoState>;
        if (Array.isArray(saved.issues)) return { ...initialState(), ...saved };
      }
    } catch {
      /* corrupted: fall back to the sample data */
    }
    return initialState();
  }

  private save() {
    try {
      this.storage?.setItem(DEMO_STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* storage full (large photos): keep working in memory */
    }
  }

  private mutate(fn: (s: DemoState) => void) {
    fn(this.state);
    this.save();
  }

  private issue(id: string) {
    const issue = this.state.issues.find((i) => i.id === id);
    if (!issue) throw new Error(`Problem ${id} doesn’t exist.`);
    return issue;
  }

  private requireStaff() {
    if (!this.state.staffSignedIn) throw new Error('Sign in as staff to do that.');
    return DEMO_STAFF;
  }

  private log(issue: Issue, text: string) {
    const event: HistoryEvent = { date: DEMO_TODAY, text };
    issue.history.push(event);
  }

  /** A history line for a staff action, with the staff member's name (staff only, like `sentBy`). */
  private staffLog(issue: Issue, text: string, staffOnly = false) {
    issue.history.push({ date: DEMO_TODAY, text, staffName: DEMO_STAFF.name, ...(staffOnly ? { staffOnly } : {}) });
  }

  private partnerUpdate(text: string): IssueUpdate {
    return { id: crypto.randomUUID(), author: DEMO_DISTRICT.name, role: 'partner', text, date: DEMO_TODAY, staffName: DEMO_STAFF.name };
  }

  /** Marks the issue's open reports handled; resolves to how many there were. */
  private settleReports(issueId: string) {
    const open = this.state.reports.filter((r) => r.issueId === issueId && !r.handled);
    open.forEach((r) => (r.handled = true));
    return open.length;
  }

  /** Open reports on one issue, as staff receive them. */
  private reportSummary(issueId: string): IssueReports | undefined {
    const open = this.state.reports.filter((r) => r.issueId === issueId && !r.handled);
    if (!open.length) return undefined;
    const counts = new Map<ReportReason, number>();
    for (const r of open) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
    return {
      count: open.length,
      since: open.reduce((min, r) => (r.date < min ? r.date : min), open[0].date),
      reasons: [...counts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    };
  }

  /** "Not fixed" answers only count for the latest time it was marked fixed, as in the database. */
  private changeStatus(issue: Issue, status: Status) {
    issue.status = status;
    issue.notFixed = 0;
    if (status === 'fixed') issue.fixedOn = DEMO_TODAY;
  }

  // ---- reads ----

  async load(): Promise<Snapshot> {
    const { issues, scanPoints, me } = this.view();
    return { district: structuredClone(DEMO_DISTRICT), issues, scanPoints, me, cursor: this.remember(issues) };
  }

  /** Compares what this viewer sees now with what the cursor's snapshot held. */
  async loadChanges(cursor: string): Promise<SnapshotChanges | null> {
    const before = this.sent.get(cursor);
    if (!before) return null;
    const { issues, scanPoints, me } = this.view();
    const changed = issues.filter((i) => before.get(i.id) !== JSON.stringify(i));
    const now = new Set(issues.map((i) => i.id));
    const removed = [...before.keys()].filter((id) => !now.has(id));
    return { district: structuredClone(DEMO_DISTRICT), issues: changed, removed, scanPoints, me, cursor: this.remember(issues) };
  }

  /** Everything this viewer may see, as copies the caller can keep. */
  private view() {
    const { issues, scanPoints, me, staffSignedIn } = this.state;
    const visible = structuredClone(staffSignedIn ? issues : issues.filter((i) => !i.hidden));
    for (const issue of visible) {
      if (staffSignedIn) {
        const reports = this.reportSummary(issue.id);
        if (reports) issue.reports = reports;
      } else {
        stripStaffOnly(issue);
      }
    }
    return { issues: visible, scanPoints: structuredClone(scanPoints), me: structuredClone(me) };
  }

  private remember(issues: Issue[]) {
    const cursor = String(++this.cursorSeq);
    this.sent.set(cursor, new Map(issues.map((i) => [i.id, JSON.stringify(i)])));
    for (const old of this.sent.keys()) if (this.sent.size > KEPT_CURSORS) this.sent.delete(old);
    return cursor;
  }

  subscribe(onChange: () => void) {
    if (typeof window === 'undefined') return () => {};
    const onStorage = (e: StorageEvent) => {
      if (e.key !== DEMO_STORAGE_KEY) return;
      this.state = this.read();
      onChange();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }

  // ---- residents ----

  async createIssue(draft: NewIssueDraft) {
    const id = `PP-${this.state.nextId}`;
    const { scanCode: _scanCode, ...fields } = draft;
    const issue: Issue = {
      ...fields,
      id,
      status: 'open',
      votes: 1,
      votesThisWeek: 1,
      createdAt: DEMO_TODAY,
      owner: null,
      updates: [],
      history: [{ date: DEMO_TODAY, text: `Pinned via ${draft.via}` }],
      following: 1,
      duplicatesMerged: 0,
      confirmedFixed: 0,
      notFixed: 0,
      isUserReport: true,
    };
    this.mutate((s) => {
      s.issues.unshift(issue);
      s.me.voted.push(id);
      s.me.following.push(id);
      s.nextId += 1;
    });
    return id;
  }

  async uploadPhoto(photo: Blob) {
    return blobToDataUrl(photo);
  }

  async vote(issueId: string) {
    const issue = this.issue(issueId);
    if (this.state.me.voted.includes(issueId)) return;
    this.mutate((s) => {
      s.me.voted.push(issueId);
      issue.votes += 1;
      issue.votesThisWeek += 1;
    });
  }

  async unvote(issueId: string) {
    const issue = this.issue(issueId);
    if (issue.isUserReport) throw new Error('You pinned this, so your +1 stays.');
    if (!this.state.me.voted.includes(issueId)) return;
    this.mutate((s) => {
      s.me.voted = s.me.voted.filter((id) => id !== issueId);
      issue.votes = Math.max(0, issue.votes - 1);
      // The demo date is frozen, so this device's +1 was always this week.
      issue.votesThisWeek = Math.max(0, issue.votesThisWeek - 1);
    });
  }

  async follow(issueId: string, contact?: FollowContact) {
    const issue = this.issue(issueId);
    this.mutate((s) => {
      if (contact && (contact.email || contact.phone)) (s.contacts[issueId] ??= []).push(contact);
      if (s.me.following.includes(issueId)) return;
      s.me.following.push(issueId);
      issue.following += 1;
    });
  }

  async unfollow(issueId: string) {
    const issue = this.issue(issueId);
    this.mutate((s) => {
      delete s.contacts[issueId];
      if (!s.me.following.includes(issueId)) return;
      s.me.following = s.me.following.filter((id) => id !== issueId);
      issue.following = Math.max(0, issue.following - 1);
    });
  }

  async comment(issueId: string, text: string, replyTo?: string) {
    const issue = this.issue(issueId);
    const root = replyTo ? noteRoot(issue, replyTo) : undefined;
    this.mutate(() => {
      issue.updates.push({
        id: crypto.randomUUID(),
        author: 'You',
        role: 'resident',
        text,
        date: DEMO_TODAY,
        mine: true,
        ...(root ? { replyTo: root } : {}),
      });
    });
  }

  async deleteNote(issueId: string, noteId: string) {
    const issue = this.issue(issueId);
    if (!issue.updates.some((u) => u.id === noteId && u.role === 'resident' && u.mine)) {
      throw new Error('Only the phone that wrote a note can delete it.');
    }
    this.mutate(() => {
      // Its replies go with it, as in the database (on delete cascade).
      issue.updates = issue.updates.filter((u) => u.id !== noteId && u.replyTo !== noteId);
    });
  }

  async removeIssue(issueId: string) {
    const issue = this.issue(issueId);
    if (issue.hidden) throw new Error(`Problem ${issueId} doesn’t exist.`);
    if (!issue.isUserReport) throw new Error('Only the phone that pinned this can remove it.');
    const blocker = removalBlocker(issue);
    if (blocker === 'office') throw new Error(`${DEMO_DISTRICT.name} has picked this up, so it stays on the map. You can still add a note.`);
    if (blocker === 'neighbors') throw new Error('Neighbors have +1’d this, so it stays on the map. You can still add a note.');
    this.mutate(() => {
      issue.hidden = true;
      issue.hiddenReason = REMOVED_BY_PINNER;
      this.log(issue, REMOVED_BY_PINNER);
    });
  }

  async reportIssue(issueId: string, reason: ReportReason) {
    const issue = this.issue(issueId);
    if (issue.hidden) throw new Error(`Problem ${issueId} doesn’t exist.`);
    if (this.state.me.reported.includes(issueId)) return;
    this.mutate((s) => {
      s.me.reported.push(issueId);
      s.reports.push({ issueId, reason, date: DEMO_TODAY, handled: false });
    });
  }

  async confirmFix(issueId: string, answer: 'yes' | 'no') {
    const issue = this.issue(issueId);
    if (issue.status !== 'fixed') throw new Error('This hasn’t been marked fixed yet.');
    if (this.state.me.confirmed[issueId]) return;
    this.mutate((s) => {
      s.me.confirmed[issueId] = answer;
      if (answer === 'yes') {
        issue.confirmedFixed += 1;
        this.log(issue, 'A neighbor confirmed the fix');
      } else {
        issue.notFixed += 1;
        this.log(issue, 'A neighbor says it is still not fixed');
      }
    });
  }

  // ---- resident accounts ----

  async requestResidentCode(email: string) {
    const address = email.trim().toLowerCase();
    if (!EMAIL.test(address)) throw new Error('Enter an email address like name@example.com.');
    if (this.state.me.account) throw new Error(`You’re already signed in as ${this.state.me.account.email}.`);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    this.mutate((s) => {
      s.pendingCode = { email: address, code };
    });
    return { demoCode: code };
  }

  async verifyResidentCode(email: string, code: string) {
    const address = email.trim().toLowerCase();
    const pending = this.state.pendingCode;
    if (!pending || pending.email !== address) throw new Error('Ask for a new code first.');
    if (code.replace(/\s/g, '') !== pending.code) throw new Error(WRONG_CODE);
    const saved = this.state.accounts[address];
    this.mutate((s) => {
      s.pendingCode = null;
      if (saved) {
        this.bringBack(saved);
        delete s.accounts[address];
      }
      s.me.account = { email: address, since: saved?.since ?? DEMO_TODAY };
    });
    return { returning: Boolean(saved) };
  }

  /**
   * Adds a returning account's records to this device's. Where both +1’d, followed, answered or
   * reported the same problem, it is one person, so the device's duplicate is taken back.
   */
  private bringBack(saved: SavedAccount) {
    const { me, issues } = this.state;
    const find = (id: string) => issues.find((i) => i.id === id);
    for (const id of saved.me.voted) {
      const issue = find(id);
      if (!me.voted.includes(id)) me.voted.push(id);
      else if (issue) {
        issue.votes = Math.max(0, issue.votes - 1);
        issue.votesThisWeek = Math.max(0, issue.votesThisWeek - 1);
      }
    }
    for (const id of saved.me.following) {
      const issue = find(id);
      if (!me.following.includes(id)) me.following.push(id);
      else if (issue) issue.following = Math.max(0, issue.following - 1);
    }
    for (const [id, answer] of Object.entries(saved.me.confirmed)) {
      const mine = me.confirmed[id];
      const issue = find(id);
      if (mine && issue) {
        if (mine === 'yes') issue.confirmedFixed = Math.max(0, issue.confirmedFixed - 1);
        else issue.notFixed = Math.max(0, issue.notFixed - 1);
      }
      me.confirmed[id] = answer;
    }
    for (const id of saved.me.reported) {
      if (!me.reported.includes(id)) {
        me.reported.push(id);
        continue;
      }
      // Two open reports from one person: keep the account's (the earlier one).
      const dupes = this.state.reports.filter((r) => r.issueId === id && !r.handled);
      if (dupes.length > 1) this.state.reports.splice(this.state.reports.lastIndexOf(dupes[dupes.length - 1]), 1);
    }
    for (const id of saved.pinned) {
      const issue = find(id);
      if (issue) issue.isUserReport = true;
    }
    const notes = new Set(saved.notes);
    for (const issue of issues) for (const u of issue.updates) if (notes.has(u.id)) u.mine = true;
  }

  async signOutResident() {
    const account = this.state.me.account;
    if (!account) return;
    this.mutate((s) => {
      const pinned = s.issues.filter((i) => i.isUserReport).map((i) => i.id);
      const notes: string[] = [];
      for (const issue of s.issues) {
        delete issue.isUserReport;
        for (const u of issue.updates) {
          if (u.mine) notes.push(u.id);
          delete u.mine;
        }
      }
      const { account: _account, ...records } = s.me;
      s.accounts[account.email] = { ...account, me: records, pinned, notes };
      s.me = emptyMe();
    });
  }

  async deleteResidentAccount() {
    if (!this.state.me.account) return;
    this.mutate((s) => {
      delete s.me.account;
    });
  }

  // ---- staff ----

  async postUpdate(issueId: string, text: string, status?: Status) {
    this.requireStaff();
    const issue = this.issue(issueId);
    this.mutate(() => {
      if (status && status !== issue.status) {
        this.changeStatus(issue, status);
        this.staffLog(issue, `Status changed to ${STATUSES[status].label}`);
      }
      issue.updates.push(this.partnerUpdate(text));
    });
  }

  async replyToNote(issueId: string, noteId: string, text: string) {
    this.requireStaff();
    const issue = this.issue(issueId);
    const root = noteRoot(issue, noteId);
    this.mutate(() => {
      issue.updates.push({ ...this.partnerUpdate(text), replyTo: root });
    });
  }

  async hideNote(issueId: string, noteId: string) {
    this.requireStaff();
    const note = this.neighborNote(issueId, noteId);
    this.mutate(() => {
      note.hidden = true;
      note.hiddenBy = DEMO_STAFF.name;
    });
  }

  async unhideNote(issueId: string, noteId: string) {
    this.requireStaff();
    const note = this.neighborNote(issueId, noteId);
    this.mutate(() => {
      delete note.hidden;
      delete note.hiddenBy;
    });
  }

  /** A neighbor's note or reply, the only posts staff can hide. */
  private neighborNote(issueId: string, noteId: string) {
    const note = this.issue(issueId).updates.find((u) => u.id === noteId && u.role === 'resident');
    if (!note) throw new Error('That note was deleted.');
    return note;
  }

  async setStatus(issueId: string, status: Status) {
    this.requireStaff();
    const issue = this.issue(issueId);
    if (status === issue.status) return; // same as the database: no change, nothing logged
    this.mutate(() => {
      this.changeStatus(issue, status);
      this.staffLog(
        issue,
        status === 'fixed' ? `Marked fixed by ${issue.owner ?? DEMO_DISTRICT.name}` : `Status changed to ${STATUSES[status].label}`,
      );
    });
  }

  async assign(issueId: string, owner: string | null) {
    this.requireStaff();
    const issue = this.issue(issueId);
    this.mutate(() => {
      issue.owner = owner;
      if (issue.status === 'open' && owner) issue.status = 'in_review';
      this.staffLog(issue, owner ? `Assigned to ${owner}` : 'Unassigned');
    });
  }

  async sendToCity(issueId: string, request?: CityRequestInput) {
    const staff = this.requireStaff();
    const issue = this.issue(issueId);
    const agency = request?.agency || issue.agency || 'NYC 311';
    // Demo only: without a real SR number, make one up so the story still works.
    const sr = request?.sr || `311-${21900000 + Math.floor(Math.random() * 99999)}`;
    this.mutate(() => {
      this.changeStatus(issue, 'sent_to_city');
      issue.owner = agency;
      issue.cityRequest = { sr, agency, routedTo: request?.routedTo || agency, sentOn: DEMO_TODAY, sentBy: staff.name };
      this.staffLog(issue, `Sent to NYC 311 · SR ${sr}`);
      issue.updates.push(
        this.partnerUpdate(
          `This is ${agency}'s responsibility, so we filed it with 311 (SR ${sr}) with ${plural(issue.votes, 'neighbor')} attached. We'll keep following up.`,
        ),
      );
    });
  }

  async nudgeCity(issueId: string) {
    this.requireStaff();
    const issue = this.issue(issueId);
    if (!issue.cityRequest) throw new Error(`${issueId} hasn’t been sent to the City yet.`);
    this.mutate(() => {
      issue.cityRequest!.lastFollowUp = DEMO_TODAY;
      this.staffLog(issue, `Followed up with the City, ${plural(issue.votes, 'neighbor')} attached`);
    });
  }

  async hideIssue(issueId: string, reason: string) {
    this.requireStaff();
    const issue = this.issue(issueId);
    this.mutate(() => {
      issue.hidden = true;
      issue.hiddenReason = reason;
      this.settleReports(issueId);
      this.staffLog(issue, reason ? `Hidden by staff: ${reason}` : 'Hidden by staff');
    });
  }

  async unhideIssue(issueId: string) {
    this.requireStaff();
    const issue = this.issue(issueId);
    this.mutate(() => {
      issue.hidden = false;
      issue.hiddenReason = undefined;
      this.staffLog(issue, 'Restored by staff');
    });
  }

  async dismissReports(issueId: string) {
    this.requireStaff();
    const issue = this.issue(issueId);
    this.mutate(() => {
      const n = this.settleReports(issueId);
      if (n) this.staffLog(issue, `Kept the pin, dismissed ${plural(n, 'report')}`, true);
    });
  }

  async mergeIssue(duplicateId: string, intoId: string) {
    this.requireStaff();
    if (duplicateId === intoId) throw new Error('Pick a different problem to merge into.');
    const dup = this.issue(duplicateId);
    const into = this.issue(intoId);
    if (dup.mergedInto) throw new Error(`${duplicateId} was already merged into ${dup.mergedInto}.`);
    if (into.mergedInto) throw new Error(`${intoId} was itself merged into ${into.mergedInto}.`);
    this.mutate((s) => {
      // The demo only knows this device's own votes, so that is the only overlap it can remove.
      const bothVoted = s.me.voted.includes(dup.id) && s.me.voted.includes(into.id);
      const bothFollowed = s.me.following.includes(dup.id) && s.me.following.includes(into.id);
      into.votes += dup.votes - (bothVoted ? 1 : 0);
      into.votesThisWeek += dup.votesThisWeek;
      into.following += dup.following - (bothFollowed ? 1 : 0);
      into.duplicatesMerged += 1 + dup.duplicatesMerged;
      if (s.me.voted.includes(dup.id) && !bothVoted) s.me.voted.push(into.id);
      if (s.me.following.includes(dup.id) && !bothFollowed) s.me.following.push(into.id);
      dup.mergedInto = into.id;
      this.staffLog(into, `Merged duplicate ${dup.id} · ${plural(dup.votes, 'neighbor')}`);
      this.staffLog(dup, `Merged into ${into.id}`);
    });
  }

  async saveScanPoint(point: ScanPoint) {
    this.requireStaff();
    this.mutate((s) => {
      const idx = s.scanPoints.findIndex((p) => p.code === point.code);
      if (idx >= 0) s.scanPoints[idx] = point;
      else s.scanPoints.push(point);
    });
  }

  async deleteScanPoint(code: string) {
    this.requireStaff();
    this.mutate((s) => {
      s.scanPoints = s.scanPoints.filter((p) => p.code !== code);
    });
  }

  async listEvents(since?: string) {
    this.requireStaff();
    return structuredClone(this.state.events.filter((e) => !since || e.at.slice(0, 10) >= since));
  }

  // ---- staff sign-in (any email works in the demo) ----

  async getStaff() {
    return this.state.staffSignedIn ? DEMO_STAFF : null;
  }

  async signIn(email: string, _password: string) {
    if (!email.trim()) throw new Error('Enter your email.');
    this.mutate((s) => {
      s.staffSignedIn = true;
    });
    this.authListeners.forEach((cb) => cb(DEMO_STAFF));
  }

  async signOut() {
    this.mutate((s) => {
      s.staffSignedIn = false;
    });
    this.authListeners.forEach((cb) => cb(null));
  }

  onAuthChange(callback: (staff: StaffUser | null) => void) {
    this.authListeners.add(callback);
    return () => {
      this.authListeners.delete(callback);
    };
  }

  // ---- analytics ----

  track(event: Omit<AnalyticsEvent, 'at'>) {
    try {
      // Keep events on the frozen demo date so date filters line up with the sample data.
      const at = `${DEMO_TODAY}T${new Date().toISOString().slice(11)}`;
      this.mutate((s) => {
        s.events.push({ ...event, at });
        if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
      });
    } catch {
      /* analytics never breaks the app */
    }
  }

  async reset() {
    this.state = initialState();
    this.save();
    this.authListeners.forEach((cb) => cb(DEMO_STAFF));
  }
}
