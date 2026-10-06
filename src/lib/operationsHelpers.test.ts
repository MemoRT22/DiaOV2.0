import { describe, expect, test } from 'vitest';
import type { OperationsOverview, OperationsSession } from './operationsApi';
import {
  applyFilters, attentionOf, buildRows, checkinHref, defaultView, demandOf, divisionOptions, eventPhase, formatSpan,
  groupByStart, matchesDivision, matchesQuery, NO_FILTERS, splitViews, temporalStatus, unlocatedUpcoming,
} from './operationsHelpers';

const D1 = { id: 'd1', code: 'SAL', name: 'Salud' };
const D2 = { id: 'd2', code: 'ING', name: 'Ingeniería' };
const T0 = Date.parse('2026-10-15T15:00:00Z'); // 10:00 en Cancún
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

let n = 0;
function session(over: Partial<OperationsSession> = {}): OperationsSession {
  n += 1;
  return {
    session_id: `s${n}`, activity_id: `a${n}`, title: `Taller ${n}`, divisions: [D1], starts_at: at(60), ends_at: at(90),
    location: 'HUB', status: 'activa', capacity: 30, reserved: 10, remaining: 20, attended: 0,
    affected_reservations: 0, affected_unresolved: 0, ...over,
  };
}
const attention = (s: OperationsSession, now = T0, close = 20) => attentionOf(s, temporalStatus(s, now), now, close).map((a) => a.kind);

describe('estado temporal', () => {
  test('próxima, en curso y terminada se calculan contra el reloj que se les pasa', () => {
    const s = session({ starts_at: at(0), ends_at: at(30) });
    expect(temporalStatus(s, T0 - 1)).toBe('proxima');
    expect(temporalStatus(s, T0)).toBe('en_curso');
    expect(temporalStatus(s, T0 + 30 * 60_000)).toBe('terminada');
  });
  test('cancelada y oculta prevalecen sobre el tiempo', () => {
    expect(temporalStatus(session({ status: 'cancelada' }), T0)).toBe('cancelada');
    expect(temporalStatus(session({ status: 'oculta', starts_at: at(-10), ends_at: at(10) }), T0)).toBe('oculta');
  });
});

describe('atención: solo situaciones accionables', () => {
  test('sin ubicación en curso o por empezar pronto es atención, con su contexto', () => {
    expect(attention(session({ location: null, starts_at: at(-5), ends_at: at(25) }))).toEqual(['sin_ubicacion']);
    const near = session({ location: null, starts_at: at(20), ends_at: at(50) });
    expect(attentionOf(near, 'proxima', T0, 20)[0].label).toBe('Sin ubicación · inicia en 20 min');
    expect(attention(session({ location: '   ', starts_at: at(59), ends_at: at(80) }))).toEqual(['sin_ubicacion']);
  });
  test('sin ubicación lejana NO es atención (es una tarea de configuración)', () => {
    expect(attention(session({ location: null, starts_at: at(60 * 24 * 3), ends_at: at(60 * 24 * 3 + 30) }))).toEqual([]);
    expect(attention(session({ location: null, starts_at: at(90), ends_at: at(120) }))).toEqual([]);
  });
  test('cancelada con reservaciones sin alternativa es atención y dice cuántas', () => {
    const s = session({ status: 'cancelada', affected_reservations: 20, affected_unresolved: 17 });
    const [a] = attentionOf(s, 'cancelada', T0, 20);
    expect(a.label).toBe('Cancelada · 17 participantes con reservación');
    expect(a.tone).toBe('error');
    expect(attentionOf(session({ status: 'cancelada', affected_unresolved: 1 }), 'cancelada', T0, 20)[0].label).toBe('Cancelada · 1 participante con reservación');
  });
  test('cancelada ya resuelta, o cuyo horario ya pasó, no es atención', () => {
    expect(attentionOf(session({ status: 'cancelada', affected_reservations: 5, affected_unresolved: 0 }), 'cancelada', T0, 20)).toEqual([]);
    expect(attentionOf(session({ status: 'cancelada', affected_unresolved: 3, starts_at: at(-90), ends_at: at(-60) }), 'cancelada', T0, 20)).toEqual([]);
  });
  test('check-in pendiente: terminó, hay reservaciones, cero asistencias y la ventana sigue abierta', () => {
    const ended = session({ starts_at: at(-40), ends_at: at(-10), reserved: 8, attended: 0 });
    expect(attention(ended)).toEqual(['checkin_pendiente']);
    expect(attentionOf(ended, 'terminada', T0, 20)[0].label).toBe('Check-in pendiente · terminó hace 10 min');
  });
  test('check-in pendiente no aplica con asistencias, sin reservaciones o con la ventana cerrada', () => {
    expect(attention(session({ starts_at: at(-40), ends_at: at(-10), reserved: 8, attended: 3 }))).toEqual([]);
    expect(attention(session({ starts_at: at(-40), ends_at: at(-10), reserved: 0, attended: 0 }))).toEqual([]);
    expect(attention(session({ starts_at: at(-90), ends_at: at(-60), reserved: 8, attended: 0 }))).toEqual([]);
  });
  test('próxima sin reservaciones solo es atención cuando realmente está por empezar', () => {
    expect(attention(session({ reserved: 0, remaining: 30, starts_at: at(15), ends_at: at(45) }))).toEqual(['sin_reservaciones']);
    expect(attention(session({ reserved: 0, remaining: 30, starts_at: at(60 * 24 * 5), ends_at: at(60 * 24 * 5 + 30) }))).toEqual([]);
    expect(attention(session({ reserved: 0, remaining: 30, starts_at: at(120), ends_at: at(150) }))).toEqual([]);
  });
  test('reservaciones por encima del cupo es una anomalía de datos', () => {
    expect(attention(session({ reserved: 35, remaining: 0 }))).toEqual(['sobreocupada']);
  });
  test('LLENO y POCOS LUGARES nunca son atención', () => {
    expect(attention(session({ reserved: 30, remaining: 0 }))).toEqual([]);
    expect(attention(session({ reserved: 28, remaining: 2 }))).toEqual([]);
    expect(attention(session({ reserved: 30, remaining: 0, starts_at: at(-5), ends_at: at(25) }))).toEqual([]);
  });
  test('ocultas no generan atención', () => {
    expect(attention(session({ status: 'oculta', location: null, starts_at: at(-5), ends_at: at(25) }))).toEqual([]);
  });
});

describe('demanda', () => {
  test('lleno y pocos lugares son señales de demanda, no de incidente', () => {
    expect(demandOf(session({ remaining: 0, reserved: 30 }), 'proxima')).toBe('lleno');
    expect(demandOf(session({ remaining: 3, reserved: 27 }), 'proxima')).toBe('pocos');
    expect(demandOf(session({ remaining: 20 }), 'proxima')).toBeNull();
    expect(demandOf(session({ remaining: 0 }), 'terminada')).toBeNull();
  });
});

describe('búsqueda y división', () => {
  const multi = session({ title: 'IA Generativa', location: 'Biblioteca · Sala Ámbar', divisions: [D1, D2] });
  test('encuentra por taller, ubicación y división, sin importar acentos ni mayúsculas', () => {
    expect(matchesQuery(multi, 'generativa')).toBe(true);
    expect(matchesQuery(multi, 'sala ambar')).toBe(true);
    expect(matchesQuery(multi, 'INGENIERIA')).toBe(true);
    expect(matchesQuery(multi, 'salud')).toBe(true);
    expect(matchesQuery(multi, 'derecho')).toBe(false);
    expect(matchesQuery(multi, '  ')).toBe(true);
  });
  test('el filtro de división encuentra talleres multidivisión por cualquiera de sus divisiones', () => {
    expect(matchesDivision(multi, 'd1')).toBe(true);
    expect(matchesDivision(multi, 'd2')).toBe(true);
    expect(matchesDivision(multi, 'd9')).toBe(false);
    expect(matchesDivision(session({ divisions: [] }), 'd1')).toBe(false);
  });
  test('las opciones de división salen de la relación real y no se repiten', () => {
    expect(divisionOptions([multi, session({ divisions: [D2] }), session({ divisions: [] })])).toEqual([
      { id: 'd2', name: 'Ingeniería' }, { id: 'd1', name: 'Salud' },
    ]);
  });
});

function overview(sessions: OperationsSession[], over: Partial<OperationsOverview> = {}): OperationsOverview {
  return {
    server_time: new Date(T0).toISOString(), mode: 'preparacion', event_date: '2026-10-15', timezone: 'America/Cancun',
    checkin_close_after_minutes: 20, sessions, summary: {} as OperationsOverview['summary'], ...over,
  };
}

describe('momento del evento', () => {
  const future = (days: number) => ({ starts_at: at(60 * 24 * days), ends_at: at(60 * 24 * days + 30) });
  test('antes del día del evento es pre y aterriza en Próximas, no en una consola vacía', () => {
    const data = overview([session(future(5))], { event_date: '2026-10-20' });
    const phase = eventPhase(data, buildRows(data, T0), T0);
    expect(phase).toBe('pre');
    expect(defaultView(phase)).toBe('proximas');
  });
  test('el día del evento es live y prioriza Ahora', () => {
    const data = overview([session({ starts_at: at(180), ends_at: at(210) })]);
    const phase = eventPhase(data, buildRows(data, T0), T0);
    expect(phase).toBe('live');
    expect(defaultView(phase)).toBe('ahora');
  });
  test('con una sesión en curso es live aunque la fecha configurada no coincida', () => {
    const data = overview([session({ starts_at: at(-5), ends_at: at(25) })], { event_date: '2026-10-20' });
    expect(eventPhase(data, buildRows(data, T0), T0)).toBe('live');
  });
  test('sin nada por venir es post y muestra el programa', () => {
    const data = overview([session({ starts_at: at(-60 * 48), ends_at: at(-60 * 48 + 30) })], { event_date: '2026-10-10' });
    const phase = eventPhase(data, buildRows(data, T0), T0);
    expect(phase).toBe('post');
    expect(defaultView(phase)).toBe('programa');
  });
  test('la fecha local usa la zona de la edición, no la del navegador', () => {
    // 2026-10-16T03:00Z sigue siendo 15 de octubre en Cancún (22:00)
    const late = Date.parse('2026-10-16T03:00:00Z');
    const data = overview([session({ starts_at: at(60 * 24 * 3), ends_at: at(60 * 24 * 3 + 30) })]);
    expect(eventPhase(data, buildRows(data, late), late)).toBe('live');
  });
});

describe('vistas y bloques', () => {
  test('Ahora reúne atención, en curso y por empezar pronto; Próximas son solo las futuras', () => {
    const running = session({ starts_at: at(-5), ends_at: at(25) });
    const soon = session({ starts_at: at(20), ends_at: at(50) });
    const later = session({ starts_at: at(200), ends_at: at(230) });
    const broken = session({ location: null, starts_at: at(40), ends_at: at(70) });
    const ended = session({ starts_at: at(-120), ends_at: at(-90) });
    const data = overview([running, soon, later, broken, ended]);
    const v = splitViews(buildRows(data, T0), T0);
    expect(v.ahora.inProgress.map((r) => r.session)).toEqual([running]);
    expect(v.ahora.soon.map((r) => r.session)).toEqual([soon]);
    expect(v.ahora.attention.map((r) => r.session)).toEqual([broken]);
    expect(v.proximas.map((r) => r.session.session_id)).toEqual([soon, broken, later].map((s) => s.session_id));
    expect(v.atencion.map((r) => r.session)).toEqual([broken]);
    expect(v.programa).toHaveLength(5);
  });
  test('los bloques son cronológicos y agrupan por hora de inicio', () => {
    const a = session({ starts_at: at(60), ends_at: at(90), title: 'B' });
    const b = session({ starts_at: at(0), ends_at: at(30), title: 'A' });
    const c = session({ starts_at: at(60), ends_at: at(90), title: 'C' });
    const blocks = groupByStart(buildRows(overview([a, b, c]), T0), 'America/Cancun');
    expect(blocks.map((x) => x.rows.map((r) => r.session.title))).toEqual([['A'], ['B', 'C']]);
    expect(new Set(blocks.map((x) => x.day))).toEqual(new Set(['2026-10-15']));
  });
  test('los filtros se combinan', () => {
    const rows = buildRows(overview([
      session({ title: 'Robótica', divisions: [D2], location: 'Lab 1' }),
      session({ title: 'Anatomía', divisions: [D1], location: 'Lab 2', remaining: 0, reserved: 30 }),
    ]), T0);
    expect(applyFilters(rows, { ...NO_FILTERS, query: 'lab', divisionId: 'd1' })).toHaveLength(1);
    expect(applyFilters(rows, { ...NO_FILTERS, demand: 'llenas' }).map((r) => r.session.title)).toEqual(['Anatomía']);
    expect(applyFilters(rows, { ...NO_FILTERS, demand: 'con_lugares' }).map((r) => r.session.title)).toEqual(['Robótica']);
    expect(applyFilters(rows, { ...NO_FILTERS, moment: 'terminada' })).toHaveLength(0);
  });
  test('las sesiones próximas sin ubicación que aún no son urgentes se señalan como tarea de configuración', () => {
    const far = session({ location: null, starts_at: at(60 * 24 * 3), ends_at: at(60 * 24 * 3 + 30) });
    const near = session({ location: null, starts_at: at(20), ends_at: at(50) });
    expect(unlocatedUpcoming(buildRows(overview([far, near]), T0)).map((r) => r.session)).toEqual([far]);
  });
});

test('formatSpan y el enlace a Check-in', () => {
  expect(formatSpan(20)).toBe('20 min');
  expect(formatSpan(130)).toBe('2 h 10 min');
  expect(formatSpan(60)).toBe('1 h');
  expect(formatSpan(60 * 24 * 3)).toBe('3 d');
  expect(checkinHref('abc')).toBe('/coordinacion/checkin?session=abc');
});
