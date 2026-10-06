import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleRequest, type Deps, type ParticipantRow } from './handler.ts';

const url = 'https://example.test/functions/v1/student-access';
const post = (body: unknown) => new Request(url, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const PID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';
const SECRET = 'Contraseña-de-prueba-9';

type Fixture = { deps: Deps; calls: string[]; logs: string[] };
function fixture(opts: {
  state?: string;
  participant?: ParticipantRow | null;
  existing?: { id: string; email: string | null; kind: string | null } | null;
  create?: { id?: string; code?: 'EMAIL_TAKEN' | 'AUTH_ERROR' };
  update?: { ok: boolean; code?: 'EMAIL_TAKEN' | 'AUTH_ERROR' };
  rpc?: (name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null };
  legacyParticipant?: { id: string; birth_date: string | null; auth_user_id: string | null; password_configured_at: string | null } | null;
} = {}): Fixture {
  const calls: string[] = [];
  const logs: string[] = [];
  const deps: Deps = {
    rpc: async (name, args) => {
      calls.push(`rpc:${name}`);
      if (opts.rpc) return opts.rpc(name, args);
      if (name === 'participant_access_state_internal') return { data: opts.state ?? 'self_registration', error: null };
      if (name === 'register_self_service_internal') return { data: PID, error: null };
      return { data: null, error: null };
    },
    participantByEmail: async () => opts.participant === undefined ? { id: PID, auth_user_id: null, password_configured_at: null } : opts.participant,
    careers: async () => [{ id: 'c1', name: 'Derecho', division: 'Ciencias Jurídicas' }],
    getUser: async () => opts.existing ?? null,
    createUser: async (email) => { calls.push(`createUser:${email}`); return opts.create ?? { id: UID }; },
    updateUser: async (id, email) => { calls.push(`updateUser:${id}:${email}`); return opts.update ?? { ok: true }; },
    deleteUser: async (id) => { calls.push(`deleteUser:${id}`); },
    legacy: {
      sha256: async (t) => `h(${t})`,
      isLocked: async () => false,
      activeEditionId: async () => 'ed',
      participant: async () => opts.legacyParticipant ?? null,
      recordAttempt: async (_h, ok) => { calls.push(`attempt:${ok}`); },
      ensureIdentity: async () => { calls.push('legacy:ensure'); },
      magicLink: async () => ({ hashedToken: 't', userId: UID }),
      linkParticipant: async () => { calls.push('legacy:link'); },
      verify: async () => ({ access_token: 'a', refresh_token: 'r' }),
    },
    log: (event, code) => { logs.push(`${event}:${code ?? ''}`); },
  };
  return { deps, calls, logs };
}

const registerBody = (extra: Record<string, unknown> = {}) => ({
  action: 'register', email: 'Ana@Example.com ', password: SECRET, first_name: 'Ana', last_name: 'López', phone: '9981234567',
  high_school: 'Colegio', high_school_grade: '3', entry_period: '2027-08', initial_career_id: 'c1', consent_accepted: true, ...extra,
});

test('only POST and preflight are accepted, and malformed bodies are rejected', async () => {
  const f = fixture();
  assert.equal((await handleRequest(new Request(url, { method: 'OPTIONS' }), f.deps)).status, 204);
  assert.equal((await handleRequest(new Request(url, { method: 'GET' }), f.deps)).status, 405);
  assert.equal((await handleRequest(new Request(url, { method: 'POST', body: 'no-json' }), f.deps)).status, 400);
  assert.equal((await handleRequest(post([1, 2]), f.deps)).status, 400);
  assert.equal((await handleRequest(post({ action: 'otra' }), f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
});

test('identify returns only the access state, never personal data', async () => {
  for (const state of ['password_login', 'password_setup', 'self_registration']) {
    const f = fixture({ state });
    const response = await handleRequest(post({ action: 'identify', email: '  Ana@Example.com ' }), f.deps);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { state });
  }
  const f = fixture();
  await handleRequest(post({ action: 'identify', email: ' ANA@Example.com' }), f.deps);
  assert.deepEqual(f.calls, ['rpc:participant_access_state_internal']);
  for (const email of ['', 'sin-arroba', 'a'.repeat(250) + '@x.co', 42, undefined]) {
    const bad = await handleRequest(post({ action: 'identify', email }), f.deps);
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: 'INVALID_EMAIL' });
  }
});

test('catalog exposes only id, name and division of active official careers', async () => {
  const f = fixture();
  const response = await handleRequest(post({ action: 'catalog' }), f.deps);
  assert.deepEqual(await response.json(), { careers: [{ id: 'c1', name: 'Derecho', division: 'Ciencias Jurídicas' }] });
});

test('setup_password creates a real-email identity, links it and never returns tokens or the password', async () => {
  const f = fixture({ state: 'password_setup' });
  const response = await handleRequest(post({ action: 'setup_password', email: 'Ana@Example.com', password: SECRET }), f.deps);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { ok: true });
  assert.ok(!text.includes(SECRET));
  assert.deepEqual(f.calls, ['createUser:ana@example.com', 'rpc:participant_link_auth_internal']);
  assert.deepEqual(f.logs, []);
});

test('setup_password migrates a synthetic identity to the real email and keeps the same Auth user', async () => {
  const f = fixture({
    participant: { id: PID, auth_user_id: UID, password_configured_at: null },
    existing: { id: UID, email: `p.${PID}@participantes.diaov.invalid`, kind: 'participant' },
  });
  const response = await handleRequest(post({ action: 'setup_password', email: 'ana@example.com', password: SECRET }), f.deps);
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls, [`updateUser:${UID}:ana@example.com`, 'rpc:participant_link_auth_internal']);
});

test('setup_password never rewrites an identity that is not a participant (Staff)', async () => {
  const f = fixture({
    participant: { id: PID, auth_user_id: UID, password_configured_at: null },
    existing: { id: UID, email: 'coordinacion@anahuac.mx', kind: null },
  });
  const response = await handleRequest(post({ action: 'setup_password', email: 'ana@example.com', password: SECRET }), f.deps);
  assert.equal(response.status, 500);
  assert.deepEqual(f.calls, []);
});

test('setup_password refuses configured accounts, unknown emails and weak or oversized passwords', async () => {
  const configured = fixture({ participant: { id: PID, auth_user_id: UID, password_configured_at: '2026-10-06T00:00:00Z' } });
  const taken = await handleRequest(post({ action: 'setup_password', email: 'ana@example.com', password: SECRET }), configured.deps);
  assert.equal(taken.status, 409);
  assert.deepEqual(await taken.json(), { error: 'ACCESS_ALREADY_CONFIGURED' });
  assert.deepEqual(configured.calls, []);

  const unknown = fixture({ participant: null });
  assert.equal((await handleRequest(post({ action: 'setup_password', email: 'x@example.com', password: SECRET }), unknown.deps)).status, 404);

  const f = fixture();
  for (const password of ['corta', '1234567', 'a'.repeat(73), 'ñ'.repeat(40), '', null, 123456789]) {
    const response = await handleRequest(post({ action: 'setup_password', email: 'ana@example.com', password }), f.deps);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'INVALID_PASSWORD' });
  }
  assert.deepEqual(f.calls, []);
  const ok = fixture();
  assert.equal((await handleRequest(post({ action: 'setup_password', email: 'ana@example.com', password: 'a'.repeat(72) }), ok.deps)).status, 200);
});

test('setup_password reports an email already used in Auth and rolls back the new identity when linking fails', async () => {
  const collision = fixture({ create: { code: 'EMAIL_TAKEN' } });
  const response = await handleRequest(post({ action: 'setup_password', email: 'ana@example.com', password: SECRET }), collision.deps);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'EMAIL_EXISTS' });

  const broken = fixture({ rpc: (name) => ({ data: null, error: name === 'participant_link_auth_internal' ? { message: 'boom' } : null }) });
  const failed = await handleRequest(post({ action: 'setup_password', email: 'ana@example.com', password: SECRET }), broken.deps);
  assert.equal(failed.status, 500);
  assert.ok(broken.calls.includes(`deleteUser:${UID}`));
});

test('register creates participant, then Auth identity, then links; the response carries no tokens or secrets', async () => {
  const f = fixture();
  const response = await handleRequest(post(registerBody()), f.deps);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { ok: true });
  assert.ok(!text.includes(SECRET));
  assert.deepEqual(f.calls, ['rpc:register_self_service_internal', 'createUser:ana@example.com', 'rpc:participant_link_auth_internal']);
});

test('register sends the exact form fields to SQL and never the password', async () => {
  let sent: Record<string, unknown> | null = null;
  const f = fixture({
    rpc: (name, args) => {
      if (name === 'register_self_service_internal') sent = args.p as Record<string, unknown>;
      return { data: name === 'register_self_service_internal' ? PID : null, error: null };
    },
  });
  await handleRequest(post(registerBody({ birth_date: '2008-01-01', extra: 'x' })), f.deps);
  assert.deepEqual(Object.keys(sent!).sort(), ['consent_accepted', 'email', 'entry_period', 'first_name', 'high_school', 'high_school_grade',
    'initial_career_id', 'last_name', 'phone'].sort());
  assert.equal(sent!.email, 'ana@example.com');
  assert.ok(!JSON.stringify(sent).includes(SECRET));
});

test('register maps database validation to user-facing codes and never touches Auth', async () => {
  for (const code of ['EMAIL_EXISTS', 'INVALID_GRADE', 'INVALID_PERIOD', 'INVALID_CAREER', 'CONSENT_REQUIRED', 'INVALID_PHONE', 'INVALID_NAME']) {
    const f = fixture({ rpc: () => ({ data: null, error: { message: `P0001: ${code}` } }) });
    const response = await handleRequest(post(registerBody()), f.deps);
    assert.equal(response.status, code === 'EMAIL_EXISTS' ? 409 : 400);
    assert.deepEqual(await response.json(), { error: code });
    assert.deepEqual(f.calls, ['rpc:register_self_service_internal']);
  }
  const unknown = fixture({ rpc: () => ({ data: null, error: { message: 'connection reset' } }) });
  const response = await handleRequest(post(registerBody()), unknown.deps);
  assert.deepEqual(await response.json(), { error: 'SERVER_ERROR' });
  const weak = fixture();
  assert.equal((await handleRequest(post(registerBody({ password: 'corta' })), weak.deps)).status, 400);
  assert.deepEqual(weak.calls, []);
  // el consentimiento solo cuenta si es el booleano `true`; cualquier otro valor llega a SQL como `false`
  let consent: unknown;
  const noConsent = fixture({ rpc: (name, args) => {
    if (name === 'register_self_service_internal') consent = (args.p as Record<string, unknown>).consent_accepted;
    return { data: null, error: { message: 'CONSENT_REQUIRED' } };
  } });
  await handleRequest(post(registerBody({ consent_accepted: 'true' })), noConsent.deps);
  assert.equal(consent, false);
});

test('register discards the half-created participant when Auth creation or linking fails', async () => {
  const authDown = fixture({ create: { code: 'AUTH_ERROR' } });
  const response = await handleRequest(post(registerBody()), authDown.deps);
  assert.equal(response.status, 500);
  assert.ok(authDown.calls.includes('rpc:discard_self_service_registration_internal'));

  const collision = fixture({ create: { code: 'EMAIL_TAKEN' } });
  const taken = await handleRequest(post(registerBody()), collision.deps);
  assert.equal(taken.status, 409);
  assert.ok(collision.calls.includes('rpc:discard_self_service_registration_internal'));

  const linkFails = fixture({ rpc: (name) => ({ data: name === 'register_self_service_internal' ? PID : null, error: name === 'participant_link_auth_internal' ? { message: 'x' } : null }) });
  assert.equal((await handleRequest(post(registerBody()), linkFails.deps)).status, 500);
  assert.ok(linkFails.calls.includes(`deleteUser:${UID}`));
  assert.ok(linkFails.calls.includes('rpc:discard_self_service_registration_internal'));
});

test('logs never contain the password or the email', async () => {
  const f = fixture({ create: { code: 'AUTH_ERROR' } });
  await handleRequest(post(registerBody()), f.deps);
  const all = f.logs.join('|');
  assert.ok(!all.includes(SECRET) && !all.includes('ana@example.com'));
});

test('legacy frontend (email + birth date) still works for participants without a password', async () => {
  const f = fixture({ legacyParticipant: { id: PID, birth_date: '2008-01-01', auth_user_id: null, password_configured_at: null } });
  const response = await handleRequest(post({ email: 'ana@example.com', birth_date: '2008-01-01' }), f.deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { access_token: 'a', refresh_token: 'r' });
  assert.deepEqual(f.calls, ['legacy:ensure', 'legacy:link', 'attempt:true']);
});

test('legacy path refuses participants with a configured password and wrong dates', async () => {
  const configured = fixture({ legacyParticipant: { id: PID, birth_date: '2008-01-01', auth_user_id: UID, password_configured_at: '2026-10-06T00:00:00Z' } });
  const response = await handleRequest(post({ email: 'ana@example.com', birth_date: '2008-01-01' }), configured.deps);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'INVALID_CREDENTIALS' });
  const wrong = fixture({ legacyParticipant: { id: PID, birth_date: '2008-01-01', auth_user_id: null, password_configured_at: null } });
  assert.equal((await handleRequest(post({ email: 'ana@example.com', birth_date: '2008-01-02' }), wrong.deps)).status, 401);
  assert.equal((await handleRequest(post({ email: 'ana@example.com', birth_date: 'ayer' }), wrong.deps)).status, 400);
});

test('identify aligns the Auth email when Staff corrected the participant email', async () => {
  const f = fixture({
    state: 'password_login',
    participant: { id: PID, auth_user_id: UID, password_configured_at: '2026-10-06T00:00:00Z' },
    existing: { id: UID, email: 'correo.anterior@example.com', kind: 'participant' },
  });
  const response = await handleRequest(post({ action: 'identify', email: 'ana@example.com' }), f.deps);
  assert.deepEqual(await response.json(), { state: 'password_login' });
  assert.ok(f.calls.includes(`updateUser:${UID}:ana@example.com`));

  const staff = fixture({
    state: 'password_login',
    participant: { id: PID, auth_user_id: UID, password_configured_at: '2026-10-06T00:00:00Z' },
    existing: { id: UID, email: 'staff@anahuac.mx', kind: null },
  });
  await handleRequest(post({ action: 'identify', email: 'ana@example.com' }), staff.deps);
  assert.ok(!staff.calls.some((call) => call.startsWith('updateUser')));
});

test('birth date is ignored by the new actions', async () => {
  const f = fixture({ state: 'password_login' });
  const response = await handleRequest(post({ action: 'identify', email: 'ana@example.com', birth_date: '2008-01-01' }), f.deps);
  assert.deepEqual(await response.json(), { state: 'password_login' });
});
