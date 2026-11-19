import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, Check, ChevronRight, Copy, QrCode } from 'lucide-react';
import { CATEGORY_ICONS, SampleBadge, labelClass, linkClass } from '../components/ui';
import { config } from '../config';
import { CATEGORIES } from '../data/meta';
import type { AnalyticsEvent, AttentionRules, Category } from '../data/types';
import { EXPERIMENT_THRESHOLDS } from '../lib/experimentSettings';
import { addDays, formatHours, plural, shortDate, today } from '../lib/format';
import { checkThreshold } from '../lib/metrics';
import { displayLink } from '../lib/qr';
import { navigate } from '../router';
import { useStore } from '../store';
import { TodoAction } from './actions';
import { TODO_GROUPS, cityFigures, firstResponse, intakeFigures, todoList, waited, type TodoItem } from './dashboard';
import { Photos } from './Photos';
import { UpdateComposer } from './UpdateComposer';

const card = 'rounded-xl border border-slate-200 bg-white';
const button = 'flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium hover:border-slate-300';

/**
 * The staff home page for a community district office. The to-do list is the page: who is waiting
 * on the office today, answerable without leaving the list. Three figures for how it's going sit
 * beside it on a wide screen and under it otherwise. Nothing here says a thing twice: the district's
 * name is in the sidebar, the rule behind each group is in Settings, monthly figures are in Reports.
 */
export default function Overview() {
  const { issues, hiddenIssues, district, listEvents } = useStore();
  const now = today();
  const [events, setEvents] = useState<AnalyticsEvent[] | null>(null);

  // Analytics for the response times, this 30-day window and the one before. Loaded once per visit: they move slowly.
  useEffect(() => {
    let current = true;
    void listEvents(addDays(now, -61)).then((e) => current && setEvents(e));
    return () => {
      current = false;
    };
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

  const todo = useMemo(() => todoList(issues, district.rules, now), [issues, district.rules, now]);
  const nothingPinned = issues.length === 0 && hiddenIssues.length === 0;

  return (
    <div className="mx-auto max-w-[1000px] space-y-5 px-4 py-5 md:px-8 md:py-7 xl:max-w-[1180px]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-bold md:text-2xl">
          To do
          {todo.length > 0 && <span className="ml-2 text-base font-medium tabular-nums text-slate-500">{todo.length}</span>}
        </h1>
        <SampleBadge />
      </header>

      {nothingPinned ? (
        <GetStarted />
      ) : (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
          <section className={`${card} overflow-hidden`}>
            {todo.length ? <TodoGroups items={todo} /> : <AllClear rules={district.rules} />}
          </section>
          <Figures events={events} />
        </div>
      )}
    </div>
  );
}

function Figures({ events }: { events: AnalyticsEvent[] | null }) {
  const { issues } = useStore();
  const now = today();
  const city = cityFigures(issues, now);
  const intake = intakeFigures(issues, now);
  const response = events && firstResponse(events, now);
  const before = events && firstResponse(events, addDays(now, -30));
  const target = EXPERIMENT_THRESHOLDS.staffResponseHours;

  let responseNote = 'Loading…';
  let responseTone = 'text-slate-500';
  if (response && !response.pins) responseNote = 'No new issues in the last 30 days';
  else if (response) {
    const parts = [response.responded ? 'Last 30 days' : 'Last 30 days · none answered yet'];
    // Against the 30 days before, in words: lower is better.
    if (response.responded && before?.responded) {
      const [shown, was] = [formatHours(response.medianHours), formatHours(before.medianHours)];
      if (shown === was) parts.push('same as the 30 days before');
      else parts.push(`${response.medianHours! < before.medianHours! ? 'down' : 'up'} from ${was}`);
    }
    if (target.value !== null) {
      parts.push(`target ${target.value} h`);
      if (checkThreshold(response.medianHours, target) === 'misses') responseTone = 'text-brand-dark';
    }
    responseNote = parts.join(' · ');
  }

  return (
    <div className={`${card} grid gap-px overflow-hidden bg-slate-200 sm:grid-cols-3 xl:grid-cols-1`}>
      <Figure
        label="New in the last 7 days"
        value={intake.count}
        note={[
          intake.count ? (intake.answered === intake.count ? 'All answered' : `${intake.answered} answered so far`) : '',
          `${intake.before} the week before`,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      <Figure
        label="Waiting on the City"
        value={city.count}
        href={city.count ? '#/org/issues?tab=city' : undefined}
        note={city.count ? city.byAgency.map((a) => `${a.agency} ${a.count}`).join(' · ') : 'Nothing with the City right now'}
      />
      <Figure
        label="Median first response"
        value={response ? formatHours(response.medianHours) : '…'}
        note={responseNote}
        tone={responseTone}
      />
    </div>
  );
}

/**
 * One figure beside the to-do list: what it is, the number, a note under it. The number is large
 * on purpose: this card is the one place that shows how things stand at a glance. Nothing here is
 * a link; the sidebar already leads to each of these.
 */
/** One figure. With `href` the whole figure is a link to the list behind it, marked by the arrow. */
function Figure({ label, value, note, tone = 'text-slate-500', href }: { label: string; value: ReactNode; note: string; tone?: string; href?: string }) {
  const box = 'block bg-white px-4 py-3.5 md:px-5 md:py-4';
  const body = (
    <>
      <p className={`${labelClass} flex items-center justify-between gap-2`}>
        {label}
        {href && <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums md:text-3xl">{value}</p>
      <p className={`mt-1 text-xs ${tone}`}>{note}</p>
    </>
  );
  return href ? (
    <a href={href} className={`${box} -outline-offset-2 hover:bg-slate-50`}>
      {body}
    </a>
  ) : (
    <div className={box}>{body}</div>
  );
}

function TodoGroups({ items }: { items: TodoItem[] }) {
  // One reply box at a time. It closes itself when the answered issue leaves the list.
  const [openId, setOpenId] = useState<string | null>(null);
  const groups = TODO_GROUPS.map((group) => {
    const rows = items.filter((t) => t.kind === group.kind);
    if (!rows.length) return null;
    return (
      <div key={group.kind}>
        <div className="flex items-baseline gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 md:px-5">
          <h2 className="text-sm font-semibold">{group.title}</h2>
          <span className="text-sm tabular-nums text-slate-500">{rows.length}</span>
        </div>
        {rows.map((t) => {
          const open = openId === t.issue.id;
          return (
            <div key={t.issue.id} className="border-b border-slate-100 last:border-b-0">
              {/* The title is the link; it is stretched over the row, so the whole row opens the issue and the action stays its own button. */}
              <div
                className={`relative flex flex-col items-start gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 md:px-5 ${
                  open ? '' : 'hover:bg-slate-50'
                }`}
              >
                <div className="w-full min-w-0 flex-1">
                  <p className="sm:truncate">
                    <span className="mr-2 font-mono text-xs text-slate-500">{t.issue.id}</span>
                    <a
                      href={`#/org/issues/${t.issue.id}`}
                      className="font-semibold outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ink"
                    >
                      {t.issue.title}
                    </a>
                  </p>
                  <p className="text-sm font-semibold sm:hidden">{t.days ? `Waiting ${waited(t.days)}` : 'Today'}</p>
                  <p className="mt-0.5 text-sm text-slate-500 sm:truncate">
                    {/* The category hints at whose problem it is. A City row already names the agency. */}
                    {t.kind !== 'city' && <CategoryInLine category={t.issue.category} />}
                    {t.note}
                  </p>
                </div>
                <p className="hidden w-[72px] shrink-0 text-right text-sm font-semibold tabular-nums sm:block">{waited(t.days)}</p>
                <TodoAction item={t} open={open} onCompose={() => setOpenId(open ? null : t.issue.id)} />
              </div>
              {open && <ReplyInPlace item={t} onDone={() => setOpenId(null)} />}
            </div>
          );
        })}
      </div>
    );
  });
  return <>{groups}</>;
}

/** A category inside a line of text: the icon is inline and sits on the baseline, where the flex `CategoryTag` rides high. */
function CategoryInLine({ category }: { category: Category }) {
  const Icon = CATEGORY_ICONS[category];
  return (
    <>
      <Icon className="mr-1 inline h-3.5 w-3.5 align-[-0.15em]" aria-hidden />
      {CATEGORIES[category].label} ·{' '}
    </>
  );
}

/**
 * Answering from the list: what the resident wrote, then the same box as on the issue page.
 * Forwarding to 311, assigning and hiding stay on the issue page.
 */
function ReplyInPlace({ item, onDone }: { item: TodoItem; onDone: () => void }) {
  const { issue, kind } = item;
  const last = issue.updates.filter((u) => !u.hidden).at(-1);
  const said = kind === 'residents' && last?.role === 'resident' ? last : null;
  return (
    <div className="space-y-3 bg-slate-50 px-4 py-4 md:px-5">
      {said ? (
        <div className="text-sm">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">{said.author}</span>
            <span className="text-xs text-slate-500">{shortDate(said.date)}</span>
          </p>
          <p className="text-slate-700">{said.text}</p>
        </div>
      ) : (
        kind === 'new' && (
          <div className="text-sm">
            {issue.description && <p className="text-slate-700">{issue.description}</p>}
            <p className="text-slate-500">{issue.locationDetail ?? issue.locationLabel}</p>
            {issue.photos.length > 0 && (
              <div className="mt-2">
                <Photos photos={issue.photos} label={issue.id} size="h-24" />
              </div>
            )}
          </div>
        )
      )}
      <UpdateComposer issue={issue} picker autoFocus onPosted={onDone} onCancel={onDone} />
      <p className="text-sm text-slate-500">
        To forward it to 311, assign it or hide it,{' '}
        <a href={`#/org/issues/${issue.id}`} className={linkClass}>
          open the issue
        </a>
        .
      </p>
    </div>
  );
}

function AllClear({ rules }: { rules: AttentionRules }) {
  return (
    <div className="px-4 py-10 text-center md:px-5">
      <Check className="mx-auto h-6 w-6 text-slate-400" />
      <p className="mt-2 font-semibold">Nothing is waiting on you</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
        Pins residents reported, issues nobody has answered, residents waiting for a reply, City requests with no follow-up in{' '}
        {rules.cityNoReplyDays}+ days, and issues with nothing new for residents in {rules.quietDays}+ days show up here.
      </p>
    </div>
  );
}

/** Day one of a pilot: no pins yet, so the page helps get the first ones in. */
function GetStarted() {
  const { scanPoints, toast } = useStore();
  const link = config.publicUrl;
  const posters = scanPoints.length;
  const steps: { title: string; body: string; done?: boolean; action: ReactNode }[] = [
    {
      title: 'Put up QR posters',
      body: posters
        ? `${plural(posters, 'poster')} ready to print. Put them where people wait or walk by.`
        : 'Make one for each spot people pass: a noticeboard, a library entrance, a shop window.',
      done: posters > 0,
      action: (
        <button onClick={() => navigate('/org/qr')} className={button}>
          <QrCode className="h-4 w-4" /> QR posters
        </button>
      ),
    },
    {
      title: 'Share the map link',
      body: `In your newsletter, on social media, at the next board meeting: ${displayLink(link)}`,
      action: (
        <button
          onClick={() =>
            navigator.clipboard?.writeText(link).then(
              () => toast('Link copied'),
              () => toast(`Copy this link: ${link}`),
            )
          }
          className={button}
        >
          <Copy className="h-4 w-4" /> Copy link
        </button>
      ),
    },
    {
      title: 'See what residents see',
      body: 'The public map, as it looks on a phone.',
      action: (
        <button onClick={() => navigate('/')} className={button}>
          Open the map <ArrowRight className="h-4 w-4" />
        </button>
      ),
    },
  ];

  return (
    <section className={card}>
      <div className="border-b border-slate-100 px-4 py-3.5 md:px-5">
        <h2 className="font-semibold">Get the pilot started</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Nothing has been pinned yet. Residents find Problem Pins through your posters and links.
        </p>
      </div>
      <ol>
        {steps.map((s, n) => (
          <li key={s.title} className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-4 md:px-5">
            <span
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600"
            >
              {s.done ? <Check className="h-3.5 w-3.5" /> : n + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{s.title}</p>
              <p className="text-sm text-slate-500">{s.body}</p>
            </div>
            <div className="text-sm">{s.action}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}
