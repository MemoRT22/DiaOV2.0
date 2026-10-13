import { beforeEach, describe, expect, test, vi } from 'vitest';
import { rpc } from './adminApi';
import {
  DEFAULT_POLL_SECONDS, FOLIO_BATCH, RECOVERY_SECONDS, fetchMyRafflePrizes, fetchWinnerFolios, markSeen, MAX_BACKOFF_MS, nextDelay, normalizeMyPrizes, normalizeReading, pendingNotice,
  readSeen, resetSeenMemory, RETRY_MS, SEEN_STORAGE_KEY, verifiedForMs, type MyRafflePrize,
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
    vi.mocked(rpc).mockResolvedValue({ prizes: [row()], poll_seconds: 20 } as never);
    const reading = await fetchMyRafflePrizes();
    expect(reading.prizes).toHaveLength(1);
    expect(reading.pollSeconds).toBe(20);
    expect(vi.mocked(rpc).mock.calls).toEqual([['my_raffle_prizes']]);
  });
  test('la cadencia que dicta el servidor: «null» no significa dejar de consultar sino el latido de recuperación; fuera de rango se acota', () => {
    expect(normalizeReading({ prizes: [], poll_seconds: null }).pollSeconds).toBe(RECOVERY_SECONDS);
    expect(normalizeReading({ prizes: [], poll_seconds: 1 }).pollSeconds).toBe(10);
    expect(normalizeReading({ prizes: [], poll_seconds: 99999 }).pollSeconds).toBe(600);
    expect(normalizeReading({ prizes: [] }).pollSeconds).toBe(DEFAULT_POLL_SECONDS);
    expect(normalizeReading({ prizes: [], poll_seconds: 'rápido' }).pollSeconds).toBe(DEFAULT_POLL_SECONDS);
    expect(normalizeReading([row()]).prizes).toHaveLength(1); // forma antigua: solo la lista
    expect(normalizeReading(null)).toEqual({ prizes: [], pollSeconds: DEFAULT_POLL_SECONDS });
  });
  describe('folios por lotes (el servidor rechaza más de 1000 ids)', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`);
    const answerWith = (list: string[]) => list.map((id) => ({ winner_id: id, folio: `GAN-${id.slice(1).padStart(6, '0')}` }));
    test('1,200 resultados se piden en lotes que caben y se juntan', async () => {
      vi.mocked(rpc).mockImplementation((async (_name: string, args: { p_winner_ids: string[] }) => answerWith(args.p_winner_ids)) as never);
      const folios = await fetchWinnerFolios(ids(1200));
      const sizes = vi.mocked(rpc).mock.calls.map((call) => (call[1] as { p_winner_ids: string[] }).p_winner_ids.length);
      expect(sizes.every((size) => size <= FOLIO_BATCH && size <= 1000)).toBe(true);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(1200);
      expect(folios.size).toBe(1200);
      expect(folios.get('w1199')).toBe('GAN-001199');
    });
    test('ids repetidos no se piden dos veces', async () => {
      vi.mocked(rpc).mockImplementation((async (_name: string, args: { p_winner_ids: string[] }) => answerWith(args.p_winner_ids)) as never);
      await fetchWinnerFolios(['w1', 'w1', 'w2']);
      expect((vi.mocked(rpc).mock.calls[0][1] as { p_winner_ids: string[] }).p_winner_ids).toEqual(['w1', 'w2']);
    });
    test('si falla un lote se conservan los demás; si fallan todos, se informa', async () => {
      let call = 0;
      vi.mocked(rpc).mockImplementation((async (_name: string, args: { p_winner_ids: string[] }) => { call += 1; if (call === 2) throw new Error('timeout'); return answerWith(args.p_winner_ids); }) as never);
      const partial = await fetchWinnerFolios(ids(1200));
      expect(partial.size).toBe(1200 - FOLIO_BATCH);
      vi.mocked(rpc).mockRejectedValue(new Error('network'));
      await expect(fetchWinnerFolios(ids(3))).rejects.toThrow('network');
    });
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
  test('nunca hay «sin consulta»: aun la cadencia más lenta es un latido de recuperación de 10 min', () => {
    expect(RECOVERY_SECONDS).toBe(600);
    for (const seconds of [undefined, null, 15, 20, 120, 180, 300, 600, 99999]) {
      const delay = nextDelay(0, seconds as number | null | undefined, () => 0.5);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(RECOVERY_SECONDS * 1000 * 1.15);
    }
    expect(nextDelay(0, 600, () => 0.5)).toBe(600_000);
  });
  test('con cadencia del servidor, con variación de ±15 %', () => {
    expect(nextDelay(0, 20, () => 0.5)).toBe(20_000);
    expect(nextDelay(0, 20, () => 0)).toBe(17_000);
    expect(nextDelay(0, 20, () => 1)).toBe(23_000);
    expect(nextDelay(0, 180, () => 0.5)).toBe(180_000);
  });
  test('tras fallos se espacia hasta un tope; si el servidor nunca dijo nada se reintenta cada minuto', () => {
    expect(nextDelay(1, 20, () => 0.5)).toBe(40_000);
    expect(nextDelay(3, 20, () => 0.5)).toBe(160_000);
    expect(nextDelay(10, 300, () => 0.5)).toBeLessThanOrEqual(MAX_BACKOFF_MS);
    expect(nextDelay(0, undefined, () => 0.5)).toBe(RETRY_MS);
    expect(nextDelay(1, undefined, () => 0.5)).toBe(RETRY_MS * 2);
  });
  test('lo mostrado vale como verificado ~2.5 veces la cadencia, nunca menos de un minuto', () => {
    expect(verifiedForMs(15)).toBe(60_000);
    expect(verifiedForMs(20)).toBe(60_000);
    expect(verifiedForMs(300)).toBe(750_000);
    expect(verifiedForMs(null)).toBe(750_000);
  });
});
