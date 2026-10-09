import { ArrowRight, BadgeCheck, CalendarPlus, Check, Plus, Rocket, ScanQrCode, Stamp, Timer, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { buttonClasses, PageSkeleton } from '../components/ui';
import { fetchDivisions, formatTime, type Division } from '../lib/catalog';
import { canModify, hasTightTransfer, isActiveReservation, type Board } from '../lib/reservations';
import { buildJourney, timingLabel, type Stop } from '../lib/studentJourney';
import { useLoad } from '../lib/useLoad';
import { useNow } from '../lib/useNow';
import { useReservationBoard } from '../lib/useReservationBoard';
import { useEdition } from '../edition/EditionProvider';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import { LOGBOOK, MISSION, NAV, SCAN_CTA } from './copy';
import { mapForRoute, mapForSession, MapActionLink } from './campus/mapLinks';
import PlaceLine from './campus/PlaceLine';
import ConfirmSheet, { type ConfirmRequest } from './reservations/ConfirmSheet';
import WindowNotice from './reservations/WindowNotice';
import { divisionColor, tintVars } from './ui/divisionVisuals';
import { GuideTip } from './ui/Guide';
import { PageHeader } from './ui/PageHeader';
import { Stations } from './ui/RouteMeter';
import { EmptyState, ErrorState } from './ui/States';
import { StatusPill, type StatusKind } from './ui/StatusPill';

const STATUS: Record<string, { label: string; kind: StatusKind }> = {
  active: { label: 'Reservada', kind: 'in_route' },
  in_progress: { label: 'En curso', kind: 'live' },
  completed: { label: 'Completada', kind: 'done' },
  ended: { label: 'Falta escanear', kind: 'to_scan' },
  expired: { label: 'Horario finalizado', kind: 'ended' },
  cancelled: { label: 'Sesión cancelada', kind: 'cancelled' },
};

type Variant = 'now' | 'next' | 'later' | 'pending' | 'done' | 'closed';

/**
 * Mi ruta = the day's itinerary, drawn as a trajectory of stations: NOW, still to scan, NEXT, LATER, completed and
 * history. Each station answers when, what, where, its state and the next action; change/cancel stay small.
 */
export default function MyRoute() {
  const { edition } = useEdition();
  const { board, error, loading, reload, cancel } = useReservationBoard(edition?.id);
  const divisions = useLoad(fetchDivisions, []);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const now = useNow();

  if ((loading && !board) || (divisions.loading && !divisions.data)) return <PageSkeleton blocks={3} />;
  if (error || !board) return <ErrorState error={error} onRetry={reload} />;
  if (divisions.error || !divisions.data) return <ErrorState error={divisions.error} onRetry={divisions.reload} />;

  const divisionById = new Map(divisions.data.map((d) => [d.id, d]));
  const sessionOfReservation = new Map(board.reservations.map((r) => [r.id, board.sessions.find((s) => s.id === r.session_id)]));
  const journey = buildJourney(board);
  const activeCount = board.active_reservation_count;
  const total = journey.now.length + journey.upcoming.length + journey.pending.length + journey.done.length + journey.closed.length;
  const routeComplete = journey.done.length > 0 && journey.now.length + journey.upcoming.length + journey.pending.length === 0;

  const cardProps = { board, divisionById, sessionOfReservation, now, onAskCancel: setConfirm, cancel };
  const canAdd = activeCount < board.max_reservations && board.window === 'open';

  const section = (label: string, stops: Stop[], variantOf: (i: number) => Variant) =>
    stops.length > 0 && (
      <section key={label} aria-label={label}>
        <h2 className="mb-3 text-xs font-extrabold uppercase tracking-[0.18em] text-ink-muted">{label}</h2>
        <ol>
          {stops.map((stop, i) => (
            <StopCard key={stop.reservation.id} stop={stop} variant={variantOf(i)} {...cardProps} />
          ))}
        </ol>
      </section>
    );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Tu itinerario del día"
        title={NAV.route}
        aside={total > 0 ? <MapActionLink to={mapForRoute()} label="Ver mapa" ariaLabel="Ver mi ruta en el mapa del campus" /> : undefined}
        subtitle={`${activeCount} de ${board.max_reservations} misiones reservadas${journey.done.length ? ` · ${journey.done.length} ${journey.done.length === 1 ? 'completada' : 'completadas'}` : ''} · Deja ${board.travel_buffer_minutes} min entre misiones para llegar`}
      />
      <div className="px-1">
        <Stations active={activeCount} max={board.max_reservations} wide />
      </div>

      <WindowNotice board={board} />

      {total === 0 ? (
        <EmptyState
          guide
          title="Tu ruta está vacía"
          action={
            <Link to="/misiones" className={buttonClasses('primary', 'w-full sm:w-auto')}>
              <Rocket className="h-4 w-4" aria-hidden />
              Ver {MISSION.many.toLowerCase()}
            </Link>
          }
        >
          Elige misiones y reserva un horario. Aquí aparecerán en orden, con hora y lugar.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {routeComplete && (
            <section className="animate-fade-up" aria-label="Ruta completada">
              <GuideTip
                title="¡Completaste tu ruta!"
                action={
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Link to="/pasaporte" className={buttonClasses('primary')}>
                      <Stamp className="h-4 w-4" aria-hidden />
                      Ver {LOGBOOK.mine}
                    </Link>
                    {canAdd && (
                      <Link to="/misiones" className={buttonClasses('secondary')}>
                        Agregar otra misión
                      </Link>
                    )}
                  </div>
                }
              >
                Escaneaste todas tus misiones. Tus sellos ya están en {LOGBOOK.yours}.
              </GuideTip>
            </section>
          )}
          {section('Ahora', journey.now, () => 'now')}
          {section('Falta escanear', journey.pending, () => 'pending')}
          {section('Siguiente', journey.upcoming.slice(0, 1), () => 'next')}
          {section('Después', journey.upcoming.slice(1), () => 'later')}
          {section('Completadas', journey.done, () => 'done')}
          {journey.closed.length > 0 && (
            <details className="group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-xs font-extrabold uppercase tracking-[0.18em] text-ink-muted">
                Historial ({journey.closed.length})
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" aria-hidden />
              </summary>
              <ol className="mt-3">
                {journey.closed.map((stop) => (
                  <StopCard key={stop.reservation.id} stop={stop} variant="closed" {...cardProps} />
                ))}
              </ol>
            </details>
          )}
          {canAdd && !routeComplete && (
            <Link to="/misiones" className="flex min-h-14 items-center justify-center gap-2 rounded-theme border-2 border-dashed border-line text-sm font-semibold text-ink-muted transition-colors hover:border-primary-500/60 hover:text-ink">
              <Plus className="h-4 w-4" aria-hidden />
              Agregar otra misión
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
  const color = divisionColor(theme, division);
  const ds = r.derived_status || r.status;
  const status = STATUS[ds] || { label: r.status, kind: 'waiting' as const };
  const allowed = canModify(board, s, r);
  const live = variant === 'now';
  const tight = isActiveReservation(r) && hasTightTransfer(s);
  const tightNext = tight && s.tight_transfer_with.some((id) => (sessionOfReservation.get(id)?.starts_at ?? '') > s.starts_at);
  const cancelled = ds === 'cancelled';
  const completed = ds === 'completed';
  const toRegister = ds === 'ended';
  const showTiming = variant === 'now' || variant === 'next' || variant === 'later';
  const minutes = Math.round((new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000);

  const askCancel = () =>
    onAskCancel({
      title: 'Cancelar reservación',
      body: `Liberarás tu lugar en ${s.title} (${formatTime(s.starts_at)}). Otra persona podrá tomarlo.`,
      confirmLabel: 'Liberar lugar',
      danger: true,
      action: () => cancel(r.id),
    });

  // Station on the trajectory: state shown by shape AND icon, never only by colour.
  const node = live ? (
    <span className="anim-ring-pulse flex h-7 w-7 items-center justify-center rounded-full bg-primary-500 text-on-primary">
      <Rocket className="h-4 w-4" />
    </span>
  ) : completed ? (
    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-success-500 text-white">
      <Check className="h-4 w-4" strokeWidth={3} />
    </span>
  ) : toRegister ? (
    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-warning-500 text-neutral-950">
      <ScanQrCode className="h-4 w-4" />
    </span>
  ) : cancelled ? (
    <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-error-500 bg-surface text-fg-error">
      <X className="h-3.5 w-3.5" strokeWidth={3} />
    </span>
  ) : variant === 'next' ? (
    <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-primary-500 bg-surface-sunken shadow-[0_0_12px_rgb(var(--c-primary-500)/0.7)]">
      <span className="h-2.5 w-2.5 rounded-full bg-primary-500" />
    </span>
  ) : (
    <span className="flex h-7 w-7 items-center justify-center">
      <span className="h-3.5 w-3.5 rounded-full border-2 border-ink-muted bg-surface-sunken" />
    </span>
  );

  return (
    <li className="relative pb-4 pl-11 last:pb-0">
      {/* trajectory line + station */}
      <span
        className={`absolute bottom-0 left-[13px] top-8 w-0.5 ${completed ? 'bg-success-500/60' : cancelled ? 'border-l-2 border-dashed border-line bg-transparent' : 'bg-gradient-to-b from-primary-500/60 to-line'}`}
        aria-hidden
      />
      <span className="absolute left-0 top-1" aria-hidden>{node}</span>

      <div
        className={`relative overflow-hidden rounded-theme border ${
          live
            ? 'border-primary-500 bg-primary-500/10 shadow-[0_14px_36px_-18px_rgb(var(--c-primary-500)/0.9)]'
            : toRegister
              ? 'border-warning-500/60 bg-warning-500/5'
              : cancelled
                ? 'border-error-500/40 bg-surface'
                : 'space-card'
        } ${variant === 'done' || variant === 'closed' ? 'opacity-90' : ''}`}
        style={tintVars(color)}
      >
        <span className="absolute inset-y-0 left-0 w-1 bg-[rgb(var(--tint))]" aria-hidden />
        <div className="p-4 pl-5">
          <div className="flex items-start justify-between gap-3">
            <p className="font-display text-2xl font-extrabold leading-none">
              {formatTime(s.starts_at)}
              <span className="ml-1.5 align-middle text-sm font-semibold text-ink-muted">· {minutes} min</span>
            </p>
            <StatusPill kind={status.kind}>{status.label}</StatusPill>
          </div>
          {showTiming && (
            <p className={`mt-2 flex items-center gap-1.5 text-sm font-bold ${live ? 'text-fg-brand' : 'text-ink'}`}>
              <Timer className="h-4 w-4 shrink-0" aria-hidden />
              {timingLabel(s, now)}
            </p>
          )}
          <h3 className={`mt-1.5 text-base font-extrabold leading-snug ${cancelled ? 'text-ink-muted line-through' : ''}`}>{s.title}</h3>
          {division?.name && <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-ink-muted">{division.name}</p>}
          {s.location && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
              <PlaceLine location={s.location} />
              {/* Discreet; only the next/live station gets a little more weight. */}
              {!cancelled && !completed && ds !== 'expired' && (
                <MapActionLink to={mapForSession(s.id)} label="Cómo llegar" emphasis={variant === 'next'} ariaLabel={`Cómo llegar a ${s.title}`} />
              )}
            </div>
          )}
          {completed && r.credits_granted != null && (
            <p className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-fg-success">
              <BadgeCheck className="h-4 w-4" aria-hidden />
              {r.credits_granted} {r.credits_granted === 1 ? 'sello' : 'sellos'} obtenidos
            </p>
          )}
          {cancelled && (
            <p className="mt-2 text-sm text-ink-muted">Coordinación canceló este horario. Ya no cuenta en tu ruta; elige otra sesión.</p>
          )}
          {tight && (
            <p className="mt-2 text-sm font-semibold text-fg-warning">
              Traslado ajustado ·{' '}
              {tightNext
                ? `tienes menos de ${board.travel_buffer_minutes} min para llegar a tu siguiente misión.`
                : `llegas con menos de ${board.travel_buffer_minutes} min desde tu misión anterior.`}
            </p>
          )}
          {toRegister && (
            <p className="mt-2 text-sm text-ink-muted">
              El horario terminó. Si participaste, escanea el QR de la misión; si no, puedes reservar otra sesión de esta misión.
            </p>
          )}
          {ds === 'expired' && (
            <p className="mt-2 text-sm text-ink-muted">El horario finalizó. Puedes reservar otra sesión de esta misión si hay disponibles.</p>
          )}

          {(live || toRegister) && (
            <Link to="/escanear" className={buttonClasses('primary', 'mt-4 w-full')}>
              <ScanQrCode className="h-5 w-5" aria-hidden />
              {SCAN_CTA}
            </Link>
          )}
          {(cancelled || ds === 'expired' || toRegister) && board.window === 'open' && (
            <Link to="/misiones" className={buttonClasses(live || toRegister ? 'ghost' : 'primary', 'mt-2 w-full')}>
              <CalendarPlus className="h-4 w-4" aria-hidden />
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
