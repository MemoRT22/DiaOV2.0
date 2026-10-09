import { ArrowRight, Clock3, MapPin, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatTime } from '../lib/catalog';
import { isFewPlaces, isSelectable, sessionState, type Board, type BoardSession, type MyReservation } from '../lib/reservations';
import { workshopAvailability, workshopDuration, workshopLocation, workshopPersonalStatus } from '../lib/workshopDiscovery';
import { formatPlace } from './campus/resolveCampusLocation';
import { DivisionOrb, tintVars } from './ui/divisionVisuals';
import { StatusPill, type StatusKind } from './ui/StatusPill';

/** The single most important state of a mission for THIS student, as one pill (or none when it is simply open). */
export function missionHeadline(
  board: Board,
  sessions: BoardSession[],
  replacing: MyReservation | null,
  personal: ReturnType<typeof workshopPersonalStatus>,
): { kind: StatusKind; label: string } | null {
  if (personal === 'Explorado') return { kind: 'done', label: 'Completada' };
  if (personal === 'En tu ruta') return { kind: 'in_route', label: 'En tu ruta' };
  if (sessions.some((s) => s.in_progress)) return { kind: 'live', label: 'En curso' };
  const open = sessions.filter((s) => !s.ended);
  if (open.length > 0 && open.every((s) => s.remaining <= 0)) return { kind: 'full', label: 'Llena' };
  const selectable = sessions.filter((s) => isSelectable(sessionState(board, s, replacing)));
  if (selectable.length > 0 && selectable.every(isFewPlaces)) return { kind: 'few', label: 'Pocos lugares' };
  return null;
}

export const LIVE_JOINABLE = 'Puedes reservar y entrar ahora';
export const LIVE_ONLY = 'En curso ahora';

/**
 * Footer line: «¿puedo ir?» for THIS student. «En curso» (headline) only says the mission is happening now; the footer
 * promises an immediate action only when a session in progress is really selectable under the existing rules
 * (`isSelectable(sessionState(...))` — full, conflict, same workshop, max… all say no).
 */
export function missionFooter(
  board: Board,
  sessions: BoardSession[],
  replacing: MyReservation | null,
  personal: ReturnType<typeof workshopPersonalStatus>,
): { text: string; tone: 'success' | 'info' | 'error' | 'brand' | 'muted' } {
  if (personal === 'Explorado') return { text: '¡Ya la completaste!', tone: 'success' };
  const mine = sessions.find((s) => s.my_reservation_id && !s.ended);
  if (personal === 'En tu ruta' && mine) return { text: `Tu horario: ${formatTime(mine.starts_at)}`, tone: 'info' };
  const live = sessions.filter((s) => s.in_progress);
  if (live.length > 0) {
    const joinable = live.some((s) => isSelectable(sessionState(board, s, replacing)));
    return joinable ? { text: LIVE_JOINABLE, tone: 'brand' } : { text: LIVE_ONLY, tone: 'muted' };
  }
  const headline = missionHeadline(board, sessions, replacing, personal);
  return { text: workshopAvailability(board, sessions, replacing), tone: headline?.kind === 'full' ? 'error' : 'muted' };
}

const FOOTER_TONE = { success: 'text-fg-success', info: 'text-fg-info', error: 'text-fg-error', brand: 'text-fg-brand', muted: 'text-ink-muted' } as const;

/**
 * Compact catalogue card: just enough to decide «¿me interesa?» — division, name, one-line pitch, why it is for me,
 * duration, place, availability and my own state. The whole card is the tap target (the «Ver misión» link stretches
 * over it), so a phone user never has to aim at a small button.
 */
export default function MissionCard({
  board,
  sessions,
  replacing,
  divisionLabel,
  divisionName,
  color,
  reason,
  recommended,
  attended,
  reserved,
  href,
  index,
}: {
  board: Board;
  sessions: BoardSession[];
  replacing: MyReservation | null;
  divisionLabel: string;
  divisionName: string | undefined;
  color: string;
  reason: string | null;
  recommended: boolean;
  attended?: boolean;
  reserved?: boolean;
  href: string;
  index: number;
}) {
  const first = sessions[0];
  const personal = workshopPersonalStatus(sessions, attended, reserved);
  const headline = missionHeadline(board, sessions, replacing, personal);
  const location = workshopLocation(sessions);
  const done = personal === 'Explorado';
  const dim = headline?.kind === 'full';
  const footer = missionFooter(board, sessions, replacing, personal);

  return (
    <li
      className={`mission-card space-card group relative animate-fade-up overflow-hidden transition-transform duration-200 active:scale-[0.99] ${
        done ? 'border-success-500/40' : headline?.kind === 'live' ? 'border-primary-500/60' : ''
      }`}
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms`, ...tintVars(color) }}
    >
      {/* division colour as a glowing edge */}
      <span className="absolute inset-y-0 left-0 w-1 bg-[rgb(var(--tint))] shadow-[0_0_14px_rgb(var(--tint)/0.8)]" aria-hidden />
      <div className={`p-4 pl-5 ${dim ? 'opacity-75' : ''}`}>
        <div className="flex items-start gap-3">
          <DivisionOrb name={divisionName} color={color} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-bold uppercase tracking-wide text-ink-muted">{divisionLabel}</p>
            <h2 className="mt-0.5 text-base font-extrabold leading-snug">{first.title}</h2>
          </div>
        </div>

        {(headline || (recommended && !personal)) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {headline && <StatusPill kind={headline.kind}>{headline.label}</StatusPill>}
            {recommended && !personal && <StatusPill kind="for_you">Para ti</StatusPill>}
          </div>
        )}

        {first.description && <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{first.description}</p>}

        {/* why it is suggested: accent-coloured while it is an open suggestion, quieter once it is in my route */}
        {reason && !done && (
          <p className={`mt-2 flex items-start gap-1.5 text-xs font-semibold ${personal ? 'text-ink-muted' : 'text-fg-accent'}`}>
            <Sparkles className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${personal ? 'text-ink-muted' : 'text-fg-accent'}`} aria-hidden />
            <span className="line-clamp-2 min-w-0 break-words">{reason}</span>
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3.5 w-3.5" aria-hidden />
            {workshopDuration(sessions)}
          </span>
          {location && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{formatPlace(location)}</span>
            </span>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
          <span className={`text-xs font-semibold ${FOOTER_TONE[footer.tone]}`}>
            {footer.text}
          </span>
          <Link
            to={href}
            className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-bold transition-colors after:absolute after:inset-0 after:content-[''] ${
              done ? 'border border-line bg-surface text-ink' : 'bg-primary-500 text-on-primary group-hover:bg-primary-400'
            }`}
          >
            Ver misión
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </li>
  );
}
