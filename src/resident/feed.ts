import type { Issue } from '../data/types';
import { today } from '../lib/format';
import { residentHistory } from './shared';

export interface FeedItem {
  key: string;
  issueId: string;
  date: string;
  title: string;
  body: string;
  /** One line under the problem's name on the You page: who said what, or what happened. */
  summary: string;
  kind: 'district' | 'fixed' | 'city' | 'resident' | 'event';
}

/** Someone answered a note this phone wrote. */
export function hasReplyToMe(issue: Issue) {
  const mine = new Set(issue.updates.filter((u) => u.mine && !u.replyTo).map((u) => u.id));
  return issue.updates.some((u) => !u.mine && !u.hidden && u.replyTo && mine.has(u.replyTo));
}

/**
 * The problems on the You page: what this phone pinned, +1’d or follows, and where someone
 * answered its note, so the answer reaches it.
 */
export function followedIssues(issues: Issue[], voted: string[], following: string[]) {
  const ids = new Set([...voted, ...following]);
  return issues.filter((i) => ids.has(i.id) || i.isUserReport || hasReplyToMe(i));
}

/** What happened to those problems, newest first: district updates, neighbors' notes, status changes. */
export function buildFeed(followed: Issue[], districtName: string): FeedItem[] {
  const feed = followed.flatMap((issue) => [
    ...issue.updates
      // Not what this phone wrote, and not what the district office hid.
      .filter((u) => !u.mine && !u.hidden)
      .map<FeedItem>((u) => {
        const toMe = Boolean(u.replyTo && issue.updates.some((n) => n.id === u.replyTo && n.mine));
        const title = toMe
          ? `${u.author} replied to your note`
          : u.replyTo
            ? `${u.author} replied to a note`
            : u.role === 'partner'
              ? `${u.author} posted an update`
              : `${u.author} added a note`;
        return {
          key: u.id,
          issueId: issue.id,
          date: u.date,
          title,
          body: u.text,
          summary: toMe ? `${title}: ${u.text}` : `${u.author}: ${u.text}`,
          kind: u.role === 'partner' ? 'district' : 'resident',
        };
      }),
    ...residentHistory(issue.history)
      .filter((h) => !h.text.startsWith('Pinned'))
      .map<FeedItem>((h, idx) => {
        const fixed = h.text.startsWith('Marked fixed');
        const title = fixed ? `Marked fixed by ${districtName}` : h.text.split(' · ')[0];
        return {
          key: `${issue.id}-h${idx}`,
          issueId: issue.id,
          date: h.date,
          // The log names the problem's owner, which can be a City agency. The district office marks it here.
          title,
          body: issue.title,
          summary: title,
          kind: fixed ? 'fixed' : /City|311/.test(h.text) ? 'city' : 'event',
        };
      }),
  ]);
  // Newest first. The log has days, not times: on one day, what was added later comes first.
  return feed
    .map((item, at) => ({ item, at }))
    .sort((a, b) => b.item.date.localeCompare(a.item.date) || b.at - a.at)
    .map(({ item }) => item);
}

// What the resident has seen on the You page: the day of the last visit, and which items dated that
// day were already there. An item is new when it is dated that day or later and wasn't seen, so a
// problem +1’d today doesn't bring its old history in as news, and an update later the same day
// still counts (the log has days, not times; the demo's day never changes).
const SEEN_KEY = 'problem-pins-you-seen';

export interface Seen {
  day: string;
  keys: Set<string>;
}

function store(feed: FeedItem[]): Seen {
  const day = today();
  const keys = feed.filter((f) => f.date >= day).map((f) => f.key);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ day, keys }));
  } catch {
    /* private mode: nothing is ever new */
  }
  return { day, keys: new Set(keys) };
}

/** The last visit. The first time, everything already in the feed counts as seen. */
export function lastSeen(feed: FeedItem[]): Seen {
  try {
    const saved = JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null') as { day: string; keys: string[] } | null;
    if (saved?.day) return { day: saved.day, keys: new Set(saved.keys) };
  } catch {
    /* unreadable: start over */
  }
  return store(feed);
}

export function isNew(item: FeedItem, seen: Seen) {
  return item.date >= seen.day && !seen.keys.has(item.key);
}

/** The resident has the You page open: everything in the feed is seen. */
export function markSeen(feed: FeedItem[]) {
  store(feed);
}
