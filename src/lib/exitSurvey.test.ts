import { describe, expect, test } from 'vitest';
import {
  answered, asSurveyError, EMPTY_ANSWERS, EXIT_SURVEY_VERSION, isComplete, MAX_AREAS, msUntilOpen, nextCheckDelay, normalizeExitSurvey, nps,
  NO_AREA, OPEN_JITTER_MS, RESYNC_MS, toPayload, toggleArea, type ExitSurveyStatus,
} from './exitSurvey';

const complete = { ...EMPTY_ANSWERS, q1: 'entre_varias', q2: 4, q3: 'ya_claro', q4: ['salud'], q5: 9 };
const status = (over: Partial<ExitSurveyStatus> = {}): ExitSurveyStatus => ({
  version: EXIT_SURVEY_VERSION, opensAt: '2026-10-15T18:00:00Z', offsetMs: 0, isOpen: false, completed: false, completedAt: null, invitedAt: null,
  hasWon: false, stampsCategoryName: null, stampsMet: false, eligible: false, ...over,
});

describe('respuestas', () => {
  test('las cinco son obligatorias; el comentario no cuenta', () => {
    expect(isComplete(EMPTY_ANSWERS)).toBe(false);
    expect(isComplete(complete)).toBe(true);
    expect(isComplete({ ...complete, comment: '' })).toBe(true);
    for (const missing of [{ q1: null }, { q2: null }, { q3: null }, { q4: [] }, { q5: null }]) expect(isComplete({ ...complete, ...missing })).toBe(false);
  });
  test('rangos: estrellas 1–5, recomendación 0–10 (el 0 es una respuesta válida)', () => {
    expect(answered({ ...complete, q2: 0 }, 1)).toBe(false);
    expect(answered({ ...complete, q2: 6 }, 1)).toBe(false);
    expect(answered({ ...complete, q2: 1 }, 1)).toBe(true);
    expect(answered({ ...complete, q5: 0 }, 4)).toBe(true);
    expect(answered({ ...complete, q5: 10 }, 4)).toBe(true);
    expect(answered({ ...complete, q5: 11 }, 4)).toBe(false);
    expect(answered({ ...complete, q1: 'otra' }, 0)).toBe(false);
  });
  test('áreas: hasta tres, sin repetir; «todavía sin un área definida» es exclusiva', () => {
    let areas: string[] = [];
    for (const area of ['salud', 'deporte', 'negocios', 'derecho_ri']) areas = toggleArea(areas, area);
    expect(areas).toEqual(['salud', 'deporte', 'negocios']);
    expect(areas).toHaveLength(MAX_AREAS);
    expect(toggleArea(areas, 'salud')).toEqual(['deporte', 'negocios']); // quitar una libera lugar
    expect(toggleArea(areas, NO_AREA)).toEqual([NO_AREA]); // reemplaza a las demás
    expect(toggleArea([NO_AREA], 'salud')).toEqual(['salud']); // elegir un área quita «ninguna»
    expect(toggleArea([NO_AREA], NO_AREA)).toEqual([]);
    expect(answered({ ...complete, q4: [NO_AREA] }, 3)).toBe(true);
    expect(answered({ ...complete, q4: ['a', 'b', 'c', 'd'] }, 3)).toBe(false);
  });
  test('el envío nunca lleva identificador de persona ni fechas; el comentario vacío viaja como null', () => {
    const payload = toPayload({ ...complete, comment: '   ' });
    expect(Object.keys(payload).sort()).toEqual(['comment', 'q1', 'q2', 'q3', 'q4', 'q5', 'version']);
    expect(payload).toMatchObject({ version: EXIT_SURVEY_VERSION, comment: null });
    expect(toPayload({ ...complete, comment: ' más talleres ' }).comment).toBe('más talleres');
  });
});

describe('estado del servidor y reloj', () => {
  test('normaliza la respuesta y mide la diferencia entre el reloj del servidor y el del dispositivo', () => {
    const received = Date.parse('2026-10-15T17:00:10Z');
    const result = normalizeExitSurvey({ version: 'exit-2026-v1', opens_at: '2026-10-15T18:00:00Z', server_now: '2026-10-15T17:00:00Z', is_open: false, completed: false, eligible: false, stamps_met: true, stamps_category_name: 'Galaxia' }, received);
    expect(result).toMatchObject({ isOpen: false, completed: false, stampsMet: true, stampsCategoryName: 'Galaxia', invitedAt: null });
    expect(result.offsetMs).toBe(-10_000); // el dispositivo iba 10 s adelantado
  });
  test('una respuesta vacía o ilegible nunca cuenta como abierta ni como contestada', () => {
    const result = normalizeExitSurvey(null);
    expect(result).toMatchObject({ isOpen: false, completed: false, eligible: false, offsetMs: 0 });
  });
  test('msUntilOpen usa el reloj del servidor, no el del dispositivo', () => {
    const base = status({ offsetMs: -10_000 });
    const device = Date.parse('2026-10-15T17:59:00Z'); // el dispositivo cree que falta 1 min…
    expect(msUntilOpen(base, device)).toBe(70_000); // …pero el servidor va 10 s detrás: faltan 70 s
    expect(msUntilOpen(status({ opensAt: '' }))).toBeNull();
  });
});

describe('cuándo volver a preguntar al servidor', () => {
  const now = Date.parse('2026-10-15T17:50:00Z');
  test('ya contestó: nunca más. Abierta y pendiente: nada que esperar (lo mueve la persona)', () => {
    expect(nextCheckDelay(status({ completed: true }), 0, now)).toBeNull();
    expect(nextCheckDelay(status({ isOpen: true }), 0, now)).toBeNull();
  });
  test('falta poco: se pregunta a la hora, con hasta 30 s de variación para que no pregunten todos a la vez', () => {
    const soon = Date.parse('2026-10-15T17:55:00Z');
    const remaining = 5 * 60_000;
    expect(nextCheckDelay(status(), 0, soon, () => 0)).toBe(remaining);
    expect(nextCheckDelay(status(), 0, soon, () => 0.999)).toBeGreaterThan(remaining + OPEN_JITTER_MS - 100);
    const spread = new Set(Array.from({ length: 20 }, () => nextCheckDelay(status(), 0, soon)));
    expect(spread.size).toBeGreaterThan(5);
  });
  test('falta mucho: se vuelve a sincronizar cada 10 min (por si cambió la hora o el reloj)', () => {
    expect(nextCheckDelay(status({ opensAt: '2026-10-15T23:00:00Z' }), 0, now, () => 0)).toBe(RESYNC_MS);
  });
  test('según el reloj ya es la hora pero el servidor dice que no: se revisa pronto, sin abrir nada por su cuenta', () => {
    const late = Date.parse('2026-10-15T18:05:00Z');
    const delay = nextCheckDelay(status(), 0, late, () => 0)!;
    expect(delay).toBeGreaterThanOrEqual(45_000);
    expect(delay).toBeLessThanOrEqual(90_000);
  });
  test('sin lectura todavía: reintenta con espera creciente y acotada', () => {
    const waits = [0, 1, 2, 3, 4, 5, 9].map((failures) => nextCheckDelay(null, failures, now, () => 0.5)!);
    expect(waits[0]).toBe(15_000);
    expect(waits[1]).toBe(30_000);
    expect(waits[waits.length - 1]).toBeLessThanOrEqual(5 * 60_000 * 1.15);
    expect(waits.every((wait, index) => index === 0 || wait >= waits[index - 1])).toBe(true);
  });
});

describe('errores de red', () => {
  test('sin conexión, tiempo agotado y saturación son temporales; los códigos de negocio pasan intactos', () => {
    expect((asSurveyError({ message: 'TypeError: Failed to fetch' }) as Error).message).toBe('NETWORK');
    expect((asSurveyError({ message: 'Load failed' }) as Error).message).toBe('NETWORK');
    expect((asSurveyError({ message: 'The operation timed out' }) as Error).message).toBe('TIMEOUT');
    expect((asSurveyError({ message: '429 Too Many Requests' }) as Error).message).toBe('RATE_LIMITED');
    expect((asSurveyError({ message: '503 Service Unavailable' }) as Error).message).toBe('TEMPORARILY_UNAVAILABLE');
    const business = { message: 'SURVEY_NOT_OPEN' };
    expect(asSurveyError(business)).toBe(business);
    const invalid = { message: 'INVALID_SURVEY_ANSWERS' };
    expect(asSurveyError(invalid)).toBe(invalid);
  });
  test('NPS', () => {
    expect(nps({ completed: 0, q5_promoters: 0, q5_detractors: 0 })).toBeNull();
    expect(nps({ completed: 10, q5_promoters: 6, q5_detractors: 2 })).toBe(40);
  });
});
