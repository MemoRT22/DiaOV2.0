import { afterEach, expect, test, vi } from 'vitest';
import { operationRequest } from './operationRequest';
import { resetParticipantPassword } from './participantAdminApi';

vi.mock('./supabase', () => ({ functionsUrl: 'https://example.test/functions/v1', supabaseAnonKey: 'public',
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } } }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test.each([429, 503, 504, 521])('admin clients preserve temporary status (%i) with a controlled retry delay', async (status) => {
  const fetcher = vi.fn(async () => Response.json({ error: 'SERVER_ERROR' }, { status, headers: { 'Retry-After': '23' } }));
  vi.stubGlobal('fetch', fetcher);
  await expect(resetParticipantPassword('fixture-pid', 'Fixture-only-password')).rejects.toMatchObject({ code: status === 429 ? 'RATE_LIMITED' : 'TEMPORARILY_UNAVAILABLE', retryAfterSeconds: 23 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test('admin deadline covers a stalled body; no follow-up request is sent on expiry', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => new Response(new ReadableStream({ pull: () => new Promise(() => undefined) })));
  vi.stubGlobal('fetch', fetcher);
  const outcome = expect(operationRequest('/functions/v1/participant-admin', {}, 1000)).rejects.toMatchObject({ code: 'TIMEOUT' });
  await vi.advanceTimersByTimeAsync(1001);
  await outcome;
  expect(fetcher).toHaveBeenCalledTimes(1);
});
