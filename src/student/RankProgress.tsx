import { Check, Star } from 'lucide-react';
import type { Progress } from '../lib/catalog';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import { progressNextMessage } from './progressText';

/**
 * «Estoy avanzando», drawn as a constellation: the five ranks are stars on one line; reached stars shine, the current
 * one pulses («estás aquí»), the rest are outlines. Below: a bar towards the next rank and ONE sentence about what is
 * missing — the student never has to interpret a formula. `full` also lists every rank (progressive disclosure).
 */
export default function RankProgress({ progress, full = false }: { progress: Progress; full?: boolean }) {
  const { theme, term, text, rankName } = usePublicTheme();
  const level = Math.min(Math.max(progress.level, 1), 5);
  const rank = theme.ranks[level - 1];
  const visited = new Set(progress.division_ids);
  const remainingStamps = progress.next ? Math.max(progress.next.required_attendances - progress.stamps, 0) : 0;
  const remainingDivisions = progress.next ? Math.max(progress.next.required_divisions - visited.size, 0) : 0;
  const fraction = progress.next ? Math.min(progress.stamps / Math.max(progress.next.required_attendances, 1), 1) : 1;

  return (
    <section aria-label={`${term('rank')} actual`} className="space-card relative overflow-hidden p-5">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-muted">{term('rank')} actual</p>
      <h2 className="mt-0.5 font-display text-xl font-extrabold text-fg-brand">{rank.name}</h2>
      <p className="text-sm text-ink-muted">{rank.description}</p>

      {/* constellation of ranks */}
      <ol className="relative mt-5 flex items-center justify-between" aria-label={`${term('rank', true)}: ${level} de 5`}>
        <span className="absolute inset-x-4 top-1/2 h-0.5 -translate-y-1/2 bg-line" aria-hidden />
        <span
          className="anim-bar absolute left-4 top-[calc(50%-1px)] h-0.5 bg-gradient-to-r from-primary-500 to-primary-300 shadow-[0_0_8px_rgb(var(--c-primary-500)/0.8)]"
          style={{ width: `calc((100% - 2rem) * ${(level - 1) / 4})` }}
          aria-hidden
        />
        {theme.ranks.map((r, i) => {
          const n = i + 1;
          const reached = n < level;
          const current = n === level;
          return (
            <li key={n} className="relative flex flex-col items-center" aria-current={current ? 'step' : undefined}>
              <span className="sr-only">
                {r.name} {reached || current ? '(alcanzado)' : '(pendiente)'}
              </span>
              <span
                aria-hidden
                className={`relative flex items-center justify-center rounded-full ${
                  current
                    ? 'anim-ring-pulse h-10 w-10 bg-primary-500 text-on-primary shadow-[0_0_22px_rgb(var(--c-primary-500)/0.9)]'
                    : reached
                      ? 'h-8 w-8 bg-primary-500/85 text-on-primary'
                      : 'h-8 w-8 border-2 border-line bg-surface-sunken text-ink-muted'
                }`}
              >
                {current ? <Star className="h-5 w-5" fill="currentColor" /> : reached ? <Check className="h-4 w-4" strokeWidth={3} /> : <span className="text-xs font-extrabold">{n}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-center text-[11px] font-bold uppercase tracking-wide text-ink-muted">
        {term('rank')} {level} de 5
      </p>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        aria-label={`Avance hacia el siguiente ${term('rank').toLowerCase()}`}
        className="mt-4 h-2.5 overflow-hidden rounded-full bg-line"
      >
        <div className="anim-bar h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-300" style={{ width: `${fraction * 100}%` }} />
      </div>
      <p className="mt-2 text-sm font-semibold">
        {progress.next ? progressNextMessage(theme, progress.next, remainingStamps, term, rankName) : text('progressMax')}
      </p>
      {progress.next && remainingDivisions > 0 && remainingStamps === 0 && (
        <p className="mt-1 text-xs text-ink-muted">
          Te falta visitar {remainingDivisions} {term('division', remainingDivisions !== 1).toLowerCase()} distinto
          {remainingDivisions !== 1 ? 's' : ''}.
        </p>
      )}

      {full && (
        <details className="group mt-4 border-t border-line pt-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold text-fg-brand">
            Ver todos los {term('rank', true).toLowerCase()}
            <span className="text-xs text-ink-muted group-open:hidden">Mostrar</span>
            <span className="hidden text-xs text-ink-muted group-open:inline">Ocultar</span>
          </summary>
          <ol className="mt-2 space-y-1">
            {theme.ranks.map((r, i) => {
              const n = i + 1;
              const reached = n <= progress.level;
              return (
                <li key={n} className="flex items-center gap-3 py-1.5">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
                      reached ? 'bg-primary-500 text-on-primary' : 'border border-line text-ink-muted'
                    }`}
                  >
                    {reached ? <Check className="h-4 w-4" aria-hidden /> : n}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold ${reached ? 'text-ink' : 'text-ink-muted'}`}>
                      {r.name}
                      <span className="sr-only">{reached ? ' (alcanzado)' : ' (pendiente)'}</span>
                    </p>
                    <p className="text-xs text-ink-muted">{r.description}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </section>
  );
}
