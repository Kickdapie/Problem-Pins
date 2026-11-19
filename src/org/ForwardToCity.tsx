import { useState } from 'react';
import { ExternalLink, Send } from 'lucide-react';
import { fieldClass as field, linkClass } from '../components/ui';
import type { Issue } from '../data/types';
import { plural } from '../lib/format';
import { useStore } from '../store';
import Dialog from './Dialog';
import { normalizeSr } from './triage';

/** City agencies that commonly own street assets. Free text is allowed too. */
const AGENCIES = ['NYC DOT', 'NYC Parks', 'DSNY', 'DEP', 'NYPD', 'DOB', 'HPD', 'Con Edison'];

/**
 * Records a 311 service request staff filed themselves. In live mode the SR number is
 * required (it comes from 311); the demo prefills a sample one so the story still flows.
 */
export function ForwardToCityForm({ issue, onDone, onCancel }: { issue: Issue; onDone?: () => void; onCancel?: () => void }) {
  const { sendToCity, toast, mode } = useStore();
  const demo = mode === 'demo';
  const [sr, setSr] = useState(() => (demo ? `311-${21900000 + (hash(issue.id) % 99999)}` : ''));
  const [agency, setAgency] = useState(issue.agency ?? '');
  const [routedTo, setRoutedTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const number = normalizeSr(sr);
    if (!number) return setError('Enter the SR number 311 gave you. It looks like 311-12345678.');
    if (!agency.trim()) return setError('Which City agency is it routed to?');
    setError(null);
    setBusy(true);
    const ok = await sendToCity(issue.id, { sr: number, agency: agency.trim(), routedTo: routedTo.trim() || undefined });
    setBusy(false);
    if (ok) {
      toast(`${issue.id} recorded as SR ${number}`);
      onDone?.();
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-3"
    >
      <ol className="list-decimal space-y-1 pl-4 text-sm text-slate-600">
        <li>
          File it on{' '}
          <a href="https://portal.311.nyc.gov/" target="_blank" rel="noreferrer" className={`inline-flex items-center gap-0.5 ${linkClass}`}>
            the NYC 311 portal <ExternalLink className="h-3 w-3" />
          </a>{' '}
          and mention the {plural(issue.votes, 'neighbor')} who reported it.
        </li>
        <li>Enter the service request number 311 gives you, so we can track the reply here.</li>
      </ol>
      <label className="block text-sm font-medium">
        SR number
        <input
          value={sr}
          onChange={(e) => setSr(e.target.value)}
          inputMode="numeric"
          placeholder="311-12345678"
          autoFocus={!demo}
          className={`${field} font-mono`}
        />
        {demo && <span className="mt-1 block text-xs font-normal text-slate-500">Demo: a sample number is filled in.</span>}
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Agency
          <input value={agency} onChange={(e) => setAgency(e.target.value)} list="pp-agencies" placeholder="NYC DOT" className={field} />
          <datalist id="pp-agencies">
            {AGENCIES.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        <label className="block text-sm font-medium">
          Routed to <span className="font-normal text-slate-500">(optional)</span>
          <input value={routedTo} onChange={(e) => setRoutedTo(e.target.value)} placeholder="e.g. Street Lighting" className={field} />
        </label>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <p className="text-xs text-slate-500">
        Residents following {issue.id} will see that it went to {agency.trim() || 'the City'} with this SR number.
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium hover:border-slate-300">
            Cancel
          </button>
        )}
        {/* Ink, not orange: the form sits on the issue page, whose one orange button posts the update. */}
        <button disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-sm font-semibold text-white hover:bg-ink/90 disabled:opacity-60">
          <Send className="h-4 w-4" /> {busy ? 'Saving…' : 'Record 311 request'}
        </button>
      </div>
    </form>
  );
}

export function ForwardToCityDialog({ issue, onClose }: { issue: Issue; onClose: () => void }) {
  return (
    <Dialog
      title={`Forward “${issue.title}” to the City`}
      label={
        <>
          <span className="font-mono font-normal">{issue.id}</span> · {plural(issue.votes, 'neighbor')}
        </>
      }
      onClose={onClose}
    >
      <ForwardToCityForm issue={issue} onDone={onClose} onCancel={onClose} />
    </Dialog>
  );
}

/** Stable sample SR per issue in the demo, so the prefill doesn't change on every render. */
function hash(s: string) {
  return [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 2147483647, 7);
}
