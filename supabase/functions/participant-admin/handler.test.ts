import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatePassword, handleRequest, type AuthResult, type Deps, type ParticipantRow, type AuthUserInfo } from './handler.ts';

const url = 'https://example.test/functions/v1/participant-admin';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const PID = '22222222-2222-4222-8222-222222222222';
const UID = '33333333-3333-4333-8333-333333333333';
const post = (body: unknown, token = 'jwt') => new Request(url, {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

function fixture(opts: {
  caller?: AuthResult;
  participant?: ParticipantRow | null;
  existing?: AuthUserInfo | null;
  audit?: { message: string } | null;
  create?: { id?: string; code?: 'EMAIL_TAKEN' | 'AUTH_ERROR' };
  update?: { ok: boolean; code?: 'EMAIL_TAKEN' | 'AUTH_ERROR' };
  link?: { message: string } | null;
} = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const passwords: string[] = [];
  const deps: Deps = {
    authorize: async () => opts.caller ?? { kind: 'ok', userId: ACTOR },
    participant: async () => opts.participant === undefined ? { id: PID, email: 'ana@example.com', auth_user_id: null } : opts.participant,
    rpc: async (name, args) => {
      calls.push(`rpc:${name}:${JSON.stringify(args)}`);
      if (name === 'participant_password_audit_internal') return { data: null, error: opts.audit ?? null };
      return { data: null, error: opts.link ?? null };
    },
    getUser: async () => opts.existing ?? null,
    createUser: async (email, password) => { passwords.push(password); calls.push(`create:${email}`); return opts.create ?? { id: UID }; },
    updateUser: async (id, email, password) => { passwords.push(password); calls.push(`update:${id}:${email}`); return opts.update ?? { ok: true }; },
    deleteUser: async (id) => { calls.push(`delete:${id}`); },
    randomBytes: (length) => Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256),
    log: (event, code) => { logs.push(`${event}:${code ?? ''}`); },
  };
  return { deps, calls, logs, passwords };
}

test('preflight, missing token and unauthorized roles are rejected before any work', async () => {
  const f = fixture();
  assert.equal((await handleRequest(new Request(url, { method: 'OPTIONS' }), f.deps)).status, 204);
  assert.equal((await handleRequest(new Request(url, { method: 'GET' }), f.deps)).status, 405);
  assert.equal((await handleRequest(new Request(url, { method: 'POST', body: '{}' }), f.deps)).status, 401);
  for (const kind of ['unauthorized', 'forbidden'] as const) {
    const g = fixture({ caller: { kind } });
    const response = await handleRequest(post({ action: 'reset_password', participant_id: PID }), g.deps);
    assert.equal(response.status, kind === 'forbidden' ? 403 : 401);
    assert.deepEqual(g.calls, []);
  }
});

test('validates action, participant id and manual password', async () => {
  const f = fixture();
  assert.equal((await handleRequest(post({ action: 'otra' }), f.deps)).status, 400);
  assert.equal((await handleRequest(post({ action: 'reset_password', participant_id: 'no-uuid' }), f.deps)).status, 400);
  for (const password of ['corta', 'a'.repeat(73), 12345678]) {
    const response = await handleRequest(post({ action: 'reset_password', participant_id: PID, password }), f.deps);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'INVALID_PASSWORD' });
  }
  assert.deepEqual(f.calls, []);
  const missing = fixture({ participant: null });
  assert.equal((await handleRequest(post({ action: 'reset_password', participant_id: PID }), missing.deps)).status, 404);
  assert.deepEqual(missing.calls, []);
});

test('generates a password server-side, applies it, audits only actor and participant, and returns it once', async () => {
  const f = fixture({ participant: { id: PID, email: 'ana@example.com', auth_user_id: UID },
    existing: { id: UID, email: 'ana@example.com', kind: 'participant' } });
  const response = await handleRequest(post({ action: 'reset_password', participant_id: PID }), f.deps);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.generated, true);
  assert.match(body.password, /^[A-HJ-NP-Za-km-np-z2-9]{10}$/);
  assert.equal(f.passwords[0], body.password);
  const audit = f.calls.find((c) => c.startsWith('rpc:participant_password_audit_internal'))!;
  assert.deepEqual(JSON.parse(audit.split(':').slice(2).join(':')), { p_actor: ACTOR, p_participant: PID });
  assert.ok(!audit.includes(body.password));
  assert.deepEqual(f.logs, []);
  assert.ok(f.calls.indexOf(audit) < f.calls.findIndex((c) => c.startsWith('update:')));
});

test('a manual password is applied but never echoed back or sent anywhere else', async () => {
  const f = fixture();
  const response = await handleRequest(post({ action: 'reset_password', participant_id: PID, password: 'Definida-por-Staff-1' }), f.deps);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { ok: true, generated: false });
  assert.ok(!text.includes('Definida-por-Staff-1'));
  assert.deepEqual(f.passwords, ['Definida-por-Staff-1']);
  assert.ok(f.calls.filter((c) => c.startsWith('rpc:')).every((c) => !c.includes('Definida-por-Staff-1')));
  assert.ok(f.logs.every((entry) => !entry.includes('Definida')));
});

test('reset also configures the account of a participant that has none, and keeps the real email', async () => {
  const f = fixture();
  const response = await handleRequest(post({ action: 'reset_password', participant_id: PID }), f.deps);
  assert.equal(response.status, 200);
  assert.ok(f.calls.includes('create:ana@example.com'));
  assert.ok(f.calls.some((c) => c.startsWith('rpc:participant_link_auth_internal')));
});

test('recognises synthetic legacy identities and migrates them to the real email', async () => {
  const f = fixture({ participant: { id: PID, email: 'ana@example.com', auth_user_id: UID },
    existing: { id: UID, email: `p.${PID}@participantes.diaov.invalid`, kind: null } });
  assert.equal((await handleRequest(post({ action: 'reset_password', participant_id: PID }), f.deps)).status, 200);
  assert.ok(f.calls.includes(`update:${UID}:ana@example.com`));
});

test('never rewrites the password of a non-participant identity (Staff)', async () => {
  const f = fixture({ participant: { id: PID, email: 'ana@example.com', auth_user_id: UID },
    existing: { id: UID, email: 'coordinacion@anahuac.mx', kind: null } });
  const response = await handleRequest(post({ action: 'reset_password', participant_id: PID }), f.deps);
  assert.equal(response.status, 500);
  assert.ok(!f.calls.some((c) => c.startsWith('update:') || c.startsWith('create:')));
});

test('fails closed when the audit cannot be written, and reports collisions and Auth failures', async () => {
  const noAudit = fixture({ audit: { message: 'NOT_AUTHORIZED' } });
  assert.equal((await handleRequest(post({ action: 'reset_password', participant_id: PID }), noAudit.deps)).status, 500);
  assert.ok(!noAudit.calls.some((c) => c.startsWith('create:') || c.startsWith('update:')));

  const taken = fixture({ create: { code: 'EMAIL_TAKEN' } });
  const collision = await handleRequest(post({ action: 'reset_password', participant_id: PID }), taken.deps);
  assert.equal(collision.status, 409);
  assert.deepEqual(await collision.json(), { error: 'EMAIL_EXISTS' });

  const broken = fixture({ link: { message: 'boom' } });
  assert.equal((await handleRequest(post({ action: 'reset_password', participant_id: PID }), broken.deps)).status, 500);
  assert.ok(broken.calls.includes(`delete:${UID}`));
});

test('generated passwords come from the unambiguous alphabet and have no modulo bias on the cut-off bytes', () => {
  // los bytes por encima del corte (255) se descartan en lugar de plegarse sobre los primeros caracteres
  const all = generatePassword((length) => Uint8Array.from({ length }, (_, i) => (i % 2 ? 255 : i * 3)));
  assert.equal(all.length, 10);
  assert.match(all, /^[A-HJ-NP-Za-km-np-z2-9]{10}$/);
  const seen = new Set<string>();
  for (let n = 0; n < 200; n++) seen.add(generatePassword((length) => crypto.getRandomValues(new Uint8Array(length))));
  assert.equal(seen.size, 200);
});

// ------------------------------------------------------------------------------------------- delete (Coordinación)

function deleteFixture(opts: {
  caller?: AuthResult;
  plan?: { data?: unknown; error?: { message: string } | null };
  identity?: AuthUserInfo | null;
  authDeleteFails?: boolean;
  removal?: { data?: unknown; error?: { message: string; code?: string } | null };
} = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const deps: Deps = {
    authorize: async () => opts.caller ?? { kind: 'ok', userId: ACTOR, coordinator: true },
    participant: async () => { calls.push('participant'); return null; },
    rpc: async (name, args) => {
      calls.push(`rpc:${name}:${JSON.stringify(args)}`);
      if (name === 'participant_delete_plan_internal') {
        return { data: opts.plan?.data ?? { participant_id: PID, auth_user_id: UID, linked_non_participant_account: false }, error: opts.plan?.error ?? null };
      }
      return { data: opts.removal?.data ?? { participant_id: PID, deleted: true, removed: { reservations: 2, attendances: 1 } }, error: opts.removal?.error ?? null };
    },
    getUser: async (id) => { calls.push(`get:${id}`); return opts.identity === undefined ? { id: UID, email: 'ana@example.com', kind: 'participant' } : opts.identity; },
    createUser: async () => { calls.push('create'); return {}; },
    updateUser: async () => { calls.push('update'); return { ok: true }; },
    deleteUser: async (id) => { calls.push(`delete:${id}`); if (opts.authDeleteFails) throw new Error('AUTH_ERROR'); },
    randomBytes: (length) => new Uint8Array(length),
    log: (event, code) => { logs.push(`${event}:${code ?? ''}`); },
  };
  return { deps, calls, logs };
}
const args = JSON.stringify({ p_actor: ACTOR, p_participant: PID });

test('delete: only Coordinación; Staff keeps password resets but cannot delete', async () => {
  for (const caller of [{ kind: 'ok', userId: ACTOR } as AuthResult, { kind: 'ok', userId: ACTOR, coordinator: false } as AuthResult]) {
    const f = deleteFixture({ caller });
    const res = await handleRequest(post({ action: 'delete', participant_id: PID }), f.deps);
    assert.equal(res.status, 403);
    assert.deepEqual(f.calls, []);
  }
  for (const kind of ['unauthorized', 'forbidden'] as const) {
    const f = deleteFixture({ caller: { kind } });
    assert.equal((await handleRequest(post({ action: 'delete', participant_id: PID }), f.deps)).status, kind === 'forbidden' ? 403 : 401);
    assert.deepEqual(f.calls, []);
  }
  const f = deleteFixture();
  assert.equal((await handleRequest(post({ action: 'delete', participant_id: 'nope' }), f.deps)).status, 400);
  assert.deepEqual(f.calls, []);
});

test('delete: removes the participant identity from Auth first, then the participant with everything of theirs', async () => {
  const f = deleteFixture();
  const res = await handleRequest(post({ action: 'delete', participant_id: PID }), f.deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, account: 'deleted', removed: { reservations: 2, attendances: 1 } });
  assert.deepEqual(f.calls, [
    `rpc:participant_delete_plan_internal:${args}`, `get:${UID}`, `delete:${UID}`, `rpc:participant_delete_internal:${args}`,
  ]);
});

test('delete: a participant without an account is removed without touching Auth', async () => {
  const f = deleteFixture({ plan: { data: { participant_id: PID, auth_user_id: null, linked_non_participant_account: false } } });
  const res = await handleRequest(post({ action: 'delete', participant_id: PID }), f.deps);
  assert.equal((await res.json()).account, 'none');
  assert.deepEqual(f.calls, [`rpc:participant_delete_plan_internal:${args}`, `rpc:participant_delete_internal:${args}`]);
});

test('delete: a Staff or Coordinación account linked by mistake is never deleted', async () => {
  // The database already refuses to hand over the identity…
  const byPlan = deleteFixture({ plan: { data: { participant_id: PID, auth_user_id: null, linked_non_participant_account: true } } });
  const first = await handleRequest(post({ action: 'delete', participant_id: PID }), byPlan.deps);
  assert.equal((await first.json()).account, 'kept_not_participant');
  assert.ok(!byPlan.calls.some((c) => c.startsWith('delete:')));
  assert.ok(byPlan.calls.includes(`rpc:participant_delete_internal:${args}`));

  // …and even if it did, Auth's own record is checked before deleting anything.
  for (const identity of [{ id: UID, email: 'staff@anahuac.mx', kind: 'staff' }, { id: UID, email: 'coord@anahuac.mx', kind: null }]) {
    const byAuth = deleteFixture({ identity });
    const res = await handleRequest(post({ action: 'delete', participant_id: PID }), byAuth.deps);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).account, 'kept_not_participant');
    assert.ok(!byAuth.calls.some((c) => c.startsWith('delete:')));
    assert.deepEqual(byAuth.logs, ['identity_not_participant:']);
  }
});

test('delete: the synthetic participant e-mail also identifies a participant identity', async () => {
  const f = deleteFixture({ identity: { id: UID, email: `p.${PID}@participantes.diaov.invalid`, kind: null } });
  const res = await handleRequest(post({ action: 'delete', participant_id: PID }), f.deps);
  assert.equal((await res.json()).account, 'deleted');
  assert.ok(f.calls.includes(`delete:${UID}`));
});

test('delete: if Auth cannot remove the identity nothing is deleted and the operation can be retried', async () => {
  const f = deleteFixture({ authDeleteFails: true });
  const res = await handleRequest(post({ action: 'delete', participant_id: PID }), f.deps);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'AUTH_DELETE_FAILED');
  assert.ok(!f.calls.some((c) => c.startsWith('rpc:participant_delete_internal')));
});

test('delete: an identity already gone from Auth does not block the removal', async () => {
  const f = deleteFixture({ identity: null });
  const res = await handleRequest(post({ action: 'delete', participant_id: PID }), f.deps);
  assert.equal(res.status, 200);
  assert.ok(!f.calls.some((c) => c.startsWith('delete:')));
  assert.ok(f.calls.includes(`rpc:participant_delete_internal:${args}`));
});

test('delete: database answers are mapped without leaking details', async () => {
  for (const [message, status, code] of [['NOT_FOUND', 404, 'NOT_FOUND'], ['NOT_AUTHORIZED', 403, 'NOT_AUTHORIZED'], ['boom relation x', 500, 'SERVER_ERROR']] as const) {
    const onPlan = deleteFixture({ plan: { error: { message } } });
    const planRes = await handleRequest(post({ action: 'delete', participant_id: PID }), onPlan.deps);
    assert.equal(planRes.status, status);
    assert.deepEqual(await planRes.json(), { error: code });
    assert.ok(!onPlan.calls.some((c) => c.startsWith('delete:') || c.startsWith('get:')));

    const onRemoval = deleteFixture({ removal: { error: { message } } });
    const removalRes = await handleRequest(post({ action: 'delete', participant_id: PID }), onRemoval.deps);
    assert.equal(removalRes.status, status);
    assert.deepEqual(await removalRes.json(), { error: code });
  }
});
