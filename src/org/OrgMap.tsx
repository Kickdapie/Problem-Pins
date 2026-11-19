import { useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import IssueMap from '../components/IssueMap';
import { CategoryTag, SampleBadge, StatusTag, labelClass, linkClass } from '../components/ui';
import { STATUS_ORDER } from '../data/meta';
import type { Category, Status } from '../data/types';
import { daysBetween, plural, shortDate, today } from '../lib/format';
import { navigate } from '../router';
import { useStore } from '../store';
import { TodoAction } from './actions';
import { todoFor, todoHeadline } from './dashboard';
import { cityWait } from './issueList';
import { useMediaQuery } from './useMediaQuery';

const AGE_OPTIONS = [
  { label: 'Any', days: 0 },
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
];

const OPEN_STATUSES: Status[] = ['open', 'in_review', 'scheduled', 'sent_to_city'];

/** `issueId` comes from the URL (`#/org/map?issue=PP-2402`, the link on an issue's page): that issue opens selected and centered. */
export default function OrgMap({ issueId }: { issueId?: string | null }) {
  const { issues, district } = useStore();
  const linked = issueId ? issues.find((i) => i.id === issueId) : undefined;
  const [categories, setCategories] = useState<Category[]>(district.categories);
  const [statuses, setStatuses] = useState<Status[]>(OPEN_STATUSES);
  const [minAge, setMinAge] = useState(0);
  const [sizeByVotes, setSizeByVotes] = useState(true);
  const [onlyTodo, setOnlyTodo] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Arriving from an issue's page: select it, and show its status even if the filters leave it out (a fixed one).
  const linkedId = linked?.id;
  const linkedStatus = linked?.status;
  useEffect(() => {
    if (!linkedId || !linkedStatus) return;
    setSelectedId(linkedId);
    setStatuses((s) => (s.includes(linkedStatus) ? s : [...s, linkedStatus]));
  }, [linkedId, linkedStatus]);
  const center = useMemo(() => (linked ? { lat: linked.lat, lng: linked.lng } : undefined), [linked?.lat, linked?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  // Below 1024px an always-open filter panel would cover the issue card and much of the map, so
  // there it opens on demand, as on phones. Picking a pin closes it.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Phones pinch to zoom (+/- buttons would sit under the issue card). Elsewhere the buttons go
  // bottom right, since the filters take the top left.
  const wide = useMediaQuery('(min-width: 768px)');

  const now = today();
  // "What needs me, and where": the same issues as the Overview's to-do list.
  const onTodoList = useMemo(
    () => new Set(issues.filter((i) => todoFor(i, district.rules, now)).map((i) => i.id)),
    [issues, district.rules, now],
  );
  const visible = issues.filter(
    (i) =>
      categories.includes(i.category) &&
      daysBetween(i.createdAt) >= minAge &&
      // The to-do list decides on its own which statuses belong (a fixed issue neighbors dispute is on it),
      // so with it on, the status boxes don't hide anything from it.
      (onlyTodo ? onTodoList.has(i.id) : statuses.includes(i.status)),
  );
  const selected = visible.find((i) => i.id === selectedId);
  // The filter panel is always open from 1024px, so the district is framed clear of it.
  const panelOpen = useMediaQuery('(min-width: 1024px)');
  const todo = selected ? todoFor(selected, district.rules, now) : null;
  const withCity = Boolean(selected?.cityRequest && selected.status === 'sent_to_city');

  const toggle = <T,>(list: T[], value: T, set: (v: T[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const filterRow = 'flex cursor-pointer items-center gap-2 py-1';
  const count = 'ml-auto text-xs text-slate-500';

  return (
    // `district-map` (index.css): a paler base map, and no seams between tiles at a between-levels zoom.
    <div className="district-map relative h-full">
      <IssueMap
        issues={visible}
        selectedId={selectedId}
        onSelect={(i) => {
          setSelectedId(i.id);
          setFiltersOpen(false);
        }}
        center={center}
        zoom={center ? 17 : undefined}
        fit={{ topLeft: panelOpen ? [290, 24] : [24, 64], bottomRight: [24, 40] }}
        sizeByVotes={sizeByVotes}
        zoomControl={wide}
        zoomPosition="bottomright"
      />

      <button
        onClick={() => setFiltersOpen(true)}
        className={`absolute left-3 top-3 z-[1000] flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium shadow-sm lg:hidden ${
          filtersOpen ? 'hidden' : ''
        }`}
      >
        <SlidersHorizontal className="h-4 w-4" /> Filters · {visible.length}
      </button>

      <div
        className={`absolute inset-x-3 top-3 z-[1001] max-h-[calc(100%-1.5rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white text-sm shadow-lg md:inset-x-auto md:left-4 md:top-4 md:w-[250px] lg:block ${
          filtersOpen ? '' : 'hidden'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="font-semibold">
            Filters <span className="ml-1 text-xs font-normal text-slate-500">{visible.length} shown</span>
          </h2>
          <button
            className={`${linkClass} ml-auto mr-3 lg:mr-0`}
            onClick={() => {
              setCategories(district.categories);
              setStatuses(OPEN_STATUSES);
              setOnlyTodo(false);
              setMinAge(0);
            }}
          >
            Reset
          </button>
          <button onClick={() => setFiltersOpen(false)} aria-label="Close filters" className="lg:hidden">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b border-slate-100 px-4 py-3">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={onlyTodo} onChange={(e) => setOnlyTodo(e.target.checked)} className="accent-ink" />
            Only the to-do list
            <span className={count}>{onTodoList.size}</span>
          </label>
        </div>
        <div className="border-b border-slate-100 px-4 py-3">
          <p className={`${labelClass} mb-1.5`}>Category</p>
          {district.categories.map((c) => (
            <label key={c} className={filterRow}>
              <input type="checkbox" checked={categories.includes(c)} onChange={() => toggle(categories, c, setCategories)} className="accent-ink" />
              <CategoryTag category={c} className={categories.includes(c) ? '' : 'text-slate-500'} />
              <span className={count}>{issues.filter((i) => i.category === c).length}</span>
            </label>
          ))}
        </div>
        <div className="border-b border-slate-100 px-4 py-3">
          <p className={`${labelClass} mb-1.5`}>Status</p>
          {STATUS_ORDER.map((s) => (
            <label key={s} className={filterRow}>
              <input type="checkbox" checked={statuses.includes(s)} onChange={() => toggle(statuses, s, setStatuses)} className="accent-ink" />
              <StatusTag status={s} className={statuses.includes(s) ? '' : 'text-slate-500'} />
              <span className={count}>{issues.filter((i) => i.status === s).length}</span>
            </label>
          ))}
        </div>
        <div className="px-4 py-3">
          <p className={`${labelClass} mb-2`}>Open longer than</p>
          <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs">
            {AGE_OPTIONS.map((o) => (
              <button
                key={o.label}
                onClick={() => setMinAge(o.days)}
                aria-pressed={minAge === o.days}
                className={`flex-1 rounded-md py-1.5 ${minAge === o.days ? 'bg-white font-medium shadow-sm' : 'text-slate-600'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <label className="mt-3 flex cursor-pointer items-center justify-between">
            Size dots by neighbors
            <input type="checkbox" checked={sizeByVotes} onChange={(e) => setSizeByVotes(e.target.checked)} className="accent-ink" />
          </label>
        </div>
      </div>

      <div className="absolute right-3 top-3 z-[1000] flex items-center gap-3 md:right-4 md:top-4">
        <SampleBadge />
      </div>

      {selected && (
        <div className="absolute inset-x-3 bottom-3 z-[1000] rounded-xl border border-slate-200 bg-white p-4 shadow-xl md:inset-x-auto md:bottom-auto md:right-4 md:top-20 md:w-[320px] lg:w-[360px]">
          <div className={`flex justify-between gap-3 ${labelClass}`}>
            <span>
              <span className="font-mono font-normal">{selected.id}</span> · {selected.locationLabel}
            </span>
            <button onClick={() => setSelectedId(null)} aria-label="Close" className="shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
          <h3 className="mt-1 text-lg font-bold leading-snug">{selected.title}</h3>
          <p className="mt-1 flex gap-3 text-xs">
            <CategoryTag category={selected.category} />
            <StatusTag status={selected.status} />
          </p>
          {/* One line of facts, short enough not to wrap and none of them said again further down: how many
              neighbors, when it was pinned (or fixed), and who has it. The week's change is on the issue page. An agency that has it is named with its 311 request below instead. */}
          <p className="mt-2 text-sm text-slate-600">
            {plural(selected.votes, 'neighbor')} ·{' '}
            {selected.status === 'fixed' ? `fixed ${shortDate(selected.fixedOn ?? selected.createdAt)}` : `pinned ${shortDate(selected.createdAt)}`}
            {withCity ? '' : ` · ${selected.owner ?? 'unassigned'}`}
          </p>
          {/* Why it's on the to-do list and for how long, in the Overview's words; or, for an issue with the
              City that isn't due a follow-up yet, how long since the last contact. */}
          {todo ? (
            <div className="mt-3 rounded-lg bg-brand-soft px-3 py-2 text-xs">
              <p className="font-semibold text-brand-dark">{todoHeadline(todo)}</p>
              {/* For an unanswered pin the note is its neighbor count, which the line above already gives. */}
              {todo.kind !== 'new' && <p className="mt-0.5 text-slate-700">{todo.note}</p>}
            </div>
          ) : (
            withCity && (
              <p className="mt-3 text-xs text-slate-600">
                {selected.cityRequest!.agency} · {cityWait(selected.cityRequest!, now)}
              </p>
            )
          )}
          <div className="mt-3 space-y-2">
            {todo?.kind === 'city' && <TodoAction item={todo} block />}
            <button
              onClick={() => navigate(`/org/issues/${selected.id}`)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:border-slate-300"
            >
              Open issue
            </button>
          </div>
        </div>
      )}

      {/* The key to the colors, only where the filter panel (which shows the same ones) isn't always open. */}
      <div className="absolute bottom-4 left-4 z-[1000] hidden gap-4 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs shadow-sm md:flex lg:hidden">
        {STATUS_ORDER.map((s) => (
          <StatusTag key={s} status={s} />
        ))}
      </div>
    </div>
  );
}
