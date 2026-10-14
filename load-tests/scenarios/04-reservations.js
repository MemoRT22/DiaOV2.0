// Reservaciones bajo contención. Muchas personas intentan reservar a la vez sesiones con CUPO LIMITADO. Se comprueba que:
//   · nunca se excede el cupo (umbral por sesión: reservaciones logradas ≤ capacidad, y auditoría del tablero de cada persona);
//   · nunca hay reservaciones duplicadas (mismo taller / misma sesión) ni más del máximo por persona;
//   · los conflictos de horario y de taller se rechazan (si el sistema aceptara uno, la prueba se detiene);
//   · los dobles clic no duplican (ALREADY_RESERVED).
// ESCRIBE en la base: exige LOADTEST_ALLOW_WRITES=<frase> y un entorno AISLADO. Sin ella corre en solo lectura (tablero).
// RESERVATION_MODE: contention (apertura: todos sobre las sesiones «calientes»), steady (reservar/cambiar/cancelar en el catálogo normal)
// o mixed (por omisión). Antes de repetir la prueba, restablece el estado: `psql -f data/reset-run.sql`.
import { journey } from '../config/profiles.js';
import * as thresholds from '../config/thresholds.js';
import { sessionsOf } from '../lib/data.js';
import { ENV, assertSafe } from '../lib/env.js';
import { accountReserve, auditBoard, candidates, conflicting } from '../lib/reservations.js';
import { duplicateReservation, conflictAccepted } from '../lib/metrics.js';
import { studentSession } from '../lib/session.js';
import { summarize } from '../lib/summary.js';
import { chance, pick, think } from '../lib/think.js';
import { rpc } from '../lib/supabase.js';

const MODE = (__ENV.RESERVATION_MODE || 'mixed').toLowerCase();

function scenarios() {
  const all = {
    contention: journey({ exec: 'contention', share: MODE === 'mixed' ? 0.5 : 1, tags: { flow: 'contention' } }),
    steady: journey({ exec: 'steady', share: MODE === 'mixed' ? 0.5 : 1, tags: { flow: 'steady' } }),
  };
  return MODE === 'contention' ? { contention: all.contention } : MODE === 'steady' ? { steady: all.steady } : all;
}

/** Tope duro por sesión «caliente»: no puede haber más reservaciones logradas que lugares. Se genera desde el manifiesto. */
function capThresholds() {
  const rules = {};
  for (const session of sessionsOf('hot')) rules[`reserve_success{session:${session.id}}`] = [{ threshold: `count<=${session.capacity}`, abortOnFail: true, delayAbortEval: '0s' }];
  return rules;
}

export const options = {
  scenarios: scenarios(),
  thresholds: thresholds.merge(thresholds.health(), thresholds.integrity(), thresholds.reads(), thresholds.writes(), capThresholds()),
};

export function setup() { return assertSafe({ supabase: true, writes: true }); }

const hot = () => sessionsOf('hot');
const normal = () => sessionsOf('normal');

function readOnlyTick(session) { const board = rpc(session, 'my_reservation_board', {}); if (board.ok) auditBoard(board.body); think(2, 6); }

/** Apertura de reservaciones: todos sobre unas pocas sesiones con poco cupo, con la vista algo desactualizada (como en la vida real). */
export function contention(slice, globalUnique = false) {
  const session = studentSession(slice, globalUnique);
  if (!session) return;
  if (!ENV.writes) return readOnlyTick(session);
  const board = rpc(session, 'my_reservation_board', {});
  if (!board.ok) return think(1, 3);
  auditBoard(board.body);

  const attemptConflict = chance(0.12);
  const pool = attemptConflict ? conflicting(board.body, hot()) : candidates(board.body, hot(), chance(0.7));
  if (pool.length === 0) return think(2, 6);
  const target = pick(pool);
  const result = rpc(session, 'reserve_session', { p_session: target.id }, { op: 'reserve_session', extraTags: { set: 'hot' } });
  const outcome = accountReserve(result, target, true);
  if (attemptConflict && outcome === 'ok') conflictAccepted.add(1); // aceptó algo que chocaba: violación

  if (chance(0.08)) { // doble clic
    const again = rpc(session, 'reserve_session', { p_session: target.id }, { op: 'reserve_session', extraTags: { set: 'hot', double: 'yes' } });
    if (again.ok) duplicateReservation.add(1);
  }
  const after = rpc(session, 'my_reservation_board', {});
  if (after.ok) auditBoard(after.body);
  think(3, 9);
}

/** Uso normal: reservar en el catálogo general, cambiar de horario y cancelar. */
export function steady(slice, globalUnique = false) {
  const session = studentSession(slice, globalUnique);
  if (!session) return;
  if (!ENV.writes) return readOnlyTick(session);
  const board = rpc(session, 'my_reservation_board', {});
  if (!board.ok) return think(2, 5);
  auditBoard(board.body);
  // Solo se cambia o cancela en el catálogo normal: en las sesiones «calientes» no se libera cupo, para que «logradas ≤ capacidad» sea una prueba exacta.
  const normalIds = new Set(normal().map((s) => s.id));
  const mine = board.body.reservations.filter((r) => r.status === 'vigente' && normalIds.has(r.session_id));
  const action = Math.random();
  if (action < 0.65 || mine.length === 0) {
    const pool = candidates(board.body, normal(), true);
    if (pool.length) { const target = pick(pool); accountReserve(rpc(session, 'reserve_session', { p_session: target.id }, { op: 'reserve_session', extraTags: { set: 'normal' } }), target, false); }
  } else if (action < 0.85) {
    const current = pick(mine);
    const sameActivity = normal().filter((s) => s.activity_id === current.activity_id && s.id !== current.session_id);
    if (sameActivity.length) rpc(session, 'change_reservation', { p_reservation: current.id, p_session: pick(sameActivity).id }, { op: 'change_reservation' });
  } else {
    rpc(session, 'cancel_reservation', { p_reservation: pick(mine).id }, { op: 'cancel_reservation' });
  }
  const after = rpc(session, 'my_reservation_board', {});
  if (after.ok) auditBoard(after.body);
  think(4, 14);
}

export const handleSummary = summarize('04-reservations');
