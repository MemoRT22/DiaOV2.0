import type { ReactNode } from 'react';

/** One header recipe for every student screen: a small eyebrow (context), the title, and at most one short line. */
export function PageHeader({ eyebrow, title, subtitle, aside }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="animate-fade-up">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-fg-brand">{eyebrow}</p>}
          <h1 className="mt-0.5 text-[1.75rem] font-extrabold leading-tight">{title}</h1>
        </div>
        {aside}
      </div>
      {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
    </header>
  );
}
