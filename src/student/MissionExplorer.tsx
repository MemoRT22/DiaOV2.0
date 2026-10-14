import { ArrowRight, Flag, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Division } from '../lib/catalog';
import { belongsToDivision, type BoardSession } from '../lib/reservations';
import { UNIVERSITY_LIFE } from '../lib/universityLife';
import { divisionColor, divisionIcon, tintVars } from './ui/divisionVisuals';
import type { ThemeConfig } from '../theme/types';

const count = (n: number) => `${n} ${n === 1 ? 'misión' : 'misiones'}`;

/**
 * The landing of «Misiones»: instead of 63 cards in a row, a small universe to choose from. What is recommended for me
 * (only when the server really recommends something), what is happening now, then one tile per academic area plus
 * Vida Universitaria, and a way to see everything. Pure presentation: every tile is a link to the same filters the list
 * already had, so availability and booking rules are untouched.
 */
export default function MissionExplorer({
  workshops,
  divisions,
  theme,
  accent,
  featured,
  featuredTotal,
  liveCount,
  lifeCount,
  href,
}: {
  workshops: BoardSession[][];
  divisions: Division[];
  theme: ThemeConfig;
  /** The colour of Vida Universitaria (distinct from every academic area). */
  accent: string;
  /** Up to three ready-made cards of recommended missions, in the server's order. */
  featured: ReactNode[];
  featuredTotal: number;
  liveCount: number;
  lifeCount: number;
  /** URL of a filter (keeps the rest of the query). */
  href: (kind: 'all' | 'foryou' | 'live' | 'life' | { division: string }) => string;
}) {
  const areas = divisions
    .map((d) => ({ division: d, total: workshops.filter((w) => belongsToDivision(w[0], d.id)).length }))
    .filter((a) => a.total > 0);

  return (
    <div className="space-y-6">
      {liveCount > 0 && (
        <Link
          to={href('live')}
          className="flex min-h-14 animate-fade-up items-center gap-3 rounded-theme border border-primary-500/60 bg-primary-500/10 px-4 py-2.5 text-sm"
        >
          <span className="anim-blink h-2.5 w-2.5 shrink-0 rounded-full bg-primary-500" aria-hidden />
          <span className="min-w-0 flex-1">
            <strong className="block">En curso ahora</strong>
            <span className="text-ink-muted">{count(liveCount)} {liveCount === 1 ? 'ya empezó' : 'ya empezaron'}: aún puedes entrar</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-fg-brand" aria-hidden />
        </Link>
      )}

      {featured.length > 0 && (
        <section aria-label="Misiones para ti" className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-extrabold">
                <Sparkles className="h-5 w-5 text-fg-accent" aria-hidden />
                Para ti
              </h2>
              <p className="text-xs text-ink-muted">Relacionadas con las carreras que elegiste.</p>
            </div>
            {featuredTotal > featured.length && (
              <Link to={href('foryou')} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-fg-accent">
                Ver las {featuredTotal}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            )}
          </div>
          <ul className="space-y-3">{featured}</ul>
        </section>
      )}

      <section aria-label="Explora por área" className="space-y-3">
        <div>
          <h2 className="text-lg font-extrabold">Explora por área</h2>
          <p className="text-xs text-ink-muted">Elige un área y verás solo sus misiones.</p>
        </div>
        <ul className="grid grid-cols-2 gap-3">
          {areas.map(({ division, total }, i) => (
            <AreaTile
              key={division.id}
              to={href({ division: division.id })}
              name={division.name}
              detail={count(total)}
              color={divisionColor(theme, division)}
              index={i}
            />
          ))}
          {lifeCount > 0 && (
            <AreaTile to={href('life')} name={UNIVERSITY_LIFE} detail={`${count(lifeCount)} · deporte, arte, liderazgo y más`} color={accent} index={areas.length} wide />
          )}
        </ul>
        <Link to={href('all')} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-line bg-surface/80 px-5 text-sm font-bold text-ink hover:border-primary-500/60">
          Ver las {workshops.length} misiones
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </section>
    </div>
  );
}

function AreaTile({ to, name, detail, color, index, wide = false }: { to: string; name: string; detail: string; color: string; index: number; wide?: boolean }) {
  const Symbol = name === UNIVERSITY_LIFE ? Flag : divisionIcon(name);
  return (
    <li className={wide ? 'col-span-2' : ''}>
      <Link
        to={to}
        className="space-card group relative flex h-full min-h-[8.25rem] animate-fade-up flex-col justify-between overflow-hidden p-3.5 transition-transform duration-200 active:scale-[0.98]"
        style={{ animationDelay: `${Math.min(index, 7) * 40}ms`, ...tintVars(color) }}
      >
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_80%_at_100%_0%,rgb(var(--tint)/0.26),transparent_65%)]" aria-hidden />
        <Symbol className="pointer-events-none absolute -bottom-3 -right-3 h-24 w-24 text-[rgb(var(--tint))] opacity-[0.12]" strokeWidth={1.25} aria-hidden />
        <span className="division-orb relative flex h-10 w-10 items-center justify-center rounded-2xl" aria-hidden>
          <Symbol className="h-5 w-5" />
        </span>
        <span className="relative mt-3 block">
          <span className="block font-display text-[0.95rem] font-extrabold leading-tight">{name}</span>
          <span className="mt-1 block text-xs text-ink-muted">{detail}</span>
        </span>
      </Link>
    </li>
  );
}
