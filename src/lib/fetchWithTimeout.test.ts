import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './fetchWithTimeout';

const hangUntilAborted = vi.fn((_input: unknown, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));

beforeEach(() => {
  vi.useFakeTimers();
  hangUntilAborted.mockClear();
  vi.stubGlobal('fetch', hangUntilAborted);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('a data request that never answers fails instead of leaving the app on «Cargando» forever', async () => {
  const pending = fetchWithTimeout('https://x.supabase.co/rest/v1/editions?select=*');
  const outcome = expect(pending).rejects.toThrow('aborted');
  await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
  await outcome;
});

test('an auth request is covered too', async () => {
  const pending = fetchWithTimeout('https://x.supabase.co/auth/v1/token?grant_type=refresh_token');
  const outcome = expect(pending).rejects.toThrow('aborted');
  await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
  await outcome;
});

test('edge functions and storage (imports, exports, uploads) are left untouched: they can legitimately take longer', async () => {
  void fetchWithTimeout('https://x.supabase.co/functions/v1/import-roster', { method: 'POST' });
  await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 3);
  expect(hangUntilAborted).toHaveBeenCalledTimes(1);
  expect(hangUntilAborted.mock.calls[0][1]).toEqual({ method: 'POST' }); // no signal injected
});

test('a request that answers in time is returned as is', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
  const response = await fetchWithTimeout('https://x.supabase.co/rest/v1/editions');
  expect(response.status).toBe(200);
});

test('a caller that aborts keeps working', async () => {
  const caller = new AbortController();
  const pending = fetchWithTimeout('https://x.supabase.co/rest/v1/editions', { signal: caller.signal });
  const outcome = expect(pending).rejects.toThrow('aborted');
  caller.abort();
  await outcome;
});
