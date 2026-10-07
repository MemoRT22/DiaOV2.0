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
    for (const action of ['list', 'get', 'edit', 'approve', 'approve_publish', 'archive']) {
      const res = await handleRequest(post({ action, submission_id: ID, payload }), deps);
      assert.equal(res.status, kind === 'forbidden' ? 403 : 401);
    }
    assert.equal(calls.length, 0);
  }
});

test('human and legacy physical status filters reach SQL', async () => {
  const { deps, calls } = fixture();
  const statuses = ['pending', 'submitted', 'in_review', 'changes_requested', 'approved', 'published', 'archived'];
  for (const status of statuses) {
    assert.equal((await handleRequest(post({ action: 'list', status, page: 2 }), deps)).status, 200);
  }
  assert.deepEqual(calls.map(({ name, args }) => [name, args.p_status]),
    statuses.map((status) => ['workshop_admin_list_internal', status]));
  assert.equal((await handleRequest(post({ action: 'list', status: 'unknown' }), deps)).status, 400);
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

test('legacy review actions keep their transition RPC and notes', async () => {
  const { deps, calls } = fixture();
  for (const action of ['start_review', 'save_notes', 'request_changes', 'resume_review', 'approve', 'archive']) {
    const res = await handleRequest(post({ action, submission_id: ID,
      admin_notes: 'Nota interna', review_feedback: 'Ajustar horario' }), deps);
    assert.equal(res.status, 200);
    assert.equal(calls.at(-1)?.name, 'workshop_review_transition_internal');
    assert.deepEqual(calls.at(-1)?.args, {
      p_actor: ACTOR, p_submission_id: ID, p_action: action,
      p_admin_notes: 'Nota interna', p_review_feedback: 'Ajustar horario',
    });
  }
  assert.equal(calls.length, 6);
});

test('legacy notes and feedback validation stays in place', async () => {
  const { deps, calls } = fixture();
  assert.deepEqual(await body(await handleRequest(post({ action: 'save_notes', submission_id: ID }), deps)), { error: 'NOTES_REQUIRED' });
  assert.deepEqual(await body(await handleRequest(post({ action: 'request_changes', submission_id: ID, review_feedback: '  ' }), deps)), { error: 'FEEDBACK_REQUIRED' });
  assert.equal((await handleRequest(post({ action: 'approve', submission_id: ID, admin_notes: 123 }), deps)).status, 400);
  assert.equal(calls.length, 0);
});

test('new approval and legacy publish both call the publication RPC', async () => {
  const { deps, calls } = fixture();
  const first = await body(await handleRequest(post({ action: 'approve_publish', submission_id: ID }), deps));
  const second = await body(await handleRequest(post({ action: 'publish', submission_id: ID }), deps));
  assert.deepEqual(first, second);
  assert.equal(first.status, 'published');
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.name === 'publish_workshop_submission_internal'));
  assert.deepEqual(calls[0].args, { p_actor: ACTOR, p_submission_id: ID });
});

test('SQL transition errors are mapped without exposing internal details', async () => {
  const { deps } = fixture(undefined, async () => ({ data: null, error: { message: 'INVALID_TRANSITION' } }));
  const res = await handleRequest(post({ action: 'approve_publish', submission_id: ID }), deps);
  assert.equal(res.status, 409);
  assert.deepEqual(await body(res), { error: 'INVALID_TRANSITION' });
});
