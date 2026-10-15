import { isTemporaryAccessError, retryAfterOf } from './accessErrors';

export type RetryOptions = {
  /** Reintentos automáticos ADEMÁS del intento inicial. Acotado: nunca infinito. */
  retries?: number;
  baseMs?: number;
  /** Si el servidor pide esperar más que esto, no se espera en segundo plano: se avisa a la persona. */
  maxAutoWaitMs?: number;
  /**
   * Un intento que tardó más que esto antes de fallar indica un servicio saturado, no un tropiezo de red: repetirlo de inmediato solo
   * suma carga y alarga la espera de la persona. No se reintenta solo; se le avisa para que decida (con cuenta atrás).
   */
  slowAttemptMs?: number;
  signal?: AbortSignal;
  random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export class RetryAborted extends Error {
  constructor() { super('ABORTED'); this.name = 'RetryAborted'; }
}

export const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(new RetryAborted());
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(timer); reject(new RetryAborted()); };
  signal?.addEventListener('abort', onAbort, { once: true });
});

/** Espera antes del siguiente reintento: exponencial con variación aleatoria (±30 %), y nunca menos de lo que pidió el servidor. */
export function backoffMs(attempt: number, retryAfterSeconds: number | undefined, baseMs: number, random: () => number): number {
  const exponential = baseMs * 2 ** attempt * (0.7 + random() * 0.6);
  return Math.round(Math.max(exponential, (retryAfterSeconds ?? 0) * 1000 * (1 + random() * 0.2)));
}

/**
 * Reintenta `run` SOLO ante errores temporales (límite, caída, red, tiempo agotado), con esperas progresivas y variación aleatoria,
 * un número acotado de veces y sin seguir en segundo plano si la persona abandona (`signal`). Úsese únicamente con operaciones
 * seguras de repetir: lecturas e inicio de sesión. Las que crean cuentas se reintentan por decisión de la persona.
 */
export async function retryTransient<T>(run: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 1, baseMs = 1500, maxAutoWaitMs = 5_000, slowAttemptMs = 3_000, signal, random = Math.random, sleep: wait = sleep } = options;
  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) throw new RetryAborted();
    const startedAt = Date.now();
    try {
      return await run();
    } catch (cause) {
      if (cause instanceof RetryAborted || signal?.aborted) throw cause instanceof RetryAborted ? cause : new RetryAborted();
      if (!isTemporaryAccessError(cause) || attempt >= retries) throw cause;
      if (Date.now() - startedAt > slowAttemptMs) throw cause; // servicio saturado: no se le suma otra petición
      // El tope se aplica a lo que PIDIÓ el servidor (y a la espera exponencial), antes de la variación aleatoria: un `Retry-After: 5`
      // con tope de 5 s sí se reintenta; la variación (hasta +20 %) solo reparte los reintentos, no decide si ocurren.
      const askedMs = (retryAfterOf(cause) ?? 0) * 1000;
      if (askedMs > maxAutoWaitMs || baseMs * 2 ** attempt > maxAutoWaitMs) throw cause; // que lo decida la persona, con la cuenta atrás
      const delay = backoffMs(attempt, retryAfterOf(cause), baseMs, random);
      await wait(delay, signal);
    }
  }
}
