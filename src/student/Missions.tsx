import { ArrowLeftRight, Sparkles, Telescope, X } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, PageSkeleton } from '../components/ui';
import { fetchDivisions, formatTime } from '../lib/catalog';
import { recommendationReason } from '../lib/recommendationReason';
import { fetchRecommendedActivities } from '../lib/recommendationsApi';
import { belongsToDivision, type BoardSession } from '../lib/reservations';
import { workshopDivisionIds } from '../lib/workshopDiscovery';
import { useLoad } from '../lib/useLoad';
import { useParticipantSync } from '../lib/useParticipantSync';
import { useReservationBoard } from '../lib/useReservationBoard';
import { useEdition } from '../edition/EditionProvider';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import { MISSION, NAV } from './copy';
import MissionCard from './MissionCard';
import WindowNotice from './reservations/WindowNotice';
import { divisionColor } from './ui/divisionVisuals';
import { PageHeader } from './ui/PageHeader';
import { RouteMeter } from './ui/RouteMeter';
import { EmptyState, ErrorState } from './ui/States';

type Filter = { kind: 'all' } | { kind: 'foryou' } | { kind: 'live' } | { kind: 'division'; id: string };

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
    : { kind: 'all' };
  const setFilter = (next: Filter) => {
    const updated = new URLSearchParams(params);
    updated.delete('f');
    updated.delete('d');
    if (next.kind !== 'all') updated.set('f', next.kind);
    if (next.kind === 'division') updated.set('d', next.id);
    setParams(updated);
  };

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
  const current: Filter =
    (filter.kind === 'foryou' && recommendedIds.size === 0) || (filter.kind === 'live' && !anyLive) ? { kind: 'all' } : filter;
  const visible = workshops.filter((w) => {
    if (current.kind === 'foryou') return recommendedIds.has(w[0].activity_id);
    if (current.kind === 'live') return w.some((s) => s.in_progress);
    if (current.kind === 'division') return belongsToDivision(w[0], current.id);
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
  const listKey = JSON.stringify(current);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={MISSION.descriptor} title={MISSION.many} subtitle={!replacing ? 'Elige las que quieras vivir y agrégalas a tu ruta.' : undefined} />
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
        <WindowNotice board={board} />
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

      <div className="no-scrollbar sticky top-[calc(3rem+env(safe-area-inset-top))] z-20 -mx-4 flex gap-2 overflow-x-auto overscroll-x-contain bg-surface-sunken/90 px-4 py-2 backdrop-blur" aria-label="Filtrar misiones" role="group">
        <button className={chip(isFilter({ kind: 'all' }))} aria-pressed={isFilter({ kind: 'all' })} onClick={() => setFilter({ kind: 'all' })}>
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
        {divisions.data.map((d) => (
          <button key={d.id} className={chip(isFilter({ kind: 'division', id: d.id }))} aria-pressed={isFilter({ kind: 'division', id: d.id })} onClick={() => setFilter({ kind: 'division', id: d.id })}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: divisionColor(theme, d) }} aria-hidden />
            {d.name}
          </button>
        ))}
      </div>

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
        <EmptyState icon={Telescope} title={current.kind === 'all' ? text('activitiesEmpty') : 'No hay misiones con este filtro'}>
          {current.kind === 'all' ? undefined : 'Prueba con «Todos» para ver todas las misiones.'}
        </EmptyState>
      ) : (
        <ul key={listKey} className="space-y-3">
          {visible.map((sessions, i) => {
            const first = sessions[0];
            const ids = workshopDivisionIds(first);
            const divisionNames = ids.map((id) => divisionById.get(id)?.name).filter((name): name is string => !!name);
            const onlyDivision = ids.length === 1 ? divisionById.get(ids[0]) : null;
            const rec = recommendations.find((r) => r.activity_id === first.activity_id);
            const why = rec ? recommendationReason(rec) : null;
            return (
              <MissionCard
                key={first.activity_id}
                board={board}
                sessions={sessions}
                replacing={replacing}
                divisionLabel={divisionNames.length ? divisionNames.join(' · ') : 'Vida Universitaria'}
                divisionName={onlyDivision?.name ?? (divisionNames.length ? undefined : 'Vida Universitaria')}
                color={divisionColor(theme, onlyDivision)}
                reason={why?.reason || null}
                recommended={!!rec && !rec.already_attended}
                attended={rec?.already_attended}
                reserved={rec?.already_reserved}
                href={`/misiones/${first.activity_id}${params.toString() ? `?${params.toString()}` : ''}`}
                index={i}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
