import { Check } from 'lucide-react';
import type { Progress } from '../lib/catalog';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import { progressNextMessage } from './progressText';

/**
 * «Estoy avanzando»: current rank, a bar towards the next one and ONE sentence about what is missing.
 * The student never has to interpret a formula. `full` also lists every level (progressive disclosure).
 */
export default function RankProgress({ progress, full = false }: { progress: Progress; full?: boolean }) {
  const { theme, term, text, rankName } = usePublicTheme();
  const rank = theme.ranks[Math.min(Math.max(progress.level, 1), 5) - 1];
  const visited = new Set(progress.division_ids);
  const remainingStamps = progress.next ? Math.max(progress.next.required_attendances - progress.stamps, 0) : 0;
  const remainingDivisions = progress.next ? Math.max(progress.next.required_divisions - visited.size, 0) : 0;
  const fraction = progress.next ? Math.min(progress.stamps / Math.max(progress.next.required_attendances, 1), 1) : 1;

  return (
    <section aria-label={`${term('rank')} actual`} className="card overflow-hidden p-5">
      <div className="flex items-center gap-4">
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary-500 text-on-primary shadow-[0_10px_28px_-10px_rgb(var(--c-primary-500)/0.8)]">
          <span className="font-display text-3xl font-extrabold leading-none">{progress.level}</span>
          <span className="absolute -bottom-2 rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-muted ring-1 ring-line">
            de 5
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-muted">{term('rank')} actual</p>
          <h2 className="truncate text-xl font-extrabold">{rank.name}</h2>
          <p className="line-clamp-2 text-sm text-ink-muted">{rank.description}</p>
        </div>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        aria-label={`Avance hacia el siguiente ${term('rank').toLowerCase()}`}
        className="mt-5 h-3 overflow-hidden rounded-full bg-line"
      >
        <div className="anim-bar h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-300" style={{ width: `${fraction * 100}%` }} />
      </div>
      <p className="mt-3 text-sm font-semibold">
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
              const level = i + 1;
              const reached = level <= progress.level;
              return (
                <li key={level} className="flex items-center gap-3 py-1.5">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
                      reached ? 'bg-primary-500 text-on-primary' : 'border border-line text-ink-muted'
                    }`}
                  >
                    {reached ? <Check className="h-4 w-4" aria-hidden /> : level}
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
