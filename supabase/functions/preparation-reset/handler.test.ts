import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleRequest, type Deps } from './handler.ts';

const actor = '11111111-1111-4111-8111-111111111111';
const edition = '22222222-2222-4222-8222-222222222222';
const student = '33333333-3333-4333-8333-333333333333';
const url = 'https://example.test/functions/v1/preparation-reset';
const post = (body: unknown, token = 'jwt') => new Request(url, {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
});
function fixture(overrides: Partial<Deps> = {}) {
  const calls: string[] = [];
  const deps: Deps = {
    authorize: async () => ({ kind: 'ok', userId: actor, editionId: edition, mode: 'preparacion' }),
    rpc: async (name, args) => {
      calls.push(`${name}:${JSON.stringify(args)}`);
      if (name === 'preparation_reset_preview_internal') return { data: { auth_cleanup_pending: 0, counts: { participants: 2 } }, error: null };
      return { data: { reset_id: 'run-1' }, error: null };
    },
    pending: async () => [{ auth_user_id: student }],
    deleteUser: async () => ({ ok: true }),
    log: () => undefined,
    ...overrides,
  };
  return { deps, calls };
}

test('preflight, missing token and non-Coordinación are rejected', async () => {
  const f = fixture();
  assert.equal((await handleRequest(new Request(url, { method: 'OPTIONS' }), f.deps)).status, 204);
  assert.equal((await handleRequest(new Request(url, { method: 'POST', body: '{}' }), f.deps)).status, 401);
  assert.equal(f.calls.length, 0);
  for (const kind of ['unauthorized', 'forbidden'] as const) {
    const g = fixture({ authorize: async () => ({ kind }) });
    assert.equal((await handleRequest(post({ action: 'preview' }), g.deps)).status, kind === 'forbidden' ? 403 : 401);
    assert.equal(g.calls.length, 0);
  }
});

test('preview is calculated by restricted SQL with the authenticated actor', async () => {
  const f = fixture();
  const response = await handleRequest(post({ action: 'preview', p_actor: student }), f.deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { auth_cleanup_pending: 0, counts: { participants: 2 } });
  assert.ok(f.calls[0].includes(`"p_actor":"${actor}"`));
});

test('reset requires phrase and preparation mode before SQL mutation', async () => {
  const f = fixture();
  assert.equal((await handleRequest(post({ action: 'reset', phrase: 'wrong' }), f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
  const real = fixture({ authorize: async () => ({ kind: 'ok', userId: actor, editionId: edition, mode: 'operacion_real' }) });
  assert.equal((await handleRequest(post({ action: 'reset', phrase: 'REINICIAR PREPARACIÓN' }), real.deps)).status, 409);
  assert.equal(real.calls.length, 0);
});

test('reset commits in SQL then deletes synthetic Auth users and audits result', async () => {
  const f = fixture();
  const response = await handleRequest(post({ action: 'reset', phrase: 'REINICIAR PREPARACIÓN', p_actor: student }), f.deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reset: { reset_id: 'run-1' }, auth_cleanup: { deleted: 1, failed: 0, pending: 0 } });
  assert.match(f.calls[0], /reset_preparation_internal/);
  assert.match(f.calls[0], new RegExp(actor));
  assert.match(f.calls[1], /preparation_auth_cleanup_result_internal/);
  assert.match(f.calls[1], /"p_success":true/);
});

test('Auth outage leaves a reported queue item and retry succeeds without another reset', async () => {
  let fail = true;
  const f = fixture({
    deleteUser: async () => fail ? { ok: false, code: 'AUTH_UNAVAILABLE' } : { ok: true },
    rpc: async (name) => name === 'preparation_reset_preview_internal'
      ? { data: { auth_cleanup_pending: fail ? 1 : 0 }, error: null }
      : { data: { reset_id: 'run-1' }, error: null },
  });
  const first = await handleRequest(post({ action: 'reset', phrase: 'REINICIAR PREPARACIÓN' }), f.deps);
  assert.deepEqual((await first.json() as { auth_cleanup: unknown }).auth_cleanup, { deleted: 0, failed: 1, pending: 1 });
  fail = false;
  const second = await handleRequest(post({ action: 'retry_auth_cleanup' }), f.deps);
  assert.deepEqual((await second.json() as { auth_cleanup: unknown }).auth_cleanup, { deleted: 1, failed: 0, pending: 0 });
});

test('database errors are mapped without exposing SQL details', async () => {
  const f = fixture({ rpc: async () => ({ data: null, error: { message: 'sensitive row content' } }) });
  const response = await handleRequest(post({ action: 'reset', phrase: 'REINICIAR PREPARACIÓN' }), f.deps);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'SERVER_ERROR' });
});

test('a cleanup service outage still reports the already committed reset', async () => {
  const f = fixture({ pending: async () => { throw new Error('temporarily unavailable'); } });
  const response = await handleRequest(post({ action: 'reset', phrase: 'REINICIAR PREPARACIÓN' }), f.deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reset: { reset_id: 'run-1' },
    auth_cleanup: { deleted: 0, failed: 0, pending: null } });
});
