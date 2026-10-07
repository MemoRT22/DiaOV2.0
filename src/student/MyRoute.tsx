import { CalendarPlus, Clock, MapPin, Award } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, buttonClasses, LoadError, PageSkeleton } from '../components/ui';
import { fetchDivisions, formatTime } from '../lib/catalog';
import { canModify, durationMinutes, hasTightTransfer, isActiveReservation } from '../lib/reservations';
import { useLoad } from '../lib/useLoad';
import { useReservationBoard } from '../lib/useReservationBoard';
import { useEdition } from '../edition/EditionProvider';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import ConfirmSheet, { type ConfirmRequest } from './reservations/ConfirmSheet';
import WindowNotice from './reservations/WindowNotice';

const DERIVED_BADGE: Record<string, { label: string; tone: 'info' | 'success' | 'neutral' | 'error' | 'warning' }> = {
  active: { label: 'Reservada', tone: 'info' },
  in_progress: { label: 'En curso', tone: 'info' },
  completed: { label: 'Completada', tone: 'success' },
  ended: { label: 'Registra tu asistencia', tone: 'warning' },
  expired: { label: 'Horario finalizado', tone: 'neutral' },
  cancelled: { label: 'Sesión cancelada', tone: 'error' },
};

export default function MyRoute() {
  const { theme, term } = usePublicTheme();
  const { edition } = useEdition();
  const { board, error, loading, reload, cancel } = useReservationBoard(edition?.id);
  const divisions = useLoad(fetchDivisions, []);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const navigate = useNavigate();

  if ((loading && !board) || (divisions.loading && !divisions.data)) return <PageSkeleton blocks={3} />;
  if (error || !board) return <LoadError error={error} onRetry={reload} />;
  if (divisions.error || !divisions.data) return <LoadError error={divisions.error} onRetry={divisions.reload} />;

  const divisionById = new Map(divisions.data.map((d) => [d.id, d]));
  const sessionById = new Map(board.sessions.map((s) => [s.id, s]));
  const sessionOfReservation = new Map(board.reservations.map((r) => [r.id, sessionById.get(r.session_id)]));
  const items = board.reservations
    .filter((r) => r.status === 'vigente' || r.status === 'expirada' || !r.resolved)
    .flatMap((r) => {
      const s = sessionById.get(r.session_id);
      return s ? [{ r, s }] : [];
    })
    .sort((a, b) => a.s.starts_at.localeCompare(b.s.starts_at));
  const activeCount = board.active_reservation_count;

  return (
    <div className="space-y-5">
      <header className="animate-fade-up">
        <h1 className="text-2xl font-extrabold">{term('route')}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {activeCount} de {board.max_reservations} talleres activos · Recomendamos {board.travel_buffer_minutes} min entre talleres
        </p>
      </header>

      <WindowNotice board={board} />

      {items.length === 0 ? (
        <div className="card animate-fade-up p-6 text-center">
          <CalendarPlus className="mx-auto h-10 w-10 text-ink-muted" aria-hidden />
          <p className="mt-3 font-semibold">Tu ruta está vacía</p>
          <p className="mt-1 text-sm text-ink-muted">Elige horarios de talleres para armarla.</p>
          <Link to="/misiones" className={buttonClasses('primary', 'mt-4')}>
            Ver {term('activity', true).toLowerCase()}
          </Link>
        </div>
      ) : (
        <ol className="relative space-y-4 border-l border-line pl-5">
          {items.map(({ r, s }, i) => {
            const division = divisionById.get(s.division_id);
            const color = (division && theme.divisions[division.code]?.color) || theme.colors.secondary;
            const ds = r.derived_status || r.status;
            const badge = DERIVED_BADGE[ds] || { label: r.status, tone: 'neutral' as const };
            const isCancelled = ds === 'cancelled';
            const isCompleted = ds === 'completed';
            const isCheckinOpen = ds === 'ended';
            const isEnded = ds === 'expired';
            const allowed = canModify(board, s, r);
            const tight = isActiveReservation(r) && hasTightTransfer(s);
            const tightNext = tight && s.tight_transfer_with.some((id) => (sessionOfReservation.get(id)?.starts_at ?? '') > s.starts_at);
            return (
              <li key={r.id} className="animate-fade-up relative" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
                <span
                  className="absolute -left-[27px] top-5 h-3 w-3 rounded-full ring-4 ring-surface-sunken"
                  style={{ background: isCancelled ? 'rgb(var(--c-error-500))' : isCompleted ? 'rgb(var(--c-success-500))' : color }}
                  aria-hidden
                />
                <div className={`card overflow-hidden ${isCancelled ? 'border-error-500/50' : ''}`}>
                  <div className="h-1" style={{ background: color }} />
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="flex items-center gap-1.5 text-lg font-extrabold">
                        <Clock className="h-4 w-4 text-ink-muted" aria-hidden />
                        {formatTime(s.starts_at)}
                        <span className="text-sm font-normal text-ink-muted">· {durationMinutes(s)} min</span>
                      </p>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </div>
                    <h2 className={`mt-1 text-base font-semibold ${isCancelled ? 'text-ink-muted line-through' : ''}`}>{s.title}</h2>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-wide" style={{ color }}>
                      {division?.name}
                    </p>
                    {s.location && (
                      <p className="mt-2 inline-flex items-center gap-1 text-sm text-ink-muted">
                        <MapPin className="h-4 w-4" aria-hidden />
                        {s.location}
                      </p>
                    )}
                    {isCompleted && r.credits_granted != null && (
                      <p className="mt-2 inline-flex items-center gap-1 text-sm font-semibold" style={{ color: 'rgb(var(--c-success-600))' }}>
                        <Award className="h-4 w-4" aria-hidden />
                        {r.credits_granted} {r.credits_granted === 1 ? 'sello' : 'sellos'} obtenidos
                      </p>
                    )}
                    {isCancelled && (
                      <p className="mt-2 text-sm text-ink-muted">
                        Coordinación canceló este horario. Tu lugar ya no cuenta en tu ruta; elige otra sesión.
                      </p>
                    )}
                    {tight && (
                      <p className="mt-2 text-sm font-semibold text-fg-warning">
                        Traslado ajustado ·{' '}
                        {tightNext
                          ? `tienes menos de ${board.travel_buffer_minutes} min para llegar a tu siguiente taller.`
                          : `llegas con menos de ${board.travel_buffer_minutes} min desde tu taller anterior.`}
                      </p>
                    )}
                    {isCheckinOpen && (
                      <p className="mt-2 text-sm text-ink-muted">
                        El horario terminó. Si participaste, registra tu asistencia con el QR del taller; si no, puedes reservar otra sesión de este taller.
                      </p>
                    )}
                    {isEnded && (
                      <p className="mt-2 text-sm text-ink-muted">
                        El horario finalizó. Puedes reservar otra sesión de este taller si hay disponibles.
                      </p>
                    )}
                    {(isCancelled || isEnded || isCheckinOpen) && board.window === 'open' && (
                      <Link to="/misiones" className={buttonClasses('primary', 'mt-3 w-full')}>
                        Elegir otra sesión
                      </Link>
                    )}
                    {(allowed.change || allowed.cancel) && (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {allowed.change ? (
                          <button className={buttonClasses('secondary')} onClick={() => navigate(`/misiones?cambiar=${r.id}`)}>
                            Cambiar
                          </button>
                        ) : (
                          <span />
                        )}
                        {allowed.cancel && (
                          <button
                            className={buttonClasses('ghost')}
                            onClick={() =>
                              setConfirm({
                                title: 'Cancelar reservación',
                                body: `Liberarás tu lugar en ${s.title} (${formatTime(s.starts_at)}). Otra persona podrá tomarlo.`,
                                confirmLabel: 'Liberar lugar',
                                danger: true,
                                action: () => cancel(r.id),
                              })
                            }
                          >
                            Cancelar
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {confirm && <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}
