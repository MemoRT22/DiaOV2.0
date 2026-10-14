import { useCallback, useEffect, useRef, useState } from 'react';
import { announceParticipantChange } from './participantSync';
import { supabase } from './supabase';
import { useParticipantSync } from './useParticipantSync';
import {
  availabilityTopic,
  cancelReservation,
  changeReservation,
  fetchBoard,
  reserveSession,
  reservationWindow,
  type AvailabilityPatch,
  type Board,
} from './reservations';

const CLOCK_TICK_MS = 30_000;

export function applyClock(board: Board, offsetMs: number): Board {
  const now = Date.now() + offsetMs;
  // El servidor es la autoridad para reservar; el frontend solo actualiza su estado visual
  // al cruzar la apertura/cierre, incluso si el estudiante deja la pagina abierta.
  const nextWindow = board.opens_at ? reservationWindow(board.opens_at, board.closes_at, now) : board.window;
  let changed = nextWindow !== board.window;
  const sessions = board.sessions.map((s) => {
    const started = new Date(s.starts_at).getTime() <= now;
    const ended = new Date(s.ends_at).getTime() <= now;
    const inProgress = started && !ended;
    // Inscripción: el servidor manda el límite; aquí solo se refleja al cruzarlo con la pantalla abierta.
    const enrollmentOpen = s.enrollment_closes_at ? now <= new Date(s.enrollment_closes_at).getTime() : s.enrollment_open;
    if (s.started === started && s.ended === ended && s.in_progress === inProgress && s.enrollment_open === enrollmentOpen) return s;
    changed = true;
    return { ...s, started, ended, in_progress: inProgress, ...(enrollmentOpen === undefined ? {} : { enrollment_open: enrollmentOpen }) };
  });
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  // A reservation moves active → in_progress → ended with the clock; completion/expiry only come from the server.
  // Crossing into `ended` also releases the commitment (it no longer counts toward the limit nor blocks schedules),
  // exactly like the server snapshot would after a reload. Each reservation is released at most once.
  let released = 0;
  const releasedIds = new Set<string>();
  const reservations = board.reservations.map((r) => {
    const s = sessionById.get(r.session_id);
    if (!s || r.status !== 'vigente' || (r.derived_status !== 'active' && r.derived_status !== 'in_progress')) return r;
    const next = s.ended ? 'ended' : s.in_progress ? 'in_progress' : 'active';
    if (next === r.derived_status) return r;
    changed = true;
    if (next === 'ended') {
      released += 1;
      releasedIds.add(r.id);
    }
    return { ...r, derived_status: next };
  });
  if (!changed) return board;
  // Conflicts and tight transfers that pointed at a commitment that just ended no longer apply.
  const sessionsOut =
    releasedIds.size === 0
      ? sessions
      : sessions.map((s) => {
          const conflicts = s.conflicts_with.filter((id) => !releasedIds.has(id));
          const tight = s.tight_transfer_with.filter((id) => !releasedIds.has(id));
          return conflicts.length === s.conflicts_with.length && tight.length === s.tight_transfer_with.length
            ? s
            : { ...s, conflicts_with: conflicts, tight_transfer_with: tight };
        });
  return {
    ...board,
    window: nextWindow,
    sessions: sessionsOut,
    reservations,
    active_reservation_count: Math.max(0, board.active_reservation_count - released),
  };
}

/** The nearest future `enrollment_closes_at` among sessions that are still open for enrollment (null when none). */
export function nextEnrollmentClose(board: Board, now: number): number | null {
  let next: number | null = null;
  for (const s of board.sessions) {
    if (!s.enrollment_closes_at || s.enrollment_open === false || s.status === 'cancelada') continue;
    const at = new Date(s.enrollment_closes_at).getTime();
    if (at >= now && (next === null || at < next)) next = at;
  }
  return next;
}

/**
 * Loads the participant's reservation board and keeps availability fresh through a single private
 * broadcast channel per edition. Losing the channel only makes counts staler; the server always revalidates.
 */
export function useReservationBoard(editionId: string | undefined) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const offset = useRef(0);
  const requestSeq = useRef(0);

  const reload = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const data = await fetchBoard();
      if (seq !== requestSeq.current) return;
      if (!data || !Array.isArray(data.sessions) || !Array.isArray(data.reservations)) throw new Error('BAD_BOARD');
      offset.current = new Date(data.server_time).getTime() - Date.now();
      setBoard(applyClock(data, offset.current));
      setError(null);
    } catch (cause) {
      if (seq === requestSeq.current) setError(cause);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const id = window.setInterval(() => setBoard((b) => (b ? applyClock(b, offset.current) : b)), CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // Desbloqueo preciso en la hora de apertura, sin esperar el tick de 30 segundos
  // ni necesitar que el estudiante recargue la pagina. El backend revalida cada reserva.
  useEffect(() => {
    if (!board?.opens_at || board.window !== 'not_open') return;
    const remaining = new Date(board.opens_at).getTime() - (Date.now() + offset.current);
    if (remaining <= 0) {
      setBoard((current) => (current ? applyClock(current, offset.current) : current));
      return;
    }
    const timer = window.setTimeout(() => {
      setBoard((current) => (current ? applyClock(current, offset.current) : current));
    }, remaining + 10);
    return () => window.clearTimeout(timer);
  }, [board?.window, board?.opens_at]);

  // Cierre de inscripción preciso: al cruzar el límite de una sesión el botón desaparece sin esperar el tick de 30 s
  // ni recargar. El backend revalida cada reserva con su propio reloj.
  useEffect(() => {
    if (!board) return;
    const now = Date.now() + offset.current;
    const next = nextEnrollmentClose(board, now);
    if (next == null) return;
    const timer = window.setTimeout(() => {
      setBoard((current) => (current ? applyClock(current, offset.current) : current));
    }, Math.max(next - now, 0) + 10);
    return () => window.clearTimeout(timer);
  }, [board]);

  // Personal state: another tab of this browser changed my reservations/attendance, or this tab was hidden for a while.
  // (Seat counts come from the availability broadcast below; these are different concerns.)
  useParticipantSync(reload);

  useEffect(() => {
    if (!editionId) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let wasConnected = false;
    let reloadTimer = 0;
    const scheduleReload = () => {
      window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => void reload(), 400 + Math.random() * 800);
    };

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled || !data.session) return;
      supabase.realtime.setAuth(data.session.access_token);
      channel = supabase
        .channel(availabilityTopic(editionId), { config: { private: true } })
        .on('broadcast', { event: 'availability' }, ({ payload }) => {
          const p = payload as AvailabilityPatch;
          if (!p || typeof p.session_id !== 'string') return;
          setBoard((b) =>
            b
              ? {
                  ...b,
                  sessions: b.sessions.map((s) =>
                    s.id === p.session_id ? { ...s, reserved: p.reserved, remaining: p.remaining } : s,
                  ),
                }
              : b,
          );
        })
        .on('broadcast', { event: 'session_changed' }, scheduleReload)
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            if (wasConnected) scheduleReload();
            wasConnected = true;
          }
        });
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(reloadTimer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [editionId, reload]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        // Only a successful action is announced; the reload below never announces, so tabs cannot ping-pong.
        announceParticipantChange('reservation');
      } finally {
        await reload();
      }
    },
    [reload],
  );

  return {
    board,
    error,
    loading,
    reload,
    reserve: (sessionId: string) => run(() => reserveSession(sessionId)),
    change: (reservationId: string, sessionId: string) => run(() => changeReservation(reservationId, sessionId)),
    cancel: (reservationId: string) => run(() => cancelReservation(reservationId)),
  };
}
