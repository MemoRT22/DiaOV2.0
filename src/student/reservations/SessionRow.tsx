import { Clock, MapPin, Users } from 'lucide-react';
import { Badge } from '../../components/ui';
import { formatTime } from '../../lib/catalog';
import { durationMinutes, isSelectable, type BoardSession, type SessionState } from '../../lib/reservations';
import { STATE_LABELS } from './sessionPresentation';

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
  /** Recommended minutes between talleres when this session leaves less than that (warning only). */
  tightMinutes?: number | null;
}) {
  const { label, tone } = STATE_LABELS[state];
  const selectable = isSelectable(state);
  const showCount = state !== 'cancelled' && state !== 'ended';

  return (
    <li className="flex items-center gap-3 rounded-theme border border-line bg-surface-sunken/40 p-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Clock className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
          {formatTime(session.starts_at)}–{formatTime(session.ends_at)}
          <span className="font-normal text-ink-muted">· {durationMinutes(session)} min</span>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          {showLocation && session.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              {session.location}
            </span>
          )}
          {showCount && (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" aria-hidden />
              {session.remaining === 0 ? 'Sin lugares' : `${session.remaining} de ${session.capacity} lugares`}
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={tone}>{label}</Badge>
          {tightMinutes != null && selectable && (
            <Badge tone="warning">Traslado ajustado · menos de {tightMinutes} min</Badge>
          )}
        </div>
      </div>
      {selectable && (
        <button
          onClick={onAction}
          className="min-h-11 shrink-0 rounded-full bg-primary-500 px-4 text-sm font-semibold text-on-primary transition-all hover:bg-primary-400 active:scale-[0.97]"
        >
          {actionLabel}
        </button>
      )}
    </li>
  );
}
