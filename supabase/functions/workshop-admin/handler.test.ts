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
    for (const action of ['list', 'get', 'edit', 'approve', 'archive']) {
      const res = await handleRequest(post({ action, submission_id: ID, payload }), deps);
      assert.equal(res.status, kind === 'forbidden' ? 403 : 401);
    }
    assert.equal(calls.length, 0);
  }
});

test('human status filter reaches SQL; legacy physical filter is rejected', async () => {
  const { deps, calls } = fixture();
  assert.equal((await handleRequest(post({ action: 'list', status: 'pending', page: 2 }), deps)).status, 200);
  assert.equal(calls[0].name, 'workshop_admin_list_internal');
  assert.equal(calls[0].args.p_status, 'pending');
  assert.equal((await handleRequest(post({ action: 'list', status: 'in_review' }), deps)).status, 400);
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

test('approve is one RPC that returns a published activity; archive never calls publication', async () => {
  const { deps, calls } = fixture();
  const approved = await handleRequest(post({ action: 'approve', submission_id: ID }), deps);
  assert.equal(approved.status, 200);
  assert.equal((await body(approved)).status, 'published');
  assert.deepEqual(calls[0], { name: 'publish_workshop_submission_internal', args: { p_actor: ACTOR, p_submission_id: ID } });
  await handleRequest(post({ action: 'archive', submission_id: ID }), deps);
  assert.equal(calls[1].name, 'workshop_review_transition_internal');
  assert.equal(calls[1].args.p_action, 'archive');
  assert.equal(calls.length, 2);
});

test('duplicate approval retry uses the same idempotent SQL primitive', async () => {
  const { deps, calls } = fixture();
  const first = await body(await handleRequest(post({ action: 'approve', submission_id: ID }), deps));
  const second = await body(await handleRequest(post({ action: 'approve', submission_id: ID }), deps));
  assert.deepEqual(first, second);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.name === 'publish_workshop_submission_internal'));
});

test('SQL transition errors are mapped without exposing internal details', async () => {
  const { deps } = fixture(undefined, async () => ({ data: null, error: { message: 'INVALID_TRANSITION' } }));
  const res = await handleRequest(post({ action: 'approve', submission_id: ID }), deps);
  assert.equal(res.status, 409);
  assert.deepEqual(await body(res), { error: 'INVALID_TRANSITION' });
});
