import { Fragment, useMemo } from 'react';
import { FileSpreadsheet, Printer } from 'lucide-react';
import { SampleBadge, labelClass, linkClass } from '../components/ui';
import { isDemo } from '../config';
import { CATEGORIES, STATUSES } from '../data/meta';
import type { Issue } from '../data/types';
import { downloadText, toCsv } from '../lib/csv';
import { EXPERIMENT_THRESHOLDS } from '../lib/experimentSettings';
import { daysBetween, plural, shortDate, today } from '../lib/format';
import { OPEN_LONG_DAYS, checkThreshold, monthLabel, monthOf, monthReport, reportMonths, shiftMonth, waitingByAgency } from '../lib/metrics';
import { navigate } from '../router';
import { useStore } from '../store';
import { cityFigures } from './dashboard';

const control = 'flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm';
// Category bars are one neutral color: color means status.
const bar = 'h-4 rounded bg-slate-400';
// A section of the sheet. A document's sections are headings, not field labels.
const heading = 'text-base font-semibold';
// The sheet's side padding, and the margin that lets a band of it run edge to edge on screen.
const gutter = 'px-5 md:px-8 print:px-3';
const bleed = '-mx-5 md:-mx-8 print:mx-0';

function exportIssuesCsv(issues: Issue[]) {
  const rows = [...issues]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((i) => [
      i.id,
      i.title,
      CATEGORIES[i.category].label,
      STATUSES[i.status].label,
      i.votes,
      i.createdAt,
      i.fixedOn ?? '',
      [i.locationLabel, i.locationDetail].filter(Boolean).join(', '),
      i.owner ?? '',
      i.cityRequest?.sr ?? '',
    ]);
  downloadText(
    `problem-pins-issues-${today()}.csv`,
    toCsv(['id', 'title', 'category', 'status', 'neighbors', 'created', 'fixed', 'location', 'owner', '311 SR'], rows),
  );
}

/**
 * The monthly report: what the District Manager reads out at the board's monthly meeting and takes
 * to the District Service Cabinet. A document first, so it is laid out to print.
 */
/** `month` comes from the URL (`#/org/reports?month=2026-09`); anything else means the current month. */
export default function Reports({ month: wanted }: { month?: string | null }) {
  const { issues, hiddenIssues, district } = useStore();
  const now = today();
  const allIssues = useMemo(() => [...issues, ...hiddenIssues], [issues, hiddenIssues]);
  const months = useMemo(() => reportMonths(allIssues, now), [allIssues, now]);
  const month = wanted && months.includes(wanted) ? wanted : monthOf(now);
  const setMonth = (m: string) => navigate(m === monthOf(now) ? '/org/reports' : `/org/reports?month=${m}`);

  const r = monthReport(allIssues, month, now, district.categories);
  const name = monthLabel(month).split(' ')[0];
  const prevName = monthLabel(shiftMonth(month, -1)).split(' ')[0];
  const fixTarget = EXPERIMENT_THRESHOLDS.daysToFix.value;
  const fixResult = checkThreshold(r.medianDaysToFix, EXPERIMENT_THRESHOLDS.daysToFix);

  // Always as of today, whichever month is selected.
  const agencies = waitingByAgency(issues, now);
  const listed = agencies.reduce((n, a) => n + a.rows.length, 0);
  // The same count as the Overview and the sidebar: filed with 311 and still waiting.
  const waiting = cityFigures(issues, now).count;
  const notFiled = listed - waiting;
  const quotes = issues
    .flatMap((i) => i.updates.filter((u) => u.role === 'resident' && !u.mine && !u.hidden && monthOf(u.date) === month).map((u) => ({ u, i })))
    .slice(0, 2);

  // A median of whole days is a whole number or a half.
  const dayCount = (d: number) => (Number.isInteger(d) ? String(d) : d.toFixed(1));
  const figures: [label: string, value: string, note: string, tone?: string][] = [
    ['Problems pinned', String(r.pinned), r.partial ? `${r.pinnedPrev} in all of ${prevName}` : `${r.pinnedPrev} in ${prevName}`],
    ['Fixed', String(r.fixed), r.fixed === 0 ? '' : `${r.confirmed === r.fixed ? (r.fixed === 1 ? 'confirmed' : 'all confirmed') : `${r.confirmed} confirmed`} by residents`],
    [
      'Median days to fix',
      r.medianDaysToFix === null ? '—' : dayCount(r.medianDaysToFix),
      r.medianDaysToFix === null ? `nothing fixed${r.partial ? ' yet' : ''}` : fixTarget === null ? 'from pinned to marked fixed' : `target ${plural(fixTarget, 'day')}`,
      fixResult === 'misses' ? 'text-brand-dark' : undefined,
    ],
    // The backlog, which the month's pins and fixes alone don't show.
    [
      r.partial ? 'Still open today' : `Still open on ${shortDate(r.through)}`,
      String(r.open),
      r.open === 0 ? '' : r.openLong === 0 ? `none older than ${OPEN_LONG_DAYS} days` : `${r.openLong} older than ${OPEN_LONG_DAYS} days`,
    ],
  ];

  // One row per category that had a pin or a fix, most pins first.
  const rows = r.byCategory.filter((c) => c.pinned > 0 || c.fixed > 0).sort((a, b) => b.pinned - a.pinned);
  const maxPins = Math.max(1, ...rows.map((c) => c.pinned));
  const anyFixed = rows.some((c) => c.fixed > 0);

  return (
    <div className="pp-report mx-auto max-w-[1000px] space-y-5 px-4 py-5 md:px-8 md:py-7 print:p-0">
      {/* The app shell scrolls inside a box one screen high, which would print one page and cut the rest. */}
      <style>{`@media print {
        html, body, #root, #root :has(.pp-report) { display: block !important; height: auto !important; overflow: visible !important; background: white !important; }
      }`}</style>

      <header className="flex flex-wrap items-end justify-between gap-x-4">
        <div className="min-w-0">
          <p className={labelClass}>Monthly report</p>
          <h1 className="text-xl font-bold md:text-2xl">{monthLabel(month)}</h1>
        </div>
        <p className="w-full text-sm text-slate-600 xl:order-last">
          {district.name} · {r.partial ? `month in progress, figures up to ${shortDate(r.through)}` : `${shortDate(`${month}-01`)} to ${shortDate(r.through)}`}
        </p>
        <div className="mt-3 flex w-full flex-wrap items-center gap-2 xl:mt-0 xl:w-auto print:hidden">
          <SampleBadge />
          <select
            aria-label="Report month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium hover:border-slate-300 sm:flex-none"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <button
            onClick={() => exportIssuesCsv(allIssues.filter((i) => !i.hidden))}
            className={`${control} border-slate-200 bg-white font-medium hover:border-slate-300`}
            title="Every issue, all months (hidden ones left out)"
          >
            <FileSpreadsheet className="h-4 w-4" /> Issues CSV
          </button>
          <button
            onClick={() => window.print()}
            className={`${control} flex-1 border-brand bg-brand font-semibold text-white hover:bg-brand-dark sm:flex-none`}
          >
            <Printer className="h-4 w-4" /> Print or save PDF
          </button>
        </div>
      </header>

      <article
        className="overflow-hidden rounded-xl border border-slate-200 bg-white p-5 md:p-8 print:overflow-visible print:border-0 print:p-0"
        style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
      >
        <div
          className={`${bleed} -mt-5 grid break-inside-avoid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 md:-mt-8 lg:grid-cols-4 print:mt-0 print:grid-cols-4 print:border-t`}
        >
          {figures.map(([label, value, note, tone = 'text-slate-500']) => (
            <div key={label} className={`${gutter} bg-white py-4`}>
              <p className={labelClass}>{label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums md:text-3xl">{value}</p>
              <p className={`mt-1 min-h-4 text-xs ${tone}`}>{note}</p>
            </div>
          ))}
        </div>

        <section className="mt-6 md:mt-8">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className={heading}>Waiting on the City</h2>
            <p className="text-sm text-slate-500">
              {[`as of ${shortDate(now)}`, waiting ? `${waiting} filed with 311` : '', notFiled ? `${notFiled} not filed yet` : ''].filter(Boolean).join(' · ')}
            </p>
          </div>
          {listed === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Nothing is waiting on the City.</p>
          ) : (
            <div className={`${bleed} mt-3 border-t border-slate-100`}>
              {agencies.map((a) => (
                <div key={a.agency} className="break-inside-avoid">
                  <div className={`${gutter} flex items-baseline gap-x-2 border-b border-slate-100 bg-slate-50 py-2`}>
                    <h3 className="text-sm font-semibold">{a.agency}</h3>
                    <span className="text-xs text-slate-500">{a.rows.length}</span>
                  </div>
                  {a.rows.map(({ issue: i, days }) => {
                    const req = i.cityRequest;
                    // Orange by the to-do list's rule: no contact with the City for `cityNoReplyDays` or more.
                    const late = req && daysBetween(req.lastFollowUp ?? req.sentOn, now) >= district.rules.cityNoReplyDays;
                    const tone = late ? 'text-brand-dark' : '';
                    // The City's wait starts when the request is filed, so an unfiled one has none to show.
                    const wait = req ? plural(days, 'day') : 'Not filed';
                    const facts = req
                      ? [
                          <span className="font-mono text-xs">SR {req.sr}</span>,
                          plural(i.votes, 'neighbor'),
                          `sent ${shortDate(req.sentOn)}, ${req.lastFollowUp ? `last follow-up ${shortDate(req.lastFollowUp)}` : 'no follow-up yet'}`,
                        ]
                      : [plural(i.votes, 'neighbor'), `pinned ${shortDate(i.createdAt)}`];
                    return (
                      <a
                        key={i.id}
                        href={`#/org/issues/${i.id}`}
                        className={`${gutter} flex flex-col border-b border-slate-100 py-3 -outline-offset-2 hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-4 print:py-2`}
                      >
                        <div className="min-w-0 flex-1">
                          <p>
                            <span className="mr-2 font-mono text-xs text-slate-500">{i.id}</span>
                            <span className="font-semibold">{i.title}</span>
                          </p>
                          <p className={`text-sm font-semibold sm:hidden ${req ? tone : 'text-slate-500'}`}>{req ? `Waiting ${wait}` : 'Not filed with 311 yet'}</p>
                          <p className="mt-0.5 text-sm text-slate-500">
                            {facts.map((fact, n) => (
                              <Fragment key={n}>
                                <span className="whitespace-nowrap">
                                  {fact}
                                  {n < facts.length - 1 && ' ·'}
                                </span>{' '}
                              </Fragment>
                            ))}
                          </p>
                        </div>
                        <p className={`hidden w-[72px] shrink-0 text-right text-sm tabular-nums sm:block ${req ? `font-semibold ${tone}` : 'text-slate-500'}`}>{wait}</p>
                      </a>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="mt-6 grid break-inside-avoid gap-8 md:mt-8 lg:grid-cols-[1fr_300px] lg:gap-10 print:grid-cols-[1fr_240px]">
          <section>
            <h2 className={heading}>By category</h2>
            {rows.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No pins in {name}.</p>
            ) : (
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className={`${labelClass} text-right [&>th]:pb-1.5 [&>th]:align-bottom [&>th]:font-medium`}>
                    <th className="w-24 text-left sm:w-28">
                      <span className="sr-only">Category</span>
                    </th>
                    <th className="text-left">Pinned</th>
                    {anyFixed && (
                      <>
                        <th className="w-12 sm:w-14">Fixed</th>
                        <th className="w-[4.5rem] sm:w-24">Median days</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.category} className="[&>td]:py-1">
                      <td>{CATEGORIES[c.category].label}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          {c.pinned > 0 && <div className={bar} style={{ width: `calc((100% - 2rem) * ${c.pinned / maxPins})` }} />}
                          <span className="tabular-nums">{c.pinned}</span>
                        </div>
                      </td>
                      {anyFixed && (
                        <>
                          <td className="text-right tabular-nums">{c.fixed || <span className="text-slate-500">–</span>}</td>
                          <td
                            className={`text-right tabular-nums ${checkThreshold(c.medianDaysToFix, EXPERIMENT_THRESHOLDS.daysToFix) === 'misses' ? 'font-semibold text-brand-dark' : ''}`}
                          >
                            {c.medianDaysToFix === null ? <span className="text-slate-500">–</span> : dayCount(c.medianDaysToFix)}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <h2 className={heading}>In residents’ words</h2>
            {quotes.length === 0 && <p className="mt-2 text-sm text-slate-500">No resident comments in {name}.</p>}
            {quotes.map(({ u, i }) => (
              <blockquote key={u.id} className="mt-3 border-l-2 border-slate-300 pl-3 text-sm">
                “{u.text}”
                <footer className="mt-1 text-xs text-slate-500">
                  <p>
                    On{' '}
                    <a href={`#/org/issues/${i.id}`} className={linkClass}>
                      {i.title}
                    </a>
                  </p>
                  <p>
                    {shortDate(u.date)} · {plural(i.votes, 'neighbor')}
                  </p>
                </footer>
              </blockquote>
            ))}
          </section>
        </div>

        {r.hidden > 0 && (
          <p className="mt-6 text-xs text-slate-500 md:mt-8">
            {plural(r.hidden, 'pin')} that staff hid or the person who pinned {r.hidden === 1 ? 'it' : 'them'} removed {r.hidden === 1 ? 'is' : 'are'} left out of
            these figures.
          </p>
        )}
      </article>

      {isDemo && (
        <p className="text-sm text-slate-500 print:hidden">
          <a href="#/org/experiments" className={linkClass}>
            Experiment results
          </a>
          , for the Problem Pins team
        </p>
      )}
    </div>
  );
}
