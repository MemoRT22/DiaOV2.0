// Acceso de participantes: correo → el sistema decide → contraseña.
// La función orquesta Supabase Auth con service_role (solo en el servidor) y la base de datos mediante funciones
// internas que únicamente service_role puede ejecutar. Nunca devuelve tokens: tras crear o configurar la cuenta,
// el navegador inicia sesión con `signInWithPassword`. La contraseña no se guarda, no se registra y no se audita.
export type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
export type ParticipantRow = { id: string; auth_user_id: string | null; password_configured_at: string | null };
export type AuthUserInfo = { id: string; email: string | null; kind: string | null };
export type HighSchoolRow = { id: string; name: string };
export type CareerRow = { id: string; name: string; division: string | null };
export type Deps = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  participantByEmail: (email: string) => Promise<ParticipantRow | null>;
  careers: () => Promise<CareerRow[]>;
  highSchools: () => Promise<HighSchoolRow[]>;
  getUser: (id: string) => Promise<AuthUserInfo | null>;
  createUser: (email: string, password: string) => Promise<{ id?: string; code?: 'EMAIL_TAKEN' | 'AUTH_ERROR' }>;
  updateUser: (id: string, email: string, password?: string) => Promise<{ ok: boolean; code?: 'EMAIL_TAKEN' | 'AUTH_ERROR' }>;
  deleteUser: (id: string) => Promise<void>;
  log: (event: string, code?: string) => void;
};

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Content-Type': 'application/json',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SYNTHETIC = /^p\.[0-9a-f-]{36}@participantes\.diaov\.invalid$/i;
const KNOWN_ERRORS = ['INVALID_EMAIL', 'INVALID_NAME', 'INVALID_PHONE', 'PHONE_REQUIRED', 'HIGH_SCHOOL_REQUIRED', 'INVALID_GRADE',
  'INVALID_PERIOD', 'INVALID_CAREER', 'INVALID_HIGH_SCHOOL', 'CONSENT_REQUIRED', 'EMAIL_EXISTS', 'NO_ACTIVE_EDITION', 'NOT_FOUND'];

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= PASSWORD_MIN && new TextEncoder().encode(value).length <= PASSWORD_MAX;
}

function normalizeEmail(value: unknown): string | null {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email && email.length <= 254 && EMAIL.test(email) ? email : null;
}

const statusFor = (code: string) => code === 'EMAIL_EXISTS' || code === 'ACCESS_ALREADY_CONFIGURED' ? 409
  : code === 'NO_ACTIVE_EDITION' ? 503 : code === 'SERVER_ERROR' ? 500 : code === 'NOT_FOUND' ? 404 : 400;
const fail = (code: string) => json({ error: code }, statusFor(code));
const rpcErrorCode = (error: { message: string }) => KNOWN_ERRORS.find((code) => error.message.includes(code)) ?? 'SERVER_ERROR';

/** Una identidad solo se reutiliza si es de participante: nunca se cambia la contraseña de Staff por un vínculo erróneo. */
const isParticipantIdentity = (user: AuthUserInfo) => user.kind === 'participant' || SYNTHETIC.test(user.email ?? '');

/** Crea la identidad con el correo real, o migra la sintética antigua al correo real, y vincula al participante. */
async function establishIdentity(deps: Deps, participant: ParticipantRow, email: string, password: string): Promise<string> {
  let existing: AuthUserInfo | null = null;
  if (participant.auth_user_id) existing = await deps.getUser(participant.auth_user_id);
  if (existing && !isParticipantIdentity(existing)) {
    deps.log('identity_not_participant');
    throw new Error('SERVER_ERROR');
  }
  if (existing) {
    const updated = await deps.updateUser(existing.id, email, password);
    if (!updated.ok) throw new Error(updated.code === 'EMAIL_TAKEN' ? 'EMAIL_EXISTS' : 'SERVER_ERROR');
    const linked = await deps.rpc('participant_link_auth_internal', { p_participant: participant.id, p_auth_user: existing.id });
    if (linked.error) throw new Error('SERVER_ERROR');
    return existing.id;
  }
  const created = await deps.createUser(email, password);
  if (!created.id) throw new Error(created.code === 'EMAIL_TAKEN' ? 'EMAIL_EXISTS' : 'SERVER_ERROR');
  const linked = await deps.rpc('participant_link_auth_internal', { p_participant: participant.id, p_auth_user: created.id });
  if (linked.error) {
    await deps.deleteUser(created.id).catch(() => deps.log('rollback_delete_failed'));
    throw new Error('SERVER_ERROR');
  }
  return created.id;
}

async function identify(deps: Deps, body: Record<string, unknown>) {
  const email = normalizeEmail(body.email);
  if (!email) return fail('INVALID_EMAIL');
  const state = await deps.rpc('participant_access_state_internal', { p_email: email });
  if (state.error) return fail(rpcErrorCode(state.error));
  // Si Staff corrigió el correo del participante, la identidad de Auth sigue con el correo anterior: se alinea antes de
  // que el navegador intente iniciar sesión. Es un ajuste silencioso; un fallo no impide continuar.
  if (state.data === 'password_login') await syncAuthEmail(deps, email).catch(() => deps.log('email_sync_failed'));
  return json({ state: state.data });
}

async function syncAuthEmail(deps: Deps, email: string) {
  const participant = await deps.participantByEmail(email);
  if (!participant?.auth_user_id) return;
  const user = await deps.getUser(participant.auth_user_id);
  if (user && isParticipantIdentity(user) && (user.email ?? '').toLowerCase() !== email) {
    await deps.updateUser(user.id, email);
  }
}

async function setupPassword(deps: Deps, body: Record<string, unknown>) {
  const email = normalizeEmail(body.email);
  if (!email) return fail('INVALID_EMAIL');
  if (!validPassword(body.password)) return fail('INVALID_PASSWORD');
  const participant = await deps.participantByEmail(email);
  if (!participant) return fail('NOT_FOUND');
  if (participant.password_configured_at) return fail('ACCESS_ALREADY_CONFIGURED');
  try {
    await establishIdentity(deps, participant, email, body.password);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'SERVER_ERROR';
    return fail(KNOWN_ERRORS.includes(code) ? code : 'SERVER_ERROR');
  }
  return json({ ok: true });
}

async function register(deps: Deps, body: Record<string, unknown>) {
  const email = normalizeEmail(body.email);
  if (!email) return fail('INVALID_EMAIL');
  if (!validPassword(body.password)) return fail('INVALID_PASSWORD');
  const fields = {
    email, first_name: body.first_name, last_name: body.last_name, phone: body.phone, high_school_id: body.high_school_id,
    high_school_grade: body.high_school_grade, entry_period: body.entry_period, initial_career_id: body.initial_career_id,
    consent_accepted: body.consent_accepted === true,
  };
  // La base de datos valida todo y crea participante, perfil, interés inicial y consentimiento en una transacción.
  const created = await deps.rpc('register_self_service_internal', { p: fields });
  if (created.error || typeof created.data !== 'string') return fail(created.error ? rpcErrorCode(created.error) : 'SERVER_ERROR');
  const participantId = created.data;
  try {
    await establishIdentity(deps, { id: participantId, auth_user_id: null, password_configured_at: null }, email, body.password);
  } catch (error) {
    // Compensación: sin cuenta no debe quedar un autorregistro a medias. Si la limpieza falla, el correo simplemente
    // aparecerá como «prerregistro sin contraseña» y la persona podrá terminar de configurarla.
    await deps.rpc('discard_self_service_registration_internal', { p_participant: participantId })
      .catch(() => deps.log('rollback_discard_failed'));
    const code = error instanceof Error ? error.message : 'SERVER_ERROR';
    return fail(KNOWN_ERRORS.includes(code) ? code : 'SERVER_ERROR');
  }
  return json({ ok: true });
}

async function catalog(deps: Deps) {
  const [careers, high_schools] = await Promise.all([deps.careers(), deps.highSchools()]);
  return json({ careers, high_schools });
}

export async function handleRequest(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('INVALID_INPUT');
  const input = body as Record<string, unknown>;
  try {
    if (input.action === 'identify') return await identify(deps, input);
    if (input.action === 'catalog') return await catalog(deps);
    if (input.action === 'setup_password') return await setupPassword(deps, input);
    if (input.action === 'register') return await register(deps, input);
    return fail('INVALID_INPUT');
  } catch {
    deps.log('unexpected_failure');
    return fail('SERVER_ERROR');
  }
}
