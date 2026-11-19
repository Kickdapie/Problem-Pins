import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { labelClass } from '../components/ui';

/**
 * A modal on the native `<dialog>` element (focus trap, Esc to close, top layer above the map).
 * A bottom sheet on phones, a centered card on wider screens. Clicks inside don't bubble to
 * whatever row opened it (React bubbles portal and dialog events through the component tree).
 */
export default function Dialog({
  title,
  label,
  onClose,
  children,
  width = 'sm:max-w-lg',
}: {
  title: string;
  /** Small line above the title, e.g. the issue ID. */
  label?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.open) el.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      close.current();
    };
    el.addEventListener('cancel', onCancel);
    return () => {
      el.removeEventListener('cancel', onCancel);
      if (el.open) el.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === ref.current) onClose(); // backdrop
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={`m-0 mt-auto w-full max-w-none rounded-t-2xl bg-white p-0 text-ink shadow-xl backdrop:bg-ink/40 sm:m-auto ${width} sm:rounded-xl`}
    >
      <div className="max-h-[85dvh] overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white px-5 py-4">
          <div className="min-w-0">
            {label && <p className={labelClass}>{label}</p>}
            <h2 className="text-lg font-bold leading-snug">{title}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </dialog>
  );
}
