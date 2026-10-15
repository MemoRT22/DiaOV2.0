import { ArrowRight, Compass, Flag, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Division } from '../lib/catalog';
import { belongsToDivision, type BoardSession } from '../lib/reservations';
import { UNIVERSITY_LIFE } from '../lib/universityLife';
import { divisionColor, divisionIcon, tintVars } from './ui/divisionVisuals';
import type { ThemeConfig } from '../theme/types';

const count = (n: number) => `${n} ${n === 1 ? 'misión' : 'misiones'}`;

/**
 * The landing of «Misiones»: a small universe to choose from, before any list. First the whole map of what exists (one tile per
 * academic area plus Vida Universitaria, every count read from the real catalogue), then what is suggested for me as a row that
 * ends in a door to somewhere ELSE, then a way to see everything. Suggestions complement the exploration; they are never the
 * first and biggest thing on screen. Pure presentation: every tile is a link to the same filters the list already had.
 */
export default function MissionExplorer({
  workshops,
  divisions,
  theme,
  accent,
  featured,
  featuredTotal,
  recommendedIds,
  liveCount,
  liveOpenCount,
  lifeCount,
  href,
}: {
  workshops: BoardSession[][];
  divisions: Division[];
  theme: ThemeConfig;
  /** The colour of Vida Universitaria (distinct from every academic area). */
  accent: string;
  /** Compact cards of the first recommended missions, in the server's order (a row to slide through). */
  featured: ReactNode[];
  featuredTotal: number;
  /** Activities the server recommended: used only to find an area the suggestions do not touch. */
  recommendedIds: ReadonlySet<string>;
  /** Missions with a session in progress (it only says what is happening). */
  liveCount: number;
  /** Of those, the ones the student can actually book right now under the existing rules (seats, route, enrollment tolerance…). */
  liveOpenCount: number;
  lifeCount: number;
  /** URL of a filter (keeps the rest of the query). */
  href: (kind: 'all' | 'foryou' | 'live' | 'life' | { division: string }) => string;
}) {
  const areas = divisions
    .map((d) => ({ division: d, total: workshops.filter((w) => belongsToDivision(w[0], d.id)).length }))
    .filter((a) => a.total > 0);
  // «Y también…»: the biggest area none of whose missions is among the suggestions, so the row always ends outside the student's
  // declared interests. A real count from the catalogue, no new ranking.
  const elsewhere = areas
    .filter((a) => !workshops.some((w) => belongsToDivision(w[0], a.division.id) && recommendedIds.has(w[0].activity_id)))
    .sort((a, b) => b.total - a.total)[0] ?? null;

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
            <span className="text-ink-muted">
              {count(liveCount)} en curso
              {liveOpenCount > 0
                ? ` · ${liveOpenCount === 1 ? '1 acepta' : `${liveOpenCount} aceptan`} reservación ahora`
                : ' · revisa cuáles aún aceptan reservación'}
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-fg-brand" aria-hidden />
        </Link>
      )}

      <section aria-label="Explora por área" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <Compass className="h-5 w-5 text-fg-brand" aria-hidden />
            Explora por área
          </h2>
          <Link to={href('all')} className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-semibold text-fg-brand">
            Ver las {workshops.length}<span className="sr-only"> misiones</span>
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <ul className="grid grid-cols-2 gap-2.5">
          {areas.map(({ division, total }, i) => (
            <AreaTile key={division.id} to={href({ division: division.id })} name={division.name} detail={count(total)} color={divisionColor(theme, division)} index={i} />
          ))}
          {lifeCount > 0 && (
            <AreaTile to={href('life')} name={UNIVERSITY_LIFE} detail={`${count(lifeCount)} · deporte, arte, liderazgo…`} color={accent} index={areas.length} wide />
          )}
        </ul>
      </section>

      {featured.length > 0 && (
        <section aria-label="Misiones para ti" className="space-y-2.5">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-lg font-extrabold">
                <Sparkles className="h-5 w-5 text-fg-accent" aria-hidden />
                Para ti
              </h2>
              <p className="text-xs text-ink-muted">Según las carreras que elegiste. Hay mucho más: sigue explorando.</p>
            </div>
            {featuredTotal > featured.length && (
              <Link to={href('foryou')} className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-semibold text-fg-accent">
                Ver las {featuredTotal}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            )}
          </div>
          {/* A row that slides: the next card peeks in, so it reads as «there are more», not as «these are the only ones». */}
          <ul className="no-scrollbar -mx-4 flex snap-x snap-mandatory items-stretch gap-3 overflow-x-auto overscroll-x-contain px-4 pb-1 [scroll-padding-inline:1rem]">
            {featured}
            <li className="flex min-w-[10.5rem] max-w-[12rem] flex-1 snap-start">
              <Link
                to={elsewhere ? href({ division: elsewhere.division.id }) : href('all')}
                className="space-card group relative flex w-full flex-col justify-between overflow-hidden border-dashed p-3.5 transition-transform duration-200 active:scale-[0.98]"
                style={tintVars(elsewhere ? divisionColor(theme, elsewhere.division) : accent)}
              >
                <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_80%_at_100%_0%,rgb(var(--tint)/0.22),transparent_65%)]" aria-hidden />
                <span className="relative text-[10.5px] font-extrabold uppercase tracking-wider text-[rgb(var(--tint))]">Y también…</span>
                <span className="relative mt-2 block">
                  <span className="block font-display text-[1rem] font-extrabold leading-snug">{elsewhere ? elsewhere.division.name : 'Todas las misiones'}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">{elsewhere ? `${count(elsewhere.total)} fuera de tus sugerencias` : count(workshops.length)}</span>
                </span>
                <span className="relative mt-3 inline-flex items-center gap-1 text-sm font-bold text-fg-brand">
                  Descubrir
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </span>
              </Link>
            </li>
          </ul>
        </section>
      )}

    </div>
  );
}

function AreaTile({ to, name, detail, color, index, wide = false }: { to: string; name: string; detail: string; color: string; index: number; wide?: boolean }) {
  const Symbol = name === UNIVERSITY_LIFE ? Flag : divisionIcon(name);
  return (
    <li className={wide ? 'col-span-2' : ''}>
      <Link
        to={to}
        className="space-card group relative flex h-full min-h-[4.75rem] animate-fade-up items-center gap-2.5 overflow-hidden px-2.5 py-2.5 transition-transform duration-200 active:scale-[0.98] min-[360px]:gap-3 min-[360px]:px-3"
        style={{ animationDelay: `${Math.min(index, 7) * 40}ms`, ...tintVars(color) }}
      >
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_80%_at_100%_0%,rgb(var(--tint)/0.26),transparent_65%)]" aria-hidden />
        <Symbol className="pointer-events-none absolute -bottom-3 -right-2 h-20 w-20 text-[rgb(var(--tint))] opacity-[0.12]" strokeWidth={1.25} aria-hidden />
        <span className="division-orb relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl min-[360px]:h-10 min-[360px]:w-10 min-[360px]:rounded-2xl" aria-hidden>
          <Symbol className="h-5 w-5" />
        </span>
        <span className="relative min-w-0">
          <span className="block break-words font-display text-[0.82rem] font-extrabold leading-tight [hyphens:auto] min-[360px]:text-[0.9rem]">{name}</span>
          <span className="mt-0.5 block text-xs text-ink-muted">{detail}</span>
        </span>
      </Link>
    </li>
  );
}
