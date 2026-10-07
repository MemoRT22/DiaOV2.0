import { formatTime } from './catalog';
import type { Board, BoardSession, MyReservation } from './reservations';

/**
 * The student's day as a journey, derived from the reservation board: what is happening NOW, what comes NEXT,
 * what is LATER, what still needs its attendance registered, and what is already DONE.
 * Pure functions: the screens only render them.
 */
export type Stop = { reservation: MyReservation; session: BoardSession };

export type Journey = {
  /** In progress right now (at most a couple; they never overlap in time). */
  now: Stop[];
  /** Upcoming, in chronological order. The first one is "the next one". */
  upcoming: Stop[];
  /** Session finished but no attendance registered yet: the student may still scan the workshop QR. */
  pending: Stop[];
  done: Stop[];
  /** Cancelled by Coordinación or archived: history only. */
  closed: Stop[];
};

const byStart = (a: Stop, b: Stop) => a.session.starts_at.localeCompare(b.session.starts_at);

export function buildJourney(board: Board): Journey {
  const sessionById = new Map(board.sessions.map((s) => [s.id, s]));
  const journey: Journey = { now: [], upcoming: [], pending: [], done: [], closed: [] };
  for (const reservation of board.reservations) {
    if (reservation.status !== 'vigente' && reservation.status !== 'expirada' && reservation.resolved) continue;
    const session = sessionById.get(reservation.session_id);
    if (!session) continue;
    const stop = { reservation, session };
    switch (reservation.derived_status) {
      case 'in_progress': journey.now.push(stop); break;
      case 'active': journey.upcoming.push(stop); break;
      case 'ended': journey.pending.push(stop); break;
      case 'completed': journey.done.push(stop); break;
      default: journey.closed.push(stop);
    }
  }
  for (const list of Object.values(journey)) list.sort(byStart);
  return journey;
}

/** The single most useful stop to put in front of the student: in progress first, then the next upcoming one. */
export function focusStop(journey: Journey): { kind: 'now' | 'next'; stop: Stop } | null {
  if (journey.now[0]) return { kind: 'now', stop: journey.now[0] };
  if (journey.upcoming[0]) return { kind: 'next', stop: journey.upcoming[0] };
  return null;
}

const minutes = (ms: number) => Math.max(0, Math.round(ms / 60000));

function span(totalMinutes: number) {
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')} min`;
}

const TZ = 'America/Cancun';
const dayKey = (iso: string | number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

function dayLabel(iso: string) {
  return new Intl.DateTimeFormat('es-MX', { timeZone: TZ, day: 'numeric', month: 'short' }).format(new Date(iso)).replace('.', '');
}

/** Human, glanceable timing: «Empieza en 12 min», «Termina en 8 min», «Hoy a las 10:30», «15 oct · 09:00». */
export function timingLabel(session: Pick<BoardSession, 'starts_at' | 'ends_at'>, now: number): string {
  const start = new Date(session.starts_at).getTime();
  const end = new Date(session.ends_at).getTime();
  if (now >= end) return `Terminó a las ${formatTime(session.ends_at)}`;
  if (now >= start) {
    const left = minutes(end - now);
    return left <= 0 ? 'Termina ahora' : `En curso · termina en ${span(left)}`;
  }
  const until = minutes(start - now);
  if (dayKey(session.starts_at) !== dayKey(now)) return `${dayLabel(session.starts_at)} · ${formatTime(session.starts_at)}`;
  if (until <= 0) return 'Empieza ahora';
  if (until <= 90) return `Empieza en ${span(until)}`;
  return `Hoy a las ${formatTime(session.starts_at)}`;
}

/** Urgent when it is in progress or about to start (used to colour the hero). */
export function isImminent(session: Pick<BoardSession, 'starts_at' | 'ends_at'>, now: number) {
  const start = new Date(session.starts_at).getTime();
  return now < new Date(session.ends_at).getTime() && start - now <= 15 * 60000;
}

export function firstName(displayName: string | undefined | null) {
  const name = (displayName ?? '').trim();
  return name ? name.split(/\s+/)[0] : '';
}

export type Hero =
  | { kind: 'now' | 'imminent' | 'pending' | 'next'; stop: Stop }
  | { kind: 'none' };

/** The pending attendance that matters most: the one that ended last (the workshop the student just left). */
export const latestPending = (journey: Journey): Stop | undefined => journey.pending[journey.pending.length - 1];

/**
 * ONE main action for «¿qué hago ahora?», in human priority order:
 *  1) something in progress; 2) the next activity when it is imminent (never make them late);
 *  3) an attendance still to be registered; 4) the next future activity; 5) nothing booked → pick workshops.
 */
export function heroAction(journey: Journey, now: number): Hero {
  if (journey.now[0]) return { kind: 'now', stop: journey.now[0] };
  const next = journey.upcoming[0];
  if (next && isImminent(next.session, now)) return { kind: 'imminent', stop: next };
  const pending = latestPending(journey);
  if (pending) return { kind: 'pending', stop: pending };
  if (next) return { kind: 'next', stop: next };
  return { kind: 'none' };
}
