import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import IssueMap from '../components/IssueMap';
import { Poster, PrintPoster, useQrSvg } from '../components/Poster';
import { SampleBadge, fieldClass as field, labelClass, linkClass } from '../components/ui';
import { distanceMeters } from '../data/geo';
import type { AnalyticsEvent, ScanPoint } from '../data/types';
import { downloadText, downloadUrl } from '../lib/csv';
import { formatMeters, nyDate, shortDate } from '../lib/format';
import { displayLink, qrPng, shortLink } from '../lib/qr';
import { isValidCode, loadRetiredCodes, nextFreeCode, normalizeCode, retireCode, usedCodes } from '../lib/scanCodes';
import { useStore } from '../store';

interface Draft {
  code: string;
  name: string;
  detail: string;
  lat: number | null;
  lng: number | null;
  issueId: string;
}

const card = 'rounded-xl border border-slate-200 bg-white';
const optional = 'font-normal text-slate-500';
const button = 'flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium hover:border-slate-300';
const primary = 'flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark';

const WHERE_TO_POST =
  'Post where you have permission: noticeboards, library and community-center entrances, lobbies, shop windows. The City doesn’t allow posters on lamp posts, trees, bus shelters or benches.';

/** One QR poster per spot: make it, print it, and see how many scans each spot gets. */
export default function QrPosters() {
  const store = useStore();
  const { scanPoints, district } = store;
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [retired, setRetired] = useState(loadRetiredCodes);
  const [selected, setSelected] = useState<string | null>(null);
  const [printing, setPrinting] = useState<ScanPoint | null>(null);
  const stopPrinting = useCallback(() => setPrinting(null), []);
  const panel = useRef<HTMLDivElement>(null);
  /** Picks a poster or the new-poster form. Below `xl` the panel sits under the list, so it is scrolled into view. */
  const show = (code: string) => {
    setSelected(code);
    if (!window.matchMedia('(min-width: 1280px)').matches)
      requestAnimationFrame(() => panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  useEffect(() => {
    void store.listEvents().then(setEvents);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const used = useMemo(() => usedCodes(scanPoints, events, retired), [scanPoints, events, retired]);
  const scans = useMemo(() => {
    const byCode = new Map<string, { count: number; last: string | null }>();
    for (const e of events) {
      if (e.name !== 'scan_view' || e.props?.src !== 'qr' || !e.scanCode) continue;
      const s = byCode.get(e.scanCode) ?? { count: 0, last: null };
      s.count += 1;
      s.last = !s.last || e.at > s.last ? e.at : s.last;
      byCode.set(e.scanCode, s);
    }
    return byCode;
  }, [events]);

  const adding = selected === 'new';
  // Nothing picked, or the picked poster is gone: show the first one.
  const point = adding ? undefined : (scanPoints.find((p) => p.code === selected) ?? scanPoints[0]);
  const totalScans = scanPoints.reduce((n, p) => n + (scans.get(p.code)?.count ?? 0), 0);

  return (
    <div className="mx-auto max-w-[1000px] space-y-5 px-4 py-5 md:px-8 md:py-7 xl:max-w-[1180px]">
      <header>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold md:text-2xl">
            QR posters
            {scanPoints.length > 0 && <span className="ml-2 text-base font-medium tabular-nums text-slate-500">{scanPoints.length}</span>}
          </h1>
          <div className="flex items-center gap-3">
            <SampleBadge />
            {/* Orange only while it is the one thing to do here. */}
            <button onClick={() => show('new')} className={`${scanPoints.length || adding ? button : primary} whitespace-nowrap`}>
              <Plus className="h-4 w-4" /> New poster
            </button>
          </div>
        </div>
        <p className="mt-1 max-w-xl text-sm text-slate-500">Each poster has its own code, so you can see which spots bring people in.</p>
      </header>

      {/* The list is the narrow column, as on Issues; the poster and its form get the room. */}
      <div className={`grid items-start gap-5 ${adding || point ? 'xl:grid-cols-[340px_minmax(0,1fr)]' : ''}`}>
        <div className={`${card} min-w-0 overflow-hidden`}>
          {scanPoints.length === 0 ? (
            <div className="px-4 py-10 text-center md:px-5">
              <p className="font-semibold">No posters yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                Make one for each spot where you have permission to post: a noticeboard, a library entrance, a shop window.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className={`${labelClass} border-b border-slate-100 text-left`}>
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="py-2 font-medium">Where</th>
                  <th className="whitespace-nowrap px-4 py-2 text-right font-medium">QR scans</th>
                </tr>
              </thead>
              <tbody>
                {scanPoints.map((p) => {
                  const s = scans.get(p.code);
                  return (
                    // A table row can't be a real button, so it is given a button's role and keys.
                    <tr
                      key={p.code}
                      role="button"
                      tabIndex={0}
                      aria-current={p === point ? 'true' : undefined}
                      onClick={() => show(p.code)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        show(p.code);
                      }}
                      className={`cursor-pointer border-b border-slate-100 -outline-offset-2 last:border-0 ${p === point ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 align-top font-mono text-xs leading-5">{p.code}</td>
                      <td className="py-3">
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-slate-500">{p.detail}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right align-top">
                        <p className="font-semibold tabular-nums">{s?.count ?? 0}</p>
                        <p className="whitespace-nowrap text-xs text-slate-500">{s?.last ? `last ${shortDate(nyDate(s.last))}` : 'none yet'}</p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* With one poster the total is the number in its row. */}
              {scanPoints.length > 1 && (
                <tfoot>
                  <tr className="border-t border-slate-200 text-slate-500">
                    <td className="px-4 py-2.5" />
                    <td className="py-2.5">All posters</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">{totalScans}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>

        {adding ? (
          <aside ref={panel} className={`${card} min-w-0 scroll-mt-4 p-4 md:p-5`}>
            <div className="max-w-md">
              <Editor key="new" used={used} onSaved={setSelected} onCancel={() => setSelected(null)} />
            </div>
          </aside>
        ) : point ? (
          // The poster beside its form; the poster above it where there isn't room for both.
          <aside ref={panel} className={`${card} min-w-0 scroll-mt-4 lg:grid lg:grid-cols-2`}>
            <div className="min-w-0 p-4 md:p-5">
              <PosterPanel point={point} onPrint={() => setPrinting(point)} />
            </div>
            <div className="min-w-0 border-t border-slate-100 p-4 md:p-5 lg:border-l lg:border-t-0">
              <Editor
                key={point.code}
                point={point}
                used={used}
                printed={scans.has(point.code)}
                onSaved={(code, old) => {
                  if (old && old !== code) {
                    retireCode(old);
                    setRetired(loadRetiredCodes());
                  }
                  setSelected(code);
                }}
                onDeleted={(code) => {
                  retireCode(code);
                  setRetired(loadRetiredCodes());
                  setSelected(null);
                }}
              />
            </div>
          </aside>
        ) : null}
      </div>

      {printing && <PrintPoster point={printing} district={district} onDone={stopPrinting} />}
    </div>
  );
}

function PosterPanel({ point, onPrint }: { point: ScanPoint; onPrint: () => void }) {
  const { district } = useStore();
  const url = shortLink(point.code);
  const svg = useQrSvg(url);

  // The preview is 40% of true size, or as much as fits where the panel is narrower (phones).
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const el = frame.current!;
    // 816px is 8.5in; 2px is the border around the preview.
    const watch = new ResizeObserver(() => setScale(Math.min(0.4, (el.clientWidth - 2) / 816)));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  return (
    <div ref={frame}>
      <p className={labelClass}>Poster · US Letter</p>
      <div className="mx-auto mt-2 w-fit border border-slate-200">
        <Poster point={point} district={district} scale={scale} />
      </div>
      <div className="mt-3 flex justify-center">
        <button onClick={onPrint} className={primary}>
          Print poster
        </button>
      </div>
      <p className="mt-3 text-center text-xs text-slate-500">
        The code opens <span className="font-mono text-ink">{displayLink(url)}</span>
      </p>
      {/* The code on its own, for a newsletter or a flyer. */}
      <p className="mt-1 text-center text-xs text-slate-500">
        Just the QR code:{' '}
        <button onClick={async () => downloadUrl(`problem-pins-${point.code}.png`, await qrPng(url))} className={linkClass}>
          PNG
        </button>{' '}
        ·{' '}
        <button disabled={!svg} onClick={() => svg && downloadText(`problem-pins-${point.code}.svg`, svg, 'image/svg+xml')} className={linkClass}>
          SVG
        </button>
      </p>
      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">{WHERE_TO_POST}</p>
    </div>
  );
}

function Editor({
  point,
  used,
  printed = false,
  onSaved,
  onCancel,
  onDeleted,
}: {
  point?: ScanPoint;
  used: Set<string>;
  /** The code has been scanned, so a poster with it is up somewhere. */
  printed?: boolean;
  onSaved: (code: string, oldCode?: string) => void;
  onCancel?: () => void;
  onDeleted?: (code: string) => void;
}) {
  const store = useStore();
  const { district } = store;
  const [draft, setDraft] = useState<Draft>(() =>
    point
      ? { code: point.code, name: point.name, detail: point.detail, lat: point.lat, lng: point.lng, issueId: point.issueId ?? '' }
      : { code: nextFreeCode(used), name: '', detail: '', lat: null, lng: null, issueId: '' },
  );
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const code = normalizeCode(draft.code);
  const codeChanged = Boolean(point && code !== point.code);
  const codeError = !isValidCode(code)
    ? 'Use letters, numbers and dashes, like Q-14.'
    : code !== point?.code && used.has(code)
      ? `${code} has been used before. Codes are printed, so they are never reused.`
      : null;
  const missing = !draft.name.trim() ? 'Give it a name.' : draft.lat === null ? 'Pick its location on the map.' : null;
  // Nothing to save until something differs from the saved poster.
  const changed =
    !point ||
    codeChanged ||
    draft.name.trim() !== point.name ||
    draft.detail.trim() !== point.detail ||
    draft.lat !== point.lat ||
    draft.lng !== point.lng ||
    draft.issueId !== (point.issueId ?? '');
  const pick = draft.lat !== null && draft.lng !== null ? { lat: draft.lat, lng: draft.lng } : null;
  const mapCenter = useMemo(() => (point ? { lat: point.lat, lng: point.lng } : undefined), [point]);

  const nearby = useMemo(() => {
    const list = store.issues.map((i) => ({ issue: i, d: pick ? distanceMeters(pick, i) : null }));
    return pick ? list.sort((a, b) => a.d! - b.d!) : list.sort((a, b) => b.issue.votes - a.issue.votes);
  }, [store.issues, pick?.lat, pick?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (codeError || missing || !pick) return;
    if (
      codeChanged &&
      !window.confirm(
        `Change ${point!.code} to ${code}?\n\nPosters already printed with ${point!.code} will stop working, and ${point!.code} won't be used again. Reprint the poster after saving.`,
      )
    )
      return;
    setBusy(true);
    const next: ScanPoint = {
      code,
      name: draft.name.trim(),
      detail: draft.detail.trim(),
      lat: pick.lat,
      lng: pick.lng,
      ...(draft.issueId ? { issueId: draft.issueId } : {}),
    };
    let ok = await store.saveScanPoint(next);
    if (ok && codeChanged) ok = await store.deleteScanPoint(point!.code);
    setBusy(false);
    if (!ok) return;
    store.toast(point ? `Saved ${code}` : `Added ${code}`);
    onSaved(code, point?.code);
  };

  const remove = async () => {
    if (!point) return;
    if (
      !window.confirm(
        `Delete ${point.code}, ${point.name}?\n\nAnyone who scans a poster with this code will see “This code isn’t active”. Take the posters down. ${point.code} won't be used again.`,
      )
    )
      return;
    if (await store.deleteScanPoint(point.code)) {
      store.toast(`Deleted ${point.code}`);
      onDeleted?.(point.code);
    }
  };

  return (
    <div className="space-y-3">
      <p className={labelClass}>{point ? 'Edit poster' : 'New poster'}</p>
      <label className="block text-sm font-medium">
        Name
        <input
          className={field}
          value={draft.name}
          placeholder="e.g. Library entrance, W 23rd St"
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <label className="block text-sm font-medium">
        Detail <span className={optional}>(optional)</span>
        <input
          className={field}
          value={draft.detail}
          placeholder="e.g. Between 7th and 8th Ave"
          onChange={(e) => set({ detail: e.target.value })}
        />
      </label>
      {/* For a poster that exists this sits under its preview, next to Print. */}
      {!point && <p className="text-xs text-slate-500">{WHERE_TO_POST}</p>}

      <div>
        <p className="text-sm font-medium">
          Location <span className={optional}>(pick it on the map)</span>
        </p>
        <div className="mt-1 h-52 overflow-hidden rounded-lg border border-slate-200 [&_.leaflet-control-attribution]:text-[10px] [&_.leaflet-control-attribution]:leading-[1.5]">
          <IssueMap issues={[]} center={mapCenter} zoom={district.zoom} pick={pick} onPick={(p) => set({ lat: p.lat, lng: p.lng })} zoomControl />
        </div>
      </div>

      <label className="block text-sm font-medium">
        Linked issue <span className={optional}>(optional)</span>
        <select className={field} value={draft.issueId} onChange={(e) => set({ issueId: e.target.value })}>
          <option value="">None: the scan page asks what’s wrong</option>
          {draft.issueId && !nearby.some((n) => n.issue.id === draft.issueId) && <option value={draft.issueId}>{draft.issueId}</option>}
          {nearby.map(({ issue, d }) => (
            <option key={issue.id} value={issue.id}>
              {issue.id} · {issue.title}
              {d !== null ? ` · ${formatMeters(d)}` : ''}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs font-normal text-slate-500">
          Shown first on the scan page so people +1 it instead of pinning it again.
        </span>
      </label>

      {/* Last, because it is the one field that is rarely touched: a new poster gets the next free code, and changing a printed one breaks it. */}
      <label className="block w-28 text-sm font-medium">
        Code
        <input className={`${field} font-mono`} value={draft.code} onChange={(e) => set({ code: e.target.value })} />
      </label>
      {codeError && <p className="text-xs text-red-800">{codeError}</p>}
      {!codeError && !codeChanged && (
        <p className="text-xs text-slate-500">
          {point ? 'Printed on the poster. Changing it breaks the posters that are already up.' : 'Printed on the poster. This is the next free one.'}
        </p>
      )}
      {!codeError && codeChanged && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {printed ? `${point!.code} has been scanned, so posters with it are up.` : `${point!.code} may already be printed.`} Changing
          the code breaks those posters; {point!.code} will be retired.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          onClick={save}
          disabled={busy || !changed || Boolean(codeError || missing)}
          className={`rounded-lg px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-40 ${
            point ? 'bg-ink hover:bg-ink/90' : 'bg-brand hover:bg-brand-dark'
          }`}
        >
          {point ? (codeChanged ? `Save and retire ${point.code}` : 'Save changes') : `Add ${code || 'poster'}`}
        </button>
        {onCancel && (
          <button onClick={onCancel} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium hover:border-slate-300">
            Cancel
          </button>
        )}
        {point && (
          <button onClick={remove} className="ml-auto flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-ink">
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        )}
      </div>
      {missing && !codeError && <p className="text-xs text-slate-500">{missing}</p>}
    </div>
  );
}
