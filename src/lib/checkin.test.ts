import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { checkIn, CHECKIN_TIMEOUT_MS } from './checkin';
import { REQUEST_TIMEOUT_MS } from './fetchWithTimeout';
import { AccessError } from './accessErrors';

vi.mock('./supabase', () => ({ functionsUrl: 'https://example.test/functions/v1', supabaseAnonKey: 'public',
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'jwt' } } })) } } }));

const result = { already_registered: false, title: 'Misión', stamps: 2, credits_granted: 2, attended_workshops: 1, level: 1,
  session_id: 's', activity_id: 'a', starts_at: '2026-10-15T15:00:00Z', ends_at: '2026-10-15T16:00:00Z', method: 'qr' };
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test.each(['opaque-QR-fixture', 'ABCDEF'])('one authenticated check_in request accepts QR or manual code (%s)', async (credential) => {
  const fetcher = vi.fn(async () => Response.json(result));
  vi.stubGlobal('fetch', fetcher);
  expect(await checkIn(credential)).toEqual(result);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://example.test/rest/v1/rpc/check_in');
  expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt' });
  expect(JSON.parse(init.body as string)).toEqual({ p_credential: credential });
});

test.each([429, 502, 503, 504, 521])('infrastructure %i retains temporary classification and Retry-After even with HTML', async (status) => {
  const fetcher = vi.fn(async () => new Response('<html>gateway</html>', { status, headers: { 'Retry-After': '17' } }));
  vi.stubGlobal('fetch', fetcher);
  await expect(checkIn('opaque-QR-fixture')).rejects.toMatchObject({ code: status === 429 ? 'RATE_LIMITED' : 'TEMPORARILY_UNAVAILABLE', retryAfterSeconds: 17 });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetcher).toHaveBeenCalledTimes(1); // never automatically retries this write
});

test('the 12 s deadline includes a stalled response body and is specific to check-in', async () => {
  expect(CHECKIN_TIMEOUT_MS).toBeLessThan(REQUEST_TIMEOUT_MS);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ pull: () => new Promise(() => undefined) }))));
  const outcome = expect(checkIn('opaque-QR-fixture')).rejects.toMatchObject({ code: 'TIMEOUT' });
  await vi.advanceTimersByTimeAsync(CHECKIN_TIMEOUT_MS + 1);
  await outcome;
});

test('an unanswered request is bounded even if the transport does not reject on abort', async () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
  const outcome = expect(checkIn('opaque-QR-fixture')).rejects.toMatchObject({ code: 'TIMEOUT' });
  await vi.advanceTimersByTimeAsync(CHECKIN_TIMEOUT_MS + 1);
  await outcome;
});

test('business rejection remains definitive', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'P0001', message: 'NO_RESERVATION' }, { status: 400 })));
  try { await checkIn('ABCDEF'); throw new Error('expected rejection'); }
  catch (cause) { expect(cause).not.toBeInstanceOf(AccessError); expect((cause as Error).message).toBe('NO_RESERVATION'); }
});

test('response lost AFTER commit: a deliberate second attempt recovers the existing result and grants once', async () => {
  let stored = false;
  let stampsGranted = 0;
  const fetcher = vi.fn(async () => {
    if (!stored) { stored = true; stampsGranted += 2; throw new TypeError('connection lost'); }
    return Response.json({ ...result, already_registered: true, stamps: stampsGranted });
  });
  vi.stubGlobal('fetch', fetcher);
  await expect(checkIn('opaque-QR-fixture')).rejects.toMatchObject({ code: 'NETWORK' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await checkIn('opaque-QR-fixture')).toMatchObject({ already_registered: true, stamps: 2 });
  expect(stampsGranted).toBe(2);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('leaving aborts the pending attempt; an unreadable success is uncertain', async () => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
  const outcome = expect(checkIn('ABCDEF', controller.signal)).rejects.toThrow('ABORTED');
  controller.abort();
  await outcome;
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  await expect(checkIn('ABCDEF')).rejects.toMatchObject({ code: 'TEMPORARILY_UNAVAILABLE' });
});
