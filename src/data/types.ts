// Domain model shared by every screen and both backends (demo + Supabase).
// Dates are calendar dates in New York time, formatted `YYYY-MM-DD`; timestamps are ISO strings.
// See docs/ARCHITECTURE.md before changing anything here: other modules depend on it.

export type Category = 'lighting' | 'seating' | 'accessibility' | 'litter' | 'noise' | 'other';

export type Status = 'open' | 'in_review' | 'scheduled' | 'sent_to_city' | 'fixed';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface IssueUpdate {
  id: string;
  /** Display name: the district for partner updates, "Neighbor"/"You" for residents. */
  author: string;
  role: 'partner' | 'resident';
  text: string;
  date: string;
  /** True when this device/browser wrote it. */
  mine?: boolean;
  /** The staff member who posted a district update. Only staff receive it; residents see the district. */
  staffName?: string;
  /**
   * A reply: the id of the neighbor's note it answers. One level only, so a reply to a reply
   * answers the same note. A district reply is not a district update: it isn't the latest word on
   * the status card, only an answer under the note.
   */
  replyTo?: string;
  /**
   * Hidden by the district office (a neighbor's note or reply). Neighbors don't see it; its text
   * reaches only staff and the device that wrote it. Staff can show it again.
   */
  hidden?: boolean;
  /** The staff member who hid it. Only staff receive it. */
  hiddenBy?: string;
}

export interface HistoryEvent {
  date: string;
  text: string;
  /** The staff member who did it. Only staff receive it; residents see the district. */
  staffName?: string;
  /** A line only staff see (dismissing reports). Residents never receive these. */
  staffOnly?: boolean;
}

/** Why a resident reported a pin. Labels in `REPORT_REASONS` (src/data/meta.ts). */
export type ReportReason = 'spam' | 'offensive' | 'personal_info' | 'not_public_space' | 'other';

/** Residents' reports on a pin that staff haven't handled yet. Only staff receive this; reports are never public. */
export interface IssueReports {
  /** Devices that reported it. */
  count: number;
  /** The day the oldest of these reports came in. */
  since: string;
  /** Most reported first. */
  reasons: { reason: ReportReason; count: number }[];
}

export interface CityRequest {
  sr: string;
  agency: string;
  routedTo: string;
  sentOn: string;
  /** The staff member who filed it. Only staff see it; residents see updates signed by the district. */
  sentBy?: string;
  lastFollowUp?: string;
}

/** What staff type in when they forward a problem to the City (the SR number comes from 311). */
export interface CityRequestInput {
  sr: string;
  agency: string;
  routedTo?: string;
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  category: Category;
  status: Status;
  lat: number;
  lng: number;
  locationLabel: string;
  locationDetail?: string;
  /** Counts are derived from vote/follow records by the backend, never written directly. */
  votes: number;
  votesThisWeek: number;
  createdAt: string;
  owner: string | null;
  /** City agency that owns the asset, when the District can't fix it directly. */
  agency?: string;
  photos: string[];
  cityRequest?: CityRequest;
  updates: IssueUpdate[];
  history: HistoryEvent[];
  via: string;
  following: number;
  duplicatesMerged: number;
  confirmedFixed: number;
  /** Neighbors who said it still isn't fixed since it was last marked fixed. */
  notFixed: number;
  fixedOn?: string;
  isUserReport?: boolean;
  /** Staff removed it from the public map. Only staff ever receive hidden issues. */
  hidden?: boolean;
  hiddenReason?: string;
  /** Staff merged it into another issue as a duplicate. */
  mergedInto?: string;
  /** Open reports from residents. Staff only; absent when there are none. */
  reports?: IssueReports;
}

/**
 * When the dashboard's to-do list flags an issue (see `src/org/dashboard.ts`). New pins and
 * residents waiting for a reply are always on it; votes never decide whether an issue is.
 */
export interface AttentionRules {
  /** Sent to the City with no follow-up logged for this many days. */
  cityNoReplyDays: number;
  /** Residents haven't had an update from the district for this many days. */
  quietDays: number;
}

/** Minimal GeoJSON geometry for a district boundary, coordinates in [lng, lat] order. */
export type DistrictBoundary =
  | { type: 'Polygon'; coordinates: [number, number][][] }
  | { type: 'MultiPolygon'; coordinates: [number, number][][][] };

/** The organization a deployment serves: a BID, a community district office, a park conservancy... */
export interface District {
  id: string;
  /** Who residents are talking to, e.g. "West Side District" or "Manhattan Community Board 8". */
  name: string;
  /** The neighborhood people recognise, e.g. "West Chelsea". */
  area: string;
  center: LatLng;
  zoom: number;
  /** Pins outside the boundary are refused. No boundary = no limit. */
  boundary?: DistrictBoundary;
  /** Which of the fixed categories this district takes, in display order. */
  categories: Category[];
  /** Who an issue can be assigned to, e.g. "District office staff". */
  teams: string[];
  rules: AttentionRules;
  /** Shown to residents as the human contact for the program. */
  contactEmail?: string;
}

/** A printed QR code at a fixed spot (a noticeboard, a library entrance, a shop window). */
export interface ScanPoint {
  /** Printed on the poster and in the short link, e.g. "Q-12". Never reuse a code. */
  code: string;
  name: string;
  detail: string;
  lat: number;
  lng: number;
  /** A problem already reported at this spot, shown first on the landing page. */
  issueId?: string;
}

/** Signed-in organization staff. */
export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: string;
  districtId: string;
}

/** What this device/browser has done (or the resident account signed in on it). */
export interface MyState {
  voted: string[];
  following: string[];
  confirmed: Record<string, 'yes' | 'no'>;
  /** Issues this device reported (one report per device per issue). */
  reported: string[];
  /**
   * Set while a resident account is signed in on this device (optional). The email is the
   * resident's own and is never shown to neighbors or to the district office.
   */
  account?: ResidentAccount;
}

export interface ResidentAccount {
  email: string;
  /** `YYYY-MM-DD` the account was created. */
  since: string;
}

/** Optional contact a resident leaves to get updates. Never shown publicly. */
export interface FollowContact {
  email?: string;
  phone?: string;
}

export type AnalyticsEventName =
  | 'map_view'
  | 'scan_view'
  | 'issue_view'
  | 'pin_start'
  | 'pin_submit'
  | 'vote'
  | 'follow'
  | 'comment'
  | 'confirm_fix'
  | 'share'
  | 'report'
  | 'account_signin'
  | 'staff_update'
  | 'staff_status'
  | 'staff_assign'
  | 'staff_send_to_city'
  | 'staff_nudge'
  | 'staff_hide'
  | 'staff_merge';

/** Product analytics for the experiments. No personal data in here, ever. */
export interface AnalyticsEvent {
  name: AnalyticsEventName;
  issueId?: string;
  scanCode?: string;
  props?: Record<string, string | number | boolean | null>;
  /** ISO timestamp, set by the backend when the event is recorded. */
  at: string;
}
