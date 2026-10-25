import { useEffect, useId, useRef, type ReactNode } from 'react';
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
/** Accessible dialog: labelled, traps Tab, closes on Escape, restores focus to the opener. Backdrop clicks do NOT close it (avoids losing form input). */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null), id = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null, el = ref.current;
    (el?.querySelector<HTMLElement>('input,select,textarea') ?? el?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    return () => prev?.focus?.();
  }, []);
  const onKey = (e: { key: string; shiftKey: boolean; preventDefault: () => void }) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key !== 'Tab' || !ref.current) return;
    const f = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)], first = f[0], last = f[f.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/40 p-4" onKeyDown={onKey}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className={`max-h-full w-full ${wide ? 'max-w-2xl' : 'max-w-md'} overflow-y-auto rounded-lg bg-white p-4 text-slate-900 dark:bg-slate-800 dark:text-slate-100`}>
        <h2 id={id} className="mb-2 font-semibold">{title}</h2>{children}
      </div>
    </div>
  );
}
