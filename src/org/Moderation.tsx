import { useMemo, useState } from 'react';
import { ArrowLeft, GitMerge, Search } from 'lucide-react';
import { CategoryTag, StatusTag, fieldBoxClass, fieldClass, labelClass } from '../components/ui';
import type { Issue } from '../data/types';
import { formatMeters, plural } from '../lib/format';
import { navigate } from '../router';
import { useStore } from '../store';
import Dialog from './Dialog';
import { mergeCandidates, mergeSummary } from './triage';

const HIDE_REASONS = [
  'Spam or not a public-space problem',
  'Personal information in the text or photo',
  'Abusive or offensive',
  'Outside the district',
  'Other',
];

export function HideDialog({ issue, onClose }: { issue: Issue; onClose: () => void }) {
  const { hideIssue, toast } = useStore();
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason) return setError('Pick a reason.');
    if (reason === 'Other' && !detail.trim()) return setError('Say briefly why, so your team knows later.');
    const text = reason === 'Other' ? detail.trim() : detail.trim() ? `${reason}: ${detail.trim()}` : reason;
    setBusy(true);
    const ok = await hideIssue(issue.id, text);
    setBusy(false);
    if (ok) {
      toast(`${issue.id} hidden from the public map`);
      onClose();
    }
  };

  return (
    <Dialog title={`Hide “${issue.title}”`} label={<span className="font-mono font-normal">{issue.id}</span>} onClose={onClose}>
      <form
        noValidate
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm text-slate-600">
          It leaves the public map and its link stops working for residents. Staff still see it under Hidden &amp; merged, and you can
          unhide it any time. Same problem as another pin? Use Merge instead, so its neighbors and followers move over.
        </p>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-medium">Reason</legend>
          {HIDE_REASONS.map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="accent-ink" />
              {r}
            </label>
          ))}
        </fieldset>
        <label className="block text-sm font-medium">
          Note for your team {reason !== 'Other' && <span className="font-normal text-slate-500">(optional)</span>}
          <input value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={200} className={fieldClass} />
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium hover:border-slate-300">
            Cancel
          </button>
          <button disabled={busy} className="rounded-lg bg-ink px-3.5 py-2 text-sm font-semibold text-white hover:bg-ink/90 disabled:opacity-60">
            {busy ? 'Hiding…' : 'Hide from public'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function MergeDialog({ issue, onClose }: { issue: Issue; onClose: () => void }) {
  const { issues, mergeIssue, toast } = useStore();
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<Issue | null>(null);
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => {
    const all = mergeCandidates(issue, issues);
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 8);
    return all.filter((c) => `${c.issue.id} ${c.issue.title} ${c.issue.locationLabel}`.toLowerCase().includes(q)).slice(0, 20);
  }, [issue, issues, query]);

  if (target) {
    const s = mergeSummary(issue, target);
    return (
      <Dialog title="Merge these two pins?" label={<span className="font-mono font-normal">{`${issue.id} → ${target.id}`}</span>} onClose={onClose}>
        <div className="space-y-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <PinCard issue={issue} note="Duplicate" />
            <GitMerge className="mx-auto h-4 w-4 rotate-90 text-slate-400 sm:rotate-0" />
            <PinCard issue={target} note="Keeps going" />
          </div>
          <ul className="list-disc space-y-1 pl-4 text-slate-700">
            <li>
              {plural(s.votes, 'neighbor')} and {plural(s.following, 'follower')} move to {target.id} (up to{' '}
              {plural(s.votesAfter, 'neighbor')} after: anyone who +1’d both counts once).
            </li>
            {s.alsoMerged > 0 && <li>The {s.alsoMerged} duplicates already merged into {issue.id} count toward {target.id} too.</li>}
            <li>
              {issue.id} leaves the public map. Its link tells residents it was merged and sends them to {target.id}.
            </li>
            <li>Comments, updates and photos on {issue.id} stay with it; staff can still read them under Hidden &amp; merged.</li>
          </ul>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">A merge can’t be undone from the dashboard.</p>
          <div className="flex flex-wrap justify-between gap-2">
            <button onClick={() => setTarget(null)} className="flex items-center gap-1 rounded-lg px-2 py-2 font-medium text-slate-600 hover:text-ink">
              <ArrowLeft className="h-4 w-4" /> Pick another
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const ok = await mergeIssue(issue.id, target.id);
                setBusy(false);
                if (ok) {
                  toast(`${issue.id} merged into ${target.id}`);
                  onClose();
                  navigate(`/org/issues/${target.id}`);
                }
              }}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
            >
              <GitMerge className="h-4 w-4" /> {busy ? 'Merging…' : `Merge into ${target.id}`}
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Merge into another pin"
      label={
        <>
          <span className="font-mono font-normal">{issue.id}</span> · {issue.title}
        </>
      }
      onClose={onClose}
    >
      <p className="text-sm text-slate-600">Pick the pin that reports the same problem. Nearby open pins in the same category are listed first.</p>
      <label className={`${fieldBoxClass} mt-3`}>
        <Search className="h-4 w-4 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ID, street, keyword"
          className="h-10 w-full text-sm outline-none"
        />
      </label>
      <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {candidates.map(({ issue: c, meters, sameCategory }) => (
          <li key={c.id}>
            <button onClick={() => setTarget(c)} className="block w-full px-3 py-2.5 text-left -outline-offset-2 hover:bg-slate-50">
              <span className="flex justify-between gap-3 text-xs text-slate-500">
                <span className="font-mono">{c.id}</span>
                <span>{formatMeters(meters)} away</span>
              </span>
              <span className="block font-medium">{c.title}</span>
              <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-600">
                <CategoryTag category={c.category} className={sameCategory ? 'font-medium text-ink' : ''} />
                <StatusTag status={c.status} />
                <span>{plural(c.votes, 'neighbor')}</span>
              </span>
            </button>
          </li>
        ))}
        {!candidates.length && <li className="px-3 py-6 text-center text-sm text-slate-500">No pins match.</li>}
      </ul>
    </Dialog>
  );
}

function PinCard({ issue, note }: { issue: Issue; note: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className={`flex justify-between gap-3 ${labelClass}`}>
        <span className="font-mono font-normal">{issue.id}</span>
        <span>{note}</span>
      </p>
      <p className="font-medium leading-snug">{issue.title}</p>
      <p className="text-xs text-slate-500">
        {issue.locationLabel} · {plural(issue.votes, 'neighbor')}
      </p>
    </div>
  );
}
