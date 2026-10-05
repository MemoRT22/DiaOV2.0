// Pruebas de los helpers TypeScript del Centro de Operación (Fase 7).
// Verifica temporalStatus, attentionSignals, hasAttention, attendanceRate, isUpcomingSoon.
// Las señales visuales (LLENA, POCOS LUGARES, CHECK-IN PENDIENTE, SIN ASISTENCIAS, etc.)
// viven en operationsHelpers.ts y se prueban aquí, no en SQL.
//
// Ejecutar: node supabase/tests/test_operationsHelpers.mjs

import {
  temporalStatus,
  attentionSignals,
  hasAttention,
  attendanceRate,
  reservationPercent,
  isUpcomingSoon,
} from '../../src/lib/operationsHelpers.ts';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ` -> ${detail}` : ''}`);
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` -> ${detail}` : ''}`);
}

function makeSession(overrides) {
  return {
    session_id: 'test-uuid',
    activity_id: 'test-act',
    title: 'Test',
    division_id: 'test-div',
    division_name: 'Test Div',
    division_code: 'TD',
    starts_at: '2026-10-05T10:00:00Z',
    ends_at: '2026-10-05T11:00:00Z',
    location: 'Salon Test',
    status: 'activa',
    capacity: 20,
    reserved: 5,
    remaining: 15,
    attended: 3,
    is_demo: false,
    ...overrides,
  };
}

// ===== temporalStatus =====
const NOW = new Date('2026-10-05T10:30:00Z').getTime();

check('temporal: futura -> proxima',
  temporalStatus(makeSession({ starts_at: '2026-10-05T12:00:00Z', ends_at: '2026-10-05T13:00:00Z' }), NOW) === 'proxima');

check('temporal: entre inicio y fin -> en_curso',
  temporalStatus(makeSession({ starts_at: '2026-10-05T10:00:00Z', ends_at: '2026-10-05T11:00:00Z' }), NOW) === 'en_curso');

check('temporal: despues del fin -> terminada',
  temporalStatus(makeSession({ starts_at: '2026-10-05T09:00:00Z', ends_at: '2026-10-05T10:00:00Z' }), NOW) === 'terminada');

check('temporal: cancelada prevalece sobre tiempo',
  temporalStatus(makeSession({ status: 'cancelada', starts_at: '2026-10-05T09:00:00Z', ends_at: '2026-10-05T10:00:00Z' }), NOW) === 'cancelada');

check('temporal: oculta prevalece sobre tiempo',
  temporalStatus(makeSession({ status: 'oculta', starts_at: '2026-10-05T12:00:00Z', ends_at: '2026-10-05T13:00:00Z' }), NOW) === 'oculta');

// ===== attentionSignals: LLENA =====
check('signal: LLENA cuando remaining=0 y no terminada',
  attentionSignals(makeSession({ remaining: 0, reserved: 20, capacity: 20 }), 'proxima', NOW, 20)
    .some(s => s.label === 'LLENA' && s.tone === 'error'));

check('signal: no LLENA cuando remaining=0 y terminada',
  !attentionSignals(makeSession({ remaining: 0, reserved: 20, capacity: 20 }), 'terminada', NOW, 20)
    .some(s => s.label === 'LLENA'));

// ===== attentionSignals: POCOS LUGARES =====
check('signal: POCOS LUGARES cuando remaining <= 3',
  attentionSignals(makeSession({ remaining: 2, capacity: 20, reserved: 18 }), 'proxima', NOW, 20)
    .some(s => s.label === 'POCOS LUGARES' && s.tone === 'warning'));

check('signal: no POCOS LUGARES cuando remaining > 3',
  !attentionSignals(makeSession({ remaining: 10, capacity: 20, reserved: 10 }), 'proxima', NOW, 20)
    .some(s => s.label === 'POCOS LUGARES'));

check('signal: no POCOS LUGARES cuando terminada',
  !attentionSignals(makeSession({ remaining: 2, capacity: 20, reserved: 18 }), 'terminada', NOW, 20)
    .some(s => s.label === 'POCOS LUGARES'));

// ===== attentionSignals: SIN RESERVAS =====
check('signal: SIN RESERVAS cuando proxima y reserved=0',
  attentionSignals(makeSession({ reserved: 0, remaining: 20, capacity: 20 }), 'proxima', NOW, 20)
    .some(s => s.label === 'SIN RESERVAS' && s.tone === 'warning'));

check('signal: no SIN RESERVAS cuando en_curso',
  !attentionSignals(makeSession({ reserved: 0, remaining: 20, capacity: 20 }), 'en_curso', NOW, 20)
    .some(s => s.label === 'SIN RESERVAS'));

// ===== attentionSignals: CANCELADA =====
check('signal: CANCELADA',
  attentionSignals(makeSession({ status: 'cancelada' }), 'cancelada', NOW, 20)
    .some(s => s.label === 'CANCELADA' && s.tone === 'error'));

// ===== attentionSignals: CHECK-IN PENDIENTE =====
// terminada + reserved > 0 + attended = 0 + dentro de ventana (ends_at + 20min > serverTime)
const endedRecently = makeSession({
  starts_at: '2026-10-05T09:00:00Z',
  ends_at: '2026-10-05T10:00:00Z',
  reserved: 5,
  attended: 0,
  remaining: 15,
  capacity: 20,
});
check('signal: CHECK-IN PENDIENTE dentro de ventana',
  attentionSignals(endedRecently, 'terminada', new Date('2026-10-05T10:10:00Z').getTime(), 20)
    .some(s => s.label === 'CHECK-IN PENDIENTE' && s.tone === 'warning'));

// terminada + reserved > 0 + attended = 0 + fuera de ventana (ends_at + 20min < serverTime)
check('signal: SIN ASISTENCIAS fuera de ventana',
  attentionSignals(endedRecently, 'terminada', new Date('2026-10-05T10:30:00Z').getTime(), 20)
    .some(s => s.label === 'SIN ASISTENCIAS' && s.tone === 'neutral'));

// terminada + reserved = 0 + attended = 0 -> no CHECK-IN PENDIENTE
check('signal: sin reservas no marca CHECK-IN PENDIENTE',
  !attentionSignals(makeSession({ starts_at: '2026-10-05T09:00:00Z', ends_at: '2026-10-05T10:00:00Z', reserved: 0, attended: 0, remaining: 20, capacity: 20 }), 'terminada', new Date('2026-10-05T10:10:00Z').getTime(), 20)
    .some(s => s.label === 'CHECK-IN PENDIENTE'));

// ===== hasAttention =====
check('hasAttention: true con LLENA',
  hasAttention(makeSession({ remaining: 0, reserved: 20, capacity: 20 }), 'proxima', NOW, 20) === true);

check('hasAttention: false con solo SIN ASISTENCIAS (neutral)',
  hasAttention(endedRecently, 'terminada', new Date('2026-10-05T10:30:00Z').getTime(), 20) === false);

check('hasAttention: true con CHECK-IN PENDIENTE',
  hasAttention(endedRecently, 'terminada', new Date('2026-10-05T10:10:00Z').getTime(), 20) === true);

// ===== attendanceRate =====
check('tasa: 1/2 = 50%',
  attendanceRate(makeSession({ attended: 1, reserved: 2 })) === 50);

check('tasa: 0/5 = 0%',
  attendanceRate(makeSession({ attended: 0, reserved: 5 })) === 0);

check('tasa: reserved=0 retorna null (no division)',
  attendanceRate(makeSession({ attended: 0, reserved: 0 })) === null);

// ===== reservationPercent =====
check('reservationPercent: 5/20 = 25%',
  reservationPercent(makeSession({ reserved: 5, capacity: 20 })) === 25);

check('reservationPercent: 20/20 = 100%',
  reservationPercent(makeSession({ reserved: 20, capacity: 20 })) === 100);

check('reservationPercent: capacity=0 -> 0',
  reservationPercent(makeSession({ reserved: 5, capacity: 0 })) === 0);

// ===== isUpcomingSoon =====
check('isUpcomingSoon: true cuando inicia en 30 min',
  isUpcomingSoon(makeSession({ starts_at: new Date(NOW + 30 * 60 * 1000).toISOString() }), NOW) === true);

check('isUpcomingSoon: false cuando inicia en 2 horas',
  isUpcomingSoon(makeSession({ starts_at: new Date(NOW + 2 * 60 * 60 * 1000).toISOString() }), NOW) === false);

check('isUpcomingSoon: false cuando ya termino',
  isUpcomingSoon(makeSession({ starts_at: new Date(NOW - 60 * 60 * 1000).toISOString() }), NOW) === false);

// ===== Resumen =====
console.log('');
if (fail === 0) {
  console.log(`RESULTADO: ${pass} passed, 0 failed`);
  process.exit(0);
} else {
  console.log(`RESULTADO: ${pass} passed, ${fail} failed`);
  failures.forEach(f => console.log(`  FAIL: ${f}`));
  process.exit(1);
}
