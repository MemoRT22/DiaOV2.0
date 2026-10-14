import { ArrowLeftRight, Compass, Flag, Search, Sparkles, Telescope, X } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, PageSkeleton } from '../components/ui';
import { fetchDivisions, formatTime } from '../lib/catalog';
import { matchesMission } from '../lib/missionSearch';
import { recommendationReason } from '../lib/recommendationReason';
import { fetchRecommendedActivities } from '../lib/recommendationsApi';
import { belongsToDivision, isSelectable, sessionState, type BoardSession } from '../lib/reservations';
import { experienceCategoriesIn, isUniversityLife, UNIVERSITY_LIFE, universityLifeCategory, universityLifeLabel } from '../lib/universityLife';
import { workshopDivisionIds } from '../lib/workshopDiscovery';
import { useLoad } from '../lib/useLoad';
import { useParticipantSync } from '../lib/useParticipantSync';
import { useReservationBoard } from '../lib/useReservationBoard';
import { useEdition } from '../edition/EditionProvider';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import { MISSION, NAV } from './copy';
import MissionCard from './MissionCard';
import MissionExplorer from './MissionExplorer';
import WindowNotice from './reservations/WindowNotice';
import { divisionColor } from './ui/divisionVisuals';
import { PageHeader } from './ui/PageHeader';
import { RouteMeter } from './ui/RouteMeter';
import { EmptyState, ErrorState } from './ui/States';

type Filter =
  /** The landing: areas to explore instead of the whole catalogue (the default when nothing is chosen). */
  | { kind: 'explore' }
  | { kind: 'all' } | { kind: 'foryou' } | { kind: 'live' } | { kind: 'division'; id: string }
  /** Vida Universitaria (by official activity type), optionally narrowed to one experience category. */
  | { kind: 'life'; category?: string };

/** Misiones — the catalogue of Día OV workshops. One mission per card; the detail owns every session and booking action. */
export default function Missions() {
  const { theme, text } = usePublicTheme();
  const { edition } = useEdition();
  const { board, error, loading, reload } = useReservationBoard(edition?.id);
  const divisions = useLoad(fetchDivisions, []);
  // The personalised ranking is an enhancement: if it fails the catalogue keeps working, and `useLoad` keeps the last good
  // snapshot when a re-query fails (it only replaces `data` on success).
  const recs = useLoad(fetchRecommendedActivities, []);
  // Personal changes announced by OTHER tabs (reserve / change / cancel / check-in) and a long time hidden re-query the ranking.
  // Seat counts are NOT part of this: they keep arriving through the board's availability broadcast, never re-ranking per movement.
  useParticipantSync(recs.reload);
  const [params, setParams] = useSearchParams();
  const filter: Filter = params.get('f') === 'foryou' ? { kind: 'foryou' }
    : params.get('f') === 'live' ? { kind: 'live' }
    : params.get('f') === 'division' && params.get('d') ? { kind: 'division', id: params.get('d')! }
    : params.get('f') === 'life' ? { kind: 'life', ...(params.get('c') ? { category: params.get('c')! } : {}) }
    // Changing a reservation goes straight to the list; otherwise nothing chosen = the landing of areas.
    : params.get('f') === 'all' || params.get('cambiar') ? { kind: 'all' }
    : { kind: 'explore' };
  const query = params.get('q') ?? '';
  // Filters live in the URL only: choosing one never touches the board, the reservations or the catalogue state.
  const setFilter = (next: Filter) => {
    const updated = new URLSearchParams(params);
    updated.delete('f');
    updated.delete('d');
    updated.delete('c');
    if (next.kind === 'explore') updated.delete('q');
    if (next.kind !== 'explore') updated.set('f', next.kind);
    if (next.kind === 'division') updated.set('d', next.id);
    if (next.kind === 'life' && next.category) updated.set('c', next.category);
    setParams(updated);
  };

  // The chosen filter stays in sight: arriving from a link (or the back button) with a chip that is off to the side
  // scrolls its row to it. Only the chip rows move, never the page.
  const chipRows = useRef<HTMLDivElement>(null);
  const filterKey = params.get('f') + '|' + params.get('d') + '|' + params.get('c');
  useEffect(() => {
    chipRows.current?.querySelectorAll<HTMLElement>('[aria-pressed="true"]').forEach((chip) => {
      chip.scrollIntoView?.({ inline: 'center', block: 'nearest' });
    });
  }, [filterKey, board === null]);

  const replacing = useMemo(() => {
    const id = params.get('cambiar');
    return board?.reservations.find((r) => r.id === id && r.status === 'vigente') ?? null;
  }, [board, params]);
  const replacingSession = replacing && board?.sessions.find((s) => s.id === replacing.session_id);

  const recommendations = recs.data?.recommendations ?? [];
  const recommendedIds = useMemo(() => new Set(recommendations.map((r) => r.activity_id)), [recommendations]);

  const workshops = useMemo(() => {
    const byActivity = new Map<string, BoardSession[]>();
    for (const s of board?.sessions ?? []) {
      if (s.status !== 'activa') continue;
      byActivity.set(s.activity_id, [...(byActivity.get(s.activity_id) ?? []), s]);
    }
    const list = [...byActivity.values()];
    // Recommended (and not yet attended) first, in the order the server ranked them; the rest keep their order.
    const rank = (w: BoardSession[]) => {
      const idx = recommendations.findIndex((r) => r.activity_id === w[0].activity_id);
      return idx >= 0 && !recommendations[idx].already_attended ? idx : Number.MAX_SAFE_INTEGER;
    };
    return list.sort((a, b) => rank(a) - rank(b));
  }, [board, recommendations]);

  if ((loading && !board) || (divisions.loading && !divisions.data)) return <PageSkeleton blocks={4} />;
  if (error || !board) return <ErrorState error={error} onRetry={reload} />;
  if (divisions.error || !divisions.data) return <ErrorState error={divisions.error} onRetry={divisions.reload} />;

  const divisionById = new Map(divisions.data.map((d) => [d.id, d]));
  const anyLive = workshops.some((w) => w.some((s) => s.in_progress));
  // «Todos» is always the starting filter and the student is never moved to «Para ti» automatically. If the chip they chose
  // stops applying (e.g. the ranking came back empty), they simply see the whole catalogue.
  // Vida Universitaria missions and the experience categories that actually have some (one entry per mission).
  const lifeCategories = experienceCategoriesIn(workshops.map((w) => w[0]));
  const anyLife = lifeCategories.length > 0;
  const current: Filter =
    (filter.kind === 'foryou' && recommendedIds.size === 0) || (filter.kind === 'live' && !anyLive) || (filter.kind === 'life' && !anyLife)
      ? { kind: 'all' }
      // A category without missions (e.g. an old link) falls back to the whole of Vida Universitaria.
      : filter.kind === 'life' && filter.category && !lifeCategories.some((c) => c.value === filter.category)
        ? { kind: 'life' }
        : filter;
  const searching = query.trim().length > 0;
  const exploring = current.kind === 'explore' && !searching && !replacing;
  const areaNames = (w: BoardSession[]) => [
    ...workshopDivisionIds(w[0]).map((id) => divisionById.get(id)?.name ?? ''),
    ...(universityLifeCategory(w[0]) ? [UNIVERSITY_LIFE, universityLifeLabel(universityLifeCategory(w[0])!)] : []),
  ];
  const visible = workshops.filter((w) => {
    if (searching && !matchesMission(w, query, areaNames(w))) return false;
    if (current.kind === 'foryou') return recommendedIds.has(w[0].activity_id);
    if (current.kind === 'live') return w.some((s) => s.in_progress);
    if (current.kind === 'division') return belongsToDivision(w[0], current.id);
    if (current.kind === 'life') return current.category ? universityLifeCategory(w[0]) === current.category : isUniversityLife(w[0]);
    return true;
  });
  const active = board.active_reservation_count;
  const full = active >= board.max_reservations;

  const chip = (on: boolean, tone: 'brand' | 'accent' = 'brand') =>
    `inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors duration-200 ${
      on
        ? tone === 'accent'
          ? 'border-accent-500 bg-accent-500 text-on-accent shadow-[0_6px_18px_-8px_rgb(var(--c-accent-500)/0.9)]'
          : 'border-primary-500 bg-primary-500 text-on-primary shadow-[0_6px_18px_-8px_rgb(var(--c-primary-500)/0.9)]'
        : 'border-line bg-surface/80 text-ink-muted hover:text-ink'
    }`;
  const isFilter = (f: Filter) => JSON.stringify(f) === JSON.stringify(current);
  const listKey = JSON.stringify(current) + query;
  const setQuery = (value: string) => {
    const updated = new URLSearchParams(params);
    if (value) updated.set('q', value);
    else updated.delete('q');
    // typing replaces the entry: the back button leaves the screen instead of replaying every keystroke
    setParams(updated, { replace: true });
  };
  // Link to one filter, keeping nothing of the previous one (used by the landing tiles).
  const hrefFor = (kind: 'all' | 'foryou' | 'live' | 'life' | { division: string }) => {
    const updated = new URLSearchParams(params);
    for (const k of ['f', 'd', 'c', 'q']) updated.delete(k);
    if (typeof kind === 'string') updated.set('f', kind);
    else {
      updated.set('f', 'division');
      updated.set('d', kind.division);
    }
    return `/misiones?${updated.toString()}`;
  };

  const renderCard = (sessions: BoardSession[], i: number) => {
    const first = sessions[0];
    const ids = workshopDivisionIds(first);
    const divisionNames = ids.map((id) => divisionById.get(id)?.name).filter((name): name is string => !!name);
    const onlyDivision = ids.length === 1 ? divisionById.get(ids[0]) : null;
    // Vida Universitaria by its official type. Only a backend that does not report the type yet falls back to
    // the old reading (a mission without any division).
    const lifeCategory = universityLifeCategory(first) ?? (first.activity_type === undefined && ids.length === 0 ? 'vida_universitaria' : null);
    const rec = recommendations.find((r) => r.activity_id === first.activity_id);
    const why = rec ? recommendationReason(rec) : null;
    return (
      <MissionCard
        key={first.activity_id}
        board={board}
        sessions={sessions}
        replacing={replacing}
        divisionLabel={lifeCategory ? universityLifeLabel(lifeCategory) : divisionNames.length ? divisionNames.join(' · ') : 'Taller académico'}
        divisionName={lifeCategory ? UNIVERSITY_LIFE : onlyDivision?.name}
        // Vida Universitaria has its own colour (the theme accent), so it is never mistaken for an academic area.
        color={lifeCategory ? (theme.colors.accent || theme.colors.secondary) : divisionColor(theme, onlyDivision)}
        reason={why?.reason || null}
        recommended={!!rec && !rec.already_attended}
        attended={rec?.already_attended}
        reserved={rec?.already_reserved}
        href={`/misiones/${first.activity_id}${params.toString() ? `?${params.toString()}` : ''}`}
        index={i}
      />
    );
  };
  const forYou = workshops.filter((w) => {
    const rec = recommendations.find((r) => r.activity_id === w[0].activity_id);
    return !!rec && !rec.already_attended;
  });

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={MISSION.descriptor} title={MISSION.many} subtitle={exploring ? 'Elige las que quieras vivir y agrégalas a tu ruta.' : undefined} />
      {!replacing && <p className="sr-only">{text('activitiesIntro')}</p>}
      {!replacing && <RouteMeter active={active} max={board.max_reservations} />}

      {replacing && replacingSession ? (
        <div className="space-card flex items-center gap-3 border-primary-500/60 p-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-500/15 text-fg-brand" aria-hidden>
            <ArrowLeftRight className="h-5 w-5" />
          </span>
          <p className="min-w-0 flex-1 text-sm">
            Elige el nuevo horario para <strong>{replacingSession.title}</strong> ({formatTime(replacingSession.starts_at)}).
          </p>
          <button
            onClick={() => { const updated = new URLSearchParams(params); updated.delete('cambiar'); setParams(updated, { replace: true }); }}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-raised hover:text-ink"
            aria-label="Cancelar cambio"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
      ) : (
        // Inside a list the open window is not repeated (the landing says it once); a restriction always shows.
        <WindowNotice board={board} hideOpen={!exploring} />
      )}

      {!replacing && full && board.window === 'open' && (
        <Alert>
          Tu ruta está completa ({active} de {board.max_reservations}). Para elegir otra misión, cambia o cancela una desde{' '}
          <Link to="/ruta" className="font-semibold underline underline-offset-4">
            {NAV.route}
          </Link>
          .
        </Alert>
      )}

      {/* Find one concrete mission: local search over what the cards say. Not offered while changing a reservation. */}
      {!replacing && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar misión"
            placeholder="Busca por nombre, tema o salón"
            enterKeyHint="search"
            autoComplete="off"
            className="min-h-12 w-full rounded-full border border-line bg-surface/80 pl-11 pr-12 text-base text-ink placeholder:text-ink-muted focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
          />
          {searching && (
            <button
              onClick={() => setQuery('')}
              aria-label="Borrar búsqueda"
              className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted hover:text-ink"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      )}

      {exploring ? (
        <MissionExplorer
          workshops={workshops}
          divisions={divisions.data}
          theme={theme}
          accent={(theme.colors.accent || theme.colors.secondary)}
          featured={forYou.slice(0, 3).map(renderCard)}
          featuredTotal={forYou.length}
          liveCount={workshops.filter((w) => w.some((s) => s.in_progress)).length}
          liveOpenCount={workshops.filter((w) => w.some((s) => s.in_progress && isSelectable(sessionState(board, s, null)))).length}
          lifeCount={workshops.filter((w) => isUniversityLife(w[0])).length}
          href={hrefFor}
        />
      ) : (
        <>
          <div ref={chipRows} className="sticky top-[calc(3rem+env(safe-area-inset-top))] z-20 -mx-4 bg-surface-sunken/90 backdrop-blur">
          <div className="no-scrollbar flex gap-2 overflow-x-auto overscroll-x-contain px-4 py-2" aria-label="Filtrar misiones" role="group">
            {!replacing && (
              <button className={chip(false)} onClick={() => setFilter({ kind: 'explore' })}>
                <Compass className="h-4 w-4" aria-hidden />
                Áreas
              </button>
            )}
            <button className={chip(isFilter({ kind: 'all' }) || (current.kind === 'explore' && searching))} aria-pressed={isFilter({ kind: 'all' }) || (current.kind === 'explore' && searching)} onClick={() => setFilter({ kind: 'all' })}>
              Todos
            </button>
            {recommendedIds.size > 0 && (
              <button className={chip(isFilter({ kind: 'foryou' }), 'accent')} aria-pressed={isFilter({ kind: 'foryou' })} onClick={() => setFilter({ kind: 'foryou' })}>
                <Sparkles className="h-4 w-4" aria-hidden />
                Para ti
              </button>
            )}
            {anyLive && (
              <button className={chip(isFilter({ kind: 'live' }))} aria-pressed={isFilter({ kind: 'live' })} onClick={() => setFilter({ kind: 'live' })}>
                <span className="anim-blink h-2 w-2 rounded-full bg-current" aria-hidden />
                En curso
              </button>
            )}
            {/* Vida Universitaria is a first-class filter, right next to the personal ones and before the divisions. */}
            {anyLife && (
              <button className={chip(current.kind === 'life')} aria-pressed={current.kind === 'life'} onClick={() => setFilter({ kind: 'life' })}>
                <Flag className="h-4 w-4" aria-hidden />
                {UNIVERSITY_LIFE}
              </button>
            )}
            {divisions.data.map((d) => (
              <button key={d.id} className={chip(isFilter({ kind: 'division', id: d.id }))} aria-pressed={isFilter({ kind: 'division', id: d.id })} onClick={() => setFilter({ kind: 'division', id: d.id })}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: divisionColor(theme, d) }} aria-hidden />
                {d.name}
              </button>
            ))}
          </div>
          {/* Kinds of experience: only while Vida Universitaria is selected, and only when there is more than one. */}
          {current.kind === 'life' && lifeCategories.length > 1 && (
            <div className="no-scrollbar flex gap-2 overflow-x-auto overscroll-x-contain px-4 pb-2" aria-label="Tipo de experiencia" role="group">
              {[{ value: undefined as string | undefined, label: 'Todas' }, ...lifeCategories].map((c) => {
                const on = current.category === c.value;
                return (
                  <button
                    key={c.value ?? 'all'}
                    aria-pressed={on}
                    onClick={() => setFilter({ kind: 'life', ...(c.value ? { category: c.value } : {}) })}
                    className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-3.5 text-[13px] font-semibold transition-colors duration-200 ${
                      on ? 'border-secondary-400 bg-secondary-500/20 text-ink' : 'border-line/70 bg-transparent text-ink-muted hover:text-ink'
                    }`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          )}
          </div>

          <p className="px-1 text-xs font-semibold text-ink-muted" role="status" aria-live="polite">
            {searching
              ? `${visible.length} ${visible.length === 1 ? 'resultado' : 'resultados'} para «${query.trim()}»`
              : `${visible.length} ${visible.length === 1 ? 'misión' : 'misiones'}`}
          </p>

          {current.kind === 'foryou' && (
            <section className="relative animate-fade-up overflow-hidden rounded-theme border border-accent-500/40 bg-accent-500/10 p-4" aria-label="Misiones para ti">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-500/20 text-fg-accent" aria-hidden>
                  <Sparkles className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-extrabold">Misiones para ti</p>
                  <p className="text-xs text-ink-muted">Relacionadas con las carreras que elegiste. Tú decides cuáles agregar a tu ruta.</p>
                </div>
              </div>
            </section>
          )}

          {visible.length === 0 ? (
            <EmptyState icon={Telescope} title={searching ? `No encontramos «${query.trim()}»` : current.kind === 'all' ? text('activitiesEmpty') : 'No hay misiones con este filtro'}>
              {searching ? 'Prueba con otra palabra (un tema, el área o el nombre del salón) o borra la búsqueda.' : current.kind === 'all' ? undefined : 'Prueba con «Todos» para ver todas las misiones.'}
            </EmptyState>
          ) : (
            <ul key={listKey} className="space-y-3">
              {visible.map(renderCard)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
