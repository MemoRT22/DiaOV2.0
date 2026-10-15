import { AccessError, parseRetryAfter } from './accessErrors';
import { abortable } from './fetchWithTimeout';
import { functionsUrl, supabase, supabaseAnonKey } from './supabase';

/** One authenticated attempt, including session lookup and body, with no automatic write retries. */
export async function operationRequest<T>(path: string, body: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  try {
    const { data } = await abortable(supabase.auth.getSession(), controller.signal);
    const token = data.session?.access_token;
    if (!token) throw new Error('NOT_AUTHORIZED');
    const base = functionsUrl.replace(/\/functions\/v1$/, '');
    const response = await abortable(fetch(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal,
    }), controller.signal);
    const result = await abortable(response.json(), controller.signal).catch((cause) => {
      if (controller.signal.aborted) throw cause;
      return null;
    });
    const retryAfter = parseRetryAfter(response.headers.get('Retry-After')) ?? parseRetryAfter(result?.retry_after);
    if (response.status === 429) throw new AccessError('RATE_LIMITED', retryAfter);
    // A gateway failure or unreadable success cannot confirm whether a write committed.
    if (response.status >= 500 || response.status === 408 || (response.ok && (!result || typeof result !== 'object'))) {
      // Our own functions answer a definitive failure as `{ error: CODE }` with 500/502 (SERVER_ERROR, INTERNAL_ERROR, AUTH_UNAVAILABLE,
      // AUTH_DELETE_FAILED…) or 503 NO_ACTIVE_EDITION: keep the code, so a permanent fault is not shown as «try again». A 503/504/408 and any
      // gateway answer (no code) stay temporary.
      if (typeof result?.error === 'string' && /^[A-Z][A-Z0-9_]{2,60}$/.test(result.error)
        && (response.status === 500 || response.status === 502 || result.error === 'NO_ACTIVE_EDITION')) throw new Error(result.error);
      throw new AccessError('TEMPORARILY_UNAVAILABLE', retryAfter);
    }
    if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : typeof result?.message === 'string' ? result.message : 'SERVER_ERROR');
    return result as T;
  } catch (cause) {
    if (signal?.aborted) throw new Error('ABORTED');
    if (controller.signal.aborted) throw new AccessError('TIMEOUT');
    if (cause instanceof TypeError) throw new AccessError('NETWORK');
    throw cause;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
