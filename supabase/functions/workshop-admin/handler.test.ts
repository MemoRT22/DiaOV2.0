import assert from 'node:assert/strict';
import { TemporaryFailure } from '../_shared/operations.ts';
import { test } from 'node:test';
import { handleRequest, type Deps } from './handler.ts';

const URL_ = 'https://example.test/functions/v1/workshop-admin';
const ID = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const post = (body: unknown, token = 'jwt') => new Request(URL_, {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const body = async (res: Response) => res.json() as Promise<Record<string, unknown>>;
function fixture(auth: Deps['authorize'] = async () => ({ kind: 'ok', userId: ACTOR }), reply?: Deps['rpc']) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const deps: Deps = { authorize: auth, rpc: async (name, args) => {
    calls.push({ name, args });
    return reply ? reply(name, args) : { data: name === 'publish_workshop_submission_internal'
      ? { submission_id: ID, status: 'published', activity_id: 'activity-1', session_count: 4 }
      : { id: ID, status: 'submitted' }, error: null };
  } };
  return { deps, calls };
}
const payload = {
  facilitator_name: 'Ana Rodríguez', facilitator_email: 'ana@example.com', activity_type: 'academica',
  experience_category: null, title: 'Taller de medicina', student_pitch: 'Una experiencia médica para conocer la profesión.',
  objective: 'Conocer el trabajo médico en un hospital.', takeaway: 'Conocer la medicina y sus retos.',
  keywords: ['medicina', 'salud', 'alumnos'], session_duration_minutes: 30, capacity_per_session: 20,
  building: 'Edificio A', room_space: 'Salón 1', requirements: null, notes: null,
  career_ids: ['33333333-3333-4333-8333-333333333333'],
};

test('temporary authorization and database errors preserve infrastructure status and never replay a write', async () => {
  for (const status of [429, 503] as const) {
    const unauthorized = fixture(async () => { throw new TemporaryFailure(status, 12); });
    const denied = await handleRequest(post({ action: 'list' }), unauthorized.deps);
    assert.equal(denied.status, status);
    assert.equal(unauthorized.calls.length, 0);
    const f = fixture(undefined, async () => { throw new TemporaryFailure(status, 12); });
    const response = await handleRequest(post({ action: 'approve_publish', submission_id: ID }), f.deps);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Retry-After'), '12');
    assert.equal(f.calls.length, 1);
  }
});

test('only active Coordinación can read or mutate', async () => {
  for (const kind of ['unauthorized', 'forbidden'] as const) {
    const { deps, calls } = fixture(async () => ({ kind }));
    for (const action of ['list', 'get', 'create', 'edit', 'approve_publish', 'archive', 'delete', 'list_legacy', 'delete_legacy']) {
      const res = await handleRequest(post({ action, submission_id: ID, activity_id: ID, payload }), deps);
      assert.equal(res.status, kind === 'forbidden' ? 403 : 401);
    }
    assert.equal(calls.length, 0);
  }
});

test('current human status filters reach SQL; old physical filters are rejected', async () => {
  const { deps, calls } = fixture();
  const statuses = ['pending', 'published', 'archived'];
  for (const status of statuses) {
    assert.equal((await handleRequest(post({ action: 'list', status, page: 2 }), deps)).status, 200);
  }
  assert.deepEqual(calls.map(({ name, args }) => [name, args.p_status]),
    statuses.map((status) => ['workshop_admin_list_internal', status]));
  for (const status of ['submitted', 'in_review', 'changes_requested', 'approved', 'unknown']) {
    assert.equal((await handleRequest(post({ action: 'list', status }), deps)).status, 400);
  }
  assert.equal(calls.length, statuses.length);
});

test('edit validates the Forms payload and sends careers atomically', async () => {
  const { deps, calls } = fixture();
  const res = await handleRequest(post({ action: 'edit', submission_id: ID, payload }), deps);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'workshop_admin_edit_internal');
  assert.equal(calls[0].args.p_actor, ACTOR);
  assert.deepEqual((calls[0].args.p_payload as typeof payload).career_ids, payload.career_ids);
  const invalid = await handleRequest(post({ action: 'edit', submission_id: ID, payload: { ...payload, status: 'published' } }), deps);
  assert.equal(invalid.status, 422);
  assert.equal(calls.length, 1);
});

test('edit uses the same RPC for published workshops and permits 15 only for Vida Universitaria', async () => {
  const { deps, calls } = fixture(undefined, async () => ({ data: { id: ID, status: 'published' }, error: null }));
  const life = { ...payload, activity_type: 'vida_universitaria', experience_category: 'otra',
    career_ids: [], session_duration_minutes: 15 };
  assert.equal((await handleRequest(post({ action: 'edit', submission_id: ID, payload: life }), deps)).status, 200);
  assert.equal(calls[0].name, 'workshop_admin_edit_internal');
  assert.equal((calls[0].args.p_payload as typeof life).session_duration_minutes, 15);
  assert.equal((await handleRequest(post({ action: 'edit', submission_id: ID,
    payload: { ...payload, session_duration_minutes: 15 } }), deps)).status, 422);
  assert.equal(calls.length, 1);
});

test('published edit domain errors are returned without exposing SQL details', async () => {
  for (const code of ['SESSION_SCHEDULE_LOCKED', 'CAPACITY_BELOW_RESERVED']) {
    const { deps } = fixture(undefined, async () => ({ data: null, error: { message: code } }));
    const res = await handleRequest(post({ action: 'edit', submission_id: ID, payload }), deps);
    assert.equal(res.status, 409);
    assert.deepEqual(await body(res), { error: code });
  }
});

test('discard alone keeps the transition RPC with the current archive action', async () => {
  const { deps, calls } = fixture();
  const res = await handleRequest(post({ action: 'archive', submission_id: ID }), deps);
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [{ name: 'workshop_review_transition_internal', args: {
    p_actor: ACTOR, p_submission_id: ID, p_action: 'archive',
    p_admin_notes: null, p_review_feedback: null,
  } }]);
});

test('retired review and separate publish actions cannot reach SQL', async () => {
  const { deps, calls } = fixture();
  for (const action of ['start_review', 'save_notes', 'request_changes', 'resume_review', 'approve', 'publish']) {
    assert.deepEqual(await body(await handleRequest(post({ action, submission_id: ID }), deps)), { error: 'INVALID_ACTION' });
  }
  assert.equal((await handleRequest(post({ action: 'archive', submission_id: ID, admin_notes: 'old' }), deps)).status, 400);
  assert.equal(calls.length, 0);
});

test('approval calls the atomic publication RPC', async () => {
  const { deps, calls } = fixture();
  const result = await body(await handleRequest(post({ action: 'approve_publish', submission_id: ID }), deps));
  assert.equal(result.status, 'published');
  assert.equal(calls.length, 1);
  assert.ok(calls.every((call) => call.name === 'publish_workshop_submission_internal'));
  assert.deepEqual(calls[0].args, { p_actor: ACTOR, p_submission_id: ID });
});

test('SQL transition errors are mapped without exposing internal details', async () => {
  const { deps } = fixture(undefined, async () => ({ data: null, error: { message: 'INVALID_TRANSITION' } }));
  const res = await handleRequest(post({ action: 'approve_publish', submission_id: ID }), deps);
  assert.equal(res.status, 409);
  assert.deepEqual(await body(res), { error: 'INVALID_TRANSITION' });
});

test('create validates like the public form and can publish in the same operation', async () => {
  const { deps, calls } = fixture(undefined, async () => ({ data: { submission_id: ID, status: 'published', activity_id: 'activity-1' }, error: null }));
  const created = await handleRequest(post({ action: 'create', payload, publish: true }), deps);
  assert.equal(created.status, 201);
  assert.deepEqual(await body(created), { submission: { submission_id: ID, status: 'published', activity_id: 'activity-1' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'workshop_admin_create_internal');
  assert.equal(calls[0].args.p_actor, ACTOR);
  assert.equal(calls[0].args.p_publish, true);
  assert.deepEqual((calls[0].args.p_payload as { career_ids: string[] }).career_ids, payload.career_ids);

  // without `publish` it is saved as pending; the flag must be a boolean
  await handleRequest(post({ action: 'create', payload }), deps);
  assert.equal(calls[1].args.p_publish, false);
  assert.equal((await handleRequest(post({ action: 'create', payload, publish: 'yes' }), deps)).status, 400);
  // an invalid payload never reaches SQL
  const invalid = await handleRequest(post({ action: 'create', payload: { ...payload, title: '' } }), deps);
  assert.equal(invalid.status, 422);
  assert.equal((await body(invalid)).error, 'VALIDATION_FAILED');
  assert.equal(calls.length, 2);
});

test('create reports database rejections without leaking internals', async () => {
  for (const [message, status] of [['INVALID_CAREER', 422], ['NOT_AUTHORIZED', 403], ['NO_ACTIVE_EDITION', 503], ['boom', 500]] as const) {
    const { deps } = fixture(undefined, async () => ({ data: null, error: { message } }));
    const res = await handleRequest(post({ action: 'create', payload }), deps);
    assert.equal(res.status, status);
    assert.equal((await body(res)).error, status === 500 ? 'INTERNAL_ERROR' : message);
  }
});

test('delete removes a workshop in any state through one SQL operation and reports what went with it', async () => {
  const removed = { sessions: 2, reservations: 3, attendances: 1, participants: 3 };
  const { deps, calls } = fixture(undefined, async () => ({ data: { submission_id: ID, deleted: true, removed }, error: null }));
  const res = await handleRequest(post({ action: 'delete', submission_id: ID }), deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await body(res), { submission_id: ID, deleted: true, removed });
  assert.deepEqual(calls, [{ name: 'workshop_admin_delete_internal', args: { p_actor: ACTOR, p_submission_id: ID } }]);
});

test('delete needs a valid id and maps a missing workshop to 404', async () => {
  const { deps, calls } = fixture(undefined, async () => ({ data: null, error: { message: 'NOT_FOUND' } }));
  assert.equal((await handleRequest(post({ action: 'delete' }), deps)).status, 400);
  assert.equal((await handleRequest(post({ action: 'delete', submission_id: 'nope' }), deps)).status, 400);
  assert.equal(calls.length, 0);
  const res = await handleRequest(post({ action: 'delete', submission_id: ID }), deps);
  assert.equal(res.status, 404);
  assert.equal((await body(res)).error, 'NOT_FOUND');
});

test('legacy workshops without a file are listed on their own', async () => {
  const items = [{ activity_id: ID, title: 'Taller Académico A', activity_type: 'academica', is_demo: true }];
  const { deps, calls } = fixture(undefined, async () => ({ data: items, error: null }));
  const res = await handleRequest(post({ action: 'list_legacy' }), deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await body(res), { items });
  assert.deepEqual(calls, [{ name: 'workshop_admin_legacy_list_internal', args: {} }]);
  // an unexpected answer never breaks the screen
  const odd = fixture(undefined, async () => ({ data: null, error: null }));
  assert.deepEqual(await body(await handleRequest(post({ action: 'list_legacy' }), odd.deps)), { items: [] });
});

test('a legacy workshop is deleted by its activity, one at a time', async () => {
  const removed = { sessions: 1, reservations: 2, attendances: 1, participants: 2 };
  const { deps, calls } = fixture(undefined, async () => ({ data: { activity_id: ID, deleted: true, removed }, error: null }));
  const res = await handleRequest(post({ action: 'delete_legacy', activity_id: ID }), deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await body(res), { activity_id: ID, deleted: true, removed });
  assert.deepEqual(calls, [{ name: 'workshop_admin_activity_delete_internal', args: { p_actor: ACTOR, p_activity_id: ID } }]);

  // needs a valid activity id (a submission id in the wrong field is not accepted) and maps a missing one to 404
  const guarded = fixture(undefined, async () => ({ data: null, error: { message: 'NOT_FOUND' } }));
  assert.equal((await handleRequest(post({ action: 'delete_legacy' }), guarded.deps)).status, 400);
  assert.equal((await handleRequest(post({ action: 'delete_legacy', submission_id: ID }), guarded.deps)).status, 400);
  assert.equal((await handleRequest(post({ action: 'delete_legacy', activity_id: 'nope' }), guarded.deps)).status, 400);
  assert.equal(guarded.calls.length, 0);
  assert.equal((await handleRequest(post({ action: 'delete_legacy', activity_id: ID }), guarded.deps)).status, 404);
});
