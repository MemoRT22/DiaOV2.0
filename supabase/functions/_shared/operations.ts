/** Server-only transport policy for the low-volume administrative functions. No automatic retries. */
export const POSTGREST_TIMEOUT_MS = 8_000;
export const AUTH_TIMEOUT_MS = 15_000;

export class TemporaryFailure extends Error {
  readonly status: 429 | 503;
  readonly retryAfter: number;
  constructor(status: 429 | 503 = 503, retryAfter = status === 429 ? 10 : 5) {
    super(status === 429 ? 'RATE_LIMITED' : 'TEMPORARILY_UNAVAILABLE');
    this.name = 'TemporaryFailure';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function temporaryOf(cause: unknown): TemporaryFailure | null {
  if (cause instanceof TemporaryFailure) return cause;
  if (!cause || typeof cause !== 'object') return null;
  const { status, code, name, message } = cause as { status?: number; code?: string; name?: string; message?: string };
  if (status === 429 || code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') return new TemporaryFailure(429);
  if (status === 0 || status === 408 || (status !== undefined && status >= 500)
    || ['57014', '55P03', '53300', '57P01', 'PGRST003'].includes(code ?? '')
    || ['AbortError', 'TimeoutError', 'AuthRetryableFetchError', 'AuthUnknownError'].includes(name ?? '')
    || /fetch failed|failed to fetch|network|timed? ?out|econn|socket|connection reset/i.test(message ?? '')) return new TemporaryFailure();
  return null;
}

export function unwrap<T>(result: { data: T; error: unknown; status?: number }): T {
  if (result.error) throw temporaryOf({ ...(result.error as object), status: result.status }) ?? result.error;
  return result.data;
}

export function temporaryResponse(error: TemporaryFailure): Response {
  return new Response(JSON.stringify({ error: error.message, retry_after: error.retryAfter }), {
    status: error.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Retry-After', 'Retry-After': String(error.retryAfter) },
  });
}

function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new TemporaryFailure());
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

/** The deadline covers headers AND body; an outer abort is preserved. SDK results still retain their HTTP status. */
export const operationalFetch: typeof fetch = async (input, init) => {
  const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const outer = init?.signal;
  if (outer?.aborted) cancel();
  else outer?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, target.includes('/auth/v1/') ? AUTH_TIMEOUT_MS : POSTGREST_TIMEOUT_MS);
  const done = () => { clearTimeout(timer); outer?.removeEventListener('abort', cancel); };
  try {
    const response = await abortable(fetch(input, { ...init, signal: controller.signal }), controller.signal);
    if (!response.body) { done(); return response; }
    const reader = response.body.getReader();
    const stream = new ReadableStream<Uint8Array>({
      async pull(out) {
        try {
          const chunk = await abortable(reader.read(), controller.signal);
          if (chunk.done) { done(); out.close(); } else out.enqueue(chunk.value);
        } catch (cause) { done(); void reader.cancel().catch(() => undefined); out.error(cause); }
      },
      cancel(reason) { done(); return reader.cancel(reason); },
    });
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (cause) { done(); throw cause; }
};
