import { beforeEach, describe, expect, test, vi } from 'vitest';
import { rpc } from './adminApi';
import {
  fetchMyRafflePrizes, fetchWinnerFolios, markSeen, MAX_BACKOFF_MS, nextDelay, normalizeMyPrizes, pendingNotice, POLL_MS, readSeen, resetSeenMemory,
  SEEN_STORAGE_KEY, type MyRafflePrize,
} from './raffleWinner';

vi.mock('./adminApi', async (importOriginal) => ({ ...await importOriginal<typeof import('./adminApi')>(), rpc: vi.fn() }));

const row = (over: Record<string, unknown> = {}) => ({
  winner_id: 'w1', folio: 'GAN-000123', status: 'seleccionado', prize_name: 'Nintendo Switch OLED', category_name: 'Galaxia',
  display_name: 'Valeria Méndez Castillo', drawn_at: '2026-10-22T16:00:00Z', confirmed_at: null, ...over,
});
const prize = (over: Partial<MyRafflePrize> = {}): MyRafflePrize => ({
  winnerId: 'w1', folio: 'GAN-000123', status: 'seleccionado', prizeName: 'Nintendo Switch OLED', categoryName: 'Galaxia', displayName: 'Valeria', drawnAt: '', confirmedAt: null, ...over,
});

beforeEach(() => { vi.clearAllMocks(); window.localStorage.clear(); resetSeenMemory(); });

describe('respuesta del servidor', () => {
  test('se normaliza lo que el servidor devuelve de SU resultado', () => {
    expect(normalizeMyPrizes([row()])).toEqual([prize({ displayName: 'Valeria Méndez Castillo', drawnAt: '2026-10-22T16:00:00Z' })]);
  });
  test('solo cuentan los resultados vigentes: no_presentado e invalidado no son un premio reclamable', () => {
    expect(normalizeMyPrizes([row({ status: 'no_presentado' }), row({ winner_id: 'w2', status: 'invalidado' }), row({ winner_id: 'w3', status: 'confirmado' })]).map((p) => p.winnerId)).toEqual(['w3']);
  });
  test('una fila incompleta o con un folio raro se descarta en vez de mostrarse a medias', () => {
    expect(normalizeMyPrizes([row({ folio: 'abc' }), row({ folio: undefined }), row({ prize_name: '  ' }), row({ winner_id: 1 }), null, 'x'])).toEqual([]);
    expect(normalizeMyPrizes(null)).toEqual([]);
    expect(normalizeMyPrizes({ error: true })).toEqual([]);
  });
  test('lee con el RPC del alumno y no escribe nada', async () => {
    vi.mocked(rpc).mockResolvedValue([row()] as never);
    expect(await fetchMyRafflePrizes()).toHaveLength(1);
    expect(vi.mocked(rpc).mock.calls).toEqual([['my_raffle_prizes']]);
  });
  test('folios del operador: mapa por resultado; lo que no existe no aparece; sin ids no hay consulta', async () => {
    vi.mocked(rpc).mockResolvedValue([{ winner_id: 'w1', folio: 'GAN-000123' }, { winner_id: 'w2', folio: 'mal' }] as never);
    const folios = await fetchWinnerFolios(['w1', 'w2']);
    expect([...folios]).toEqual([['w1', 'GAN-000123']]);
    vi.mocked(rpc).mockClear();
    expect((await fetchWinnerFolios([])).size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('aviso: cuándo toca mostrarlo', () => {
  test('solo un resultado «seleccionado» que esta persona aún no cerró', () => {
    expect(pendingNotice([prize()], new Set())?.winnerId).toBe('w1');
    expect(pendingNotice([prize()], new Set(['w1']))).toBeNull();
    expect(pendingNotice([prize({ status: 'confirmado' })], new Set())).toBeNull(); // ya entregado: no hay aviso, solo la tarjeta
    expect(pendingNotice([], new Set())).toBeNull();
  });
  test('cerrar uno no oculta el aviso de otro resultado', () => {
    expect(pendingNotice([prize(), prize({ winnerId: 'w2' })], new Set(['w1']))?.winnerId).toBe('w2');
  });
  test('lo cerrado se recuerda en este dispositivo y sobrevive a recargar', () => {
    markSeen('w1');
    expect(readSeen().has('w1')).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(SEEN_STORAGE_KEY)!)).toEqual(['w1']);
  });
  test('si el almacenamiento falla, no reaparece mientras la pestaña siga abierta', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    markSeen('w9');
    expect(readSeen().has('w9')).toBe(true);
    spy.mockRestore(); get.mockRestore();
  });
  test('un valor corrupto en el almacenamiento no rompe nada', () => {
    window.localStorage.setItem(SEEN_STORAGE_KEY, '{no es json');
    expect(readSeen().size).toBe(0);
    window.localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify({ a: 1 }));
    expect(readSeen().size).toBe(0);
  });
  test('la lista de avisos vistos no crece sin límite', () => {
    for (let n = 0; n < 80; n += 1) markSeen(`w${n}`);
    expect(JSON.parse(window.localStorage.getItem(SEEN_STORAGE_KEY)!).length).toBeLessThanOrEqual(50);
  });
});

describe('cadencia de consulta', () => {
  test('cada ~20 s con variación, y más espaciada tras fallos hasta un tope', () => {
    expect(nextDelay(0, () => 0.5)).toBe(POLL_MS);
    expect(nextDelay(0, () => 0)).toBeLessThan(POLL_MS);
    expect(nextDelay(1, () => 0.5)).toBe(POLL_MS * 2);
    expect(nextDelay(10, () => 0.5)).toBeLessThanOrEqual(MAX_BACKOFF_MS);
    expect(nextDelay(10, () => 1)).toBeLessThanOrEqual(MAX_BACKOFF_MS * 1.15);
  });
});
