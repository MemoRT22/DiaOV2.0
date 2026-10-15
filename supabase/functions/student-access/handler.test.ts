import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { CATALOG_STALE_MAX_MS, CATALOG_TTL_MS, handleRequest, READ_DEADLINE_MS, TemporaryError, WRITE_DEADLINE_MS, unwrapQuery, upstreamTemporary, type Deps, type ParticipantRow } from './handler.ts';

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
  /** Resultado de la prueba de posesión (¿la contraseña recibida abre la cuenta existente?). Por omisión, no. */
  verify?: 'valid' | 'invalid';
  verifyThrows?: unknown;
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
    updateUser: async (id, email, password) => { calls.push(`updateUser:${id}:${email}${password ? ':with-password' : ''}`); return opts.update ?? { ok: true }; },
    verifyPassword: async (email) => { calls.push(`verifyPassword:${email}`); if (opts.verifyThrows) throw opts.verifyThrows; return opts.verify ?? 'invalid'; },
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
  assert.deepEqual(f.calls, [`updateUser:${UID}:ana@example.com:with-password`, 'rpc:participant_link_auth_internal']);
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

test('identify does not call Auth Admin during concurrent access', async () => {
  const f = fixture({
    state: 'password_login',
    participant: { id: PID, auth_user_id: UID, password_configured_at: '2026-10-06T00:00:00Z' },
    existing: { id: UID, email: 'ana@example.com', kind: 'participant' },
    getUserThrows: new Error('Auth Admin is unavailable'),
  });
  const response = await handleRequest(post({ action: 'identify', email: 'ana@example.com' }), f.deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { state: 'password_login' });
  assert.ok(!f.calls.some((call) => call.startsWith('updateUser')));
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
    verify: 'valid', // es la misma persona: reescribe la contraseña de su primer intento
  });
  const second = await handleRequest(post({ action: 'setup_password', email: 'ana@example.com', password: SECRET }), retry.deps);
  assert.equal(second.status, 200);
  // Solo se vincula: la contraseña de la cuenta existente nunca se reescribe.
  assert.deepEqual(retry.calls, ['createUser:ana@example.com', 'findUserByEmail:ana@example.com', `participantByAuthUser:${UID}`, 'verifyPassword:ana@example.com', 'rpc:participant_link_auth_internal']);
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
  const own = fixture({ create: { code: 'EMAIL_TAKEN' }, byEmail: { id: UID, email: 'ana@example.com', kind: 'participant' }, owner: { id: PID }, verify: 'valid' });
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
    verify: 'valid',
  });
  const response = await handleRequest(post(registerBody()), f.deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.ok(!f.calls.some((call) => call.startsWith('updateUser'))); // nunca se reescribe la contraseña de una cuenta existente
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

// ── Recuperación segura: una cuenta que ya existía solo se reclama demostrando que se conoce su contraseña ──────────────────────

const OTHER = '99999999-9999-4999-8999-999999999999';
const setup = (f: Fixture, password = SECRET) => handleRequest(post({ action: 'setup_password', email: 'ana@example.com', password }), f.deps);
const writes = (f: Fixture) => f.calls.filter((call) => call.startsWith('updateUser') || call.startsWith('deleteUser') || call.startsWith('rpc:participant_link') || call.startsWith('rpc:discard'));

test('takeover attempt: an orphan account of another alumno is NOT claimed, its password is NOT replaced and nothing is linked', async () => {
  const orphan = { id: UID, email: 'ana@example.com', kind: 'participant' };
  // setup_password (prerregistro) y register (autorregistro reanudado) con una contraseña que NO es la de la cuenta.
  const viaSetup = fixture({ create: { code: 'EMAIL_TAKEN' }, byEmail: orphan, owner: null, verify: 'invalid' });
  const a = await setup(viaSetup, 'Contraseña-del-atacante-1');
  assert.equal(a.status, 409);
  const aText = await a.text();
  assert.deepEqual(JSON.parse(aText), { error: 'ACCOUNT_RECOVERY_REQUIRED' });
  assert.deepEqual(writes(viaSetup), []);

  const viaRegister = fixture({
    rpc: (name) => (name === 'register_self_service_internal' ? { data: null, error: { message: 'EMAIL_EXISTS' } } : { data: null, error: null }),
    participant: { id: PID, auth_user_id: null, password_configured_at: null, origin: 'self_service' },
    create: { code: 'EMAIL_TAKEN' }, byEmail: orphan, owner: null, verify: 'invalid',
  });
  const b = await handleRequest(post(registerBody({ password: 'Contraseña-del-atacante-1' })), viaRegister.deps);
  assert.equal(b.status, 409);
  assert.deepEqual(await b.json(), { error: 'ACCOUNT_RECOVERY_REQUIRED' });
  assert.deepEqual(writes(viaRegister), []); // ni siquiera se descarta el registro que no creó esta solicitud
  assert.ok(!aText.includes('atacante'));
});

test('legitimate recovery: the original person retypes their first password and the SAME account is linked, with no password rewrite', async () => {
  const f = fixture({ create: { code: 'EMAIL_TAKEN' }, byEmail: { id: UID, email: 'ana@example.com', kind: 'participant' }, owner: null, verify: 'valid' });
  const response = await setup(f);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(writes(f), ['rpc:participant_link_auth_internal']);
  assert.ok(!f.calls.some((call) => call.startsWith('createUser:') && call !== 'createUser:ana@example.com')); // no se creó ninguna otra
});

test('the ownership proof is skipped for accounts that cannot be claimed (Staff, other alumno): no password oracle on them', async () => {
  for (const opts of [
    { byEmail: { id: UID, email: 'ana@example.com', kind: null }, owner: null },
    { byEmail: { id: UID, email: 'ana@example.com', kind: 'participant' }, owner: { id: OTHER } },
  ]) {
    const f = fixture({ create: { code: 'EMAIL_TAKEN' }, verify: 'valid', ...opts });
    assert.equal((await setup(f)).status, 409);
    assert.ok(!f.calls.some((call) => call.startsWith('verifyPassword')));
    assert.deepEqual(writes(f), []);
  }
});

test('the ownership proof failing temporarily is a 429/503 that changes nothing', async () => {
  for (const status of [429, 503] as const) {
    const f = fixture({ create: { code: 'EMAIL_TAKEN' }, byEmail: { id: UID, email: 'ana@example.com', kind: 'participant' }, verifyThrows: new TemporaryError(status, 7) });
    const response = await setup(f);
    assert.equal(response.status, status);
    assert.deepEqual(writes(f), []);
  }
});

test('self-registration without a password: a half registration with an existing real-email account needs the proof; a placeholder identity does not', async () => {
  const partial = (existing: { id: string; email: string | null; kind: string | null }, verify: 'valid' | 'invalid') => fixture({
    rpc: (name) => (name === 'register_self_service_internal' ? { data: null, error: { message: 'EMAIL_EXISTS' } } : { data: null, error: null }),
    participant: { id: PID, auth_user_id: UID, password_configured_at: null, origin: 'self_service' },
    existing, verify,
  });
  const real = { id: UID, email: 'ana@example.com', kind: 'participant' };
  const refused = partial(real, 'invalid');
  assert.equal((await handleRequest(post(registerBody()), refused.deps)).status, 409);
  assert.deepEqual(writes(refused), []);

  const proven = partial(real, 'valid');
  assert.equal((await handleRequest(post(registerBody()), proven.deps)).status, 200);
  assert.deepEqual(writes(proven), ['rpc:participant_link_auth_internal']);

  const placeholder = partial({ id: UID, email: `p.${PID}@participantes.diaov.invalid`, kind: 'participant' }, 'invalid');
  assert.equal((await handleRequest(post(registerBody()), placeholder.deps)).status, 200);
  assert.ok(placeholder.calls.includes(`updateUser:${UID}:ana@example.com:with-password`));
  assert.ok(!placeholder.calls.some((call) => call.startsWith('verifyPassword')));
});

test('a linked account whose email Staff corrected is aligned only after the proof, and without touching its password', async () => {
  const f = fixture({
    participant: { id: PID, auth_user_id: UID, password_configured_at: null },
    existing: { id: UID, email: 'vieja@example.com', kind: 'participant' }, verify: 'valid',
  });
  assert.equal((await setup(f)).status, 200);
  assert.ok(f.calls.includes('verifyPassword:vieja@example.com')); // la prueba se hace contra el correo con que la cuenta existe
  assert.ok(f.calls.includes(`updateUser:${UID}:ana@example.com`));
  assert.ok(!f.calls.some((call) => call.endsWith(':with-password')));
  const denied = fixture({ participant: { id: PID, auth_user_id: UID, password_configured_at: null }, existing: { id: UID, email: 'vieja@example.com', kind: 'participant' }, verify: 'invalid' });
  assert.equal((await setup(denied)).status, 409);
  assert.deepEqual(writes(denied), []);
});

/** Un Auth y una base en memoria: la prueba de concurrencia usa las reglas reales (el correo es único, la contraseña se compara). */
function memoryWorld() {
  const accounts = new Map<string, { id: string; password: string; kind: string }>(); // por correo
  const links = new Map<string, string>(); // participante → cuenta
  const participant = { id: PID, auth_user_id: null as string | null, password_configured_at: null as string | null, origin: 'forms' as string };
  const calls: string[] = [];
  let seq = 0;
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const deps: Deps = {
    rpc: async (name, args) => {
      await tick();
      if (name === 'participant_link_auth_internal') {
        links.set(String(args.p_participant), String(args.p_auth_user));
        participant.auth_user_id = String(args.p_auth_user);
        participant.password_configured_at = 'now';
      }
      calls.push(name);
      return { data: null, error: null };
    },
    participantByEmail: async () => { await tick(); return { ...participant }; },
    careers: async () => [], highSchools: async () => [],
    getUser: async (id) => { await tick(); const e = [...accounts.entries()].find(([, a]) => a.id === id); return e ? { id, email: e[0], kind: e[1].kind } : null; },
    findUserByEmail: async (email) => { await tick(); const a = accounts.get(email); return a ? { id: a.id, email, kind: a.kind } : null; },
    participantByAuthUser: async (id) => { await tick(); for (const [pid, uid] of links) if (uid === id) return { id: pid }; return null; },
    createUser: async (email, password) => {
      await tick();
      if (accounts.has(email)) return { code: 'EMAIL_TAKEN' };
      const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
      accounts.set(email, { id, password, kind: 'participant' });
      calls.push('createUser');
      return { id };
    },
    updateUser: async (id, email, password) => { calls.push('updateUser'); const a = accounts.get(email); if (a && password) a.password = password; return { ok: true }; },
    deleteUser: async (id) => { calls.push('deleteUser'); for (const [e, a] of accounts) if (a.id === id) accounts.delete(e); },
    verifyPassword: async (email, password) => { await tick(); return accounts.get(email)?.password === password ? 'valid' : 'invalid'; },
    log: () => undefined,
  };
  return { deps, accounts, links, calls, participant };
}

test('concurrency: two simultaneous setups for one email create ONE account; the second with a different password cannot overwrite the first', async () => {
  const world = memoryWorld();
  const send = (password: string) => handleRequest(post({ action: 'setup_password', email: 'ana@example.com', password }), world.deps);
  const [a, b] = await Promise.all([send('Primera-clave-77'), send('Segunda-clave-88')]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(world.accounts.size, 1);
  assert.equal(world.calls.filter((call) => call === 'createUser').length, 1);
  assert.ok(!world.calls.includes('updateUser'));
  assert.ok(!world.calls.includes('deleteUser'));
  const winner = a.status === 200 ? 'Primera-clave-77' : 'Segunda-clave-88';
  assert.equal(world.accounts.get('ana@example.com')?.password, winner); // la contraseña del que ganó sigue intacta
});

test('concurrency: the same person double-submitting the same password converges on one linked account', async () => {
  const world = memoryWorld();
  const send = () => handleRequest(post({ action: 'setup_password', email: 'ana@example.com', password: SECRET }), world.deps);
  const results = await Promise.all([send(), send(), send()]);
  assert.ok(results.every((response) => response.status === 200 || response.status === 409));
  assert.ok(results.some((response) => response.status === 200));
  assert.equal(world.accounts.size, 1);
  assert.ok(!world.calls.includes('updateUser'));
  assert.equal(world.links.size, 1);
});

test('retries on the same email after a lost link converge on the same account and never modify another alumno\'s account', async () => {
  const world = memoryWorld();
  // La cuenta de OTRA persona con otro correo existe y debe quedar intacta.
  world.accounts.set('luis@example.com', { id: OTHER, password: 'Clave-de-Luis-55', kind: 'participant' });
  world.links.set('luis-participant', OTHER);
  let failLink = true;
  const original = world.deps.rpc;
  world.deps.rpc = async (name, args) => {
    if (name === 'participant_link_auth_internal' && failLink) { failLink = false; throw new TemporaryError(429, 5); }
    return original(name, args);
  };
  const send = (password: string) => handleRequest(post({ action: 'setup_password', email: 'ana@example.com', password }), world.deps);
  assert.equal((await send(SECRET)).status, 429); // la cuenta quedó creada pero sin vincular
  assert.equal((await send('Otra-contraseña-1')).status, 409); // un tercero no la reclama
  assert.equal((await send(SECRET)).status, 200); // la persona original sí
  assert.equal(world.accounts.size, 2);
  assert.equal(world.accounts.get('luis@example.com')?.password, 'Clave-de-Luis-55');
  assert.equal(world.calls.filter((call) => call === 'createUser').length, 1);
  assert.ok(!world.calls.includes('updateUser'));
  assert.ok(!world.calls.includes('deleteUser'));
});

// ── Catálogo: los errores HTTP de las consultas de carreras y preparatorias se conservan y se clasifican ─────────────────────────

const catalogWith = (careers: () => Promise<never>, highSchools?: () => Promise<never>) => {
  const f = fixture();
  f.deps.careers = careers as Deps['careers'];
  if (highSchools) f.deps.highSchools = highSchools as Deps['highSchools'];
  return f;
};

test('catalog: a 429/503 on either query is answered as 429/503 with Retry-After, never as SERVER_ERROR', async () => {
  for (const status of [429, 503] as const) {
    for (const which of ['careers', 'highSchools'] as const) {
      const failing = async () => { throw new TemporaryError(status, 12); };
      const f = which === 'careers' ? catalogWith(failing) : catalogWith(undefined as never, failing);
      if (which === 'highSchools') f.deps.careers = async () => [];
      const response = await handleRequest(post({ action: 'catalog' }), f.deps);
      assert.equal(response.status, status, `${which} ${status}`);
      assert.equal(retryAfterOf(response), 12);
      assert.deepEqual(await response.json(), { error: status === 429 ? 'RATE_LIMITED' : 'TEMPORARILY_UNAVAILABLE', retry_after: 12 });
    }
  }
});

test('catalog: when one query fails temporarily and the other fails otherwise, the temporary error wins', async () => {
  const f = catalogWith(async () => { throw new Error('boom'); }, async () => { throw new TemporaryError(429, 9); });
  const response = await handleRequest(post({ action: 'catalog' }), f.deps);
  assert.equal(response.status, 429);
  const other = catalogWith(async () => { throw new Error('boom'); }, async () => { throw new Error('también'); });
  assert.equal((await handleRequest(post({ action: 'catalog' }), other.deps)).status, 500); // un fallo que no es temporal sigue siéndolo
});

test('unwrapQuery keeps the HTTP status of a PostgREST result: 429, 5xx and a lost connection are temporary, a data error is not', () => {
  const failure = (error: object, status?: number) => () => unwrapQuery({ data: null, error, status });
  for (const [error, status, expected] of [
    [{ message: 'rate limit' }, 429, 429], [{ message: 'upstream' }, 503, 503], [{ message: 'oops' }, 500, 503],
    [{ message: 'FetchError: fetch failed' }, 0, 503], [{ code: 'over_request_rate_limit', message: 'x' }, undefined, 429],
  ] as const) {
    assert.throws(failure(error, status), (cause) => cause instanceof TemporaryError && cause.status === expected, JSON.stringify(error));
  }
  const dataError = { code: '42501', message: 'permission denied' };
  assert.throws(failure(dataError, 403), (cause) => cause === dataError);
  assert.deepEqual(unwrapQuery({ data: [{ id: 'h1' }], error: null, status: 200 }), [{ id: 'h1' }]);
  assert.deepEqual(unwrapQuery({ data: null, error: null, status: 200 }), []);
});


// =====================================================================================================================
// Hotfix de latencia (incidente 2026-10-15): plazos, Auth fuera de `identify`, escrituras que no se abandonan a medias
// =====================================================================================================================

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const identifyBody = { action: 'identify', email: 'ana@example.com' };

test('identify concurrente: solo el RPC de estado; ninguna llamada a Auth Admin ni a otras consultas, ni siquiera en segundo plano', async () => {
  const f = fixture({ state: 'password_login' });
  const forbidden = (name: string) => async () => { throw new Error(`no debe llamarse: ${name}`); };
  Object.assign(f.deps, {
    getUser: forbidden('getUser'), findUserByEmail: forbidden('findUserByEmail'), participantByEmail: forbidden('participantByEmail'),
    participantByAuthUser: forbidden('participantByAuthUser'), createUser: forbidden('createUser'), updateUser: forbidden('updateUser'),
    deleteUser: forbidden('deleteUser'), verifyPassword: forbidden('verifyPassword'),
  });
  const responses = await Promise.all(Array.from({ length: 50 }, () => handleRequest(post(identifyBody), f.deps)));
  await flush();
  assert.ok(responses.every((response) => response.status === 200));
  assert.deepEqual(await responses[0].json(), { state: 'password_login' });
  assert.equal(f.calls.length, 50);
  assert.ok(f.calls.every((call) => call === 'rpc:participant_access_state_internal'));
});

test('a dependency that never answers becomes a 503 with Retry-After at the read deadline, not minutes later', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const f = fixture({ state: 'password_login' });
    f.deps.rpc = () => new Promise(() => undefined);
    const pending = handleRequest(post(identifyBody), f.deps);
    await flush();
    mock.timers.tick(READ_DEADLINE_MS - 1);
    let settled = false;
    void pending.then(() => { settled = true; });
    await flush();
    assert.equal(settled, false);
    mock.timers.tick(2);
    const response = await pending;
    assert.equal(response.status, 503);
    assert.ok(Number(response.headers.get('Retry-After')) >= 5);
    assert.deepEqual(Object.keys(await response.json()).sort(), ['error', 'retry_after']);
    assert.ok(f.logs.includes('temporary_failure:503'));
  } finally {
    mock.timers.reset();
  }
});

test('catalog: served from memory for a minute; if the database degrades, the last good list is served only while it is recent', async () => {
  const f = fixture();
  let queries = 0;
  const careers = f.deps.careers;
  f.deps.careers = async () => { queries += 1; return careers(); };
  let clock = 5_000;
  f.deps.now = () => clock;
  const first = await (await handleRequest(post({ action: 'catalog' }), f.deps)).json();
  await handleRequest(post({ action: 'catalog' }), f.deps);
  assert.equal(queries, 1);
  clock += CATALOG_TTL_MS + 1;
  f.deps.careers = async () => { throw new TemporaryError(503); };
  const stale = await handleRequest(post({ action: 'catalog' }), f.deps);
  assert.equal(stale.status, 200);
  assert.deepEqual(await stale.json(), first);
  assert.ok(f.logs.includes('catalog_served_stale:'));
  clock += CATALOG_STALE_MAX_MS; // una lista demasiado vieja ya no se sirve: mejor un 503 reintentable
  assert.equal((await handleRequest(post({ action: 'catalog' }), f.deps)).status, 503);
});

test('catalog: a change made by Staff is visible within a minute (a fresh read once the memory expires)', async () => {
  const f = fixture();
  let clock = 1;
  f.deps.now = () => clock;
  await handleRequest(post({ action: 'catalog' }), f.deps);
  f.deps.careers = async () => [{ id: 'c2', name: 'Medicina', division: 'Ciencias de la Salud' }];
  clock += CATALOG_TTL_MS + 1;
  const body = await (await handleRequest(post({ action: 'catalog' }), f.deps)).json() as { careers: { id: string }[] };
  assert.deepEqual(body.careers.map((career) => career.id), ['c2']);
});

test('without any good catalog yet, a degraded database is still a retryable 503 (unchanged)', async () => {
  const f = fixture();
  f.deps.careers = async () => { throw new TemporaryError(503); };
  assert.equal((await handleRequest(post({ action: 'catalog' }), f.deps)).status, 503);
});

// ---------------------------------------------------------------------------------------------------------------------
// Mundo con estado (Auth + participantes) para probar convergencia: creación, recuperación y concurrencia
// ---------------------------------------------------------------------------------------------------------------------
type AuthAccount = { id: string; email: string; password: string; kind: string };
type Person = { id: string; email: string; auth_user_id: string | null; password_configured_at: string | null; origin: string };
function world(seed: { people?: Person[]; accounts?: AuthAccount[] } = {}) {
  const accounts = new Map<string, AuthAccount>((seed.accounts ?? []).map((a) => [a.id, a]));
  const people = new Map<string, Person>((seed.people ?? []).map((p) => [p.id, p]));
  const calls: string[] = [];
  const hooks: { afterCreate?: () => void; beforeLink?: () => Promise<unknown>; createGate?: Promise<unknown> } = {};
  let counter = 0;
  const byEmail = (email: string) => [...accounts.values()].find((a) => a.email === email) ?? null;
  const info = (a: AuthAccount | null) => (a ? { id: a.id, email: a.email, kind: a.kind } : null);
  const deps: Deps = {
    rpc: async (name, args) => {
      calls.push(`rpc:${name}`);
      if (name === 'participant_link_auth_internal') {
        if (hooks.beforeLink) await hooks.beforeLink();
        const person = people.get(String(args.p_participant));
        if (!person) return { data: null, error: { message: 'NOT_FOUND' } };
        person.auth_user_id = String(args.p_auth_user);
        person.password_configured_at ??= 'now';
        return { data: null, error: null };
      }
      if (name === 'register_self_service_internal') {
        const email = String((args.p as { email: string }).email);
        if ([...people.values()].some((p) => p.email === email)) return { data: null, error: { message: 'EMAIL_EXISTS' } };
        counter += 1;
        const id = `p-${counter}`;
        people.set(id, { id, email, auth_user_id: null, password_configured_at: null, origin: 'self_service' });
        return { data: id, error: null };
      }
      if (name === 'discard_self_service_registration_internal') {
        const person = people.get(String(args.p_participant));
        const gone = !!person && person.origin === 'self_service' && !person.password_configured_at && !person.auth_user_id;
        if (gone) people.delete(person!.id);
        return { data: gone, error: null };
      }
      return { data: null, error: null };
    },
    participantByEmail: async (email) => { const p = [...people.values()].find((x) => x.email === email); return p ? { ...p } : null; },
    careers: async () => [], highSchools: async () => [],
    getUser: async (id) => info(accounts.get(id) ?? null),
    findUserByEmail: async (email) => { calls.push('findUserByEmail'); await flush(); return info(byEmail(email)); },
    participantByAuthUser: async (id) => { const p = [...people.values()].find((x) => x.auth_user_id === id); return p ? { id: p.id } : null; },
    createUser: async (email, password) => {
      calls.push('createUser');
      if (hooks.createGate) await hooks.createGate;
      await flush();
      if (byEmail(email)) return { code: 'EMAIL_TAKEN' };
      counter += 1;
      const account = { id: `u-${counter}`, email, password, kind: 'participant' };
      accounts.set(account.id, account);
      hooks.afterCreate?.();
      return { id: account.id };
    },
    updateUser: async (id, email, password) => { calls.push('updateUser'); const a = accounts.get(id)!; a.email = email; if (password) a.password = password; return { ok: true }; },
    deleteUser: async (id) => { calls.push('deleteUser'); accounts.delete(id); },
    verifyPassword: async (email, password) => { calls.push('verifyPassword'); await flush(); return byEmail(email)?.password === password ? 'valid' : 'invalid'; },
    log: () => undefined,
  };
  return { deps, accounts, people, calls, hooks };
}
const PRE: Person = { id: 'pre-1', email: 'ana@example.com', auth_user_id: null, password_configured_at: null, origin: 'forms' };
const setupBody = (password = SECRET) => ({ action: 'setup_password', email: 'ana@example.com', password });

test('prerregistrada que crea su contraseña: una sola cuenta, vinculada, sin borrar nada', async () => {
  const w = world({ people: [{ ...PRE }] });
  const response = await handleRequest(post(setupBody()), w.deps);
  assert.equal(response.status, 200);
  assert.equal(w.accounts.size, 1);
  assert.equal(w.people.get('pre-1')!.auth_user_id, [...w.accounts.keys()][0]);
  assert.ok(w.people.get('pre-1')!.password_configured_at);
  assert.ok(!w.calls.includes('deleteUser'));
});

test('autorregistro: crea participante y cuenta, vinculados; un segundo envío no duplica nada', async () => {
  const w = world();
  assert.equal((await handleRequest(post(registerBody()), w.deps)).status, 200);
  assert.equal(w.accounts.size, 1);
  assert.equal(w.people.size, 1);
  const [person] = [...w.people.values()];
  assert.equal(person.auth_user_id, [...w.accounts.keys()][0]);
  const again = await handleRequest(post(registerBody()), w.deps);
  assert.equal(again.status, 409); // ya configurado: se informa, no se duplica
  assert.equal(w.accounts.size, 1);
  assert.equal(w.people.size, 1);
});

test('red perdida DESPUÉS de crear la cuenta: no se borra nada y el reintento la recupera con la misma contraseña', async () => {
  const w = world({ people: [{ ...PRE }] });
  w.hooks.beforeLink = async () => { throw new TemporaryError(503); }; // la cuenta ya existe, pero el vínculo se perdió
  const lost = await handleRequest(post(setupBody()), w.deps);
  assert.equal(lost.status, 503);
  assert.equal(w.accounts.size, 1);
  assert.equal(w.people.get('pre-1')!.auth_user_id, null);
  assert.ok(!w.calls.includes('deleteUser'), 'un resultado incierto nunca borra una cuenta legítima');

  w.hooks.beforeLink = undefined;
  const retry = await handleRequest(post(setupBody()), w.deps);
  assert.equal(retry.status, 200);
  assert.equal(w.accounts.size, 1, 'se adopta la cuenta que quedó a medias, no se crea otra');
  assert.equal(w.people.get('pre-1')!.auth_user_id, [...w.accounts.keys()][0]);
  assert.ok(w.calls.includes('verifyPassword'), 'la comprobación de propiedad se conserva');
});

test('recuperación con OTRA contraseña: no se toca la cuenta existente (ACCOUNT_RECOVERY_REQUIRED) y sigue siendo una sola', async () => {
  const w = world({ people: [{ ...PRE }] });
  w.hooks.beforeLink = async () => { throw new TemporaryError(503); };
  await handleRequest(post(setupBody()), w.deps);
  w.hooks.beforeLink = undefined;
  const other = await handleRequest(post(setupBody('Otra-contraseña-77')), w.deps);
  assert.equal(other.status, 409);
  assert.deepEqual(await other.json(), { error: 'ACCOUNT_RECOVERY_REQUIRED' });
  assert.equal(w.accounts.size, 1);
  assert.equal([...w.accounts.values()][0].password, SECRET);
  assert.equal(w.people.get('pre-1')!.auth_user_id, null);
  assert.ok(!w.calls.includes('updateUser') && !w.calls.includes('deleteUser'));
});

test('dos intentos SIMULTÁNEOS del mismo correo y contraseña convergen en una sola cuenta vinculada, sin borrar nada', async () => {
  const w = world({ people: [{ ...PRE }] });
  const [a, b] = await Promise.all([handleRequest(post(setupBody()), w.deps), handleRequest(post(setupBody()), w.deps)]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  assert.equal(w.accounts.size, 1);
  assert.equal(w.people.get('pre-1')!.auth_user_id, [...w.accounts.keys()][0]);
  assert.ok(!w.calls.includes('deleteUser'));
});

test('dos autorregistros SIMULTÁNEOS del mismo correo: un participante, una cuenta, vinculados', async () => {
  const w = world();
  const results = await Promise.all([handleRequest(post(registerBody()), w.deps), handleRequest(post(registerBody()), w.deps)]);
  assert.ok(results.every((response) => response.status === 200 || response.status === 409));
  assert.equal(w.accounts.size, 1);
  assert.equal(w.people.size, 1);
  assert.equal([...w.people.values()][0].auth_user_id, [...w.accounts.keys()][0]);
  assert.ok(!w.calls.includes('deleteUser'));
});

test('dos intentos simultáneos con contraseñas DISTINTAS: gana uno, el otro no cambia ni roba la cuenta', async () => {
  const w = world({ people: [{ ...PRE }] });
  const [a, b] = await Promise.all([handleRequest(post(setupBody('Primera-clave-11')), w.deps), handleRequest(post(setupBody('Segunda-clave-22')), w.deps)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(w.accounts.size, 1);
  assert.ok(!w.calls.includes('updateUser') && !w.calls.includes('deleteUser'));
});

test('timeout durante una escritura: 503 a tiempo, resultado incierto y NINGÚN paso nuevo después del plazo; el reintento converge', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    // La cuenta ya existía de un intento anterior (se perdió la respuesta): crear devuelve «correo ya tiene cuenta» y tarda.
    const w = world({ people: [{ ...PRE }], accounts: [{ id: 'u-0', email: 'ana@example.com', password: SECRET, kind: 'participant' }] });
    let releaseCreate!: () => void;
    w.hooks.createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
    const pending = handleRequest(post(setupBody()), w.deps);
    await flush();
    mock.timers.tick(WRITE_DEADLINE_MS + 1);
    const response = await pending;
    assert.equal(response.status, 503);
    assert.ok(Number(response.headers.get('Retry-After')) >= 5);

    // La llamada que seguía en vuelo termina DESPUÉS del plazo: el flujo tardío no inicia pasos nuevos (ni buscar, ni probar la
    // contraseña, ni cambiar o borrar cuentas) y la persona queda en un estado incierto pero intacto.
    releaseCreate();
    await flush(); await flush(); await flush();
    assert.deepEqual(w.calls, ['createUser']);
    assert.equal(w.accounts.size, 1);
    assert.equal(w.people.get('pre-1')!.auth_user_id, null);

    // Reintento con la misma contraseña: adopta la cuenta existente demostrando que la conoce; una sola cuenta, vinculada.
    w.hooks.createGate = undefined;
    const retry = await handleRequest(post(setupBody()), w.deps);
    assert.equal(retry.status, 200);
    assert.equal(w.accounts.size, 1);
    assert.equal(w.people.get('pre-1')!.auth_user_id, 'u-0');
    assert.ok(w.calls.includes('verifyPassword'));
    assert.ok(!w.calls.includes('deleteUser') && !w.calls.includes('updateUser'));
  } finally {
    mock.timers.reset();
  }
});

test('timeout tras CREAR la cuenta: el vínculo (idempotente) sí puede completarse, y el reintento encuentra «ya configurada»', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const w = world({ people: [{ ...PRE }] });
    let releaseCreate!: () => void;
    w.hooks.createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
    const pending = handleRequest(post(setupBody()), w.deps);
    await flush();
    mock.timers.tick(WRITE_DEADLINE_MS + 1);
    assert.equal((await pending).status, 503);
    releaseCreate();
    await flush(); await flush(); await flush();
    assert.equal(w.accounts.size, 1);
    assert.equal(w.people.get('pre-1')!.auth_user_id, [...w.accounts.keys()][0]); // la cuenta no queda huérfana
    const retry = await handleRequest(post(setupBody()), w.deps);
    assert.equal(retry.status, 409);
    assert.deepEqual(await retry.json(), { error: 'ACCESS_ALREADY_CONFIGURED' }); // el navegador entra con la contraseña escrita
    assert.equal(w.accounts.size, 1);
  } finally {
    mock.timers.reset();
  }
});

test('timeout en un registro nuevo: si lo tardío falla de forma definitiva NO se deshace el registro ni se borra la cuenta', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const w = world();
    let releaseLink!: () => void;
    const gate = new Promise<void>((resolve) => { releaseLink = resolve; });
    w.hooks.beforeLink = async () => { await gate; throw new Error('fallo definitivo tardío'); };
    const pending = handleRequest(post(registerBody()), w.deps);
    await flush(); await flush(); await flush();
    mock.timers.tick(WRITE_DEADLINE_MS + 1);
    assert.equal((await pending).status, 503);
    releaseLink();
    await flush(); await flush(); await flush();
    assert.equal(w.people.size, 1, 'el registro guardado se conserva');
    assert.equal(w.accounts.size, 1, 'la cuenta creada se conserva');
    assert.ok(!w.calls.includes('deleteUser'));
    assert.ok(!w.calls.includes('rpc:discard_self_service_registration_internal'));
    // El reintento (misma contraseña) lo completa sin duplicar.
    w.hooks.beforeLink = undefined;
    const retry = await handleRequest(post(registerBody()), w.deps);
    assert.equal(retry.status, 200);
    assert.equal(w.people.size, 1);
    assert.equal(w.accounts.size, 1);
    assert.equal([...w.people.values()][0].auth_user_id, [...w.accounts.keys()][0]);
  } finally {
    mock.timers.reset();
  }
});

test('reads have a shorter deadline than writes, and writes stay below the browser timeout', () => {
  assert.ok(READ_DEADLINE_MS < WRITE_DEADLINE_MS && WRITE_DEADLINE_MS < 25_000);
});
