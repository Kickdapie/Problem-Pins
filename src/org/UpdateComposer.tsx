import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { StatusTag, fieldBoxClass, linkClass } from '../components/ui';
import { STATUSES, STATUS_ORDER } from '../data/meta';
import type { Issue, Status } from '../data/types';
import { useStore } from '../store';

/** Asks the box to scroll into view and take focus, with a status picked if given. `n` makes every ask a new one. */
export interface ComposeAsk {
  status?: Status;
  n: number;
}

/** The statuses staff can move an issue to by hand. "Sent to City" needs an SR number, so it comes from the 311 form. */
export function pickableStatuses(issue: Issue) {
  return STATUS_ORDER.filter((s) => s !== 'sent_to_city' || issue.cityRequest || issue.status === 'sent_to_city');
}

/**
 * The box staff write an update for residents in, and where a status change is confirmed.
 *
 * A change shows as "Open → In review" above the box, so it is plain that posting will also move
 * the issue. Marking it fixed, or reopening a fixed one, needs a note: neighbors are asked to
 * confirm a fix, and a reopening has to be explained. Any other move can go without one, because
 * a status that is easy to keep current is worth more than a note on every step.
 *
 * It sits under an issue's thread, where the status is picked next to the title and arrives as
 * `ask`. On the Overview's to-do rows it opens in place and offers the status itself (`picker`).
 */
export function UpdateComposer({
  issue,
  ask,
  picker = false,
  autoFocus = false,
  onPosted,
  onCancel,
}: {
  issue: Issue;
  ask?: ComposeAsk | null;
  picker?: boolean;
  autoFocus?: boolean;
  onPosted?: () => void;
  onCancel?: () => void;
}) {
  const { postUpdate, setStatus: saveStatus, toast } = useStore();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>(issue.status);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setText('');
    setStatus(issue.status);
  }, [issue.id, issue.status]);
  useEffect(() => {
    if (!ask) return;
    if (ask.status) setStatus(ask.status);
    box.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    box.current?.focus({ preventScroll: true });
  }, [ask]);

  const note = text.trim();
  const changing = status !== issue.status;
  const fixing = changing && status === 'fixed';
  const reopening = changing && issue.status === 'fixed';
  const needsNote = !changing || fixing || reopening;
  const move = fixing ? 'mark fixed' : reopening ? 'reopen' : `set to ${STATUSES[status].label}`;
  const label = !changing ? 'Post update' : note || needsNote ? `Post and ${move}` : move[0].toUpperCase() + move.slice(1);

  const submit = async () => {
    const done = note ? await postUpdate(issue.id, note, status) : await saveStatus(issue.id, status);
    if (!done) return;
    setText('');
    toast(
      fixing
        ? `${issue.id} marked fixed · neighbors will be asked to confirm`
        : note
          ? `Update posted on ${issue.id}`
          : `${issue.id} set to ${STATUSES[status].label}`,
    );
    onPosted?.();
  };

  return (
    <div>
      {changing && (
        <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <StatusTag status={issue.status} className="text-slate-500" />
          <ArrowRight className="h-3.5 w-3.5 text-slate-400" aria-label="changes to" />
          <StatusTag status={status} className="font-medium" />
          <button onClick={() => setStatus(issue.status)} className={`ml-1 ${linkClass}`}>
            Keep {STATUSES[issue.status].label}
          </button>
        </p>
      )}
      <textarea
        ref={box}
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        aria-label="Update for residents"
        placeholder={
          fixing
            ? 'What was done, and by whom? Neighbors will be asked to confirm it’s fixed.'
            : reopening
              ? 'Why is it open again? Residents who were told it was fixed see this.'
              : changing
                ? 'Add a note for residents if there is something to say. It can go without one.'
                : 'What changed? Residents who +1’d or follow this see it on the issue page and in their updates.'
        }
        className="w-full rounded-lg border border-slate-200 bg-white p-3 text-sm"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        {picker ? (
          <label className={`${fieldBoxClass} bg-white py-1.5 text-xs text-slate-500`}>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className="bg-transparent text-sm font-medium text-ink outline-none">
              {pickableStatuses(issue).map((s) => (
                <option key={s} value={s}>
                  {STATUSES[s].label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-4">
          {onCancel && (
            <button onClick={onCancel} className={`text-sm ${linkClass}`}>
              Cancel
            </button>
          )}
          <button
            disabled={needsNote && !note}
            onClick={() => void submit()}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
          >
            {label}
          </button>
        </div>
      </div>
    </div>
  );
}
