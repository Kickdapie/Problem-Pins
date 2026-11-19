import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, ChevronUp, EyeOff, MapPin, Share } from 'lucide-react';
import StaticMap from '../components/StaticMap';
import { StatusTag } from '../components/ui';
import { config } from '../config';
import { REMOVED_BY_PINNER, REPORT_REASONS, REPORT_REASON_ORDER, STATUSES } from '../data/meta';
import type { District, FollowContact, Issue, IssueUpdate, ReportReason } from '../data/types';
import { distanceMeters } from '../data/geo';
import { daysBetween, formatMeters, plural, shortDate } from '../lib/format';
import { removalBlocker } from '../lib/ownPin';
import { useUserLocation } from '../lib/userLocation';
import { navigate } from '../router';
import { useStore } from '../store';
import { BUTTON, CategoryLabel, ConfirmAction, Facts, FixQuestion, HEADING, LINK, goBack, residentHistory, shareIssue } from './shared';

function statusCopy(issue: Issue, district: District): { title: string; body?: ReactNode } {
  const DISTRICT = district.name;
  const days = daysBetween(issue.createdAt);
  switch (issue.status) {
    case 'sent_to_city': {
      const req = issue.cityRequest;
      const who = req?.agency ?? issue.agency ?? 'A City agency';
      if (!req) return { title: 'No response from the City yet', body: `${who} is responsible for this. ${DISTRICT} sent it to the City.` };
      const wait = daysBetween(req.sentOn);
      return {
        title: 'No response from the City yet',
        body: (
          <>
            {who} is responsible for this. {DISTRICT} filed it with NYC 311 on {shortDate(req.sentOn)}
            {wait > 0 && `, ${plural(wait, 'day')} ago`}
            {req.lastFollowUp && `, and followed up on ${shortDate(req.lastFollowUp)}`}. The 311 request number is{' '}
            <span className="whitespace-nowrap font-mono">{req.sr}</span>.
          </>
        ),
      };
    }
    case 'open':
      return {
        title: days > 14 ? 'Nobody has picked this up yet' : 'New · waiting for review',
        body: `${DISTRICT} reviews every new pin. Each +1 shows them, and the City, how many neighbors it affects.`,
      };
    case 'in_review':
      return { title: `${DISTRICT} is looking into it`, body: 'They are checking who is responsible for this and what it takes to fix.' };
    case 'scheduled':
      // Only promise a message when one is really sent (config.notifications). The tag above already
      // says "Scheduled"; the district's latest update below says who fixes it and when.
      return { title: 'A fix is on the way', body: config.notifications ? 'You’ll get a note when it’s marked done.' : undefined };
    case 'fixed':
      return {
        title: issue.fixedOn ? `Marked fixed on ${shortDate(issue.fixedOn)}` : 'Marked fixed',
        body: `${plural(issue.confirmedFixed, 'neighbor')} confirmed the fix so far.${
          issue.notFixed > 0 ? ` ${plural(issue.notFixed, 'neighbor')} ${issue.notFixed === 1 ? 'says' : 'say'} it isn’t fixed.` : ''
        }`,
      };
  }
}

/** A small gray link for what is rarely needed: deleting a note, reporting a pin. */
const QUIET = 'text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-ink';

/** "Phone or email" field → a contact the backend can store privately. */
function parseContact(value: string): FollowContact | undefined {
  const v = value.trim();
  if (!v) return undefined;
  return v.includes('@') ? { email: v } : { phone: v };
}

/** Every photo, one per swipe. The arrows are for screens without touch. */
function Photos({ photos }: { photos: string[] }) {
  const strip = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const step = (by: number) => strip.current?.scrollBy({ left: by * strip.current.clientWidth, behavior: 'smooth' });
  const arrow = 'absolute top-1/2 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white shadow disabled:opacity-0 sm:grid';
  return (
    <div className="relative">
      <div
        ref={strip}
        onScroll={(e) => setAt(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        className="no-scrollbar flex h-56 snap-x snap-mandatory overflow-x-auto"
      >
        {photos.map((src, i) => (
          <img key={i} src={src} alt={`Photo ${i + 1} of ${photos.length}`} className="h-full w-full shrink-0 snap-center object-cover" />
        ))}
      </div>
      {photos.length > 1 && (
        <>
          <button onClick={() => step(-1)} disabled={at === 0} aria-label="Previous photo" className={`${arrow} left-3`}>
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button onClick={() => step(1)} disabled={at === photos.length - 1} aria-label="Next photo" className={`${arrow} right-3`}>
            <ChevronRight className="h-5 w-5" />
          </button>
          <span className="absolute bottom-3 right-3 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
            {at + 1} / {photos.length}
          </span>
        </>
      )}
    </div>
  );
}

/** On the device that pinned it: remove the pin while that's still allowed, or say in one sentence why not. */
function RemovePin({ issue }: { issue: Issue }) {
  const store = useStore();
  const blocker = removalBlocker(issue);
  if (blocker) {
    const others = issue.votes === 2 ? 'Another neighbor has' : 'Other neighbors have';
    return (
      <p>
        {blocker === 'office' ? `${store.district.name} has picked this up` : `${others} +1’d this`}, so it stays on the map. You can still add a
        note.
      </p>
    );
  }
  return (
    <ConfirmAction
      label="Remove your pin"
      question={`Remove your pin? It comes off the map for everyone. ${store.district.name} can still see it.`}
      confirmLabel="Remove pin"
      cancelLabel="Keep it"
      onConfirm={async () => {
        if (await store.removeIssue(issue.id)) {
          store.toast('Your pin was removed');
          navigate('/');
        }
      }}
    />
  );
}

/** "Report this pin": one report per device, a reason from a short list, seen only by the district office. */
function ReportPin({ issue }: { issue: Issue }) {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) first.current?.focus();
    else if (wasOpen.current) opener.current?.focus();
    wasOpen.current = open;
  }, [open]);

  if (store.reported.includes(issue.id)) {
    return (
      <p className="text-slate-600">You reported this pin. {store.district.name} will review it.</p>
    );
  }
  if (!open) {
    return (
      <button ref={opener} onClick={() => setOpen(true)} className={QUIET}>
        Report this pin
      </button>
    );
  }
  return (
    <form
      className="basis-full rounded-xl border border-slate-200 p-4 text-base"
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!reason) return;
        setBusy(true);
        if (await store.reportIssue(issue.id, reason)) store.toast('Report sent');
        setBusy(false);
      }}
    >
      <fieldset>
        <legend className="font-semibold">Why are you reporting this pin?</legend>
        <p className="mt-0.5 text-sm text-slate-600">Only {store.district.name} sees reports.</p>
        <div className="mt-2">
          {REPORT_REASON_ORDER.map((r, n) => (
            <label key={r} className="flex cursor-pointer items-center gap-2.5 py-1.5 text-[15px]">
              <input
                ref={n === 0 ? first : undefined}
                type="radio"
                name="report-reason"
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
                className="h-4 w-4 accent-ink"
              />
              {REPORT_REASONS[r]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-3 flex items-center gap-4">
        <button disabled={!reason || busy} className={`${BUTTON} px-4 py-2 text-sm disabled:opacity-50`}>
          Send report
        </button>
        <button type="button" onClick={() => setOpen(false)} className={`text-sm ${LINK}`}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * One note or reply: who, when, Delete on this phone's own, then the text. Its writer still sees
 * a note the district office hid, and is told why no one else does.
 */
function Note({ issue, district, u, replies = 0 }: { issue: Issue; district: District; u: IssueUpdate; replies?: number }) {
  const store = useStore();
  const reply = Boolean(u.replyTo);
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-[15px] font-semibold">{u.author}</span>
      <span className="text-xs text-slate-500">{shortDate(u.date)}</span>
      {u.mine && (
        <ConfirmAction
          label="Delete"
          question={
            reply
              ? 'Delete this reply? It can’t be brought back.'
              : replies
                ? `Delete this note and the ${replies === 1 ? 'reply' : `${replies} replies`} under it? It can’t be brought back.`
                : 'Delete this note? It can’t be brought back.'
          }
          confirmLabel={reply ? 'Delete reply' : 'Delete note'}
          linkClassName={`ml-auto text-xs ${QUIET}`}
          className="order-last mt-2 basis-full text-sm"
          onConfirm={async () => {
            if (await store.deleteNote(issue.id, u.id)) store.toast(reply ? 'Reply deleted' : 'Note deleted');
          }}
        />
      )}
      {/* In the row so that the delete question, once asked, comes after the note. */}
      <p className={`mt-0.5 basis-full text-[15px] leading-relaxed ${u.hidden ? 'text-slate-500' : 'text-slate-700'}`}>{u.text}</p>
      {u.hidden && (
        <p className="basis-full text-xs text-slate-500">
          {district.name} hid this {reply ? 'reply' : 'note'}. Other neighbors don’t see it.
        </p>
      )}
    </div>
  );
}

/**
 * Neighbors' notes, each with its replies under it, then the box for a new note. One level: a
 * reply answers the note, from a neighbor or from the district, and "Reply" sits at the end of
 * the thread, so nothing nests deeper.
 */
function Notes({ issue, district }: { issue: Issue; district: District }) {
  const store = useStore();
  const [note, setNote] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const notes = issue.updates.filter((u) => u.role === 'resident' && !u.replyTo);
  const input = 'h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-ink';

  return (
    <section className="border-t border-slate-100 pt-6">
      <h2 className={HEADING}>Notes from neighbors</h2>
      {notes.map((n) => {
        // What the district office hid stays out, except for the phone that wrote it. A hidden note
        // with replies leaves a line, so the replies still answer something.
        const replies = issue.updates.filter((u) => u.replyTo === n.id && (!u.hidden || u.mine));
        if (n.hidden && !n.mine && !replies.length) return null;
        return (
          <div key={n.id} className="border-b border-slate-100 py-3">
            {n.hidden && !n.mine ? (
              <p className="text-sm text-slate-500">{district.name} hid this note.</p>
            ) : (
              <Note issue={issue} district={district} u={n} replies={replies.length} />
            )}
            {replies.length > 0 && (
              <div className="mt-2.5 space-y-2.5 border-l-2 border-slate-200 pl-3">
                {replies.map((r) => (
                  <Note key={r.id} issue={issue} district={district} u={r} />
                ))}
              </div>
            )}
            {n.hidden ? null : replyingTo === n.id ? (
              <form
                className={`mt-2.5 flex gap-2 ${replies.length ? 'pl-3.5' : ''}`}
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!reply.trim()) return;
                  if (await store.addComment(issue.id, reply.trim(), n.id)) {
                    setReply('');
                    setReplyingTo(null);
                    store.toast('Reply added');
                  }
                }}
                onKeyDown={(e) => e.key === 'Escape' && setReplyingTo(null)}
              >
                <input
                  autoFocus
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  maxLength={1000}
                  placeholder="Reply to this note…"
                  aria-label="Reply to this note"
                  className={input}
                />
                <button className={`${BUTTON} px-3 text-sm`}>Reply</button>
              </form>
            ) : (
              <button
                onClick={() => {
                  setReplyingTo(n.id);
                  setReply('');
                }}
                className={`mt-1.5 text-xs ${QUIET} ${replies.length ? 'ml-3.5' : ''}`}
              >
                Reply
              </button>
            )}
          </div>
        );
      })}
      <form
        className="mt-3 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!note.trim()) return;
          if (await store.addComment(issue.id, note.trim())) {
            setNote('');
            store.toast('Note added');
          }
        }}
      >
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          placeholder="Add what you’ve seen…"
          aria-label="Add a note"
          className={input}
        />
        <button className={`${BUTTON} px-3 text-sm`}>Post</button>
      </form>
      <p className="mt-1.5 text-xs text-slate-500">Neighbors and {district.name} see your notes and replies. Leave out names and phone numbers.</p>
    </section>
  );
}

export default function IssueDetail({ id }: { id?: string }) {
  const store = useStore();
  const { district, track } = store;
  const issue = id ? store.getIssue(id) : undefined;
  const [contact, setContact] = useState('');
  const you = useUserLocation().position;
  const exists = Boolean(issue);
  // The +1 button scrolled out of sight: a bar at the bottom offers it again.
  const voteButton = useRef<HTMLButtonElement>(null);
  const [voteOutOfSight, setVoteOutOfSight] = useState(false);
  const canVote = Boolean(issue && issue.status !== 'fixed' && !issue.hidden && !issue.mergedInto && !store.voted.includes(issue.id));
  useEffect(() => {
    const el = voteButton.current;
    if (!el || !canVote) return setVoteOutOfSight(false);
    const seen = new IntersectionObserver(([entry]) => setVoteOutOfSight(!entry.isIntersecting));
    seen.observe(el);
    return () => seen.disconnect();
  }, [canVote, id]);
  const showBar = canVote && voteOutOfSight;
  useEffect(() => {
    if (!showBar) return;
    const root = document.documentElement.style;
    root.setProperty('--toast-offset', '5.5rem');
    return () => void root.removeProperty('--toast-offset');
  }, [showBar]);

  useEffect(() => {
    if (id && exists) track({ name: 'issue_view', issueId: id });
  }, [id, exists]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!issue) {
    return (
      <div className="p-8 text-center">
        <p className="mb-4 text-slate-600">This problem doesn’t exist (yet).</p>
        <button className={LINK} onClick={() => navigate('/')}>
          Back to the map
        </button>
      </div>
    );
  }

  if (issue.mergedInto) {
    return (
      <div className="p-8 text-center">
        <p className="mb-4 text-slate-600">
          {district.name} merged this pin into <span className="font-mono">{issue.mergedInto}</span>, which reports the same problem.
          Its +1s and followers moved with it.
        </p>
        <button className={LINK} onClick={() => navigate(`/i/${issue.mergedInto}`)}>
          Open <span className="font-mono">{issue.mergedInto}</span>
        </button>
      </div>
    );
  }

  const voted = store.voted.includes(issue.id);
  const following = store.following.includes(issue.id);
  // The device that pinned it keeps its +1 and stays on it under You.
  const mine = Boolean(issue.isUserReport);
  const yourPage = (
    <a href="#/updates" className={LINK}>
      You
    </a>
  );
  // The account is offered elsewhere (the You page, a new pin's card), never on the way to a +1.
  const status = STATUSES[issue.status];
  const copy = statusCopy(issue, district);
  // The district's latest update goes on the status card: it is where the problem stands now. The
  // earlier ones sit in the history, on the day they were posted. Neighbors' notes have their own section.
  // A district reply under a note answers that note; it isn't an update on the problem.
  const fromDistrict = issue.updates.filter((u) => u.role === 'partner' && !u.replyTo);
  const latest = fromDistrict.reduce<IssueUpdate | undefined>((a, u) => (!a || u.date >= a.date ? u : a), undefined);
  const timeline = [
    ...residentHistory(issue.history).map((h) => ({ date: h.date, text: h.text, update: false })),
    ...fromDistrict.filter((u) => u !== latest).map((u) => ({ date: u.date, text: u.text, update: true })),
  ].sort((a, b) => a.date.localeCompare(b.date)); // stable: on one day, the event before the update about it
  const meters = you ? distanceMeters(you, issue) : null;
  const place = issue.locationDetail ?? issue.locationLabel;
  const showOnMap = () => navigate(`/?focus=${issue.id}`);
  // What this phone has to do with the problem, said once, under the +1: what it gets (the updates,
  // on the You page; where they are kept is said there) and at most one way to undo it. A +1 already
  // brings the updates, so "Stop following" shows only without one, where it changes something.
  const unfollow = (
    <button
      onClick={async () => {
        if (await store.unfollow(issue.id)) store.toast(config.notifications ? 'You won’t get messages about this any more' : 'You’re no longer following this');
      }}
      className={LINK}
    >
      Stop following
    </button>
  );
  const tieClass = 'mt-1.5 text-sm leading-relaxed text-slate-600';
  let tie: ReactNode = null;
  if (mine) {
    tie = (
      <div className={`${tieClass} space-y-1.5`}>
        <p>
          You pinned this. {config.notifications && following ? 'You’ll get a text or email when it changes' : <>Its updates show under {yourPage}</>}.
        </p>
        {!issue.hidden && <RemovePin issue={issue} />}
      </div>
    );
  } else if (config.notifications) {
    if (following) tie = <p className={tieClass}>You’ll get a text or email when this changes · {unfollow}</p>;
  } else if (voted) {
    tie = (
      <p className={tieClass}>
        Its updates show under {yourPage}
        {/* Not on a fixed or hidden problem, and not from the map list, where a stray tap would undo it. */}
        {issue.status !== 'fixed' && !issue.hidden && (
          <>
            {' · '}
            <button
              onClick={async () => {
                if (await store.unvote(issue.id)) store.toast('Your +1 is taken back');
              }}
              className={LINK}
            >
              Take back your +1
            </button>
          </>
        )}
      </p>
    );
  } else if (following) {
    tie = (
      <p className={tieClass}>
        Its updates show under {yourPage} · {unfollow}
      </p>
    );
  } else if (issue.status !== 'fixed' && !issue.hidden) {
    tie = (
      <p className={tieClass}>
        <button
          onClick={async () => {
            if (await store.follow(issue.id)) store.toast('Following. Its updates show under You');
          }}
          className={LINK}
        >
          Or follow it without a +1
        </button>
      </p>
    );
  }
  const rank =
    [...store.issues].filter((i) => i.status !== 'fixed').sort((a, b) => b.votes - a.votes).findIndex((i) => i.id === issue.id) + 1;

  return (
    <div className="pb-8">
      <header className="flex items-center justify-between px-3 py-2">
        <button onClick={goBack} aria-label="Back" className="grid h-10 w-10 place-items-center rounded-full hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button onClick={() => shareIssue(issue, store, 'detail')} className={`${BUTTON} mr-2 flex items-center gap-1.5 px-3 py-1.5 text-sm`}>
          <Share className="h-4 w-4" /> Share
        </button>
      </header>

      {issue.photos.length > 0 && <Photos photos={issue.photos} />}

      {issue.hidden && (
        <p className="flex items-center gap-2 border-y border-slate-200 px-5 py-2.5 text-sm text-slate-600">
          <EyeOff className="h-4 w-4 shrink-0" />
          {issue.hiddenReason === REMOVED_BY_PINNER
            ? `${REMOVED_BY_PINNER}. Only staff can see this.`
            : `Hidden by staff${issue.hiddenReason ? `: ${issue.hiddenReason}` : ''}. Only staff can see this.`}
        </p>
      )}

      <div className="space-y-7 px-5 pt-4">
        <div>
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="font-mono">{issue.id}</span> · <CategoryLabel category={issue.category} iconClass="h-3.5 w-3.5 text-slate-500" />
          </p>
          <h1 className="mt-1 text-2xl font-bold leading-tight">{issue.title}</h1>
          {/* Where it stands, on its own line. Where it is goes with the map below. When it was pinned is
              the first line of the history. */}
          <p className="mt-1.5 text-[15px]">
            <StatusTag status={issue.status} resident className="font-medium text-ink" />
          </p>
          {issue.description && <p className="mt-3 text-[15px] leading-relaxed text-slate-700">{issue.description}</p>}
          {/* Many arrive from a poster or a shared link, not from the map: show where it is, and how far. */}
          {issue.hidden ? (
            <p className="mt-3 text-sm text-slate-600">{place}</p>
          ) : (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
              <StaticMap lat={issue.lat} lng={issue.lng} height={128} label={`Show ${place} on the map`} onOpen={showOnMap} />
              <button
                type="button"
                onClick={showOnMap}
                className="flex w-full items-baseline gap-3 border-t border-slate-200 px-3 py-2 text-left text-sm"
              >
                <MapPin className="h-3.5 w-3.5 shrink-0 self-center text-slate-500" />
                <span className="min-w-0 flex-1 text-slate-700">{place}</span>
                {meters !== null && meters >= 10 && <span className="shrink-0 text-slate-500">{formatMeters(meters)} away</span>}
              </button>
            </div>
          )}
        </div>

        {/* The +1, and right under it what this phone has to do with the problem. */}
        <div>
          {issue.status === 'fixed' ? (
            <FixQuestion issue={issue} />
          ) : voted ? (
            <p className="flex items-center justify-center gap-1.5 rounded-lg border border-brand px-4 py-2.5 font-semibold text-brand">
              <Check className="h-4 w-4" strokeWidth={2.5} /> You +1’d this
            </p>
          ) : (
            <button
              ref={voteButton}
              onClick={() => store.vote(issue.id, 'detail')}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:bg-brand-dark"
            >
              <ChevronUp className="h-4 w-4" strokeWidth={2.5} /> +1 This is my problem too
            </button>
          )}
          <Facts
            className="mt-2 text-sm text-slate-600"
            parts={[
              issue.votes === 0
                ? 'No +1s yet'
                : voted && issue.votes === 1
                  ? mine
                    ? 'No one else has +1’d this yet'
                    : 'You’re the first neighbor to +1 this'
                  : `${plural(issue.votes, 'neighbor')} +1’d this`,
              // A rank only says something near the top.
              rank === 1 && `the most +1’d in ${district.area}`,
              (rank === 2 || rank === 3) && `#${rank} most +1’d in ${district.area}`,
            ]}
          />
          {tie}
        </div>

        <div className="rounded-xl border p-4" style={{ background: status.soft, borderColor: `${status.color}55` }}>
          <p className="text-lg font-bold leading-snug">{copy.title}</p>
          {/* One paragraph: the district's own words when there are some, else what the status means. */}
          {latest ? (
            <>
              <p className="mt-1.5 text-[15px] leading-relaxed text-slate-800">
                <span className="font-semibold">
                  {district.name}, {shortDate(latest.date)}:
                </span>{' '}
                {latest.text}
              </p>
              {issue.status === 'sent_to_city' && issue.cityRequest && (
                <Facts
                  className="mt-1.5 text-sm text-slate-700"
                  parts={[
                    issue.cityRequest.agency ?? issue.agency ?? 'City',
                    <>
                      311 request <span className="font-mono">{issue.cityRequest.sr}</span>
                    </>,
                    `filed ${shortDate(issue.cityRequest.sentOn)}`,
                  ]}
                />
              )}
            </>
          ) : (
            <>
              {copy.body && <p className="mt-1.5 text-[15px] leading-relaxed text-slate-700">{copy.body}</p>}
              {/* The City agency that owns it, once known. Who at the district office holds it is for staff. */}
              {issue.agency && issue.status !== 'sent_to_city' && issue.status !== 'fixed' && (
                <p className="mt-1 text-[15px] leading-relaxed text-slate-700">{issue.agency} is responsible for this.</p>
              )}
            </>
          )}
          <p className="mt-3 text-xs text-slate-600">Tracked by {district.name}, not an official NYC 311 status.</p>
        </div>

        <section className="border-t border-slate-100 pt-6">
          <h2 className={`${HEADING} mb-3`}>History</h2>
          <ol className="space-y-3">
            {timeline.map((t, idx) => (
              <li key={idx} className="flex gap-3 text-[15px]">
                <span className="w-12 shrink-0 pt-0.5 text-xs text-slate-500">{shortDate(t.date)}</span>
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />
                {t.update ? (
                  <span className="min-w-0">
                    {district.name} posted an update
                    <span className="mt-1 block border-l-2 border-slate-200 pl-3 leading-relaxed text-slate-700">{t.text}</span>
                  </span>
                ) : (
                  <span>{t.text}</span>
                )}
              </li>
            ))}
            {issue.status !== 'fixed' && (
              <li className="flex gap-3 text-[15px] text-slate-500">
                <span className="w-12 shrink-0 pt-0.5 text-xs">Next</span>
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full border border-slate-400" />
                <span>Fixed, then confirmed by neighbors</span>
              </li>
            )}
          </ol>
        </section>

        <Notes issue={issue} district={district} />

        {/* With texts and emails on, following takes a phone number or email: a form of its own. */}
        {config.notifications && !following && (
          <section className="rounded-xl border border-slate-200 p-4">
            <h2 className="mb-2 font-semibold">Get a text or email when this changes</h2>
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await store.follow(issue.id, parseContact(contact))) {
                  store.toast(contact ? `We’ll notify ${contact}` : 'Following this problem');
                }
              }}
            >
              <input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="Phone or email"
                aria-label="Phone or email"
                className="h-11 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 outline-none focus:border-ink"
              />
              <button className={`${BUTTON} px-4`}>Notify me</button>
            </form>
            <p className="mt-2 text-xs text-slate-500">No account. Unsubscribe from any message.</p>
          </section>
        )}

        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-3 border-t border-slate-100 pt-4 text-sm">
          {/* Reporting your own pin makes no sense: you can remove it, or add a note. */}
          {!mine && !issue.hidden && <ReportPin issue={issue} />}
          <a href="#/about" className={QUIET}>
            About Problem Pins
          </a>
        </div>
      </div>

      {showBar && (
        <div className="sticky bottom-0 z-[1000] mt-4 border-t border-slate-200 bg-white/95 px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <button
            onClick={() => store.vote(issue.id, 'detail_bar')}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:bg-brand-dark"
          >
            <ChevronUp className="h-4 w-4" strokeWidth={2.5} /> +1 This is my problem too
            <span className="font-normal opacity-90">· {issue.votes}</span>
          </button>
        </div>
      )}
    </div>
  );
}
