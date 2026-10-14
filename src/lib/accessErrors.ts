/*
 * Errores temporales del acceso (inicio de sesión, identificación, registro).
 *
 * Un límite de solicitudes (429), una caída pasajera (5xx), la pérdida de conexión o un tiempo agotado NO son «contraseña incorrecta»
 * ni un dato inválido: la persona debe poder reintentar sin perder nada. Aquí se nombran, se reconocen y se les saca el tiempo de
 * espera que informe el servidor (`Retry-After`).
 */

export type TemporaryCode = 'RATE_LIMITED' | 'TEMPORARILY_UNAVAILABLE' | 'NETWORK' | 'TIMEOUT';
const TEMPORARY: readonly string[] = ['RATE_LIMITED', 'TEMPORARILY_UNAVAILABLE', 'NETWORK', 'TIMEOUT'];

/** El `message` es el código, para que `friendlyError` y las pruebas existentes sigan funcionando igual. */
export class AccessError extends Error {
  readonly code: TemporaryCode;
  /** Segundos que pidió esperar el servidor, si lo dijo. */
  readonly retryAfterSeconds?: number;
  constructor(code: TemporaryCode, retryAfterSeconds?: number) {
    super(code);
    this.name = 'AccessError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const isTemporaryAccessError = (cause: unknown): cause is Error =>
  cause instanceof Error && (cause instanceof AccessError || TEMPORARY.includes(cause.message));

export const retryAfterOf = (cause: unknown): number | undefined =>
  cause instanceof AccessError ? cause.retryAfterSeconds : undefined;

export const temporaryCodeOf = (cause: unknown): TemporaryCode | null =>
  cause instanceof AccessError ? cause.code : cause instanceof Error && TEMPORARY.includes(cause.message) ? (cause.message as TemporaryCode) : null;

/** El tope de espera que se le pide a una persona; un valor absurdo del servidor no la deja bloqueada. */
export const MAX_RETRY_AFTER_SECONDS = 120;

/** `Retry-After`: segundos enteros o una fecha HTTP. Devuelve segundos (acotados) o undefined. */
export function parseRetryAfter(value: string | number | null | undefined, now: number = Date.now()): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const text = String(value).trim();
  let seconds: number;
  if (/^\d+(\.\d+)?$/.test(text)) seconds = Math.ceil(Number(text));
  else {
    const at = Date.parse(text);
    if (Number.isNaN(at)) return undefined;
    seconds = Math.ceil((at - now) / 1000);
  }
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(MAX_RETRY_AFTER_SECONDS, seconds);
}

/**
 * Clasifica el error de `supabase.auth.signInWithPassword`. `null` = es una respuesta definitiva (credenciales incorrectas u otro
 * rechazo): solo entonces se puede decir «correo o contraseña incorrectos».
 */
export function classifyAuthError(error: { status?: number; code?: string; name?: string; message?: string } | null | undefined): AccessError | null {
  if (!error) return null;
  const status = error.status;
  if (status === 429 || error.code === 'over_request_rate_limit' || error.code === 'over_email_send_rate_limit') return new AccessError('RATE_LIMITED');
  if (/abort|timed? ?out/i.test(error.message ?? '')) return new AccessError('TIMEOUT');
  // Una respuesta que no es JSON de Auth (p. ej. la página de error de una puerta de enlace saturada) no dice nada de la contraseña.
  if (error.name === 'AuthUnknownError') return new AccessError('TEMPORARILY_UNAVAILABLE');
  if (error.name === 'AuthRetryableFetchError' || status === 0 || status === 408) {
    return new AccessError(status !== undefined && status >= 500 ? 'TEMPORARILY_UNAVAILABLE' : 'NETWORK');
  }
  if (status !== undefined && status >= 500) return new AccessError('TEMPORARILY_UNAVAILABLE');
  return null;
}
