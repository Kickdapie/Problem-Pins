import { useEffect } from 'react';
import { Check, ChevronUp } from 'lucide-react';
import { Logo, PhotoThumb, StatusTag } from '../components/ui';
import { config } from '../config';
import { distanceMeters } from '../data/geo';
import { formatMeters, plural, shortDate } from '../lib/format';
import { navigate } from '../router';
import { useStore } from '../store';
import { BUTTON, CategoryLabel, Facts, FixQuestion, LABEL, LINK } from './shared';

/** How close an open problem must be to show as "nearby" when the poster has no linked problem. */
const NEARBY_METERS = 150;

let lastView = { code: '', at: 0 };

/** Where a printed QR code lands. `source` is "qr" when the visit came through the short link. */
export default function ScanLanding({ code, source }: { code: string; source: string | null }) {
  const store = useStore();
  const { district, track } = store;
  const point = store.scanPoints.find((p) => p.code === code);
  const found = point?.issueId ? store.getIssue(point.issueId) : undefined;
  // A hidden issue (spam, off-topic) counts as no linked issue. In the demo, staff can see hidden ones.
  const linked = found?.hidden ? undefined : found;
  // Follow a merge so the poster keeps working after staff dedupe the problem.
  const merged = Boolean(linked?.mergedInto);
  const target = linked?.mergedInto ? store.getIssue(linked.mergedInto) : linked;
  const issue = target?.hidden ? undefined : target;
  // Lets the experiments panel attribute +1s to this poster.
  const voteSource = `scan:${code}`;
  // With nothing linked, offer open problems close by so people +1 instead of pinning a duplicate.
  const nearby = issue || !point
    ? []
    : store.issues
        .filter((i) => i.status !== 'fixed')
        .map((i) => ({ issue: i, d: distanceMeters(point, i) }))
        .filter((n) => n.d <= NEARBY_METERS)
        .sort((a, b) => a.d - b.d)
        .slice(0, 3);
  const voted = issue ? store.voted.includes(issue.id) : false;
  const known = Boolean(point);

  useEffect(() => {
    // Count one view per visit: React's StrictMode (dev) runs effects twice on mount.
    const now = Date.now();
    if (lastView.code === code && now - lastView.at < 1000) return;
    lastView = { code, at: now };
    track({ name: 'scan_view', scanCode: code, props: { src: source ?? 'link', known } });
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!point) {
    return (
      <div className="px-5 pb-8 pt-8">
        <Logo />
        <h1 className="mt-8 text-2xl font-bold">This code isn’t active</h1>
        <p className="mt-2 text-slate-600">
          The poster you scanned (<span className="font-mono">{code || 'no code'}</span>) isn’t linked to a spot anymore. You can still pin a
          problem on the {district.area} map.
        </p>
        <button onClick={() => navigate('/')} className={`${LINK} mt-5`}>
          Open the map
        </button>
      </div>
    );
  }

  return (
    <div className="px-5 pb-8 pt-8">
      <div className="mb-8 flex items-center gap-3">
        <Logo />
        <span className="flex-1 text-right text-sm leading-snug text-slate-500">with {district.name}</span>
      </div>

      <p className={LABEL}>You scanned</p>
      <h1 className="mt-1 text-2xl font-bold">{point.name}</h1>
      <p className="text-slate-600">{point.detail}</p>

      {merged && issue && (
        <p className="mt-5 text-sm text-slate-600">
          The problem reported here (<span className="font-mono">{linked!.id}</span>) was combined with a matching report, so +1s
          count in one place.
        </p>
      )}

      {issue && issue.status === 'fixed' ? (
        <div className="mt-5 rounded-xl border border-slate-200 p-4">
          <p className={LABEL}>Reported here</p>
          <div className="mt-2 flex gap-3">
            <p className="flex-1 text-balance text-lg font-semibold leading-snug">{issue.title}</p>
            {issue.photos.length > 0 && <PhotoThumb issue={issue} className="h-14 w-14 shrink-0 rounded-lg" />}
          </div>
          <p className="mt-2 text-sm text-slate-500">
            <StatusTag status="fixed" resident className="text-ink" />
            {issue.fixedOn && <> on {shortDate(issue.fixedOn)}</>}
            {issue.confirmedFixed > 0 && <> · {plural(issue.confirmedFixed, 'neighbor')} confirmed</>}
          </p>
          <div className="mt-4 border-t border-slate-100 pt-4">
            <FixQuestion issue={issue} />
          </div>
          <button onClick={() => navigate(`/i/${issue.id}`)} className={`${LINK} mt-4`}>
            See what happened with it
          </button>
        </div>
      ) : issue ? (
        <div className="mt-5 rounded-xl border border-slate-200 p-4">
          <p className={LABEL}>Already reported here</p>
          <div className="mt-2 flex gap-3">
            <p className="flex-1 text-balance text-lg font-semibold leading-snug">{issue.title}</p>
            {issue.photos.length > 0 && <PhotoThumb issue={issue} className="h-14 w-14 shrink-0 rounded-lg" />}
          </div>
          <Facts
            className="mt-2 text-[13px] text-slate-500"
            parts={[
              <StatusTag status={issue.status} resident className="text-ink" />,
              plural(issue.votes, 'neighbor'),
              `pinned ${shortDate(issue.createdAt)}`,
            ]}
          />
          {voted ? (
            <p className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-brand py-3 font-semibold text-brand">
              <Check className="h-5 w-5" strokeWidth={2.5} /> You +1’d this
            </p>
          ) : (
            <button
              onClick={() => store.vote(issue.id, voteSource)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 font-semibold text-white hover:bg-brand-dark"
            >
              <ChevronUp className="h-5 w-5" strokeWidth={2.5} /> +1 This is my problem too
            </button>
          )}
          <button onClick={() => navigate(`/i/${issue.id}`)} className={`${LINK} mt-3`}>
            See what’s happening with it
          </button>
        </div>
      ) : (
        nearby.length > 0 && (
          <div className="mt-5">
            <p className={LABEL}>Already reported nearby</p>
            <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
              {nearby.map(({ issue: i, d }) => {
                const mine = store.voted.includes(i.id);
                return (
                  <li key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                    <button onClick={() => navigate(`/i/${i.id}`)} className="min-w-0 flex-1 text-left">
                      <p className="truncate font-medium">{i.title}</p>
                      <p className="text-xs text-slate-500">
                        {plural(i.votes, 'neighbor')} · {formatMeters(d)} away
                      </p>
                    </button>
                    <button
                      onClick={() => store.vote(i.id, voteSource)}
                      disabled={mine}
                      className={`shrink-0 px-3 py-1.5 text-sm ${mine ? 'font-semibold text-brand' : BUTTON}`}
                    >
                      {mine ? '+1’d' : '+1'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )
      )}

      {issue || nearby.length > 0 ? (
        <div className="my-5 flex items-center gap-3 text-sm text-slate-500">
          <span className="h-px flex-1 bg-slate-200" />
          or report something else here
          <span className="h-px flex-1 bg-slate-200" />
        </div>
      ) : (
        <p className="mb-3 mt-6 font-semibold">What’s the problem here?</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {district.categories.map((c) => (
          <button
            key={c}
            onClick={() => navigate(`/new?cat=${c}&from=${code}`)}
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium hover:border-slate-300"
          >
            <CategoryLabel category={c} />
          </button>
        ))}
      </div>

      <p className="mt-5 text-sm text-slate-500">
        {config.notifications ? 'No app or account. Leave a phone number or email only if you want updates.' : 'No app or account needed.'}{' '}
        <a href="#/about" className={LINK}>
          About Problem Pins
        </a>
      </p>
      <button onClick={() => navigate('/')} className={`${LINK} mt-3 text-sm`}>
        Explore the neighborhood map
      </button>
    </div>
  );
}
