import ws from 'k6/ws';
import { check } from 'k6';
import { ENV } from './env.js';
import { rtConnected, rtDropped, rtJoinMs, rtJoinOk, rtLagMs, rtMessages, rtRecoveryMs, rtRecoveryOk } from './metrics.js';

/*
 * Cliente mínimo del protocolo Phoenix de Supabase Realtime, igual al que usa `supabase-js` en la aplicación: un canal PRIVADO de
 * broadcast por edición (`availability:<edition_id>`) con el JWT de la persona. Las actualizaciones de cupo llegan como eventos
 * `availability` y los cambios de horario como `session_changed`.
 */
const wsUrl = () => `${ENV.supabaseUrl.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${ENV.anonKey}&vsn=1.0.0`;
export const topicOf = (editionId) => `realtime:availability:${editionId}`;

/**
 * Abre una conexión, se une al canal y la mantiene `holdMs`. Callbacks:
 *   onJoined(socket)        – canal confirmado
 *   onAvailability(payload, receivedAt)
 *   onTick(socket, elapsedMs) – cada 1 s (para acciones programadas del escenario)
 * Devuelve { joined, joinMs, messages, closedByServer }.
 */
export function connect(session, editionId, { holdMs, onJoined, onAvailability, onTick, closeAfterMs } = {}) {
  const result = { joined: false, joinMs: 0, messages: 0, closedByServer: false };
  const startedAt = Date.now();
  let ref = 0;
  const nextRef = () => String(++ref);
  const joinRef = nextRef();

  const response = ws.connect(wsUrl(), { tags: { op: 'realtime_connect', kind: 'realtime' } }, (socket) => {
    socket.on('open', () => {
      rtConnected.add(1);
      socket.send(JSON.stringify({
        topic: topicOf(editionId), event: 'phx_join', ref: joinRef, join_ref: joinRef,
        payload: { config: { broadcast: { ack: false, self: false }, presence: { key: '' }, postgres_changes: [], private: true }, access_token: session.accessToken },
      }));
    });
    socket.on('message', (raw) => {
      const message = JSON.parse(raw);
      if (message.event === 'phx_reply' && message.ref === joinRef) {
        const ok = message.payload && message.payload.status === 'ok';
        rtJoinOk.add(!!ok);
        if (ok) {
          result.joined = true; result.joinMs = Date.now() - startedAt; rtJoinMs.add(result.joinMs);
          if (onJoined) onJoined(socket);
        }
      } else if (message.event === 'broadcast' && message.payload) {
        const receivedAt = Date.now();
        result.messages += 1; rtMessages.add(1);
        if (onAvailability && message.payload.event === 'availability') onAvailability(message.payload.payload, receivedAt);
      } else if (message.event === 'phx_close' || message.event === 'phx_error') {
        result.closedByServer = true; rtDropped.add(1);
      }
    });
    socket.on('close', () => { /* cierre normal o forzado: el escenario decide */ });
    socket.on('error', () => { rtDropped.add(1); });
    // Latido de Phoenix cada 25 s (el servidor cierra conexiones mudas).
    socket.setInterval(() => socket.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() })), 25000);
    socket.setInterval(() => { if (onTick) onTick(socket, Date.now() - startedAt); }, 1000);
    socket.setTimeout(() => socket.close(), closeAfterMs || holdMs);
  });
  check(response, { 'ws 101': (r) => r && r.status === 101 });
  if (!(response && response.status === 101)) rtJoinOk.add(false);
  return result;
}

/** Mide cuánto tarda en volver a estar unido y con el estado al día después de una desconexión. */
export function recordRecovery(startedAtMs, ok) {
  rtRecoveryOk.add(!!ok);
  if (ok) rtRecoveryMs.add(Date.now() - startedAtMs);
}
export { rtLagMs };
