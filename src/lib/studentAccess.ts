import { AccessError, parseRetryAfter } from './accessErrors';
import { abortable } from './fetchWithTimeout';
import { retryTransient } from './retry';
import { functionsUrl, supabaseAnonKey } from './supabase';

/** Lo único que la pantalla pública llega a saber de un correo: qué paso sigue. Nunca datos personales. */
export type AccessState = 'password_login' | 'password_setup' | 'self_registration';
export type CatalogHighSchool = { id: string; name: string };
export type AccessCatalog = { careers: CatalogCareer[]; high_schools: CatalogHighSchool[] };
export type CatalogCareer = { id: string; name: string; division: string | null };

export type SelfRegistration = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone: string;
  high_school_id: string;
  high_school_grade: string;
  entry_period: string;
  initial_career_id: string;
  consent_accepted: boolean;
};

/**
 * La Edge Function responde en menos de 2 s en operación normal. Las lecturas (identificar, catálogo) esperan poco: el servidor
 * ya responde un 503 con «vuelve a intentar» a los 9 s, así que pasados 12 s algo no responde y la persona debe verlo, no seguir
 * mirando un spinner. Crear una cuenta puede tardar más (cifrado de la contraseña) y su resultado queda incierto si se agota.
 */
export const ACCESS_READ_TIMEOUT_MS = 12_000;
export const ACCESS_TIMEOUT_MS = 25_000;
type CallOptions = { signal?: AbortSignal };
/** Estados de negocio que el servidor emite con 5xx y que NO son una falla de infraestructura. */
const DEFINITIVE_5XX = ['NO_ACTIVE_EDITION'];

async function call<T>(body: Record<string, unknown>, options: CallOptions = {}, timeoutMs: number = ACCESS_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  let response: Response;
  let result: { error?: unknown; retry_after?: unknown } | null;
  try {
    response = await fetch(`${functionsUrl}/student-access`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supabaseAnonKey}`, apikey: supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    // El plazo cubre también la lectura del cuerpo: cabeceras a tiempo con el cuerpo detenido no deja un spinner indefinido.
    result = await abortable(response.json(), controller.signal).catch((cause) => {
      if (controller.signal.aborted) throw cause;
      return null; // cuerpo ilegible (no JSON): se trata como respuesta sin datos
    });
  } catch (cause) {
    // Abandonó la pantalla: no es un error. Si fue nuestro propio plazo, el resultado es incierto.
    if (options.signal?.aborted) throw new Error('ABORTED');
    throw new Error(controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError') ? 'TIMEOUT' : 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
  const retryAfter = () => parseRetryAfter(response.headers?.get?.('Retry-After')) ?? parseRetryAfter(result?.retry_after as string | number | undefined);
  if (!response.ok || !result || typeof result !== 'object') {
    const code = typeof result?.error === 'string' ? result.error : null;
    // El estado HTTP manda: un 429/5xx nunca se convierte en un error de datos ni de contraseña, tenga o no cuerpo.
    if (response.status === 429 || code === 'RATE_LIMITED') throw new AccessError('RATE_LIMITED', retryAfter());
    // Con 4xx el código es de negocio (validación, correo ya registrado, recuperación…) y es definitivo. Con 5xx, 408 o una respuesta
    // ilegible solo es definitivo el estado de negocio que el servidor emite con 5xx (sin edición activa); todo lo demás —
    // `SERVER_ERROR`, un código desconocido, sin cuerpo— es infraestructura y el resultado de la operación es INCIERTO: no se afirma
    // nada de los datos de la persona, se conservan y ella decide reintentar.
    const definitive = code !== null && (response.status < 500 && response.status !== 408 ? response.ok === false : DEFINITIVE_5XX.includes(code));
    if (code === 'TEMPORARILY_UNAVAILABLE' || (!definitive && (response.status >= 500 || response.status === 408 || response.ok))) {
      throw new AccessError('TEMPORARILY_UNAVAILABLE', retryAfter());
    }
    throw new Error(code ?? 'SERVER_ERROR');
  }
  return result as T;
}

export const studentAccess = {
  /** Solo lectura: un único reintento automático y solo ante un tropiezo rápido; si el servicio está saturado se avisa, no se insiste. */
  async identify(email: string, options: CallOptions = {}): Promise<AccessState> {
    const { state } = await retryTransient(() => call<{ state: AccessState }>({ action: 'identify', email: email.trim().toLowerCase() }, options, ACCESS_READ_TIMEOUT_MS), { signal: options.signal });
    if (state !== 'password_login' && state !== 'password_setup' && state !== 'self_registration') throw new AccessError('TEMPORARILY_UNAVAILABLE'); // respuesta ilegible: no es un dato de la persona
    return state;
  },
  async catalog(options: CallOptions = {}): Promise<AccessCatalog> {
    const result = await retryTransient(() => call<AccessCatalog>({ action: 'catalog' }, options, ACCESS_READ_TIMEOUT_MS), { signal: options.signal });
    return { careers: Array.isArray(result.careers) ? result.careers : [], high_schools: Array.isArray(result.high_schools) ? result.high_schools : [] };
  },
  /**
   * Prerregistro sin contraseña: la crea en Supabase Auth. Después el navegador inicia sesión con ella.
   * UN solo envío: no se repite sola (el resultado puede ser incierto); la persona reintenta y el servidor recupera la cuenta a medias.
   */
  async setupPassword(email: string, password: string, options: CallOptions = {}): Promise<void> {
    await call({ action: 'setup_password', email: email.trim().toLowerCase(), password }, options);
  },
  /** Autorregistro: crea participante, perfil, interés inicial, consentimiento y cuenta en una sola operación del servidor. */
  async register(data: SelfRegistration, options: CallOptions = {}): Promise<void> {
    await call({ action: 'register', ...data, email: data.email.trim().toLowerCase() }, options);
  },
};
