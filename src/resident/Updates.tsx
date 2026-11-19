import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Landmark, Send, User } from 'lucide-react';
import { Logo, StatusTag } from '../components/ui';
import { config, residentAccounts } from '../config';
import { STATUSES } from '../data/meta';
import type { Issue } from '../data/types';
import { daysBetween, plural, shortDate } from '../lib/format';
import { navigate } from '../router';
import { useStore } from '../store';
import { buildFeed, followedIssues, isNew, lastSeen, markSeen } from './feed';
import { BUTTON, FixQuestion, HEADING, LINK } from './shared';

// Color only where it is a status: a fix, or a hand-off to the City.
const ICONS = {
  district: { Icon: Landmark, color: undefined },
  fixed: { Icon: Check, color: STATUSES.fixed.color },
  city: { Icon: Send, color: STATUSES.sent_to_city.color },
  resident: { Icon: User, color: undefined },
  event: { Icon: Check, color: undefined },
};

const SECTION = 'mt-7 border-t border-slate-100 pt-6';

/**
 * You (`#/updates`): the resident's own page, behind the person button on the map. What needs their
 * answer, what changed on their problems, the problems themselves, and the optional account.
 */
export default function Updates() {
  const store = useStore();
  const followed = followedIssues(store.issues, store.voted, store.following);
  const toConfirm = followed.filter((i) => i.status === 'fixed' && !store.confirmed[i.id]);
  const all = buildFeed(followed, store.district.name);
  // What was new when the page opened stays marked while it is open; what arrives meanwhile is new too.
  const [seenBefore] = useState(() => lastSeen(all));
  const keys = all.map((f) => f.key).join();
  useEffect(() => markSeen(all), [keys]); // eslint-disable-line react-hooks/exhaustive-deps
  // Each problem with its latest changes (the last 30 days, two at most) and how many are new.
  const groups = followed
    .map((issue) => {
      const mine = all.filter((f) => f.issueId === issue.id);
      return {
        issue,
        items: mine.filter((f) => daysBetween(f.date) <= 30).slice(0, 2),
        fresh: mine.filter((f) => isNew(f, seenBefore)).length,
        last: mine[0]?.date ?? '',
      };
    })
    .sort((a, b) => Number(b.fresh > 0) - Number(a.fresh > 0) || b.last.localeCompare(a.last) || a.issue.title.localeCompare(b.issue.title));
  // Why a problem is here: the strongest tie first.
  const relation = (issue: Issue) =>
    issue.isUserReport
      ? 'you pinned it'
      : store.voted.includes(issue.id)
        ? 'you +1’d it'
        : store.following.includes(issue.id)
          ? 'you follow it'
          : 'you left a note on it';
  const noteOnly = followed.some((i) => relation(i) === 'you left a note on it');
  const where = store.account ? 'saved to your account' : config.notifications ? 'sent to your phone' : 'on this phone';

  return (
    <div className="px-5 pb-10 pt-6">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => navigate('/')} aria-label="Back to map">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Logo />
      </div>

      <h1 className="text-2xl font-bold">You</h1>
      {followed.length > 0 && (
        <p className="mt-1 text-[15px] text-slate-600">
          {plural(followed.length, 'problem')} you pinned, +1’d{noteOnly ? ', follow or left a note on' : ' or follow'} · {where}
        </p>
      )}

      {toConfirm.length > 0 && (
        <section className={SECTION}>
          <h2 className={HEADING}>Is it really fixed?</h2>
          {toConfirm.map((issue) => (
            <div key={issue.id} className="mt-3 rounded-xl border border-slate-200 p-4">
              <FixQuestion issue={issue} named>
                <p className="mt-1 text-sm text-slate-600">
                  {store.district.name} marked this fixed{issue.fixedOn ? ` on ${shortDate(issue.fixedOn)}` : ''}. You{' '}
                  {relation(issue).replace(/^you /, '')}; help confirm whether it’s really done.
                </p>
              </FixQuestion>
            </div>
          ))}
        </section>
      )}

      {/* One block per problem: its name and status, then its latest one or two changes. Problems
          with something new come first, then the ones that changed most recently. */}
      {groups.length > 0 && (
        <section className={SECTION}>
          <h2 className={HEADING}>Your problems</h2>
          <ul className="mt-1">
            {groups.map(({ issue, items, fresh }) => (
              <li key={issue.id}>
                <button onClick={() => navigate(`/i/${issue.id}`)} className="block w-full border-b border-slate-100 py-4 text-left">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-balance font-semibold leading-snug">{issue.title}</span>
                    {fresh > 0 && <span className="shrink-0 text-xs font-semibold text-ink">{fresh === 1 ? 'New' : `${fresh} new`}</span>}
                  </span>
                  <span className="mt-0.5 block text-sm text-slate-600">
                    <StatusTag status={issue.status} resident /> ·{' '}
                    {relation(issue)}
                  </span>
                  {items.length > 0 && (
                    <span className="mt-2 block space-y-1.5">
                      {items.map((f) => {
                        const { Icon, color } = ICONS[f.kind];
                        const isFresh = isNew(f, seenBefore);
                        return (
                          <span key={f.key} className="flex gap-2.5 text-sm">
                            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" style={{ color }} />
                            <span className={`line-clamp-2 min-w-0 flex-1 ${isFresh ? 'text-ink' : 'text-slate-600'}`}>{f.summary}</span>
                            <span className={`shrink-0 text-xs ${isFresh ? 'font-semibold text-ink' : 'text-slate-500'}`}>
                              {isFresh ? 'New' : shortDate(f.date)}
                            </span>
                          </span>
                        );
                      })}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!followed.length && (
        <div className="mt-6">
          <p className="text-lg font-semibold">Nothing here yet</p>
          <p className="mt-1 text-[15px] leading-relaxed text-slate-600">Problems you pin, +1 or follow show up here, with their updates.</p>
          <button onClick={() => navigate('/')} className={`${BUTTON} mt-4 px-4 py-2.5`}>
            Open the map
          </button>
        </div>
      )}

      {/* The account last: the page works without one. */}
      {residentAccounts && (
        <p className="mt-10 border-t border-slate-100 pt-5 text-sm leading-relaxed text-slate-600">
          {store.account ? (
            <>
              Signed in as {store.account.email} ·{' '}
              <a href="#/account" className={LINK}>
                Account
              </a>
            </>
          ) : followed.length ? (
            <>
              <a href="#/account?next=/updates&from=updates" className={LINK}>
                Keep them with your email
              </a>
              , so a new phone or a cleared browser still has them.
            </>
          ) : (
            <>
              Saved problems with your email before?{' '}
              <a href="#/account?next=/updates&from=updates" className={LINK}>
                Sign in
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
