import { describe, expect, test } from 'vitest';
import type { Board, BoardSession, MyReservation } from './reservations';
import { projectStamps, stampSlots } from './stampProjection';

const session = (id: string, credits: number, activity = `act-${id}`, minutes = 30): BoardSession => ({
  id, activity_id: activity, title: id, description: '', division_id: null, starts_at: '2026-10-15T15:00:00Z',
  ends_at: new Date(Date.parse('2026-10-15T15:00:00Z') + minutes * 60_000).toISOString(), location: '', credits, status: 'activa',
  capacity: 30, reserved: 0, remaining: 30, started: false, ended: false, in_progress: false, attended: false, my_reservation_id: null,
  conflicts_with: [], tight_transfer_with: [],
});
const booking = (id: string, s: BoardSession, over: Partial<MyReservation> = {}): MyReservation => ({
  id, session_id: s.id, activity_id: s.activity_id, status: 'vigente', created_at: '', ended_at: null, resolved: false,
  derived_status: 'active', credits_granted: null, ...over,
});
const board = (sessions: BoardSession[], reservations: MyReservation[]): Pick<Board, 'sessions' | 'reservations'> => ({ sessions, reservations });

describe('sellos potenciales de la ruta', () => {
  test('una misión de 30 minutos (1 crédito) avanza un punto potencial', () => {
    const s = session('a', 1, 'a', 30);
    expect(projectStamps(board([s], [booking('r1', s)]))).toEqual({ earned: 0, planned: 1, total: 1 });
  });

  test('una misión de 60 minutos (2 créditos) avanza dos puntos potenciales', () => {
    const s = session('a', 2, 'a', 60);
    expect(projectStamps(board([s], [booking('r1', s)]))).toEqual({ earned: 0, planned: 2, total: 2 });
  });

  test('15 y 30 minutos valen 1 sello; los créditos los pone el servidor, no la duración', () => {
    const short = session('s', 1, 's', 15);
    const sixtyButOne = session('l', 1, 'l', 60); // si el servidor dijera 1, es 1
    expect(projectStamps(board([short, sixtyButOne], [booking('r1', short), booking('r2', sixtyButOne)])).planned).toBe(2);
  });

  test('tres misiones con créditos 1 + 1 + 2 suman cuatro sellos potenciales', () => {
    const [a, b, c] = [session('a', 1), session('b', 1), session('c', 2, 'c', 60)];
    expect(projectStamps(board([a, b, c], [booking('r1', a), booking('r2', b), booking('r3', c)]))).toEqual({ earned: 0, planned: 4, total: 4 });
  });

  test('cancelar o cambiar una reservación actualiza la proyección', () => {
    const [a, b, c] = [session('a', 1), session('b', 1), session('c', 2, 'c', 60)];
    const all = [booking('r1', a), booking('r2', b), booking('r3', c)];
    expect(projectStamps(board([a, b, c], all)).planned).toBe(4);
    // cancelar la de 60 min: el tablero ya no la trae
    expect(projectStamps(board([a, b, c], all.slice(0, 2))).planned).toBe(2);
    // una cancelada por la sesión no cuenta
    expect(projectStamps(board([a, b, c], [all[0], all[1], booking('r3', c, { status: 'cancelada_sesion', derived_status: 'cancelled' })])).planned).toBe(2);
    // cambiar la de 30 min (b) por otro horario de una misión de 60 min con 2 créditos: la reservación apunta a otra sesión
    const swapped = session('b2', 2, 'b', 60);
    expect(projectStamps(board([a, swapped, c], [all[0], booking('r2', swapped), all[2]])).planned).toBe(5);
  });

  test('vencidas y terminadas sin asistencia no cuentan', () => {
    const [a, b, c] = [session('a', 1), session('b', 2, 'b', 60), session('c', 1)];
    const result = projectStamps(board([a, b, c], [
      booking('r1', a),
      booking('r2', b, { status: 'expirada', derived_status: 'expired' }),
      booking('r3', c, { derived_status: 'ended' }),
    ]));
    expect(result).toEqual({ earned: 0, planned: 1, total: 1 });
  });

  test('en curso sigue siendo potencial (aún no se confirmó la asistencia)', () => {
    const a = session('a', 2, 'a', 60);
    expect(projectStamps(board([a], [booking('r1', a, { derived_status: 'in_progress' })]))).toEqual({ earned: 0, planned: 2, total: 2 });
  });

  test('una asistencia confirmada se cuenta como obtenida y NO se suma otra vez como potencial', () => {
    const [done, next] = [session('done', 2, 'done', 60), session('next', 1)];
    const result = projectStamps(board([done, next], [
      booking('r1', done, { derived_status: 'completed', credits_granted: 2 }),
      booking('r2', next),
    ]));
    expect(result).toEqual({ earned: 2, planned: 1, total: 3 });
  });

  test('si otra reservación de la misma misión sigue en el tablero, la asistencia ya contabilizada no se duplica', () => {
    const first = session('first', 1, 'same');
    const again = session('again', 1, 'same');
    const result = projectStamps(board([first, again], [
      booking('r1', first, { derived_status: 'completed', credits_granted: 1 }),
      booking('r2', again, { status: 'cancelada_sesion', derived_status: 'completed', credits_granted: 1 }), // mismo logro, otra fila
      booking('r3', again), // vigente de una misión ya asistida
    ]));
    expect(result).toEqual({ earned: 1, planned: 0, total: 1 });
  });

  test('los sellos obtenidos salen de los créditos realmente otorgados, no de los de la sesión', () => {
    const s = session('a', 2, 'a', 60);
    expect(projectStamps(board([s], [booking('r1', s, { derived_status: 'completed', credits_granted: 1 })])).earned).toBe(1);
  });

  test('sin créditos conocidos no se inventan sellos (ni por duración)', () => {
    const odd = { ...session('a', 1, 'a', 60), credits: undefined as unknown as number };
    expect(projectStamps(board([odd], [booking('r1', odd)])).planned).toBe(0);
  });

  test('una reservación cuya sesión no está en el tablero no rompe nada', () => {
    const a = session('a', 1);
    expect(projectStamps(board([], [booking('r1', a)]))).toEqual({ earned: 0, planned: 0, total: 0 });
  });
});

describe('alcance de la proyección', () => {
  test('«obtenidos» son solo los de las misiones del tablero: una asistencia sin reservación no aparece, y por eso no define ningún rango', () => {
    // la persona tiene sellos oficiales ganados sin reservación; el tablero solo trae una reservación futura
    const next = session('next', 1);
    const result = projectStamps(board([next], [booking('r1', next)]));
    expect(result).toEqual({ earned: 0, planned: 1, total: 1 }); // parcial por diseño: la pantalla lo rotula «en tu ruta»
  });
});

describe('posiciones de la progresión (cuatro hasta el último rango)', () => {
  test('obtenidos primero, luego posibles, luego vacíos', () => {
    expect(stampSlots({ earned: 1, planned: 2 }, 4)).toEqual({ slots: ['earned', 'planned', 'planned', 'empty'], overflow: 0 });
  });

  test('con más de cuatro sellos no hay más posiciones ni rangos: se informa el excedente', () => {
    expect(stampSlots({ earned: 1, planned: 5 }, 4)).toEqual({ slots: ['earned', 'planned', 'planned', 'planned'], overflow: 2 });
    expect(stampSlots({ earned: 6, planned: 0 }, 4)).toEqual({ slots: ['earned', 'earned', 'earned', 'earned'], overflow: 2 });
  });
});
