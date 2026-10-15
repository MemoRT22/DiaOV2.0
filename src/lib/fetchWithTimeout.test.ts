import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fetchWithTimeout, REQUEST_TIMEOUT_MS, SIGN_IN_TIMEOUT_MS } from './fetchWithTimeout';

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

test('signing in with a password fails at 15 s, not 45: a saturated Auth must not leave the student on a spinner for minutes', async () => {
  expect(SIGN_IN_TIMEOUT_MS).toBeLessThan(REQUEST_TIMEOUT_MS);
  const pending = fetchWithTimeout('https://x.supabase.co/auth/v1/token?grant_type=password', { method: 'POST' });
  const outcome = expect(pending).rejects.toThrow('aborted');
  await vi.advanceTimersByTimeAsync(SIGN_IN_TIMEOUT_MS - 1);
  expect(hangUntilAborted.mock.calls[0][1]?.signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(2);
  await outcome;
});

test('other auth calls (session refresh) keep the longer limit', async () => {
  void fetchWithTimeout('https://x.supabase.co/auth/v1/user');
  await vi.advanceTimersByTimeAsync(SIGN_IN_TIMEOUT_MS + 1);
  expect(hangUntilAborted.mock.calls[0][1]?.signal?.aborted).toBe(false);
});

// Cabeceras a tiempo y cuerpo detenido (el stream nunca entrega datos ni respeta la cancelación): el plazo debe cubrirlo.
const stalledStream = () => new ReadableStream<Uint8Array>({ pull: () => new Promise(() => undefined) });
const headersThenStall = (status = 200) => vi.fn(async () => new Response(stalledStream(), { status, headers: { 'content-type': 'application/json' } }));

test('headers arrive but the body stalls: reading it fails at the limit instead of hanging forever', async () => {
  vi.stubGlobal('fetch', headersThenStall());
  const response = await fetchWithTimeout('https://x.supabase.co/rest/v1/editions');
  expect(response.status).toBe(200); // las cabeceras llegaron
  let outcome: unknown = 'pending';
  void response.json().then(() => { outcome = 'resolved'; }, (cause) => { outcome = cause; });
  await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
  expect(outcome).toBe('pending');
  await vi.advanceTimersByTimeAsync(2);
  expect(outcome).toBeInstanceOf(DOMException);
  expect((outcome as DOMException).name).toBe('AbortError');
});

test('the password sign-in limit (15 s) also covers a stalled body', async () => {
  vi.stubGlobal('fetch', headersThenStall());
  const response = await fetchWithTimeout('https://x.supabase.co/auth/v1/token?grant_type=password', { method: 'POST' });
  let outcome: unknown = 'pending';
  void response.text().then(() => { outcome = 'resolved'; }, (cause) => { outcome = cause; });
  await vi.advanceTimersByTimeAsync(SIGN_IN_TIMEOUT_MS + 1);
  expect(outcome).toBeInstanceOf(DOMException);
});

test('an external abort while the body is stalled is respected and releases the timer', async () => {
  vi.stubGlobal('fetch', headersThenStall());
  const caller = new AbortController();
  const response = await fetchWithTimeout('https://x.supabase.co/rest/v1/editions', { signal: caller.signal });
  const reading = expect(response.json()).rejects.toThrow('aborted');
  caller.abort();
  await reading;
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
});

test('a body that arrives in time is returned intact (streamed) and the timer is released', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 1 }]), { status: 200, headers: { 'content-type': 'application/json' } })));
  const response = await fetchWithTimeout('https://x.supabase.co/rest/v1/editions');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/json');
  expect(await response.json()).toEqual([{ id: 1 }]);
  expect(vi.getTimerCount()).toBe(0);
});

test('responses without a body (204) release the timer immediately', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
  const response = await fetchWithTimeout('https://x.supabase.co/auth/v1/logout', { method: 'POST' });
  expect(response.status).toBe(204);
  expect(vi.getTimerCount()).toBe(0);
});

test('a failed request (no response at all) releases the timer and rethrows', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
  await expect(fetchWithTimeout('https://x.supabase.co/rest/v1/editions')).rejects.toThrow('Failed to fetch');
  expect(vi.getTimerCount()).toBe(0);
});

test('error statuses keep their status and body readable', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"limit"}', { status: 429, statusText: 'Too Many', headers: { 'retry-after': '7' } })));
  const response = await fetchWithTimeout('https://x.supabase.co/auth/v1/token?grant_type=password', { method: 'POST' });
  expect([response.status, response.statusText, response.ok, response.headers.get('retry-after')]).toEqual([429, 'Too Many', false, '7']);
  expect(await response.json()).toEqual({ message: 'limit' });
});
