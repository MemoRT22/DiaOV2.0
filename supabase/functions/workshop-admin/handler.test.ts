import assert from 'node:assert/strict';
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

test('only active Coordinación can read or mutate', async () => {
  for (const kind of ['unauthorized', 'forbidden'] as const) {
    const { deps, calls } = fixture(async () => ({ kind }));
    for (const action of ['list', 'get', 'edit', 'approve_publish', 'archive']) {
      const res = await handleRequest(post({ action, submission_id: ID, payload }), deps);
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
