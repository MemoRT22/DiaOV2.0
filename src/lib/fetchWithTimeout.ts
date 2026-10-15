/** A data/auth request that never answers (weak mobile network) would leave the app on «Cargando» forever: fail it so screens can react. */
export const REQUEST_TIMEOUT_MS = 45_000;
/**
 * Entrar con contraseña: Auth responde en menos de 2 s y su puerta de enlace corta a ~11 s cuando está saturado. Esperar 45 s (y
 * repetirlo) dejaba a la persona minutos mirando un spinner; a los 15 s se le avisa y puede reintentar con lo escrito conservado.
 */
export const SIGN_IN_TIMEOUT_MS = 15_000;

/** Rechaza en cuanto `signal` se cancela, aunque la promesa original (p. ej. leer un cuerpo detenido) no lo haga por sí sola. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * El plazo cubre la operación HTTP COMPLETA: las cabeceras Y la lectura del cuerpo. Una respuesta que entrega cabeceras y luego deja el
 * cuerpo detenido (red móvil débil, puerta de enlace saturada) también se corta, en lugar de dejar `response.json()` esperando para siempre.
 * El cuerpo se entrega en streaming; el temporizador se libera al terminar de leerlo, al fallar o al cancelarlo.
 */
export async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  // Only the quick PostgREST/Auth calls: uploads and edge functions (imports, exports) legitimately take longer.
  if (!/\/(rest|auth)\/v1\//.test(target)) return fetch(input, init);

  const controller = new AbortController();
  const limit = /\/auth\/v1\/token\?(?:[^#]*&)?grant_type=password\b/.test(target) ? SIGN_IN_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), limit);
  const outer = init?.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', () => controller.abort(), { once: true });
  }
  let response: Response;
  try {
    response = await fetch(input, { ...init, signal: controller.signal });
  } catch (cause) {
    clearTimeout(timer);
    throw cause;
  }
  if (!response.body) {
    clearTimeout(timer);
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(stream) {
      try {
        const chunk = await abortable(reader.read(), controller.signal);
        if (chunk.done) { clearTimeout(timer); stream.close(); } else stream.enqueue(chunk.value);
      } catch (cause) {
        clearTimeout(timer);
        reader.cancel().catch(() => undefined);
        stream.error(cause);
      }
    },
    cancel(reason) {
      clearTimeout(timer);
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
