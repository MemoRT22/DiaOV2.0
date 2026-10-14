// Asistencia: `check_in` aislado, con las credenciales de ENSAYO del manifiesto (una por actividad, QR o código manual) y personas que ya
// tienen reservaciones previas sembradas. Comprueba: primera lectura registra la asistencia; repetirla es idempotente (jamás una segunda
// asistencia ni sellos dobles); una credencial inválida y un taller sin reservación se rechazan con su código. ESCRIBE: exige
// LOADTEST_ALLOW_WRITES. Sin ella solo consulta el progreso. Restablecer entre corridas: `psql -f data/reset-run.sql`.
import { journey } from '../config/profiles.js';
import * as thresholds from '../config/thresholds.js';
import { bookingsOf, credentialOf, dataset } from '../lib/data.js';
import { ENV, assertSafe } from '../lib/env.js';
import { checkinInvalid, checkinNew, checkinNoReservation, checkinRepeat, duplicateSaved } from '../lib/metrics.js';
import { studentSession } from '../lib/session.js';
import { summarize } from '../lib/summary.js';
import { chance, pick, think } from '../lib/think.js';
import { rpc } from '../lib/supabase.js';

export const options = {
  scenarios: { checkin: journey({ exec: 'scan' }) },
  thresholds: thresholds.merge(thresholds.health(), thresholds.integrity(), thresholds.reads(), thresholds.writes()),
};

export function setup() { return assertSafe({ supabase: true, writes: true }); }

export function scan(slice) {
  const session = studentSession(slice);
  if (!session) return;
  if (!ENV.writes) { rpc(session, 'my_progress', {}); return think(3, 8); }

  const bookings = bookingsOf(session.userIndex);
  if (bookings.length === 0) { rpc(session, 'my_progress', {}); return think(3, 8); }
  const booking = pick(bookings);
  const credential = credentialOf(booking.activity_id);
  const manual = chance(0.2);
  const first = rpc(session, 'check_in', { p_credential: manual ? credential.code : credential.qr }, { op: 'check_in', extraTags: { method: manual ? 'manual' : 'qr' } });
  if (first.ok) {
    if (first.body.already_registered) checkinRepeat.add(1); else checkinNew.add(1);
    // Segundo escaneo (doble lectura, o la misma persona vuelve a pasar): DEBE ser idempotente.
    if (chance(0.3)) {
      const again = rpc(session, 'check_in', { p_credential: credential.qr }, { op: 'check_in', extraTags: { method: 'qr', repeat: 'yes' } });
      if (again.ok && !again.body.already_registered) duplicateSaved.add(1);
      if (again.ok && first.body.attendance_id && again.body.attendance_id !== first.body.attendance_id) duplicateSaved.add(1);
      if (again.ok) checkinRepeat.add(1);
    }
  }
  if (chance(0.03)) { // un QR que no existe
    const bad = rpc(session, 'check_in', { p_credential: `LT-INVALID-${Math.random().toString(36).slice(2, 10)}` }, { op: 'check_in', extraTags: { method: 'invalid' } });
    if (!bad.ok && bad.code === 'INVALID_CREDENTIAL') checkinInvalid.add(1);
  }
  if (chance(0.03)) { // el taller de otra persona (sin reservación propia)
    const others = dataset().credentials.filter((c) => !bookings.some((b) => b.activity_id === c.activity_id));
    if (others.length) { const stray = rpc(session, 'check_in', { p_credential: pick(others).qr }, { op: 'check_in', extraTags: { method: 'no_reservation' } }); if (!stray.ok && stray.code === 'NO_RESERVATION') checkinNoReservation.add(1); }
  }
  rpc(session, 'my_progress', {});
  think(4, 15);
}

export const handleSummary = summarize('05-checkin');
