import { fold } from './csv';
import type { OperationsOverview, OperationsSession } from './operationsApi';

/**
 * Operations Center logic. Everything takes `now` (milliseconds): the server clock advanced by elapsed time since the
 * snapshot, never an absolute reading of the browser clock.
 *
 * Three separate ideas:
 *  - state:     where the session is in time (próxima, en curso, terminada, cancelada, oculta);
 *  - demand:    how full it is (lleno, quedan pocos) — informative, never an incident;
 *  - attention: something Coordinación can do about it right now.
 */
export type TemporalStatus = 'proxima' | 'en_curso' | 'terminada' | 'cancelada' | 'oculta';
export type OperationsView = 'ahora' | 'proximas' | 'atencion' | 'programa';
export type EventPhase = 'live' | 'pre' | 'post';

const MIN = 60_000;
/** A session that starts within this window is part of "Ahora". */
export const SOON_MINUTES = 30;
/** A session without a location is an incident once it is this close to starting (or already running). */
export const LOCATION_ATTENTION_MINUTES = 60;
/** A session about to start with no reservations is worth a look only when it is this close. */
export const EMPTY_SESSION_ATTENTION_MINUTES = 30;
const FEW_PLACES_RATIO = 0.15;

export function temporalStatus(session: OperationsSession, now: number): TemporalStatus {
  if (session.status === 'cancelada') return 'cancelada';
  if (session.status === 'oculta') return 'oculta';
  if (now < new Date(session.starts_at).getTime()) return 'proxima';
  if (now < new Date(session.ends_at).getTime()) return 'en_curso';
  return 'terminada';
}

export const TEMPORAL_LABELS: Record<TemporalStatus, string> = {
  proxima: 'Próxima',
  en_curso: 'En curso',
  terminada: 'Terminada',
  cancelada: 'Cancelada',
  oculta: 'Oculta',
};

export const minutesUntilStart = (session: OperationsSession, now: number) =>
  Math.ceil((new Date(session.starts_at).getTime() - now) / MIN);

export const minutesSinceEnd = (session: OperationsSession, now: number) =>
  Math.floor((now - new Date(session.ends_at).getTime()) / MIN);

/** "20 min", "2 h 10 min", "3 d" */
export function formatSpan(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${h} h ${rest} min` : `${h} h`;
  }
  return `${Math.round(m / (60 * 24))} d`;
}

export const hasLocation = (session: OperationsSession) => !!session.location?.trim();

export type AttentionKind = 'sin_ubicacion' | 'cancelada_afectados' | 'checkin_pendiente' | 'sin_reservaciones' | 'sobreocupada';
export type Attention = { kind: AttentionKind; label: string; tone: 'error' | 'warning' };

/**
 * Actionable situations only, derived from snapshot data. Not incidents: "lleno", "pocos lugares", a distant session
 * with no reservations yet, or a finished session whose check-in window already closed.
 */
export function attentionOf(session: OperationsSession, status: TemporalStatus, now: number, checkinCloseMinutes: number): Attention[] {
  const out: Attention[] = [];
  const toStart = minutesUntilStart(session, now);

  if (status === 'cancelada') {
    if (session.affected_unresolved > 0 && now < new Date(session.ends_at).getTime()) {
      const n = session.affected_unresolved;
      out.push({ kind: 'cancelada_afectados', tone: 'error', label: `Cancelada · ${n} ${n === 1 ? 'participante' : 'participantes'} con reservación` });
    }
    return out;
  }
  if (status === 'oculta') return out;

  if (!hasLocation(session)) {
    if (status === 'en_curso') out.push({ kind: 'sin_ubicacion', tone: 'error', label: 'Sin ubicación · en curso' });
    else if (status === 'proxima' && toStart <= LOCATION_ATTENTION_MINUTES) {
      out.push({ kind: 'sin_ubicacion', tone: 'error', label: `Sin ubicación · inicia en ${formatSpan(toStart)}` });
    }
  }

  if (status !== 'terminada' && session.reserved > session.capacity) {
    out.push({ kind: 'sobreocupada', tone: 'error', label: `Reservaciones exceden el cupo (${session.reserved}/${session.capacity})` });
  }

  if (status === 'terminada' && session.reserved > 0 && session.attended === 0 && checkinCloseMinutes > 0) {
    const sinceEnd = minutesSinceEnd(session, now);
    if (sinceEnd <= checkinCloseMinutes) {
      out.push({ kind: 'checkin_pendiente', tone: 'warning', label: `Check-in pendiente · terminó hace ${formatSpan(Math.max(sinceEnd, 0))}` });
    }
  }

  if (status === 'proxima' && session.reserved === 0 && toStart <= EMPTY_SESSION_ATTENTION_MINUTES) {
    out.push({ kind: 'sin_reservaciones', tone: 'warning', label: `Sin reservaciones · inicia en ${formatSpan(toStart)}` });
  }

  return out.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'error' ? -1 : 1));
}

export type Demand = 'lleno' | 'pocos';

/** Demand signal: how full the session is. Shown quietly; it never counts as attention. */
export function demandOf(session: OperationsSession, status: TemporalStatus): Demand | null {
  if (status === 'terminada' || status === 'cancelada' || session.capacity <= 0) return null;
  if (session.remaining <= 0) return 'lleno';
  if (session.remaining <= Math.max(3, Math.ceil(session.capacity * FEW_PLACES_RATIO))) return 'pocos';
  return null;
}

export const reservationPercent = (session: OperationsSession) =>
  session.capacity <= 0 ? 0 : Math.min(100, Math.round((session.reserved / session.capacity) * 100));

export const isSoon = (session: OperationsSession, status: TemporalStatus, now: number) =>
  status === 'proxima' && minutesUntilStart(session, now) <= SOON_MINUTES;

export type Row = { session: OperationsSession; status: TemporalStatus; attention: Attention[] };

export function buildRows(data: OperationsOverview, now: number): Row[] {
  return data.sessions.map((session) => {
    const status = temporalStatus(session, now);
    return { session, status, attention: attentionOf(session, status, now, data.checkin_close_after_minutes) };
  });
}

const localDate = (ms: number, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(ms));

/**
 * live: the event is happening or about to (event day, a session running, about to start, or just ended).
 * pre:  the event has not started and there is a program ahead.
 * post: nothing left to run.
 */
export function eventPhase(data: OperationsOverview, rows: Row[], now: number): EventPhase {
  if (localDate(now, data.timezone) === data.event_date) return 'live';
  const near = rows.some(({ session, status }) => {
    if (status === 'en_curso') return true;
    if (status === 'proxima') return minutesUntilStart(session, now) <= SOON_MINUTES;
    if (status === 'terminada') return data.checkin_close_after_minutes > 0 && minutesSinceEnd(session, now) <= data.checkin_close_after_minutes;
    return false;
  });
  if (near) return 'live';
  return rows.some((r) => r.status === 'proxima') ? 'pre' : 'post';
}

/** Natural landing view: Ahora while the event is running, the upcoming program before it, the full program after it. */
export function defaultView(phase: EventPhase): OperationsView {
  return phase === 'live' ? 'ahora' : phase === 'pre' ? 'proximas' : 'programa';
}

export type Filters = { query: string; divisionId: string; moment: TemporalStatus | ''; demand: '' | 'con_lugares' | 'llenas' };
export const NO_FILTERS: Filters = { query: '', divisionId: '', moment: '', demand: '' };

export function matchesQuery(session: OperationsSession, query: string) {
  const q = fold(query);
  if (!q) return true;
  const haystack = fold([session.title, session.location ?? '', ...session.divisions.flatMap((d) => [d.name, d.code])].join(' '));
  return q.split(' ').every((word) => haystack.includes(word));
}

/** Works for multi-division workshops: any of the session's divisions matches. */
export const matchesDivision = (session: OperationsSession, divisionId: string) =>
  !divisionId || session.divisions.some((d) => d.id === divisionId);

export function applyFilters(rows: Row[], f: Filters): Row[] {
  return rows.filter(
    ({ session, status }) =>
      matchesQuery(session, f.query) &&
      matchesDivision(session, f.divisionId) &&
      (!f.moment || status === f.moment) &&
      (f.demand === '' || (f.demand === 'llenas' ? session.remaining <= 0 : session.remaining > 0)),
  );
}

export function divisionOptions(sessions: OperationsSession[]) {
  const seen = new Map<string, string>();
  for (const s of sessions) for (const d of s.divisions) seen.set(d.id, d.name);
  return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export type ViewRows = {
  ahora: { attention: Row[]; inProgress: Row[]; soon: Row[] };
  proximas: Row[];
  atencion: Row[];
  programa: Row[];
};

const byStart = (a: Row, b: Row) =>
  new Date(a.session.starts_at).getTime() - new Date(b.session.starts_at).getTime() || a.session.title.localeCompare(b.session.title, 'es');

export function splitViews(rows: Row[], now: number): ViewRows {
  const attention = rows.filter((r) => r.attention.length > 0).sort(byStart);
  const noAttention = rows.filter((r) => r.attention.length === 0);
  return {
    ahora: {
      attention,
      inProgress: noAttention.filter((r) => r.status === 'en_curso').sort(byStart),
      soon: noAttention.filter((r) => isSoon(r.session, r.status, now)).sort(byStart),
    },
    proximas: rows.filter((r) => r.status === 'proxima').sort(byStart),
    atencion: attention,
    programa: [...rows].sort(byStart),
  };
}

export type Block = { key: string; startsAt: string; day: string; rows: Row[] };

/** Chronological blocks: one per distinct start time. */
export function groupByStart(rows: Row[], timeZone: string): Block[] {
  const blocks: Block[] = [];
  for (const row of [...rows].sort(byStart)) {
    const last = blocks[blocks.length - 1];
    if (last && last.startsAt === row.session.starts_at) last.rows.push(row);
    else blocks.push({ key: row.session.starts_at, startsAt: row.session.starts_at, day: localDate(new Date(row.session.starts_at).getTime(), timeZone), rows: [row] });
  }
  return blocks;
}

/** Sessions with no location that are not yet urgent enough to be attention (a configuration task). */
export const unlocatedUpcoming = (rows: Row[]) =>
  rows.filter((r) => (r.status === 'proxima') && !hasLocation(r.session) && !r.attention.some((a) => a.kind === 'sin_ubicacion'));

export function formatUpdatedAgo(elapsedMs: number) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 5) return 'Actualizado ahora';
  if (seconds < 60) return `Actualizado hace ${seconds} s`;
  return `Actualizado hace ${Math.floor(seconds / 60)} min`;
}

export const checkinHref = (sessionId: string) => `/coordinacion/checkin?session=${sessionId}`;
