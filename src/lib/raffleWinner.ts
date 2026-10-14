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

/** Lo que contesta el servidor: los resultados vigentes y cada cuánto conviene volver a preguntar. */
export type MyPrizesReading = { prizes: MyRafflePrize[]; pollSeconds: number };

/** Latido lento por omisión cuando el servidor no indica cadencia (respuesta antigua o incompleta). */
export const DEFAULT_POLL_SECONDS = 300;
/** Latido de recuperación: la cadencia más lenta posible. Nunca se deja de consultar del todo («null» del servidor = este latido). */
export const RECOVERY_SECONDS = 600;

export function normalizeReading(raw: unknown): MyPrizesReading {
  // Compatibilidad: una respuesta que sea solo la lista (sin cadencia) se trata con el latido lento.
  if (Array.isArray(raw)) return { prizes: normalizeMyPrizes(raw), pollSeconds: DEFAULT_POLL_SECONDS };
  const body = (raw && typeof raw === 'object' ? raw : {}) as { prizes?: unknown; poll_seconds?: unknown };
  const seconds = body.poll_seconds;
  return {
    prizes: normalizeMyPrizes(body.prizes),
    pollSeconds: seconds === null ? RECOVERY_SECONDS : typeof seconds === 'number' && Number.isFinite(seconds) ? Math.min(RECOVERY_SECONDS, Math.max(10, seconds)) : DEFAULT_POLL_SECONDS,
  };
}

export const fetchMyRafflePrizes = async (): Promise<MyPrizesReading> => normalizeReading(await rpc<unknown>('my_raffle_prizes'));

/** El servidor rechaza más de 1000 ids por llamada: se pide por lotes bastante menores. */
export const FOLIO_BATCH = 500;

/**
 * Folios para el panel del operador (Sorteo/Coordinación), por lotes. Un id sin folio simplemente no aparece. Si un lote falla se
 * conservan los demás (solo esos resultados quedan «no disponible»); si fallan todos, se lanza el error.
 */
export async function fetchWinnerFolios(ids: string[]): Promise<Map<string, string>> {
  const folios = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return folios;
  let failure: unknown = null;
  let answered = 0;
  for (let start = 0; start < unique.length; start += FOLIO_BATCH) {
    try {
      const rows = await rpc<unknown>('raffle_winner_folios', { p_winner_ids: unique.slice(start, start + FOLIO_BATCH) });
      answered += 1;
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const item = row as { winner_id?: unknown; folio?: unknown };
        if (typeof item?.winner_id === 'string' && typeof item.folio === 'string' && FOLIO.test(item.folio)) folios.set(item.winner_id, item.folio);
      }
    } catch (cause) {
      failure = cause;
    }
  }
  if (answered === 0 && failure) throw failure;
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

/** Mínimo entre dos consultas disparadas por eventos (volver a la pestaña, foco, red): evita ráfagas al desbloquear el teléfono. */
export const MIN_GAP_MS = 10_000;
export const MAX_BACKOFF_MS = 600_000;
/** Sin cadencia conocida (primer intento fallido), se reintenta pronto. */
export const RETRY_MS = 60_000;

/**
 * Espera hasta la siguiente consulta periódica, con ±15 % de variación para que miles de teléfonos no consulten a la vez.
 * `pollSeconds` lo dicta el servidor y nunca hay «sin consulta»: como mucho, el latido de recuperación de 10 min.
 * Tras fallos se espacia (×2 por intento, hasta 10 min); si el servidor nunca dijo nada, se reintenta cada minuto.
 */
export function nextDelay(failures: number, pollSeconds: number | null | undefined, random: () => number = Math.random): number {
  const seconds = pollSeconds == null ? RETRY_MS / 1000 : Math.min(RECOVERY_SECONDS, pollSeconds);
  const base = seconds * 1000 * 2 ** Math.min(failures, 4);
  return Math.round(Math.min(MAX_BACKOFF_MS, base) * (0.85 + random() * 0.3));
}

/** Tiempo máximo que una lectura exitosa puede considerarse al día: ~2.5 veces la cadencia, con un mínimo de un minuto. */
export const verifiedForMs = (pollSeconds: number | null | undefined): number => Math.max(60_000, (pollSeconds ?? DEFAULT_POLL_SECONDS) * 2500);
