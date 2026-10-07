import { MapPin, Users } from 'lucide-react';
import { Badge } from '../../components/ui';
import { formatTime } from '../../lib/catalog';
import { durationMinutes, isSelectable, type BoardSession, type SessionState } from '../../lib/reservations';
import { STATE_LABELS } from './sessionPresentation';

/** One time slot of a workshop: when, whether there is room, whether I can join, and the single action. */
export default function SessionRow({
  session,
  state,
  actionLabel,
  onAction,
  showLocation,
  tightMinutes = null,
}: {
  session: BoardSession;
  state: SessionState;
  actionLabel: string;
  onAction: () => void;
  showLocation: boolean;
  /** Recommended minutes between talleres when this session leaves less than that (advice only). */
  tightMinutes?: number | null;
}) {
  const { label, tone } = STATE_LABELS[state];
  const selectable = isSelectable(state);
  const showCount = state !== 'cancelled' && state !== 'ended';
  const dim = state === 'ended' || state === 'cancelled' || state === 'full';
  const live = state === 'in_progress';
  const seats = session.remaining === 0 ? 'Sin lugares' : `${session.remaining} de ${session.capacity} lugares`;

  return (
    <li
      className={`flex items-center gap-3 rounded-theme border p-3 ${
        live ? 'border-primary-500/60 bg-primary-500/10' : 'border-line bg-surface-sunken/40'
      } ${dim ? 'opacity-70' : ''}`}
    >
      <div className="w-14 shrink-0 text-center">
        <p className="font-display text-xl font-extrabold leading-none">{formatTime(session.starts_at)}</p>
        <p className="mt-1 text-[11px] leading-none text-ink-muted">
          <span className="sr-only">a </span>
          {formatTime(session.ends_at)}
        </p>
        <span className="sr-only"> · {durationMinutes(session)} min</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={tone}>{label}</Badge>
          {tightMinutes != null && selectable && <Badge tone="warning">Traslado ajustado · menos de {tightMinutes} min</Badge>}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          {showCount && (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" aria-hidden />
              {seats}
            </span>
          )}
          {showLocation && session.location && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{session.location}</span>
            </span>
          )}
        </div>
      </div>
      {selectable && (
        <button
          onClick={onAction}
          className="min-h-11 shrink-0 rounded-full bg-primary-500 px-5 text-sm font-bold text-on-primary transition-all hover:bg-primary-400 active:scale-[0.97]"
        >
          {actionLabel}
        </button>
      )}
    </li>
  );
}
