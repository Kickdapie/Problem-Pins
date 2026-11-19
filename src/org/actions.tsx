import { ExternalLink, Send } from 'lucide-react';
import { linkClass } from '../components/ui';
import { navigate } from '../router';
import { useStore } from '../store';
import type { TodoItem } from './dashboard';

export const CHECK_311 = 'https://portal.311.nyc.gov/check-status/';

/** 311's status page asks for the SR number, so links to it copy the number on the way. */
export function copySr(sr: string, toast: (message: string) => void) {
  navigator.clipboard?.writeText(sr).then(
    () => toast(`Copied ${sr}`),
    () => {},
  );
}

/**
 * What to do about a to-do item: log a City follow-up right here, review reports on the issue page, or respond,
 * reply or post an update. With `onCompose` that last one opens a box in place (`open` says it is showing);
 * without it, it opens the issue. `relative` keeps it above a row whose title link is stretched over the whole row.
 */
export function TodoAction({
  item,
  block = false,
  open = false,
  onCompose,
}: {
  item: TodoItem;
  block?: boolean;
  open?: boolean;
  onCompose?: () => void;
}) {
  const { nudgeCity, toast } = useStore();
  const { issue, kind } = item;
  const button = `relative flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold hover:border-slate-300 ${
    block ? 'flex-1' : ''
  }`;

  if (kind === 'city' && issue.cityRequest) {
    const { sr } = issue.cityRequest;
    return (
      <div className={`relative flex shrink-0 items-center gap-3 ${block ? 'w-full' : ''}`}>
        <a
          href={CHECK_311}
          target="_blank"
          rel="noreferrer"
          title="Opens NYC 311’s status page and copies the SR number"
          onClick={() => copySr(sr, toast)}
          className={`inline-flex items-center gap-1 whitespace-nowrap text-sm ${linkClass}`}
        >
          Check 311 <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <button
          onClick={async () => {
            if (await nudgeCity(issue.id)) toast(`Follow-up on ${sr} recorded`);
          }}
          title="Record that you followed up with the City"
          className={button}
        >
          <Send className="h-3.5 w-3.5" /> Log follow-up
        </button>
      </div>
    );
  }

  const label = kind === 'quiet' ? 'Post update' : kind === 'residents' ? 'Reply' : kind === 'reported' ? 'Review' : 'Respond';
  if (onCompose && kind !== 'reported') {
    return (
      <button onClick={onCompose} aria-expanded={open} className={button}>
        {open ? 'Close' : label}
      </button>
    );
  }
  return (
    <button onClick={() => navigate(`/org/issues/${issue.id}`)} className={button}>
      {label}
    </button>
  );
}
