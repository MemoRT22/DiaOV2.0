import { rpc } from './adminApi';

/*
 * Resultado del sorteo visto por el ALUMNO ganador, y folio que lo identifica ante el operador.
 *
 * El servidor decide todo: `my_raffle_prizes()` devuelve solo los resultados vigentes (seleccionado / confirmado) de la persona
 * autenticada, identificada por su participante, nunca por nombre o correo. Aquí solo se valida la forma de la respuesta y se
 * guarda, en este dispositivo, qué avisos ya se mostraron. Ver un aviso no cambia nada en Supabase.
 */

export type PrizeStatus = 'seleccionado' | 'confirmado';

export type MyRafflePrize = {
  winnerId: string;
  /** Referencia única y estable del resultado, «GAN-000123». Es de cotejo visual, no una credencial. */
  folio: string;
  status: PrizeStatus;
  prizeName: string;
  categoryName: string;
  /** Nombre del ganador tal como lo ve el operador en su panel. */
  displayName: string;
  drawnAt: string;
  confirmedAt: string | null;
};

const FOLIO = /^GAN-\d{6,}$/;

/** Acepta solo filas completas y vigentes; una fila rara se descarta en vez de mostrarse a medias. */
export function normalizeMyPrizes(raw: unknown): MyRafflePrize[] {
  if (!Array.isArray(raw)) return [];
  const prizes: MyRafflePrize[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const status = row.status;
    if (status !== 'seleccionado' && status !== 'confirmado') continue;
    if (typeof row.winner_id !== 'string' || typeof row.folio !== 'string' || !FOLIO.test(row.folio) || typeof row.prize_name !== 'string' || row.prize_name.trim() === '') continue;
    prizes.push({
      winnerId: row.winner_id,
      folio: row.folio,
      status,
      prizeName: row.prize_name,
      categoryName: typeof row.category_name === 'string' ? row.category_name : '',
      displayName: typeof row.display_name === 'string' && row.display_name.trim() ? row.display_name : 'Participante',
      drawnAt: typeof row.drawn_at === 'string' ? row.drawn_at : '',
      confirmedAt: typeof row.confirmed_at === 'string' ? row.confirmed_at : null,
    });
  }
  return prizes;
}

export const fetchMyRafflePrizes = async (): Promise<MyRafflePrize[]> => normalizeMyPrizes(await rpc<unknown>('my_raffle_prizes'));

/** Folios para el panel del operador (Sorteo/Coordinación). Un id sin folio simplemente no aparece. */
export async function fetchWinnerFolios(ids: string[]): Promise<Map<string, string>> {
  const folios = new Map<string, string>();
  if (ids.length === 0) return folios;
  const rows = await rpc<unknown>('raffle_winner_folios', { p_winner_ids: ids });
  if (!Array.isArray(rows)) return folios;
  for (const row of rows) {
    const item = row as { winner_id?: unknown; folio?: unknown };
    if (typeof item?.winner_id === 'string' && typeof item.folio === 'string' && FOLIO.test(item.folio)) folios.set(item.winner_id, item.folio);
  }
  return folios;
}

// ---------- Avisos ya mostrados en este dispositivo ----------

const SEEN_KEY = 'diaov:raffle-winner-seen:v1';
const SEEN_LIMIT = 50;
// Si el navegador no deja guardar (modo privado, almacenamiento lleno), el aviso no debe reaparecer mientras la pestaña siga abierta.
const memory = new Set<string>();

export function readSeen(): Set<string> {
  const seen = new Set(memory);
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? '[]');
    if (Array.isArray(parsed)) parsed.forEach((id) => typeof id === 'string' && seen.add(id));
  } catch { /* sin almacenamiento: queda la memoria de la pestaña */ }
  return seen;
}

export function markSeen(winnerId: string) {
  memory.add(winnerId);
  try {
    const ids = [...readSeen()];
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-SEEN_LIMIT)));
  } catch { /* igual queda en memoria */ }
}

export const SEEN_STORAGE_KEY = SEEN_KEY;
/** Solo para pruebas. */
export const resetSeenMemory = () => memory.clear();

/** El aviso que toca mostrar: el primer resultado «seleccionado» que esta persona aún no cerró en este dispositivo. */
export const pendingNotice = (prizes: MyRafflePrize[], seen: ReadonlySet<string>): MyRafflePrize | null =>
  prizes.find((prize) => prize.status === 'seleccionado' && !seen.has(prize.winnerId)) ?? null;

// ---------- Cadencia de consulta ----------

export const POLL_MS = 20_000;
export const MAX_BACKOFF_MS = 120_000;

/** Siguiente espera: la normal con un poco de variación (para que miles de teléfonos no consulten a la vez) o, tras fallos, más larga. */
export function nextDelay(failures: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** Math.min(failures, 3));
  return Math.round(base * (0.85 + random() * 0.3));
}
