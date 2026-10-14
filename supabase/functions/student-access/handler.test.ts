import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleRequest, TemporaryError, upstreamTemporary, type Deps, type ParticipantRow } from './handler.ts';

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
  /** Cuenta que Auth encuentra por correo (recuperación de un registro interrumpido) y quién la usa. */
  byEmail?: { id: string; email: string | null; kind: string | null } | null;
  owner?: { id: string } | null;
  createThrows?: unknown;
  getUserThrows?: unknown;
  rpc?: (name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null };
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
    highSchools: async () => [{ id: 'h1', name: 'Otra escuela' }],
    getUser: async () => { if (opts.getUserThrows) throw opts.getUserThrows; return opts.existing ?? null; },
    findUserByEmail: async (email) => { calls.push(`findUserByEmail:${email}`); return opts.byEmail ?? null; },
    participantByAuthUser: async (id) => { calls.push(`participantByAuthUser:${id}`); return opts.owner ?? null; },
    createUser: async (email) => { calls.push(`createUser:${email}`); if (opts.createThrows) throw opts.createThrows; return opts.create ?? { id: UID }; },
    updateUser: async (id, email) => { calls.push(`updateUser:${id}:${email}`); return opts.update ?? { ok: true }; },
    deleteUser: async (id) => { calls.push(`deleteUser:${id}`); },
    log: (event, code) => { logs.push(`${event}:${code ?? ''}`); },
  };
  return { deps, calls, logs };
}

const registerBody = (extra: Record<string, unknown> = {}) => ({
  action: 'register', email: 'Ana@Example.com ', password: SECRET, first_name: 'Ana', last_name: 'López', phone: '9981234567',
  high_school_id: 'h1', high_school_grade: '3', entry_period: '2027-08', initial_career_id: 'c1', consent_accepted: true, ...extra,
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
  assert.deepEqual(await response.json(), { careers: [{ id: 'c1', name: 'Derecho', division: 'Ciencias Jurídicas' }], high_schools: [{ id: 'h1', name: 'Otra escuela' }] });
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
  assert.deepEqual(Object.keys(sent!).sort(), ['consent_accepted', 'email', 'entry_period', 'first_name', 'high_school_id', 'high_school_grade',
    'initial_career_id', 'last_name', 'phone'].sort());
  assert.equal(sent!.email, 'ana@example.com');
  assert.ok(!JSON.stringify(sent).includes(SECRET));
});

test('register maps database validation to user-facing codes and never touches Auth', async () => {
  for (const code of ['EMAIL_EXISTS', 'INVALID_GRADE', 'INVALID_PERIOD', 'INVALID_CAREER', 'INVALID_HIGH_SCHOOL', 'CONSENT_REQUIRED', 'INVALID_PHONE', 'INVALID_NAME']) {
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


// =====================================================================================================================
// Resiliencia ante límites (429) y caídas temporales
// =====================================================================================================================

const retryAfterOf = (response: Response) => Number(response.headers.get('Retry-After'));

test('a temporary limit is answered as 429/503 with Retry-After, never as a data or credential error', async () => {
  for (const [status, error] of [[429, 'RATE_LIMITED'], [503, 'TEMPORARILY_UNAVAILABLE']] as const) {
    const f = fixture({ rpc: () => { throw new TemporaryError(status, 7); } });
    const response = await handleRequest(post({ action: 'identify', email: 'ana@example.com' }), f.deps);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error, retry_after: 7 });
    assert.equal(retryAfterOf(response), 7);
    assert.equal(response.headers.get('Access-Control-Expose-Headers'), 'Retry-After'); // el navegador puede leerlo
  }
});

test('Retry-After carries a random component so hundreds of phones do not come back together', async () => {
  const waits = new Set<number>();
  for (let n = 0; n < 40; n += 1) waits.add(new TemporaryError(429).retryAfter);
  assert.ok(waits.size > 3);
  for (const wait of waits) assert.ok(wait >= 10 && wait < 20);
  for (let n = 0; n < 40; n += 1) { const wait = new TemporaryError(503).retryAfter; assert.ok(wait >= 5 && wait < 15); }
});

test('upstream failures are classified: 429, 5xx, network and timeouts are temporary; validation and credentials are not', () => {
  assert.equal(upstreamTemporary({ status: 429 })?.status, 429);
  assert.equal(upstreamTemporary({ code: 'over_request_rate_limit' })?.status, 429);
  for (const status of [0, 408, 500, 502, 503, 504, 546]) assert.equal(upstreamTemporary({ status })?.status, 503);
  assert.equal(upstreamTemporary({ name: 'AuthRetryableFetchError' })?.status, 503);
  assert.equal(upstreamTemporary({ message: 'fetch failed' })?.status, 503);
  assert.equal(upstreamTemporary({ message: 'request timed out' })?.status, 503);
  for (const info of [{ status: 400 }, { status: 401 }, { status: 404 }, { status: 409 }, { status: 422, code: 'weak_password' }, { message: 'P0001: INVALID_CAREER' }, {}]) {
    assert.equal(upstreamTemporary(info), null);
  }
});

test('a database rate limit or outage on identify is temporary, not SERVER_ERROR', async () => {
  for (const status of [429, 503, 500]) {
    const f = fixture({ rpc: () => ({ data: null, error: { message: 'upstream', status } as { message: string } }) });
    const response = await handleRequest(post({ action: 'identify', email: 'ana@example.com' }), f.deps);
    assert.equal(response.status, status === 429 ? 429 : 503);
    assert.ok(Number(response.headers.get('Retry-After')) > 0);
  }
});

test('setup_password: a 429 creating the Auth account changes nothing and is retryable', async () => {
  const f = fixture({ createThrows: new TemporaryError(429, 9) });
  const response = await handleRequest(post({ action: 'setup_password', email: 'ana@example.com', password: SECRET }), f.deps);
  assert.equal(response.status, 429);
  assert.equal(retryAfterOf(response), 9);
  assert.deepEqual(f.calls, ['createUser:ana@example.com']); // no link, no delete, no discard
  assert.ok(!(await response.text()).includes(SECRET));
  assert.ok(!f.logs.join('|').includes(SECRET));
});

test('an Auth lookup that fails temporarily is never mistaken for «the account does not exist»', async () => {
  const f = fixture({ participant: { id: PID, auth_user_id: UID, password_configured_at: null }, getUserThrows: new TemporaryError(503, 5) });
  const response = await handleRequest(post({ action: 'setup_password', email: 'ana@example.com', password: SECRET }), f.deps);
  assert.equal(response.status, 503);
  assert.deepEqual(f.calls, []); // no createUser: no duplicate identity
});

test('setup_password: the link is lost to a 429 AFTER the account was created → nothing is deleted, and the retry adopts that same account', async () => {
  let linkAttempts = 0;
  const f = fixture({
    rpc: (name) => {
      if (name === 'participant_link_auth_internal') { linkAttempts += 1; if (linkAttempts === 1) throw new TemporaryError(429, 6); }
      return { data: null, error: null };
    },
    create: { id: UID },
  });
  const first = await handleRequest(post({ action: 'setup_password', email: 'ana@example.com', password: SECRET }), f.deps);
  assert.equal(first.status, 429);
  assert.ok(!f.calls.some((call) => call.startsWith('deleteUser'))); // el vínculo pudo haberse guardado: no se borra la cuenta

  // Reintento: Auth ya tiene la cuenta (se creó en el intento anterior).
  const retry = fixture({
    create: { code: 'EMAIL_TAKEN' },
    byEmail: { id: UID, email: 'ana@example.com', kind: 'participant' },
    owner: null,
  });
  const second = await handleRequest(post({ action: 'setup_password', email: 'ana@example.com', password: SECRET }), retry.deps);
  assert.equal(second.status, 200);
  assert.deepEqual(retry.calls, ['createUser:ana@example.com', 'findUserByEmail:ana@example.com', `participantByAuthUser:${UID}`, `updateUser:${UID}:ana@example.com`, 'rpc:participant_link_auth_internal']);
});

test('recovery only adopts an orphan participant account: never Staff, never another participant, never a different email', async () => {
  const cases: [string, Parameters<typeof fixture>[0]][] = [
    ['staff account with that email', { create: { code: 'EMAIL_TAKEN' }, byEmail: { id: UID, email: 'ana@example.com', kind: null } }],
    ['kind unknown', { create: { code: 'EMAIL_TAKEN' }, byEmail: { id: UID, email: 'ana@example.com', kind: 'staff' } }],
    ['used by another participant', { create: { code: 'EMAIL_TAKEN' }, byEmail: { id: UID, email: 'ana@example.com', kind: 'participant' }, owner: { id: '99999999-9999-4999-8999-999999999999' } }],
    ['email does not match', { create: { code: 'EMAIL_TAKEN' }, byEmail: { id: UID, email: 'otra@example.com', kind: 'participant' } }],
    ['no account found', { create: { code: 'EMAIL_TAKEN' }, byEmail: null }],
  ];
  for (const [name, opts] of cases) {
    const f = fixture(opts);
    const response = await handleRequest(post({ action: 'setup_password', email: 'ana@example.com', password: SECRET }), f.deps);
    assert.equal(response.status, 409, name);
    assert.deepEqual(await response.json(), { error: 'EMAIL_EXISTS' }, name);
    assert.ok(!f.calls.some((call) => call.startsWith('updateUser') || call.startsWith('rpc:participant_link')), `${name}: no se tocó la cuenta`);
  }
  // una cuenta de participante que ya es de ESTE participante sí se reutiliza
  const own = fixture({ create: { code: 'EMAIL_TAKEN' }, byEmail: { id: UID, email: 'ana@example.com', kind: 'participant' }, owner: { id: PID } });
  assert.equal((await handleRequest(post({ action: 'setup_password', email: 'ana@example.com', password: SECRET }), own.deps)).status, 200);
});

test('a definitive link failure still rolls back the account created in that same request', async () => {
  const f = fixture({ rpc: (name) => ({ data: null, error: name === 'participant_link_auth_internal' ? { message: 'NOT_FOUND' } : null }) });
  assert.equal((await handleRequest(post({ action: 'setup_password', email: 'ana@example.com', password: SECRET }), f.deps)).status, 500);
  assert.ok(f.calls.includes(`deleteUser:${UID}`));
});

test('register: a limit or outage creating the Auth account keeps the saved registration (no discard) and answers 429/503', async () => {
  for (const status of [429, 503] as const) {
    const f = fixture({ createThrows: new TemporaryError(status, 8) });
    const response = await handleRequest(post(registerBody()), f.deps);
    assert.equal(response.status, status);
    assert.equal(retryAfterOf(response), 8);
    assert.deepEqual(f.calls, ['rpc:register_self_service_internal', 'createUser:ana@example.com']);
    assert.ok(!f.calls.includes('rpc:discard_self_service_registration_internal'));
  }
});

test('register retry after a lost response: it resumes the participant that was already created, with no duplicate and no new registration', async () => {
  const f = fixture({
    rpc: (name) => (name === 'register_self_service_internal' ? { data: null, error: { message: 'P0001: EMAIL_EXISTS' } } : { data: null, error: null }),
    participant: { id: PID, auth_user_id: null, password_configured_at: null, origin: 'self_service' },
    create: { code: 'EMAIL_TAKEN' },
    byEmail: { id: UID, email: 'ana@example.com', kind: 'participant' },
    owner: null,
  });
  const response = await handleRequest(post(registerBody()), f.deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.ok(f.calls.includes(`updateUser:${UID}:ana@example.com`));
  assert.ok(f.calls.includes('rpc:participant_link_auth_internal'));
  assert.ok(!f.calls.includes('rpc:discard_self_service_registration_internal'));
});

test('register resume never applies to a pre-registration or to an account that already has a password', async () => {
  const exists = (participant: ParticipantRow) => fixture({
    rpc: (name) => (name === 'register_self_service_internal' ? { data: null, error: { message: 'EMAIL_EXISTS' } } : { data: null, error: null }),
    participant,
  });
  for (const participant of [
    { id: PID, auth_user_id: null, password_configured_at: null, origin: 'forms' },
    { id: PID, auth_user_id: UID, password_configured_at: '2026-10-14T00:00:00Z', origin: 'self_service' },
  ]) {
    const f = exists(participant);
    const response = await handleRequest(post(registerBody()), f.deps);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'EMAIL_EXISTS' });
    assert.ok(!f.calls.some((call) => call.startsWith('createUser') || call.startsWith('updateUser') || call.startsWith('deleteUser')));
  }
});

test('a definitive failure while resuming never discards a registration this request did not create', async () => {
  const f = fixture({
    rpc: (name) => (name === 'register_self_service_internal' ? { data: null, error: { message: 'EMAIL_EXISTS' } } : { data: null, error: null }),
    participant: { id: PID, auth_user_id: null, password_configured_at: null, origin: 'self_service' },
    create: { code: 'EMAIL_TAKEN' },
    byEmail: { id: UID, email: 'ana@example.com', kind: null }, // Staff: no se toca
  });
  assert.equal((await handleRequest(post(registerBody()), f.deps)).status, 409);
  assert.ok(!f.calls.includes('rpc:discard_self_service_registration_internal'));
  assert.ok(!f.calls.some((call) => call.startsWith('updateUser')));
});

test('database validation errors stay definitive (400) and are never reported as temporary', async () => {
  const f = fixture({ rpc: () => ({ data: null, error: { message: 'P0001: INVALID_CAREER', status: 400 } as { message: string } }) });
  const response = await handleRequest(post(registerBody()), f.deps);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('Retry-After'), null);
});

test('temporary failures are logged by code only', async () => {
  const f = fixture({ createThrows: new TemporaryError(429, 4) });
  await handleRequest(post({ action: 'setup_password', email: 'ana@example.com', password: SECRET }), f.deps);
  assert.deepEqual(f.logs, ['temporary_failure:429']);
});
