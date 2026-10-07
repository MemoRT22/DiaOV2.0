/** A data/auth request that never answers (weak mobile network) would leave the app on «Cargando» forever: fail it so screens can react. */
export const REQUEST_TIMEOUT_MS = 45_000;

export function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  // Only the quick PostgREST/Auth calls: uploads and edge functions (imports, exports) legitimately take longer.
  if (!/\/(rest|auth)\/v1\//.test(target)) return fetch(input, init);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const outer = init?.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}
