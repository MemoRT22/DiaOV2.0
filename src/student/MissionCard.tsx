import { ArrowRight, Clock3, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatTime } from '../lib/catalog';
import { isFewPlaces, isSelectable, sessionState, type Board, type BoardSession, type MyReservation } from '../lib/reservations';
import { workshopAvailability, workshopDuration, workshopPersonalStatus } from '../lib/workshopDiscovery';
import { divisionIcon, tintVars } from './ui/divisionVisuals';
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
  compact = false,
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
  /** A short card for a carousel: area, name, state and one line of availability. The whole card is still the tap target. */
  compact?: boolean;
}) {
  const first = sessions[0];
  const personal = workshopPersonalStatus(sessions, attended, reserved);
  const headline = missionHeadline(board, sessions, replacing, personal);
  const done = personal === 'Explorado';
  const dim = headline?.kind === 'full';
  const footer = missionFooter(board, sessions, replacing, personal);

  const Symbol = divisionIcon(divisionName);

  if (compact) {
    return (
      <li
        className={`mission-card space-card group relative h-full min-w-[17rem] max-w-[19rem] flex-1 snap-start animate-fade-up overflow-hidden transition-transform duration-200 active:scale-[0.99] ${
          done ? 'border-success-500/40' : headline?.kind === 'live' ? 'border-primary-500/60' : ''
        }`}
        style={{ animationDelay: `${Math.min(index, 8) * 45}ms`, ...tintVars(color) }}
      >
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_70%_at_100%_0%,rgb(var(--tint)/0.2),transparent_65%)]" aria-hidden />
        <Symbol className="pointer-events-none absolute -bottom-4 -right-4 h-24 w-24 text-[rgb(var(--tint))] opacity-[0.1]" strokeWidth={1.25} aria-hidden />
        <span className="absolute inset-x-0 top-0 h-0.5 bg-[rgb(var(--tint))] opacity-70" aria-hidden />
        <div className={`relative flex h-full flex-col p-3.5 ${dim ? 'opacity-75' : ''}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-wider text-[rgb(var(--tint))]">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--tint))] shadow-[0_0_8px_rgb(var(--tint)/0.9)]" aria-hidden />
              <span className="truncate">{divisionLabel}</span>
            </p>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface/70 px-2 py-0.5 text-[10.5px] font-bold text-ink-muted">
              <Clock3 className="h-3 w-3" aria-hidden />
              {workshopDuration(sessions)}
            </span>
          </div>
          <h2 className="mt-2 line-clamp-2 min-h-[2.6rem] font-display text-[1.02rem] font-extrabold leading-snug">{first.title}</h2>
          <div className="mt-auto flex items-end justify-between gap-2 pt-2.5">
            <div className="min-w-0">
              {headline && <div className="mb-1"><StatusPill kind={headline.kind}>{headline.label}</StatusPill></div>}
              <span className={`block truncate text-xs font-semibold ${FOOTER_TONE[footer.tone]}`}>{footer.text}</span>
            </div>
            <Link
              to={href}
              className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors after:absolute after:inset-0 after:content-[''] ${
                done ? 'border border-line bg-surface text-ink' : 'bg-primary-500 text-on-primary group-hover:bg-primary-400'
              }`}
            >
              <span className="sr-only">Ver misión</span>
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li
      className={`mission-card space-card group relative animate-fade-up overflow-hidden transition-transform duration-200 active:scale-[0.99] ${
        done ? 'border-success-500/40' : headline?.kind === 'live' ? 'border-primary-500/60' : ''
      }`}
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms`, ...tintVars(color) }}
    >
      {/* depth without images: a glow of the area colour and a large, faint symbol of the area (clipped by the card) */}
      <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_70%_at_100%_0%,rgb(var(--tint)/0.2),transparent_65%)]" aria-hidden />
      <Symbol className="pointer-events-none absolute -right-5 -top-5 h-32 w-32 text-[rgb(var(--tint))] opacity-[0.1]" strokeWidth={1.25} aria-hidden />
      <span className="absolute inset-x-0 top-0 h-0.5 bg-[rgb(var(--tint))] opacity-70" aria-hidden />
      <div className={`relative p-4 ${dim ? 'opacity-75' : ''}`}>
        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider text-[rgb(var(--tint))]">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[rgb(var(--tint))] shadow-[0_0_8px_rgb(var(--tint)/0.9)]" aria-hidden />
            <span className="truncate">{divisionLabel}</span>
          </p>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface/70 px-2.5 py-0.5 text-[11px] font-bold text-ink-muted">
            <Clock3 className="h-3 w-3" aria-hidden />
            {workshopDuration(sessions)}
          </span>
        </div>

        <h2 className="mt-2.5 pr-8 font-display text-[1.2rem] font-extrabold leading-snug">{first.title}</h2>

        {(headline || (recommended && !personal)) && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {headline && <StatusPill kind={headline.kind}>{headline.label}</StatusPill>}
            {recommended && !personal && <StatusPill kind="for_you">Para ti</StatusPill>}
          </div>
        )}

        {first.description && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-muted">{first.description}</p>}

        {/* why it is suggested: accent-coloured while it is an open suggestion, quieter once it is in my route */}
        {reason && !done && (
          <p className={`mt-2 flex items-start gap-1.5 text-xs font-semibold ${personal ? 'text-ink-muted' : 'text-fg-accent'}`}>
            <Sparkles className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${personal ? 'text-ink-muted' : 'text-fg-accent'}`} aria-hidden />
            <span className="line-clamp-2 min-w-0 break-words">{reason}</span>
          </p>
        )}

        <div className="mt-3.5 flex items-center justify-between gap-3">
          <span className={`min-w-0 text-xs font-semibold ${FOOTER_TONE[footer.tone]}`}>{footer.text}</span>
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
