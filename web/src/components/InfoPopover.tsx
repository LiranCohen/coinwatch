import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

interface InfoPopoverProps {
  /** short label for screen readers: "what does X mean" */
  label: string;
  children: ReactNode;
}

/**
 * Detail on demand.
 *
 * The explanations behind these are worth having but not worth reading every
 * time, and printing them all on the page buries the numbers they describe.
 */
export function InfoPopover({ label, children }: InfoPopoverProps) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    // defer so the click that opened it does not immediately close it
    const timer = setTimeout(() => window.addEventListener('click', onClick), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
      clearTimeout(timer);
    };
  }, [open]);

  return (
    <span ref={wrapper} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={`What does this mean: ${label}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-4 w-4 items-center justify-center rounded-full border text-[9px] font-semibold leading-none transition-colors ${
          open
            ? 'border-sky-400 bg-sky-400/20 text-sky-200'
            : 'border-zinc-600 text-zinc-500 hover:border-zinc-400 hover:text-zinc-300'
        }`}
      >
        i
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className="absolute left-0 top-6 z-40 w-72 rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-[11px] font-normal leading-relaxed text-zinc-300 shadow-xl"
        >
          {children}
        </span>
      )}
    </span>
  );
}
