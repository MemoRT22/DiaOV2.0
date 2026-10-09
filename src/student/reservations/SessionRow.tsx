import { Users } from 'lucide-react';
import { formatDateTime, formatTime } from '../../lib/catalog';
import { durationMinutes, isSelectable, type BoardSession, type SessionState } from '../../lib/reservations';
import { MapActionLink } from '../campus/mapLinks';
import PlaceLine from '../campus/PlaceLine';
import { StatusPill } from '../ui/StatusPill';
import { STATE_LABELS } from './sessionPresentation';

/**
 * One time slot of a mission, built to be read at a glance: the time is the biggest thing, then whether there is
 * room (a seat bar, not only a number), then the single action as a full-width button.
 */
export default function SessionRow({
  session,
  state,
  actionLabel,
  onAction,
  showLocation,
  tightMinutes = null,
  hideAction = false,
  mapHref,
}: {
  session: BoardSession;
  state: SessionState;
  actionLabel: string;
  onAction: () => void;
  showLocation: boolean;
  /** Recommended minutes between missions when this session leaves less than that (advice only). */
  tightMinutes?: number | null;
  hideAction?: boolean;
  /** Map of THIS session's own place (used when the mission's sessions are in different places). */
  mapHref?: string;
}) {
  const { label, kind } = STATE_LABELS[state];
  const selectable = isSelectable(state);
  const showCount = state !== 'cancelled' && state !== 'ended';
  const dim = state === 'ended' || state === 'cancelled' || state === 'full';
  const live = state === 'in_progress';
  const mine = state === 'reserved' || state === 'already_attended';
  const seats = session.remaining === 0 ? 'Sin lugares' : `${session.remaining} de ${session.capacity} lugares`;
  // The bar shows the room LEFT (more fill = easier to get in), coloured like the state.
  const free = session.capacity > 0 ? Math.min(Math.max(session.remaining / session.capacity, 0), 1) : 0;

  return (
    <li
      className={`overflow-hidden rounded-theme border ${
        live ? 'border-primary-500/70 bg-primary-500/10' : mine ? 'border-secondary-500/50 bg-secondary-500/10' : selectable ? 'border-line bg-surface' : 'border-line bg-surface/60'
      } ${dim ? 'opacity-70' : ''}`}
    >
      <div className="flex items-stretch">
        <div className="flex w-20 shrink-0 flex-col items-center justify-center border-r border-line px-2 py-3 text-center">
          <p className="font-display text-xl font-extrabold leading-none">{formatTime(session.starts_at)}</p>
          <p className="mt-1 text-[11px] leading-none text-ink-muted">
            <span className="sr-only">a </span>
            {formatTime(session.ends_at)}
          </p>
        </div>
        <div className="min-w-0 flex-1 p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill kind={kind}>{label}</StatusPill>
            {tightMinutes != null && selectable && <StatusPill kind="few">Traslado ajustado · menos de {tightMinutes} min</StatusPill>}
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">
            {formatDateTime(session.starts_at)} · {durationMinutes(session)} min
          </p>
          {showCount && (
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
                <div
                  className={`h-full rounded-full ${session.remaining === 0 ? 'bg-error-500' : kind === 'few' ? 'bg-warning-500' : 'bg-success-500'}`}
                  style={{ width: `${free * 100}%` }}
                />
              </div>
              <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-ink-muted">
                <Users className="h-3.5 w-3.5" aria-hidden />
                {seats}
              </p>
            </div>
          )}
          {showLocation && session.location && (
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 text-xs">
              <PlaceLine location={session.location} strong={false} />
              {mapHref && <MapActionLink to={mapHref} label="Ver en el mapa" ariaLabel={`Ver en el mapa el lugar de las ${formatTime(session.starts_at)}`} />}
            </div>
          )}
        </div>
      </div>
      {selectable && !hideAction && (
        <div className="border-t border-line p-2">
          <button
            onClick={onAction}
            className="min-h-12 w-full rounded-full bg-primary-500 px-5 text-sm font-extrabold text-on-primary shadow-[0_8px_20px_-10px_rgb(var(--c-primary-500)/0.9)] transition-all hover:bg-primary-400 active:scale-[0.98]"
          >
            {actionLabel}
          </button>
        </div>
      )}
    </li>
  );
}
