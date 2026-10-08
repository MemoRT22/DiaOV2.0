import { ArrowLeftRight, Check, Clock3, MapPin, Sparkles, X } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, LoadError, PageSkeleton } from '../components/ui';
import { fetchDivisions, formatTime } from '../lib/catalog';
import { recommendationReason } from '../lib/recommendationReason';
import { fetchRecommendedActivities } from '../lib/recommendationsApi';
import { belongsToDivision, type BoardSession } from '../lib/reservations';
import { workshopAvailability, workshopDivisionIds, workshopDuration, workshopLocation, workshopPersonalStatus } from '../lib/workshopDiscovery';
import { useLoad } from '../lib/useLoad';
import { useParticipantSync } from '../lib/useParticipantSync';
import { useReservationBoard } from '../lib/useReservationBoard';
import { useEdition } from '../edition/EditionProvider';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import WindowNotice from './reservations/WindowNotice';

type Filter = { kind: 'all' } | { kind: 'foryou' } | { kind: 'live' } | { kind: 'division'; id: string };

/** Compact catalogue: one activity per card; the detail owns every session and booking action. */
export default function Missions() {
  const { theme, term, text } = usePublicTheme();
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
  if (error || !board) return <LoadError error={error} onRetry={reload} />;
  if (divisions.error || !divisions.data) return <LoadError error={divisions.error} onRetry={divisions.reload} />;

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

  const chip = (on: boolean) =>
    `min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors ${
      on ? 'border-primary-500 bg-primary-500 text-on-primary' : 'border-line bg-surface text-ink-muted hover:text-ink'
    }`;
  const isFilter = (f: Filter) => JSON.stringify(f) === JSON.stringify(current);

  return (
    <div className="space-y-4">
      <header className="animate-fade-up">
        <h1 className="text-2xl font-extrabold">{term('activity', true)}</h1>
        {!replacing && (
          <Link to="/ruta" className="mt-1 inline-flex min-h-11 items-center gap-3 text-sm text-ink-muted" aria-label={`Llevas ${active} de ${board.max_reservations} en ${term('route')}`}>
            <span className="flex gap-1.5" aria-hidden>
              {Array.from({ length: board.max_reservations }, (_, i) => (
                <span key={i} className={`h-2.5 w-7 rounded-full ${i < active ? 'bg-primary-500' : 'bg-line'}`} />
              ))}
            </span>
            <span>
              Llevas {active} de {board.max_reservations} en <span className="font-semibold text-fg-brand">{term('route')}</span>
            </span>
          </Link>
        )}
        {!replacing && <p className="sr-only">{text('activitiesIntro')}</p>}
      </header>

      {replacing && replacingSession ? (
        <div className="card flex items-center gap-3 border-primary-500/50 p-3">
          <ArrowLeftRight className="h-5 w-5 shrink-0 text-fg-brand" aria-hidden />
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
          Tu ruta está completa ({active} de {board.max_reservations}). Para elegir otro, cambia o cancela uno desde{' '}
          <Link to="/ruta" className="font-semibold underline underline-offset-4">
            {term('route')}
          </Link>
          .
        </Alert>
      )}

      <div className="no-scrollbar sticky top-[calc(3rem+env(safe-area-inset-top))] z-20 -mx-4 flex gap-2 overflow-x-auto overscroll-x-contain bg-surface-sunken/90 px-4 py-2 backdrop-blur" aria-label="Filtrar" role="group">
        <button className={chip(isFilter({ kind: 'all' }))} aria-pressed={isFilter({ kind: 'all' })} onClick={() => setFilter({ kind: 'all' })}>
          Todos
        </button>
        {recommendedIds.size > 0 && (
          <button className={chip(isFilter({ kind: 'foryou' }))} aria-pressed={isFilter({ kind: 'foryou' })} onClick={() => setFilter({ kind: 'foryou' })}>
            Para ti
          </button>
        )}
        {anyLive && (
          <button className={chip(isFilter({ kind: 'live' }))} aria-pressed={isFilter({ kind: 'live' })} onClick={() => setFilter({ kind: 'live' })}>
            En curso
          </button>
        )}
        {divisions.data.map((d) => (
          <button key={d.id} className={chip(isFilter({ kind: 'division', id: d.id }))} aria-pressed={isFilter({ kind: 'division', id: d.id })} onClick={() => setFilter({ kind: 'division', id: d.id })}>
            {d.name}
          </button>
        ))}
      </div>

      {current.kind === 'foryou' && (
        <div className="-mt-1">
          <p className="text-sm font-bold">Talleres para ti</p>
          <p className="text-xs text-ink-muted">Sugerencias basadas en las carreras que elegiste. Tú decides qué agregar a tu ruta.</p>
        </div>
      )}

      {visible.length === 0 ? (
        <Alert>{current.kind === 'all' ? text('activitiesEmpty') : 'No hay talleres con este filtro.'}</Alert>
      ) : (
        <ul className="space-y-3">
          {visible.map((sessions, i) => {
            const first = sessions[0];
            const divisionNames = workshopDivisionIds(first).map((id) => divisionById.get(id)?.name).filter((name): name is string => !!name);
            const onlyDivision = workshopDivisionIds(first).length === 1 ? divisionById.get(workshopDivisionIds(first)[0]) : null;
            const color = (onlyDivision && theme.divisions[onlyDivision.code]?.color) || theme.colors.secondary;
            const location = workshopLocation(sessions);
            const rec = recommendations.find((r) => r.activity_id === first.activity_id);
            const why = rec ? recommendationReason(rec) : null;
            const status = workshopPersonalStatus(sessions, rec?.already_attended, rec?.already_reserved);
            return (
              <li key={first.activity_id} className="card animate-fade-up overflow-hidden" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                <div className="h-1" style={{ background: color }} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color }}>
                        {divisionNames.length ? divisionNames.join(' · ') : 'Vida Universitaria'}
                      </p>
                      <h2 className="mt-0.5 text-base font-extrabold leading-snug">{first.title}</h2>
                    </div>
                    {status ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-500/15 px-2.5 py-1 text-xs font-bold text-fg-success">
                        <Check className="h-3 w-3" aria-hidden />
                        {status}
                      </span>
                    ) : null}
                  </div>
                  {first.description && <p className="mt-2 line-clamp-3 text-sm text-ink-muted">{first.description}</p>}
                  {why?.reason && status !== 'Explorado' && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-ink-muted">
                      <Sparkles className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${status === 'En tu ruta' ? 'text-ink-muted' : 'text-fg-brand'}`} aria-hidden />
                      <span className="line-clamp-2 min-w-0 break-words">{why.reason}</span>
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                    <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" aria-hidden />{workshopDuration(sessions)}</span>
                    {location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden />{location}</span>}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
                    <span className="text-xs font-semibold text-ink-muted">{workshopAvailability(board, sessions, replacing)}</span>
                    <Link to={`/misiones/${first.activity_id}${params.toString() ? `?${params.toString()}` : ''}`} className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-primary-500 px-4 text-sm font-bold text-on-primary">
                      Ver taller
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

    </div>
  );
}
