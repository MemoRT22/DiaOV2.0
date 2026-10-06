import { Check } from 'lucide-react';
import type { StepDef } from '../../lib/workshopForm';

/** Indicador de progreso accesible: texto "Paso X de N", barra con `role="progressbar"` y lista de pasos (`aria-current="step"`). */
export default function StepIndicator({ steps, current, reached }: { steps: readonly StepDef[]; current: number; reached: number }) {
  const total = steps.length;
  const label = `Paso ${current + 1} de ${total}: ${steps[current].title}`;
  return (
    <nav aria-label="Progreso del registro">
      <p className="text-sm font-semibold text-ink" aria-live="polite">
        {label}
      </p>
      <div
        role="progressbar"
        aria-label="Avance del registro"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current + 1}
        aria-valuetext={label}
        className="mt-2 h-2 overflow-hidden rounded-full bg-surface-raised"
      >
        <div className="h-full rounded-full bg-primary-500 transition-all duration-300" style={{ width: `${((current + 1) / total) * 100}%` }} />
      </div>
      <ol className="mt-3 hidden gap-2 sm:flex">
        {steps.map((s, i) => {
          const done = i < reached && i !== current;
          return (
            <li key={s.id} aria-current={i === current ? 'step' : undefined} className="flex flex-1 items-center gap-2 text-xs">
              <span
                aria-hidden
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
                  i === current ? 'border-primary-500 bg-primary-500 text-on-primary' : done ? 'border-success-500 bg-success-500/20 text-ink' : 'border-line text-ink-muted'
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={i === current ? 'font-semibold text-ink' : 'text-ink-muted'}>{s.short}</span>
              {i === current && <span className="sr-only"> (paso actual)</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
