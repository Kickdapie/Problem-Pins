import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Check, LocateFixed, LocateOff, MapPin, Plus, Search, Share, UserRound, X } from 'lucide-react';
import IssueMap from '../components/IssueMap';
import { PhotoThumb, StatusTag } from '../components/ui';
import { config, residentAccounts } from '../config';
import { distanceMeters } from '../data/geo';
import type { Category, Issue } from '../data/types';
import { daysBetween, formatMeters, plural, shortDate } from '../lib/format';
import type { AddressResult } from '../lib/geocode';
import { useAddressSearch } from '../lib/useGeocode';
import { useLatest } from '../lib/useLatest';
import { useProgressive } from '../lib/useProgressive';
import { useUserLocation } from '../lib/userLocation';
import { navigate } from '../router';
import { useStore } from '../store';
import { buildFeed, followedIssues, isNew, lastSeen } from './feed';
import { BUTTON, CategoryLabel, Facts, LABEL, LINK, shareIssue } from './shared';

export function VoteBox({ issue, done, onVote }: { issue: Issue; done: boolean; onVote: (id: string) => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        // Already +1’d: open the problem, where the +1 can be taken back. Not here: a stray tap
        // while scrolling would undo it.
        if (done) navigate(`/i/${issue.id}`);
        else onVote(issue.id);
      }}
      aria-label={done ? 'You +1’d this. Open it to take your +1 back' : '+1 this problem'}
      className={`flex w-11 shrink-0 flex-col items-center rounded-lg border py-1.5 text-sm font-semibold transition ${
        done ? 'border-brand text-brand' : 'border-slate-200 text-ink hover:border-brand hover:text-brand'
      }`}
    >
      {/* "+1" says what a tap does; a chevron alone read as a score. */}
      {done ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <span className="text-[13px] font-bold leading-4">+1</span>}
      <span className={done ? '' : 'font-medium text-slate-600'}>{issue.votes}</span>
    </button>
  );
}

/** One open problem in the list. Memoized: a +1 elsewhere, or a toast, doesn't re-render it. */
const OpenRow = memo(function OpenRow({
  issue,
  done,
  meters,
  onVote,
}: {
  issue: Issue;
  done: boolean;
  /** How far the resident is, when known. */
  meters: number | null;
  onVote: (id: string) => void;
}) {
  return (
    <li onClick={() => navigate(`/i/${issue.id}`)} className="flex cursor-pointer items-center gap-3 border-t border-slate-100 py-3">
      <VoteBox issue={issue} done={done} onVote={onVote} />
      <div className="min-w-0 flex-1">
        <a href={`#/i/${issue.id}`} className="block text-balance font-semibold leading-snug">
          {issue.title}
        </a>
        <Facts
          className="mt-0.5 text-[13px] text-slate-500"
          parts={[
            <StatusTag status={issue.status} resident className="text-slate-600" />,
            meters !== null && meters >= 10 && `${formatMeters(meters)} away`,
            `pinned ${shortDate(issue.createdAt)}`,
          ]}
        />
      </div>
      {issue.photos.length > 0 && <PhotoThumb issue={issue} className="h-12 w-12 shrink-0 rounded-lg" />}
    </li>
  );
});

const FixedRow = memo(function FixedRow({ issue }: { issue: Issue }) {
  return (
    <li onClick={() => navigate(`/i/${issue.id}`)} className="cursor-pointer border-t border-slate-100 py-3">
      <a href={`#/i/${issue.id}`} className="block text-balance font-semibold leading-snug">
        {issue.title}
      </a>
      <p className="mt-0.5 text-[13px] text-slate-500">
        <StatusTag status="fixed" resident className="text-slate-600" /> {shortDate(issue.fixedOn!)} ·{' '}
        <span className="whitespace-nowrap">
          {issue.notFixed > 0
            ? `${plural(issue.notFixed, 'neighbor')} ${issue.notFixed === 1 ? 'says' : 'say'} it isn’t`
            : issue.confirmedFixed > 0
              ? `${plural(issue.confirmedFixed, 'neighbor')} confirmed`
              : 'not confirmed yet'}
        </span>
      </p>
    </li>
  );
});

/** `focus`: an issue ID to center and highlight, from the map picture on its detail page. */
export default function MapHome({ focus }: { focus?: string | null }) {
  const { issues, voted, following, confirmed, lastCreatedId, clearLastCreated, district, track, toast, account, vote } = useStore();
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [sort, setSort] = useState<'votes' | 'newest'>('votes');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Where the map should fly: a searched address or the resident's position. `n` re-flies on repeat taps.
  const [target, setTarget] = useState<{ lat: number; lng: number; n: number; place?: AddressResult } | null>(null);
  const [wantsLocate, setWantsLocate] = useState(false);
  const loc = useUserLocation();
  const you = loc.position;
  const addresses = useAddressSearch(searching ? query : '', district.center);

  // A "locate me" tap that had to ask first: fly once the fix arrives, explain if it doesn't.
  useEffect(() => {
    if (!wantsLocate || loc.locating) return;
    if (you) setTarget((t) => ({ lat: you.lat, lng: you.lng, n: (t?.n ?? 0) + 1 }));
    else if (loc.status === 'denied') toast('Location is blocked for this site. Allow it in your browser settings, or search an address.');
    else if (loc.status !== 'prompt') toast('Couldn’t find your location. Search an address instead.');
    else return;
    setWantsLocate(false);
  }, [wantsLocate, you, loc.locating, loc.status, toast]);

  const locate = () => {
    if (you) setTarget((t) => ({ lat: you.lat, lng: you.lng, n: (t?.n ?? 0) + 1 }));
    else {
      loc.request();
      setWantsLocate(true);
    }
  };

  const pickAddress = (place: AddressResult) => {
    setTarget((t) => ({ lat: place.lat, lng: place.lng, n: (t?.n ?? 0) + 1, place }));
    setQuery('');
    setSearching(false);
  };

  useEffect(() => {
    track({ name: 'map_view' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const active = useMemo(() => issues.filter((i) => i.status !== 'fixed'), [issues]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return active.filter(
      (i) =>
        (category === 'all' || i.category === category) &&
        (!q || `${i.title} ${i.locationLabel} ${i.id}`.toLowerCase().includes(q)),
    );
  }, [active, category, query]);

  // What got fixed lately, under the open problems: it shows that a pin leads somewhere, and each
  // one's page asks whether the fix held. Same category filter and search as the list above.
  const fixedLately = useMemo(() => {
    const q = query.trim().toLowerCase();
    return issues
      .filter(
        (i) =>
          i.status === 'fixed' &&
          Boolean(i.fixedOn) &&
          daysBetween(i.fixedOn!) <= 30 &&
          (category === 'all' || i.category === category) &&
          (!q || `${i.title} ${i.locationLabel} ${i.id}`.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.fixedOn!.localeCompare(a.fixedOn!) || b.id.localeCompare(a.id));
  }, [issues, category, query]);

  const ranked = useMemo(
    () =>
      [...visible].sort((a, b) =>
        sort === 'votes' ? b.votes - a.votes : b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      ),
    [visible, sort],
  );
  // The list mounts a page of rows at a time; the map still shows every match.
  const list = useProgressive(ranked, `${category}|${sort}|${query.trim()}`);
  const votedSet = useMemo(() => new Set(voted), [voted]);
  // `vote` is a new function after every store change; the rows only need one that calls the latest.
  const latestVote = useLatest(vote);
  const onVote = useCallback((id: string) => void latestVote.current(id, 'map'), [latestVote]);
  const created = lastCreatedId ? issues.find((i) => i.id === lastCreatedId) : undefined;
  const focused = created ?? (focus ? issues.find((i) => i.id === focus && !i.hidden) : undefined);
  // A fresh pin, or the problem the resident came from, centers the map when it opens; after that,
  // searches and "locate me" take over.
  const flyTo = target ?? (focused ? { lat: focused.lat, lng: focused.lng } : undefined);
  const showDropdown = searching && query.trim().length > 0;
  const issueMatches = showDropdown ? ranked.slice(0, 3) : [];
  // A dot on the You button: a fix to confirm, or an update since the resident last looked.
  const hasNewUpdate = useMemo(() => {
    const feed = buildFeed(followedIssues(issues, voted, following), district.name);
    const seen = lastSeen(feed);
    return feed.some((f) => isNew(f, seen));
  }, [issues, voted, following, district.name]);
  // Same set as the confirm cards on the You page: fixed problems this device +1’d or follows.
  const hasPendingConfirm = issues.some(
    (i) => i.status === 'fixed' && (voted.includes(i.id) || following.includes(i.id)) && !confirmed[i.id],
  );

  const chip = (selected: boolean) =>
    `flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium shadow-sm ${
      selected ? 'border-ink bg-ink text-white' : 'border-slate-200 bg-white text-ink'
    }`;
  const sortTab = (selected: boolean) =>
    `border-b-2 pb-0.5 text-sm ${selected ? 'border-ink font-semibold' : 'border-transparent font-medium text-slate-500 hover:text-ink'}`;

  return (
    <div className="relative h-full overflow-hidden">
      <div className="absolute inset-0">
        <IssueMap
          issues={visible}
          selectedId={focused?.id}
          center={flyTo}
          centerKey={target ? target.n : focused?.id}
          pick={target?.place ?? null}
          voteLabelsAbove={60}
          showYou
          you={you}
          onSelect={(i) => navigate(`/i/${i.id}`)}
        />
      </div>

      <div className="absolute inset-x-0 top-0 z-[1000] space-y-2.5 p-4">
        <div className="flex gap-2">
          <label className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 shadow-sm">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearching(true);
              }}
              onFocus={() => setSearching(true)}
              onBlur={() => setSearching(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSearching(false);
                if (e.key === 'Enter' && addresses.results[0] && !ranked.length) pickAddress(addresses.results[0]);
              }}
              placeholder="Search problems or an address"
              aria-label="Search problems or an address"
              className="h-11 w-full bg-transparent text-[15px] outline-none placeholder:text-slate-400"
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear search">
                <X className="h-4 w-4 text-slate-500" />
              </button>
            )}
          </label>
          <button
            onClick={() => navigate('/updates')}
            className="relative grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white shadow-sm"
            aria-label={hasPendingConfirm || hasNewUpdate ? 'You, something new' : 'You'}
          >
            <UserRound className="h-5 w-5" />
            {(hasPendingConfirm || hasNewUpdate) && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand" />}
          </button>
        </div>
        {showDropdown && (
          <div
            className="max-h-[50vh] overflow-y-auto rounded-xl border border-slate-200 bg-white text-sm shadow-lg"
            onMouseDown={(e) => e.preventDefault()} // keep focus in the input while choosing
          >
            {issueMatches.length > 0 && (
              <>
                <p className={`${LABEL} px-3 pt-2.5`}>Problems</p>
                <ul>
                  {issueMatches.map((i) => (
                    <li key={i.id}>
                      <button onClick={() => navigate(`/i/${i.id}`)} className="w-full px-3 py-2 text-left hover:bg-slate-50">
                        <span className="font-medium">{i.title}</span>
                        <span className="text-slate-500"> · {i.locationLabel}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {query.trim().length >= 3 && (
              <>
                <p className={`${LABEL} px-3 pt-2.5`}>Addresses</p>
                <ul className="pb-1">
                  {addresses.results.map((a) => (
                    <li key={a.id}>
                      <button onClick={() => pickAddress(a)} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        <span>
                          <span className="font-medium">{a.label}</span>
                          {a.detail && <span className="text-slate-500"> · {a.detail}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                  {addresses.status === 'loading' && !addresses.results.length && <li className="px-3 py-2 text-slate-500">Searching…</li>}
                  {addresses.status === 'done' && !addresses.results.length && (
                    <li className="px-3 py-2 text-slate-500">No New York City address matches.</li>
                  )}
                  {addresses.status === 'error' && <li className="px-3 py-2 text-slate-500">Address search isn’t reachable right now.</li>}
                </ul>
              </>
            )}
            {!issueMatches.length && query.trim().length < 3 && (
              <p className="px-3 py-2.5 text-slate-500">No problems match. Keep typing to search addresses.</p>
            )}
          </div>
        )}
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          <button className={chip(category === 'all')} aria-pressed={category === 'all'} onClick={() => setCategory('all')}>
            All
          </button>
          {district.categories.map((c) => (
            <button
              key={c}
              className={chip(category === c)}
              aria-pressed={category === c}
              onClick={() => setCategory(category === c ? 'all' : c)}
            >
              <CategoryLabel category={c} iconClass={`h-4 w-4 ${category === c ? 'text-white/70' : 'text-slate-500'}`} />
            </button>
          ))}
        </div>
      </div>

      <div
        className={`absolute inset-x-0 bottom-0 z-[1000] flex flex-col rounded-t-2xl border-t border-slate-200 bg-white shadow-[0_-8px_24px_rgba(0,0,0,0.08)] transition-[height] ${
          expanded ? 'h-[72%]' : 'h-[40%]'
        }`}
      >
        <button
          onClick={locate}
          className="absolute -top-16 left-4 grid h-12 w-12 place-items-center rounded-xl border border-slate-200 bg-white shadow-sm"
          aria-label={loc.status === 'denied' ? 'Location is off' : 'Show my location'}
          title={loc.status === 'denied' ? 'Location is off for this site' : 'Show my location'}
        >
          {loc.status === 'denied' || loc.status === 'unavailable' ? (
            <LocateOff className="h-5 w-5 text-slate-400" />
          ) : (
            <LocateFixed className={`h-5 w-5 ${you ? 'text-[#2563eb]' : loc.locating ? 'animate-pulse text-slate-500' : 'text-ink'}`} />
          )}
        </button>

        <button
          onClick={() => navigate('/new')}
          className="absolute -top-16 right-4 flex items-center gap-2 rounded-xl bg-brand px-5 py-3 font-semibold text-white shadow-lg hover:bg-brand-dark"
        >
          <Plus className="h-5 w-5" strokeWidth={2.5} /> Pin a problem
        </button>

        <button onClick={() => setExpanded(!expanded)} className="flex justify-center pb-1 pt-2" aria-label={expanded ? 'Shrink list' : 'Expand list'}>
          <span className="h-1 w-9 rounded-full bg-slate-300" />
        </button>

        {created && (
          <div className="mx-4 mb-3 rounded-lg border border-slate-200 p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <p>
                <span className="font-semibold">Your pin is live.</span> Neighbors can +1 it now.
                {!config.notifications && (account ? ' It’s saved to your account.' : ' Its updates show under You.')}
                {residentAccounts && !account && (
                  <>
                    {' '}
                    <a href={`#/account?next=/i/${created.id}&from=new_pin`} className={LINK}>
                      Keep it with your email
                    </a>
                  </>
                )}
              </p>
              <button onClick={clearLastCreated} aria-label="Dismiss">
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>
            <div className="mt-2 flex items-center gap-4">
              <button onClick={() => shareIssue(created, { toast, track }, 'new_pin')} className={`${BUTTON} flex items-center gap-1.5 px-3 py-1.5`}>
                <Share className="h-4 w-4" /> Share
              </button>
              <button onClick={() => navigate(`/i/${created.id}`)} className={LINK}>
                Open your pin
              </button>
            </div>
          </div>
        )}

        <div className="px-5 pb-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">{plural(ranked.length, 'open problem')}</h2>
            <div className="flex gap-3">
              <button className={sortTab(sort === 'votes')} aria-pressed={sort === 'votes'} onClick={() => setSort('votes')}>
                Most +1s
              </button>
              <button className={sortTab(sort === 'newest')} aria-pressed={sort === 'newest'} onClick={() => setSort('newest')}>
                Newest
              </button>
            </div>
          </div>
          {/* The first screen many residents see: say once what +1 means. */}
          <p className="mt-0.5 text-[13px] leading-snug text-slate-500">
            <span className="block">+1 a problem if you have it too.</span>
            Pins go to {district.name} ·{' '}
            <a href="#/about" className={LINK}>
              About
            </a>
          </p>
        </div>

        <ul className="flex-1 overflow-y-auto px-5 pb-4">
          {list.shown.map((issue) => (
            <OpenRow
              key={issue.id}
              issue={issue}
              done={votedSet.has(issue.id)}
              meters={you ? distanceMeters(you, issue) : null}
              onVote={onVote}
            />
          ))}
          {list.more && <li ref={list.sentinel} aria-hidden className="h-px" />}
          {!ranked.length && (
            <li className="py-8 text-center text-sm text-slate-500">
              {active.length ? 'No open problems match.' : 'No open problems right now.'}
            </li>
          )}
          {!list.more && fixedLately.length > 0 && (
            <li className="border-t border-slate-100 pb-1 pt-4">
              <h3 className={LABEL}>Fixed in the last 30 days</h3>
            </li>
          )}
          {!list.more && fixedLately.map((issue) => <FixedRow key={issue.id} issue={issue} />)}
        </ul>
      </div>
    </div>
  );
}
