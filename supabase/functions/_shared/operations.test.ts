import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUTH_TIMEOUT_MS, operationalFetch, POSTGREST_TIMEOUT_MS, temporaryOf, TemporaryFailure, unwrap } from './operations.ts';

test('transient infrastructure and PostgreSQL overloads remain distinct from business errors', () => {
  assert.equal(temporaryOf({ status: 429 })?.status, 429);
  for (const status of [0, 408, 502, 503, 504, 521]) assert.equal(temporaryOf({ status })?.status, 503);
  for (const code of ['57014', '55P03', 'PGRST003']) assert.equal(temporaryOf({ code })?.status, 503);
  assert.equal(temporaryOf({ status: 400, code: 'P0001', message: 'NO_RESERVATION' }), null);
  assert.throws(() => unwrap({ data: null, error: { code: 'P0001' }, status: 429 }), { status: 429 });
});

test('deadlines include stalled bodies, distinguish Auth from PostgREST, and do not retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(new ReadableStream({ pull: () => new Promise(() => undefined) })); };
  try {
    for (const [path, deadline] of [['/rest/v1/rpc/test', POSTGREST_TIMEOUT_MS], ['/auth/v1/user', AUTH_TIMEOUT_MS]] as const) {
      const response = await operationalFetch(`https://example.test${path}`);
      const reading = response.text();
      const rejection = assert.rejects(reading, TemporaryFailure);
      t.mock.timers.tick(deadline + 1);
      await rejection;
    }
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
