import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Long copy that stays accessible without becoming a wall: it shows the first `lines` and, ONLY if the text really overflows at the
 * current width (measured, not guessed), a «Leer más» button that opens the rest in place. The whole text is always in the DOM, so
 * screen readers read it complete; the toggle reports `aria-expanded`. Short texts show no button at all.
 */
export function ClampedText({ text, lines = 3, className = '', as: Tag = 'p' }: { text: string; lines?: 2 | 3 | 4 | 5; className?: string; as?: 'p' | 'div' }) {
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  const measure = () => {
    const el = ref.current;
    if (!el || open) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  };
  useLayoutEffect(measure, [text, lines, open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const clamp = { 2: 'line-clamp-2', 3: 'line-clamp-3', 4: 'line-clamp-4', 5: 'line-clamp-5' }[lines];
  return (
    <>
      <Tag ref={ref as never} className={`whitespace-pre-line ${open ? '' : clamp} ${className}`}>{text}</Tag>
      {(overflows || open) && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="-mt-0.5 inline-flex min-h-11 items-center text-sm font-bold text-fg-brand underline-offset-4 hover:underline"
        >
          {open ? 'Leer menos' : 'Leer más'}
        </button>
      )}
    </>
  );
}
