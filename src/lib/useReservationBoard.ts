import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import {
  availabilityTopic,
  cancelReservation,
  changeReservation,
  fetchBoard,
  reserveSession,
  type AvailabilityPatch,
  type Board,
} from './reservations';

const STALE_AFTER_HIDDEN_MS = 20_000;
const CLOCK_TICK_MS = 30_000;

export function applyClock(board: Board, offsetMs: number): Board {
  const now = Date.now() + offsetMs;
  let changed = false;
  const sessions = board.sessions.map((s) => {
    const started = new Date(s.starts_at).getTime() <= now;
    const ended = new Date(s.ends_at).getTime() <= now;
    const inProgress = started && !ended;
    if (s.started === started && s.ended === ended && s.in_progress === inProgress) return s;
    changed = true;
    return { ...s, started, ended, in_progress: inProgress };
  });
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  // A reservation moves active → in_progress → ended with the clock; completion/expiry only come from the server.
  const reservations = board.reservations.map((r) => {
    const s = sessionById.get(r.session_id);
    if (!s || r.status !== 'vigente' || (r.derived_status !== 'active' && r.derived_status !== 'in_progress')) return r;
    const next = s.ended ? 'ended' : s.in_progress ? 'in_progress' : 'active';
    if (next === r.derived_status) return r;
    changed = true;
    return { ...r, derived_status: next };
  });
  return changed ? { ...board, sessions, reservations } : board;
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

  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > STALE_AFTER_HIDDEN_MS) void reload();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [reload]);

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
