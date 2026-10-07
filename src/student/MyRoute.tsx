import { Award, CalendarPlus, Check, Clock, MapPin, QrCode } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, buttonClasses, LoadError, PageSkeleton } from '../components/ui';
import { fetchDivisions, formatTime, type Division } from '../lib/catalog';
import { canModify, hasTightTransfer, isActiveReservation, type Board } from '../lib/reservations';
import { buildJourney, timingLabel, type Stop } from '../lib/studentJourney';
import { useLoad } from '../lib/useLoad';
import { useNow } from '../lib/useNow';
import { useReservationBoard } from '../lib/useReservationBoard';
import { useEdition } from '../edition/EditionProvider';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import ConfirmSheet, { type ConfirmRequest } from './reservations/ConfirmSheet';
import WindowNotice from './reservations/WindowNotice';

const BADGE: Record<string, { label: string; tone: 'info' | 'success' | 'neutral' | 'error' | 'warning' }> = {
  active: { label: 'Reservada', tone: 'info' },
  in_progress: { label: 'En curso', tone: 'info' },
  completed: { label: 'Completada', tone: 'success' },
  ended: { label: 'Registra tu asistencia', tone: 'warning' },
  expired: { label: 'Horario finalizado', tone: 'neutral' },
  cancelled: { label: 'Sesión cancelada', tone: 'error' },
};

type Variant = 'now' | 'next' | 'later' | 'pending' | 'done' | 'closed';

/** Mi ruta as the day's journey: NOW, NEXT, LATER, still to register, and done. Operational actions stay small. */
export default function MyRoute() {
  const { term } = usePublicTheme();
  const { edition } = useEdition();
  const { board, error, loading, reload, cancel } = useReservationBoard(edition?.id);
  const divisions = useLoad(fetchDivisions, []);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const now = useNow();

  if ((loading && !board) || (divisions.loading && !divisions.data)) return <PageSkeleton blocks={3} />;
  if (error || !board) return <LoadError error={error} onRetry={reload} />;
  if (divisions.error || !divisions.data) return <LoadError error={divisions.error} onRetry={divisions.reload} />;

  const divisionById = new Map(divisions.data.map((d) => [d.id, d]));
  const sessionOfReservation = new Map(board.reservations.map((r) => [r.id, board.sessions.find((s) => s.id === r.session_id)]));
  const journey = buildJourney(board);
  const activeCount = board.active_reservation_count;
  const total = journey.now.length + journey.upcoming.length + journey.pending.length + journey.done.length + journey.closed.length;

  const cardProps = { board, divisionById, sessionOfReservation, now, onAskCancel: setConfirm, cancel };
  const canAdd = activeCount < board.max_reservations && board.window === 'open';

  const section = (label: string, stops: Stop[], variantOf: (i: number) => Variant) =>
    stops.length > 0 && (
      <section key={label} aria-label={label} className="space-y-3">
        <h2 className="text-xs font-extrabold uppercase tracking-widest text-ink-muted">{label}</h2>
        <ol className="space-y-3">
          {stops.map((stop, i) => (
            <StopCard key={stop.reservation.id} stop={stop} variant={variantOf(i)} {...cardProps} />
          ))}
        </ol>
      </section>
    );

  return (
    <div className="space-y-5">
      <header className="animate-fade-up">
        <h1 className="text-2xl font-extrabold">{term('route')}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {activeCount} de {board.max_reservations} talleres activos · Recomendamos {board.travel_buffer_minutes} min entre talleres
        </p>
        <div className="mt-3 flex gap-1.5" aria-hidden>
          {Array.from({ length: board.max_reservations }, (_, i) => (
            <span key={i} className={`h-2 flex-1 rounded-full ${i < activeCount ? 'bg-primary-500' : 'bg-line'}`} />
          ))}
        </div>
      </header>

      <WindowNotice board={board} />

      {total === 0 ? (
        <div className="card animate-fade-up p-6 text-center">
          <CalendarPlus className="mx-auto h-10 w-10 text-ink-muted" aria-hidden />
          <p className="mt-3 font-semibold">Tu ruta está vacía</p>
          <p className="mt-1 text-sm text-ink-muted">Elige horarios de talleres para armarla.</p>
          <Link to="/misiones" className={buttonClasses('primary', 'mt-4')}>
            Ver {term('activity', true).toLowerCase()}
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {section('Ahora', journey.now, () => 'now')}
          {section('Falta registrar asistencia', journey.pending, () => 'pending')}
          {section(journey.now.length > 0 ? 'Sigue' : 'Sigue', journey.upcoming.slice(0, 1), () => 'next')}
          {section('Después', journey.upcoming.slice(1), () => 'later')}
          {section('Completados', journey.done, () => 'done')}
          {journey.closed.length > 0 && (
            <details className="group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center text-xs font-extrabold uppercase tracking-widest text-ink-muted">
                Historial ({journey.closed.length})
              </summary>
              <ol className="mt-3 space-y-3">
                {journey.closed.map((stop) => (
                  <StopCard key={stop.reservation.id} stop={stop} variant="closed" {...cardProps} />
                ))}
              </ol>
            </details>
          )}
          {canAdd && (
            <Link to="/misiones" className={buttonClasses('secondary', 'w-full')}>
              <CalendarPlus className="h-4 w-4" aria-hidden />
              Agregar otro taller
            </Link>
          )}
        </div>
      )}

      {confirm && <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function StopCard({
  stop, variant, board, divisionById, sessionOfReservation, now, onAskCancel, cancel,
}: {
  stop: Stop;
  variant: Variant;
  board: Board;
  divisionById: Map<string, Division>;
  sessionOfReservation: Map<string, Stop['session'] | undefined>;
  now: number;
  onAskCancel: (request: ConfirmRequest) => void;
  cancel: (reservationId: string) => Promise<unknown>;
}) {
  const { theme } = usePublicTheme();
  const navigate = useNavigate();
  const { reservation: r, session: s } = stop;
  const division = divisionById.get(s.division_id ?? '');
  const color = (division && theme.divisions[division.code]?.color) || theme.colors.secondary;
  const ds = r.derived_status || r.status;
  const badge = BADGE[ds] || { label: r.status, tone: 'neutral' as const };
  const allowed = canModify(board, s, r);
  const live = variant === 'now';
  const tight = isActiveReservation(r) && hasTightTransfer(s);
  const tightNext = tight && s.tight_transfer_with.some((id) => (sessionOfReservation.get(id)?.starts_at ?? '') > s.starts_at);
  const cancelled = ds === 'cancelled';
  const completed = ds === 'completed';
  const toRegister = ds === 'ended';
  const showTiming = variant === 'now' || variant === 'next' || variant === 'later';

  const askCancel = () =>
    onAskCancel({
      title: 'Cancelar reservación',
      body: `Liberarás tu lugar en ${s.title} (${formatTime(s.starts_at)}). Otra persona podrá tomarlo.`,
      confirmLabel: 'Liberar lugar',
      danger: true,
      action: () => cancel(r.id),
    });

  return (
    <li className="relative pl-7">
      {/* timeline spine + stop marker: state shown by shape and icon, not only colour */}
      <span className="absolute bottom-[-0.75rem] left-[9px] top-5 w-0.5 bg-line" aria-hidden />
      <span
        className={`absolute left-0 top-4 flex h-5 w-5 items-center justify-center rounded-full border-2 ${
          live
            ? 'anim-ring-pulse border-primary-500 bg-primary-500'
            : completed
              ? 'border-success-500 bg-success-500 text-white'
              : toRegister
                ? 'border-warning-500 bg-warning-500'
                : cancelled
                  ? 'border-error-500 bg-surface'
                  : 'border-primary-500 bg-surface-sunken'
        }`}
        aria-hidden
      >
        {completed && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>

      <div
        className={`overflow-hidden rounded-theme border ${
          live ? 'border-primary-500 bg-primary-500/10' : cancelled ? 'border-error-500/50 bg-surface' : 'border-line bg-surface'
        } ${variant === 'done' || variant === 'closed' ? 'opacity-90' : ''}`}
      >
        <div className="h-1" style={{ background: color }} />
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xl font-extrabold leading-none">
              <Clock className="h-4 w-4 text-ink-muted" aria-hidden />
              {formatTime(s.starts_at)}
              <span className="text-sm font-normal text-ink-muted">· {Math.round((new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000)} min</span>
            </p>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </div>
          {showTiming && <p className={`mt-2 text-sm font-bold ${live ? 'text-fg-brand' : 'text-ink'}`}>{timingLabel(s, now)}</p>}
          <h3 className={`mt-1 text-base font-semibold leading-snug ${cancelled ? 'text-ink-muted line-through' : ''}`}>{s.title}</h3>
          <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide" style={{ color }}>
            {division?.name}
          </p>
          {s.location && (
            <p className="mt-2 flex items-start gap-1.5 text-sm text-ink-muted">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">{s.location}</span>
            </p>
          )}
          {completed && r.credits_granted != null && (
            <p className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-fg-success">
              <Award className="h-4 w-4" aria-hidden />
              {r.credits_granted} {r.credits_granted === 1 ? 'sello' : 'sellos'} obtenidos
            </p>
          )}
          {cancelled && (
            <p className="mt-2 text-sm text-ink-muted">Coordinación canceló este horario. Tu lugar ya no cuenta en tu ruta; elige otra sesión.</p>
          )}
          {tight && (
            <p className="mt-2 text-sm font-semibold text-fg-warning">
              Traslado ajustado ·{' '}
              {tightNext
                ? `tienes menos de ${board.travel_buffer_minutes} min para llegar a tu siguiente taller.`
                : `llegas con menos de ${board.travel_buffer_minutes} min desde tu taller anterior.`}
            </p>
          )}
          {toRegister && (
            <p className="mt-2 text-sm text-ink-muted">
              El horario terminó. Si participaste, registra tu asistencia con el QR del taller; si no, puedes reservar otra sesión de este taller.
            </p>
          )}
          {ds === 'expired' && (
            <p className="mt-2 text-sm text-ink-muted">El horario finalizó. Puedes reservar otra sesión de este taller si hay disponibles.</p>
          )}

          {(live || toRegister) && (
            <Link to="/escanear" className={buttonClasses('primary', 'mt-4 w-full')}>
              <QrCode className="h-4 w-4" aria-hidden />
              Registrar asistencia
            </Link>
          )}
          {(cancelled || ds === 'expired' || toRegister) && board.window === 'open' && (
            <Link to="/misiones" className={buttonClasses(live || toRegister ? 'ghost' : 'primary', 'mt-2 w-full')}>
              Elegir otra sesión
            </Link>
          )}
          {(allowed.change || allowed.cancel) && (
            <div className="-mb-1 mt-3 flex items-center gap-1 border-t border-line pt-2">
              {allowed.change && (
                <button
                  className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold text-ink-muted hover:bg-surface-raised hover:text-ink"
                  onClick={() => navigate(`/misiones?cambiar=${r.id}`)}
                >
                  Cambiar
                </button>
              )}
              {allowed.cancel && (
                <button
                  className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold text-ink-muted hover:bg-surface-raised hover:text-ink"
                  onClick={askCancel}
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
}
