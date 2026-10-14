// Realtime: conexiones concurrentes al canal privado de disponibilidad (el mismo que abre la aplicación), recepción de actualizaciones y
// RECUPERACIÓN tras desconexiones. Cada persona abre su conexión y la mantiene; una fracción «actúa» (reserva y cancela un cupo en sesiones
// de gran capacidad) para producir difusiones reales y medir el retraso hasta recibirlas; otra fracción pierde la conexión a propósito y
// se recupera como la aplicación (reconectar con espera, volver a unirse y recargar el tablero). Las ESCRITURAS de los actores exigen
// LOADTEST_ALLOW_WRITES; sin ella solo se mide conexión, unión y latidos (y se reciben las difusiones de otros procesos que sí escriban).
import { journey } from '../config/profiles.js';
import * as thresholds from '../config/thresholds.js';
import { sessionsOf } from '../lib/data.js';
import { ENV, assertSafe } from '../lib/env.js';
import { rtLagMs } from '../lib/metrics.js';
import { connect, recordRecovery } from '../lib/realtime.js';
import { studentSession } from '../lib/session.js';
import { summarize } from '../lib/summary.js';
import { chance, pick } from '../lib/think.js';
import { bootstrap, rpc } from '../lib/supabase.js';
import { sleep } from 'k6';

export const options = {
  scenarios: { realtime: journey({ exec: 'listen' }) },
  thresholds: thresholds.merge(thresholds.health(), thresholds.realtime(), thresholds.reads(), thresholds.writes()),
};

export function setup() { return assertSafe({ supabase: true, writes: true }); }

const ACTOR_RATIO = Number(__ENV.REALTIME_ACTOR_RATIO || 0.1);   // quién provoca difusiones
const DROP_RATIO = Number(__ENV.REALTIME_DROP_RATIO || 0.3);     // quién pierde la conexión
let editionId = null;
let role = null;                                                   // «actor» | «oyente», fijo por VU

const jitter = (min, max) => min + Math.random() * (max - min);

export function listen(slice) {
  const session = studentSession(slice);
  if (!session) return;
  role = role || (chance(ACTOR_RATIO) ? 'actor' : 'oyente');
  if (!editionId) {
    const boot = bootstrap(session);
    editionId = boot.edition && boot.edition.id;
    if (!editionId) return sleep(5);
  }
  const rt = sessionsOf('rt');
  const willDrop = chance(DROP_RATIO);
  const holdMs = jitter(40, 120) * 1000;
  const dropAt = jitter(10, Math.min(35, holdMs / 1000 - 5)) * 1000;
  let pending = null;      // { sessionId, at }: acción propia cuya difusión esperamos
  let held = null;         // { id, sessionId }: la reservación que este actor tiene y cancelará después
  let lastAction = 0;
  let dropped = false;
  let droppedAt = 0;

  const first = connect(session, editionId, {
    holdMs,
    onAvailability: (patch, receivedAt) => {
      if (pending && patch && patch.session_id === pending.sessionId) { rtLagMs.add(receivedAt - pending.at); pending = null; }
    },
    onTick: (socket, elapsed) => {
      if (willDrop && !dropped && elapsed >= dropAt) { dropped = true; droppedAt = Date.now(); socket.close(); return; }
      if (role !== 'actor' || !ENV.writes || rt.length === 0 || elapsed - lastAction < 12000 || pending) return;
      lastAction = elapsed;
      if (held) {
        const result = rpc(session, 'cancel_reservation', { p_reservation: held.id }, { op: 'cancel_reservation', extraTags: { set: 'rt' } });
        if (result.ok) pending = { sessionId: held.sessionId, at: Date.now() };
        held = null;
      } else {
        const target = pick(rt);
        const result = rpc(session, 'reserve_session', { p_session: target.id }, { op: 'reserve_session', extraTags: { set: 'rt' } });
        if (result.ok) { held = { id: result.body.reservation_id, sessionId: target.id }; pending = { sessionId: target.id, at: Date.now() }; }
      }
    },
  });
  if (!first.joined) return sleep(jitter(2, 6));

  if (dropped) {
    // Recuperación como la aplicación: esperar un poco, volver a unirse y recargar el tablero.
    sleep(jitter(0.5, 3));
    let recorded = false;
    const again = connect(session, editionId, {
      holdMs: jitter(15, 40) * 1000,
      onJoined: (socket) => {
        socket.setTimeout(() => {
          const board = rpc(session, 'my_reservation_board', {});
          recordRecovery(droppedAt, board.ok);
          recorded = true;
        }, jitter(400, 1200));
      },
    });
    if (!recorded) recordRecovery(droppedAt, false); // no volvió a unirse o se cerró antes de recargar
  }
  sleep(jitter(1, 5));
}

export const handleSummary = summarize('07-realtime');
