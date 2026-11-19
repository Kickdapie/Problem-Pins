import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { SampleBadge, labelClass } from '../components/ui';
import type { AnalyticsEvent } from '../data/types';
import { downloadText, toCsv } from '../lib/csv';
import { EXPERIMENT_THRESHOLDS, type Threshold, type ThresholdKey } from '../lib/experimentSettings';
import { formatHours, plural, shortDate, today } from '../lib/format';
import {
  checkThreshold,
  daysInMonth,
  eventDay,
  eventsInMonth,
  funnelTotals,
  monthLabel,
  monthOf,
  monthReport,
  rate,
  reportMonths,
  residentActivity,
  scanFunnels,
  scansPerWeek,
  staffResponse,
} from '../lib/metrics';
import { useStore } from '../store';

const control = 'flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium hover:border-slate-300';

function pct(r: number | null) {
  return r === null ? '—' : `${Math.round(r * 100)}%`;
}

/**
 * The Problem Pins team's own readout of the experiments: the QR funnel, response time and the
 * thresholds the team set. District staff don't need it, so it has no sidebar entry and lives
 * at `#/org/experiments`.
 */
export default function Experiments() {
  const { issues, hiddenIssues, district, scanPoints, listEvents } = useStore();
  const now = today();
  const allIssues = useMemo(() => [...issues, ...hiddenIssues], [issues, hiddenIssues]);
  const months = useMemo(() => reportMonths(allIssues, now), [allIssues, now]);
  const [month, setMonth] = useState(monthOf(now));
  const [scope, setScope] = useState<'month' | 'all'>('month');
  const [loaded, setLoaded] = useState<AnalyticsEvent[] | null>(null);

  useEffect(() => {
    void listEvents().then(setLoaded);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const events = loaded ?? [];
  const name = monthLabel(month).split(' ')[0];
  const medianDaysToFix = monthReport(allIssues, month, now, district.categories).medianDaysToFix;
  const windowEvents = scope === 'month' ? eventsInMonth(events, month) : events;
  const from = scope === 'month' ? `${month}-01` : events.length ? eventDay(events[0]) : now;
  const to = scope === 'month' && monthOf(now) !== month ? `${month}-${daysInMonth(month)}` : now;
  const rows = scanFunnels(windowEvents, scanPoints);
  const totals = funnelTotals(rows);
  const activity = residentActivity(windowEvents);
  const response = staffResponse(windowEvents, events);
  const weekly = rows.filter((x) => scanPoints.some((p) => p.code === x.code)).map((x) => scansPerWeek(x, from, to));
  const weeklyKnown = weekly.filter((w): w is number => w !== null);
  const r = {
    scanToPinStart: rate(totals.pinStarts, totals.qrScans),
    pinStartToSubmit: rate(totals.pinSubmits, totals.pinStarts),
    scanToVote: rate(totals.votes, totals.qrScans),
  };

  const metricValues: Record<ThresholdKey, { value: number | null; shown: string }> = {
    scanToPinStart: { value: r.scanToPinStart === null ? null : r.scanToPinStart * 100, shown: pct(r.scanToPinStart) },
    pinStartToSubmit: { value: r.pinStartToSubmit === null ? null : r.pinStartToSubmit * 100, shown: pct(r.pinStartToSubmit) },
    scanToVote: { value: r.scanToVote === null ? null : r.scanToVote * 100, shown: pct(r.scanToVote) },
    scansPerPointPerWeek: (() => {
      const v = weeklyKnown.length ? weeklyKnown.reduce((a, b) => a + b, 0) / weeklyKnown.length : null;
      return { value: v, shown: v === null ? '—' : v.toFixed(1) };
    })(),
    staffResponseHours: { value: response.medianHours, shown: formatHours(response.medianHours) },
    daysToFix: { value: medianDaysToFix, shown: medianDaysToFix === null ? '—' : `${medianDaysToFix.toFixed(1)} days (${name})` },
  };

  const exportEvents = () => {
    const keys = [...new Set(events.flatMap((e) => Object.keys(e.props ?? {})))].sort();
    downloadText(
      `problem-pins-events-${now}.csv`,
      toCsv(
        ['at', 'ny_date', 'name', 'issue_id', 'scan_code', ...keys.map((k) => `props.${k}`)],
        events.map((e) => [e.at, eventDay(e), e.name, e.issueId, e.scanCode, ...keys.map((k) => (e.props?.[k] ?? null) as string | number | null)]),
      ),
    );
  };

  const th = 'py-2 font-medium';
  const head = `border-b border-slate-200 text-left ${labelClass}`;
  const tab = (active: boolean) => `h-full rounded-md px-3 text-sm font-medium ${active ? 'bg-white text-ink shadow-sm' : 'text-slate-500'}`;

  return (
    <div className="mx-auto max-w-[1000px] space-y-5 px-4 py-5 md:px-8 md:py-7">
      <header className="flex flex-wrap items-end justify-between gap-x-4">
        <div className="min-w-0">
          <p className={labelClass}>For the Problem Pins team</p>
          <h1 className="text-xl font-bold md:text-2xl">Experiments</h1>
        </div>
        <p className="mt-1 w-full text-sm text-slate-600 xl:order-last">
          <span className="block max-w-[640px]">
            Counted from app events, which carry no identity: these are counts of actions, not of people. A person who scans twice
            counts twice. {scope === 'month' ? `${shortDate(from)} to ${shortDate(to)}.` : `All events, ${shortDate(from)} to ${shortDate(to)}.`}
          </span>
        </p>
        <div className="mt-3 flex w-full flex-wrap items-center gap-2 xl:mt-0 xl:w-auto">
          <SampleBadge />
          <select
            aria-label="Month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium hover:border-slate-300"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <div className="flex h-9 rounded-lg bg-slate-200 p-0.5">
            <button className={tab(scope === 'month')} onClick={() => setScope('month')}>
              {name}
            </button>
            <button className={tab(scope === 'all')} onClick={() => setScope('all')}>
              All time
            </button>
          </div>
          <button onClick={exportEvents} disabled={!loaded} className={`${control} disabled:opacity-50`}>
            <FileSpreadsheet className="h-4 w-4" /> Events CSV
          </button>
        </div>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-5 md:p-8">
        {!loaded ? (
          <p className="text-sm text-slate-500">Loading events…</p>
        ) : (
          <>
            <p className={`${labelClass} mb-2`}>Funnel by poster</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm tabular-nums">
                <thead>
                  <tr className={head}>
                    <th className={th}>Poster</th>
                    <th className={`${th} text-right`}>QR scans</th>
                    <th className={`${th} text-right`}>Pins started</th>
                    <th className={`${th} text-right`}>Submitted</th>
                    <th className={`${th} text-right`}>+1 on scan page</th>
                    <th className={`${th} text-right`}>Scans / week</th>
                    <th className={`${th} text-right`}>Other visits</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-3 text-slate-500">
                        No scan points yet.
                      </td>
                    </tr>
                  )}
                  {rows.map((x) => {
                    const w = scansPerWeek(x, from, to);
                    return (
                      <tr key={x.code} className="border-b border-slate-100">
                        <td className="py-2.5">
                          <span className="font-mono text-xs text-slate-500">{x.code}</span> {x.name ?? <span className="text-slate-500">retired</span>}
                        </td>
                        <td className="py-2.5 text-right font-semibold">{x.qrScans}</td>
                        <Cell n={x.pinStarts} of={x.qrScans} />
                        <Cell n={x.pinSubmits} of={x.pinStarts} />
                        <Cell n={x.votes} of={x.qrScans} />
                        <td className="py-2.5 text-right">{w === null ? '—' : w.toFixed(1)}</td>
                        <td className="py-2.5 text-right text-slate-500">{x.otherVisits}</td>
                      </tr>
                    );
                  })}
                  {rows.length > 1 && (
                    <tr className="font-semibold">
                      <td className="py-2.5">All posters</td>
                      <td className="py-2.5 text-right">{totals.qrScans}</td>
                      <Cell n={totals.pinStarts} of={totals.qrScans} />
                      <Cell n={totals.pinSubmits} of={totals.pinStarts} />
                      <Cell n={totals.votes} of={totals.qrScans} />
                      <td />
                      <td className="py-2.5 text-right text-slate-500">{totals.otherVisits}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Pins started counts every pin opened from a poster’s scan page (QR or shared link). Percentages: started ÷ QR scans,
              submitted ÷ started, +1 ÷ QR scans.
            </p>

            <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:gap-10">
              <div>
                <p className={`${labelClass} mb-2`}>Resident activity</p>
                <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm tabular-nums">
                  {activity.counts.map((c) => (
                    <div key={c.name} className="contents">
                      <dt className="text-slate-600">{c.label}</dt>
                      <dd className="text-right">{c.count}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-xs text-slate-500">
                  Pins started from a poster: {activity.pinStartsFromQr} · from the map: {activity.pinStartsFromMap} ·{' '}
                  {plural(activity.activeDays, 'day')} with activity
                </p>
              </div>
              <div>
                <p className={`${labelClass} mb-2`}>Staff response time</p>
                <p className="text-3xl font-bold">{formatHours(response.medianHours)}</p>
                <p className="text-sm text-slate-600">median from a pin being submitted to the first staff action on it</p>
                <p className="mt-2 text-sm text-slate-600">
                  {plural(response.pins, 'pin')} submitted in this window · {response.responded} with a staff action ·{' '}
                  {response.waiting} still waiting
                </p>
                {response.hours.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    fastest {formatHours(Math.min(...response.hours))} · slowest {formatHours(Math.max(...response.hours))}
                  </p>
                )}
                <p className="mt-2 text-xs text-slate-500">
                  A staff action is any update, status change, assignment, 311 filing, nudge, hide or merge.
                </p>
              </div>
            </div>

            <p className={`${labelClass} mb-2 mt-6`}>Thresholds</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm tabular-nums">
                <thead>
                  <tr className={head}>
                    <th className={th}>Metric</th>
                    <th className={`${th} text-right`}>Now</th>
                    <th className={`${th} text-right`}>Threshold</th>
                    <th className={`${th} text-right`}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.entries(EXPERIMENT_THRESHOLDS) as [ThresholdKey, Threshold][]).map(([key, t]) => {
                    const m = metricValues[key];
                    const result = checkThreshold(m.value, t);
                    return (
                      <tr key={key} className="border-b border-slate-100">
                        <td className="py-2.5">{t.label}</td>
                        <td className="py-2.5 text-right">{m.shown}</td>
                        <td className="py-2.5 text-right">
                          {t.value === null ? (
                            <span className="text-slate-500">set by the team</span>
                          ) : (
                            `${t.direction === 'at_least' ? '≥' : '≤'} ${t.value}${t.unit === 'percent' ? '%' : t.unit === 'count' ? '' : ` ${t.unit}`}`
                          )}
                        </td>
                        <td className={`py-2.5 text-right ${result === 'misses' ? 'font-medium text-brand-dark' : result === 'meets' ? '' : 'text-slate-500'}`}>
                          {result === 'unset' ? '—' : result === 'no_data' ? 'No data' : result === 'meets' ? 'Meets' : 'Misses'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Thresholds live in src/lib/experimentSettings.ts. The team sets each one, with its
              reasoning, before reading the results.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

function Cell({ n, of }: { n: number; of: number }) {
  return (
    <td className="py-2.5 text-right">
      {n} <span className="ml-1 inline-block w-9 text-xs text-slate-500">{pct(rate(n, of))}</span>
    </td>
  );
}
