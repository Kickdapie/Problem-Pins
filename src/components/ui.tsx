import { Accessibility, Armchair, CircleHelp, Lightbulb, Trash2, Volume2, type LucideIcon } from 'lucide-react';
import markUrl from '../../brand/mark.svg';
import { isDemo } from '../config';
import { CATEGORIES, STATUSES } from '../data/meta';
import type { Category, Issue, Status } from '../data/types';
import { useStore } from '../store';

export const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  lighting: Lightbulb,
  seating: Armchair,
  accessibility: Accessibility,
  litter: Trash2,
  noise: Volume2,
  other: CircleHelp,
};

/** A section label, table column header or page eyebrow. */
export const labelClass = 'text-xs font-medium text-slate-500';
/** A plain text link. Orange is kept for the one thing to act on. */
export const linkClass = 'font-medium text-ink underline decoration-slate-300 underline-offset-2 hover:decoration-ink';
/** A text field. The focus ring comes from `index.css`. */
export const fieldClass = 'mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm';
/** A box around an icon and a bare input (`outline-none`), which shows the focus ring for it. */
export const fieldBoxClass =
  'flex items-center gap-2 rounded-lg border border-slate-200 px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink';

export function Logo({ dark = false, size = 'md' }: { dark?: boolean; size?: 'sm' | 'md' }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src={markUrl} alt="" className={size === 'sm' ? 'h-6' : 'h-7'} />
      <span className={`font-semibold ${dark ? 'text-white' : 'text-ink'}`}>Problem Pins</span>
    </div>
  );
}

/** Icon and label. Categories have no color of their own: color means status. */
export function CategoryTag({ category, className = '' }: { category: Category; className?: string }) {
  const Icon = CATEGORY_ICONS[category];
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Icon className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
      {CATEGORIES[category].label}
    </span>
  );
}

export function StatusTag({ status, resident = false, className = '' }: { status: Status; resident?: boolean; className?: string }) {
  const meta = STATUSES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: meta.color }} />
      {resident ? meta.residentLabel : meta.label}
    </span>
  );
}

/** Marks screens that show sample data. Renders nothing in live mode. */
export function SampleBadge() {
  if (!isDemo) return null;
  return <span className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600">Sample data</span>;
}

export function PhotoThumb({ issue, className = '', index = 0 }: { issue: Issue; className?: string; index?: number }) {
  const photo = issue.photos[index];
  if (photo) return <img src={photo} alt="" className={`object-cover ${className}`} />;
  const Icon = CATEGORY_ICONS[issue.category];
  return (
    <div className={`grid place-items-center bg-slate-100 ${className}`} aria-label={`${CATEGORIES[issue.category].label}, no photo`}>
      <Icon className="h-1/3 max-h-12 w-1/3 max-w-12 text-slate-400" strokeWidth={1.5} />
    </div>
  );
}

export function Toast() {
  const { toastMessage } = useStore();
  if (!toastMessage) return null;
  return (
    // A screen with a bar at the bottom (issue detail's +1) sets --toast-offset to keep it clear.
    <div className="pointer-events-none fixed inset-x-0 bottom-[var(--toast-offset,1.5rem)] z-[2000] flex justify-center px-4 print:hidden">
      <div className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white shadow-lg">{toastMessage}</div>
    </div>
  );
}
