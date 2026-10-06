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
  const deps: Deps = {
    authorize: auth,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return reply ? reply(name, args) : { data: name === 'workshop_admin_get_internal' ? { id: ID } : { items: [], counts: {}, total: 0 }, error: null };
    },
  };
  return { deps, calls };
}

test('preflight works; missing JWT is rejected before database work', async () => {
  const { deps, calls } = fixture();
  assert.equal((await handleRequest(new Request(URL_, { method: 'OPTIONS' }), deps)).status, 204);
  const res = await handleRequest(new Request(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), deps);
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test('non-Staff and Staff without Coordinación are rejected', async () => {
  for (const kind of ['unauthorized', 'forbidden'] as const) {
    const { deps, calls } = fixture(async () => ({ kind }));
    const res = await handleRequest(post({ action: 'list' }), deps);
    assert.equal(res.status, kind === 'forbidden' ? 403 : 401);
    assert.equal(calls.length, 0);
  }
});

test('Coordinación can list with search, filters and page; invalid filters stop before SQL', async () => {
  const { deps, calls } = fixture();
  const res = await handleRequest(post({ action: 'list', status: 'submitted', type: 'academica', search: '  Ana@  ', page: 2 }), deps);
  assert.equal(res.status, 200);
  assert.deepEqual(calls[0], { name: 'workshop_admin_list_internal', args: {
    p_status: 'submitted', p_type: 'academica', p_search: 'Ana@', p_page: 2,
  } });
  for (const invalid of [{ status: 'draft' }, { type: 'other' }, { page: 0 }, { search: 'x'.repeat(121) }]) {
    const response = await handleRequest(post({ action: 'list', ...invalid }), deps);
    assert.equal(response.status, 400);
  }
  assert.equal(calls.length, 1);
});

test('get returns a proposal or 404', async () => {
  const { deps, calls } = fixture();
  assert.equal((await handleRequest(post({ action: 'get', submission_id: ID }), deps)).status, 200);
  assert.equal(calls[0].name, 'workshop_admin_get_internal');
  const missing = fixture(undefined, async () => ({ data: null, error: null }));
  const res = await handleRequest(post({ action: 'get', submission_id: ID }), missing.deps);
  assert.equal(res.status, 404);
  assert.deepEqual(await body(res), { error: 'NOT_FOUND' });
});

test('review actions call only the atomic SQL primitive and use authenticated actor', async () => {
  const { deps, calls } = fixture();
  for (const [action, extra] of [
    ['start_review', {}], ['save_notes', { admin_notes: 'Nota interna' }],
    ['request_changes', { review_feedback: 'Especifica materiales' }],
    ['resume_review', {}], ['archive', { admin_notes: 'Conservar historial' }],
    ['approve', {}], ['publish', {}]
  ] as const) {
    assert.equal((await handleRequest(post({ action, submission_id: ID, ...extra, p_actor: 'untrusted' }), deps)).status, 200);
  }
  assert.equal(calls.length, 7);
  assert.ok(calls.every((c) => (c.name === 'workshop_review_transition_internal' || c.name === 'publish_workshop_submission_internal') && c.args.p_actor === ACTOR));
  assert.deepEqual(calls.filter(c => c.name === 'workshop_review_transition_internal').map((c) => c.args.p_action), ['start_review', 'save_notes', 'request_changes', 'resume_review', 'archive', 'approve']);
  assert.ok(calls.some(c => c.name === 'publish_workshop_submission_internal'));
});

test('empty feedback, missing notes and malformed id are rejected', async () => {
  const { deps, calls } = fixture();
  for (const [request, expected] of [
    [{ action: 'request_changes', submission_id: ID, review_feedback: '   ' }, 'FEEDBACK_REQUIRED'],
    [{ action: 'save_notes', submission_id: ID }, 'NOTES_REQUIRED'],
    [{ action: 'archive', submission_id: 'bad' }, 'INVALID_INPUT'],
  ] as const) {
    const res = await handleRequest(post(request), deps);
    assert.equal(res.status, expected === 'INVALID_INPUT' ? 400 : 422);
    assert.deepEqual(await body(res), { error: expected });
  }
  assert.equal(calls.length, 0);
});

test('invalid transition is a conflict, and SQL errors do not reveal details', async () => {
  let { deps } = fixture(undefined, async () => ({ data: null, error: { message: 'INVALID_TRANSITION' } }));
  const conflict = await handleRequest(post({ action: 'start_review', submission_id: ID }), deps);
  assert.equal(conflict.status, 409);
  assert.deepEqual(await body(conflict), { error: 'INVALID_TRANSITION' });
  ({ deps } = fixture(undefined, async () => ({ data: null, error: { message: 'PUBLISH_STATE_INCONSISTENT' } })));
  const inconsistent = await handleRequest(post({ action: 'publish', submission_id: ID }), deps);
  assert.equal(inconsistent.status, 409);
  assert.deepEqual(await body(inconsistent), { error: 'PUBLISH_STATE_INCONSISTENT' });

  ({ deps } = fixture(undefined, async () => ({ data: null, error: { message: 'sensitive row contents' } })));
  const failed = await handleRequest(post({ action: 'list' }), deps);
  assert.equal(failed.status, 500);
  assert.deepEqual(await body(failed), { error: 'INTERNAL_ERROR' });
});
