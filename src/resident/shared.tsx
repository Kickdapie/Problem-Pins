import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CATEGORY_ICONS } from '../components/ui';
import { config, isDemo } from '../config';
import { CATEGORIES } from '../data/meta';
import type { AnalyticsEvent, Category, HistoryEvent, Issue } from '../data/types';
import { navigate } from '../router';
import { useStore } from '../store';

/**
 * The history lines a resident sees. Staff-only lines never reach them; who at the district office
 * holds a problem ("Assigned to …") is for staff too, like the owner on the status card.
 */
export function residentHistory(history: HistoryEvent[]) {
  return history.filter((h) => !h.staffOnly && !/^(Assigned to |Unassigned$)/.test(h.text));
}

/**
 * A line of short facts joined by dots ("In review · 30 m away · pinned Oct 3"). Each fact stays in
 * one piece, so a line that is too long breaks between facts, never inside one. Every fact carries
 * its dot in front; the row is shifted left by one dot and clipped, so a line never starts or ends
 * with a stray dot. Empty facts are skipped.
 */
export function Facts({ parts, className = '' }: { parts: ReactNode[]; className?: string }) {
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== '');
  return (
    <div className={`overflow-hidden ${className}`}>
      <p className="-ml-4 flex flex-wrap items-baseline">
        {shown.map((part, i) => (
          <span key={i} className="max-w-full before:inline-block before:w-4 before:text-center before:content-['·']">
            {part}
          </span>
        ))}
      </p>
    </div>
  );
}

/** A section heading on a resident page: sentence case, darker and larger than a label. */
export const HEADING = 'text-base font-semibold text-ink';
/** A section label: sentence case, never mono or capitals. */
export const LABEL = 'text-xs font-medium text-slate-500';
/** A plain text link. Orange is kept for the one thing to act on. */
export const LINK = 'font-medium text-ink underline decoration-slate-300 underline-offset-2 hover:decoration-ink';
/** A secondary button. */
export const BUTTON = 'rounded-lg border border-slate-300 bg-white font-semibold hover:border-ink';

export function goBack() {
  if (history.length > 1) history.back();
  else navigate('/');
}

/** A category as its icon and label. Categories carry no color. */
export function CategoryLabel({ category, iconClass = 'h-4 w-4 text-slate-500' }: { category: Category; iconClass?: string }) {
  const Icon = CATEGORY_ICONS[category];
  return (
    <>
      <Icon className={`shrink-0 ${iconClass}`} />
      {CATEGORIES[category].label}
    </>
  );
}

/** Copies without the Clipboard API, which browsers refuse outside a focused, secure page. */
function legacyCopy(text: string) {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand('copy');
  el.remove();
  return ok;
}

interface ShareContext {
  toast: (message: string) => void;
  track: (event: Omit<AnalyticsEvent, 'at'>) => void;
}

/**
 * Opens the phone's share sheet, or copies the link where there is none. Counted as a `share`
 * once it went somewhere (a closed share sheet or a failed copy isn't). `source` says which screen.
 */
export async function shareIssue(issue: Issue, { toast, track }: ShareContext, source: 'detail' | 'new_pin') {
  // A sample problem exists only in the demo, so a link shared from the demo has to open the demo.
  const url = `${config.publicUrl}/${isDemo ? '?mode=demo' : ''}#/i/${issue.id}`;
  const shared = (method: 'share_sheet' | 'copy') => track({ name: 'share', issueId: issue.id, props: { source, method } });
  if (navigator.share) {
    try {
      await navigator.share({ title: issue.title, text: `${issue.title}, ${issue.locationLabel}. +1 it if it’s your problem too.`, url });
      shared('share_sheet');
    } catch {
      /* closed the share sheet */
    }
    return;
  }
  let copied = true;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    copied = legacyCopy(url);
  }
  if (copied) shared('copy');
  toast(copied ? 'Link copied' : `Couldn’t copy the link: ${url}`);
}

/**
 * A quiet action that can't be undone, confirmed in place: the first tap asks, the second does it.
 * Focus moves to the confirm button when it asks, and back to the action on Cancel or Escape.
 */
export function ConfirmAction({
  label,
  question,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  className = '',
  linkClassName,
}: {
  label: string;
  question: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => Promise<unknown>;
  className?: string;
  /** The button's classes before it is pressed, instead of a plain link with `className`. */
  linkClassName?: string;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (asking) confirmButton.current?.focus();
    else if (asked.current) action.current?.focus();
    asked.current = asking;
  }, [asking]);

  if (!asking) {
    return (
      <button ref={action} onClick={() => setAsking(true)} className={linkClassName ?? `${LINK} ${className}`}>
        {label}
      </button>
    );
  }
  return (
    <div
      role="group"
      onKeyDown={(e) => e.key === 'Escape' && setAsking(false)}
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${className}`}
    >
      <span className="basis-full text-slate-700">{question}</span>
      <button
        ref={confirmButton}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onConfirm();
          setBusy(false);
          setAsking(false);
        }}
        className={`${BUTTON} px-3 py-1.5 disabled:opacity-60`}
      >
        {confirmLabel}
      </button>
      <button onClick={() => setAsking(false)} className={LINK}>
        {cancelLabel}
      </button>
    </div>
  );
}

/** "Is it fixed?" for a problem marked fixed: one answer per device, shown once given. `children` explains why it's asked. */
export function FixQuestion({ issue, named = false, children }: { issue: Issue; named?: boolean; children?: ReactNode }) {
  const store = useStore();
  const answer = store.confirmed[issue.id];
  if (answer) {
    return (
      <p className="text-[15px] text-slate-600">
        <span className="font-semibold text-ink">{answer === 'yes' ? 'You said it’s fixed.' : 'You said it’s still broken.'}</span>{' '}
        {store.district.name} can see {answer === 'yes' ? 'your answer' : 'that'}.
      </p>
    );
  }
  return (
    <div>
      <p className="font-semibold leading-snug">{named ? `Is “${issue.title}” fixed?` : 'Is it fixed?'}</p>
      {children}
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <button
          onClick={async () => {
            if (await store.confirmFix(issue.id, 'yes')) store.toast('Thanks for confirming');
          }}
          className={`${BUTTON} py-2.5`}
        >
          Yes, it’s fixed
        </button>
        <button
          onClick={async () => {
            if (await store.confirmFix(issue.id, 'no')) store.toast(`${store.district.name} will see this.`);
          }}
          className={`${BUTTON} py-2.5`}
        >
          Still broken
        </button>
      </div>
    </div>
  );
}
