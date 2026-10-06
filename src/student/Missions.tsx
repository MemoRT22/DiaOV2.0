import { ArrowLeftRight, Compass, Check, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, LoadError, PageSkeleton } from '../components/ui';
import { fetchDivisions, formatTime } from '../lib/catalog';
import { fetchRecommendedActivities, type RecommendedActivity } from '../lib/recommendationsApi';
import { sessionState, type BoardSession } from '../lib/reservations';
import { useLoad } from '../lib/useLoad';
import { useReservationBoard } from '../lib/useReservationBoard';
import { useEdition } from '../edition/EditionProvider';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import ConfirmSheet, { type ConfirmRequest } from './reservations/ConfirmSheet';
import SessionRow from './reservations/SessionRow';
import WindowNotice from './reservations/WindowNotice';

export default function Missions() {
  const { theme, term, text } = usePublicTheme();
  const { edition } = useEdition();
  const { board, error, loading, reload, reserve, change } = useReservationBoard(edition?.id);
  const divisions = useLoad(fetchDivisions, []);
  const recs = useLoad(() => fetchRecommendedActivities().catch(() => null), []);
  const [filter, setFilter] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const replacing = useMemo(() => {
    const id = params.get('cambiar');
    return board?.reservations.find((r) => r.id === id && r.status === 'vigente') ?? null;
  }, [board, params]);
  const replacingSession = replacing && board?.sessions.find((s) => s.id === replacing.session_id);

  const workshops = useMemo(() => {
    const byActivity = new Map<string, BoardSession[]>();
    for (const s of board?.sessions ?? []) {
      if (s.status !== 'activa') continue;
      byActivity.set(s.activity_id, [...(byActivity.get(s.activity_id) ?? []), s]);
    }
    return [...byActivity.values()];
  }, [board]);

  if ((loading && !board) || (divisions.loading && !divisions.data)) return <PageSkeleton blocks={4} />;
  if (error || !board) return <LoadError error={error} onRetry={reload} />;
  if (divisions.error || !divisions.data) return <LoadError error={divisions.error} onRetry={divisions.reload} />;

  const divisionById = new Map(divisions.data.map((d) => [d.id, d]));
  const visible = filter ? workshops.filter((w) => w[0].division_id === filter) : workshops;
  const active = board.active_reservation_count;

  const recommendations = recs.data?.recommendations ?? [];
  const recommendedIds = new Set(recommendations.map((r) => r.activity_id));
  const notYetAttended = recommendations.filter((r) => !r.already_attended);

  const ask = (s: BoardSession) => {
    const when = `${formatTime(s.starts_at)}–${formatTime(s.ends_at)}`;
    if (replacing && replacingSession) {
      setConfirm({
        title: 'Cambiar horario',
        body: `Cambiarás ${replacingSession.title} (${formatTime(replacingSession.starts_at)}) por ${s.title} (${when}). Si el nuevo lugar ya no está disponible, conservas tu reservación actual.`,
        confirmLabel: 'Confirmar cambio',
        action: async () => {
          await change(replacing.id, s.id);
          navigate('/ruta');
        },
      });
    } else {
      setConfirm({
        title: 'Reservar lugar',
        body: `${s.title} · ${when}${s.location ? ` · ${s.location}` : ''}`,
        confirmLabel: 'Reservar',
        action: () => reserve(s.id),
      });
    }
  };

  const chip = (on: boolean) =>
    `min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors ${
      on ? 'border-primary-500 bg-primary-500 text-on-primary' : 'border-line bg-surface text-ink-muted hover:text-ink'
    }`;

  return (
    <div className="space-y-5">
      <header className="animate-fade-up">
        <h1 className="text-2xl font-extrabold">{term('activity', true)}</h1>
        <p className="mt-1 text-sm text-ink-muted">{text('activitiesIntro')}</p>
      </header>

      {replacing && replacingSession ? (
        <div className="card flex items-center gap-3 border-secondary-500/50 p-3">
          <ArrowLeftRight className="h-5 w-5 shrink-0 text-secondary-300" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            Elige el nuevo horario para <strong>{replacingSession.title}</strong> ({formatTime(replacingSession.starts_at)}).
          </p>
          <button
            onClick={() => setParams({}, { replace: true })}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-raised hover:text-ink"
            aria-label="Cancelar cambio"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
      ) : (
        <WindowNotice board={board} />
      )}

      {!replacing && board.window === 'open' && (
        <p className="text-sm text-ink-muted">
          Llevas {active} de {board.max_reservations} en <Link to="/ruta" className="font-semibold text-primary-300 underline-offset-4 hover:underline">{term('route')}</Link>.
        </p>
      )}

      {notYetAttended.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-primary-400" aria-hidden />
            <h2 className="text-lg font-extrabold">Recomendados para ti</h2>
          </div>
          {notYetAttended.map((rec) => (
            <RecommendedCard
              key={rec.activity_id}
              rec={rec}
              theme={theme}
              board={board}
              replacing={replacing}
              onAsk={ask}
            />
          ))}
        </section>
      )}

      <div className="-mx-4 flex gap-2 overflow-x-auto overscroll-x-contain px-4 pb-1 [scrollbar-width:none]" aria-label={term('division', true)}>
        <button className={chip(filter === null)} onClick={() => setFilter(null)}>
          Todos
        </button>
        {divisions.data.map((d) => (
          <button key={d.id} className={chip(filter === d.id)} onClick={() => setFilter(d.id)}>
            {d.name}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <Alert>{text('activitiesEmpty')}</Alert>
      ) : (
        <ul className="space-y-3">
          {visible.map((sessions, i) => {
            const first = sessions[0];
            const division = divisionById.get(first.division_id);
            const color = (division && theme.divisions[division.code]?.color) || theme.colors.secondary;
            const sharedLocation = sessions.every((s) => s.location === first.location) ? first.location : '';
            const isRecommended = recommendedIds.has(first.activity_id);
            const rec = recommendations.find((r) => r.activity_id === first.activity_id);
            return (
              <li key={first.activity_id} className="card animate-fade-up overflow-hidden" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                <div className="h-1" style={{ background: color }} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color }}>
                        {term('division')} · {division?.name}
                      </p>
                      <h2 className="mt-1 text-base font-extrabold">{first.title}</h2>
                    </div>
                    {isRecommended && !rec?.already_attended && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-500/15 px-2.5 py-0.5 text-xs font-semibold text-primary-400">
                        <Compass className="h-3 w-3" />
                        Para ti
                      </span>
                    )}
                    {rec?.already_attended && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-500/15 px-2.5 py-0.5 text-xs font-semibold text-success-400">
                        <Check className="h-3 w-3" />
                        Explorado
                      </span>
                    )}
                  </div>
                  {first.description && <p className="mt-2 text-sm text-ink-muted">{first.description}</p>}
                  {isRecommended && rec && rec.related_careers && (
                    <p className="mt-1 text-xs text-primary-400">
                      {rec.already_attended ? 'Relacionado con: ' : 'Recomendado porque te interesa: '}
                      {rec.related_careers}
                    </p>
                  )}
                  {sharedLocation && <p className="mt-2 text-xs text-ink-muted">{sharedLocation}</p>}
                  <ul className="mt-3 space-y-2">
                    {sessions.map((s) => (
                      <SessionRow
                        key={s.id}
                        session={s}
                        state={sessionState(board, s, replacing)}
                        actionLabel={replacing ? 'Cambiar aquí' : 'Reservar'}
                        onAction={() => ask(s)}
                        showLocation={!sharedLocation}
                      />
                    ))}
                  </ul>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {confirm && <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function RecommendedCard({
  rec,
  theme,
  board,
  replacing,
  onAsk,
}: {
  rec: RecommendedActivity;
  theme: ReturnType<typeof usePublicTheme>['theme'];
  board: ReturnType<typeof useReservationBoard>['board'];
  replacing: ReturnType<typeof useReservationBoard>['board'] extends infer B ? (B extends null ? null : { id: string }) : null;
  onAsk: (s: BoardSession) => void;
}) {
  const color = theme.divisions[rec.division_code]?.color ?? theme.colors.secondary;
  const availableSessions = rec.sessions.filter((s) => !s.started && s.remaining > 0);
  const hasAvailable = availableSessions.length > 0;

  return (
    <div className="card animate-fade-up overflow-hidden border-primary-500/30" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color }}>
          {rec.division_name}
        </p>
        <h3 className="mt-1 text-base font-extrabold">{rec.title}</h3>
        <p className="mt-1 text-xs text-primary-400">Recomendado porque te interesa: {rec.related_careers}</p>
        {rec.description && <p className="mt-2 text-sm text-ink-muted">{rec.description}</p>}

        {hasAvailable ? (
          <ul className="mt-3 space-y-2">
            {availableSessions.slice(0, 3).map((s) => {
              const boardSession: BoardSession = {
                id: s.session_id,
                activity_id: rec.activity_id,
                title: rec.title,
                description: rec.description,
                division_id: rec.division_id,
                starts_at: s.starts_at,
                ends_at: s.ends_at,
                location: s.location,
                credits: s.credits,
                status: 'activa',
                capacity: s.capacity,
                reserved: s.reserved,
                remaining: s.remaining,
                started: s.started,
                my_reservation_id: rec.already_reserved ? 'rec' : null,
                conflicts_with: [],
                attended: rec.already_attended ?? false,
              };
              return (
                <SessionRow
                  key={s.session_id}
                  session={boardSession}
                  state={sessionState(board!, boardSession, replacing as never)}
                  actionLabel="Reservar"
                  onAction={() => onAsk(boardSession)}
                  showLocation
                />
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink-muted">
            {rec.sessions.length > 0 ? 'Las sesiones de este taller ya iniciaron o están llenas.' : 'No hay sesiones disponibles en este momento.'}
          </p>
        )}
      </div>
    </div>
  );
}
