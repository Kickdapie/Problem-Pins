import { useEffect, useState } from 'react';
import Dialog from './Dialog';

const step = 'rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium hover:border-slate-300 disabled:opacity-40';

/**
 * A pin's photos, for staff. Residents attach them as evidence, so they are there to be looked
 * at: every photo is shown (a pin has at most four), each in its own shape so a tall phone photo
 * isn't cut down to a strip, and each opens large without leaving the page.
 */
export function Photos({ photos, label, size = 'h-36' }: { photos: string[]; label: string; size?: string }) {
  const [at, setAt] = useState<number | null>(null);
  const last = photos.length - 1;
  const open = at !== null;
  // Arrow keys page through the photos wherever the focus is in the dialog. Caught on the way down,
  // because the dialog keeps its key presses from reaching the page behind it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setAt((a) => (a !== null && a > 0 ? a - 1 : a));
      if (e.key === 'ArrowRight') setAt((a) => (a !== null && a < last ? a + 1 : a));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, last]);
  if (!photos.length) return null;
  return (
    <>
      <ul className="flex flex-wrap gap-2">
        {photos.map((src, i) => (
          <li key={i}>
            <button
              onClick={() => setAt(i)}
              aria-label={`Open photo ${i + 1} of ${photos.length}`}
              className="block overflow-hidden rounded-lg border border-slate-200 hover:border-slate-300"
            >
              <img src={src} alt="" className={`${size} w-auto max-w-full`} />
            </button>
          </li>
        ))}
      </ul>
      {at !== null && (
        <Dialog title={`Photo ${at + 1} of ${photos.length}`} label={label} onClose={() => setAt(null)} width="sm:max-w-3xl">
          <img src={photos[at]} alt="" className="mx-auto max-h-[70dvh] w-auto max-w-full rounded-lg" />
          {last > 0 && (
            <div className="mt-3 flex justify-center gap-2">
              <button onClick={() => setAt(at - 1)} disabled={at === 0} className={step}>
                Previous
              </button>
              <button onClick={() => setAt(at + 1)} disabled={at === last} className={step}>
                Next
              </button>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
