// Acceso de participantes: correo → el sistema decide → contraseña.
// La función orquesta Supabase Auth con service_role (solo en el servidor) y la base de datos mediante funciones
// internas que únicamente service_role puede ejecutar. Nunca devuelve tokens: tras crear o configurar la cuenta,
// el navegador inicia sesión con `signInWithPassword`. La contraseña no se guarda, no se registra y no se audita.
export type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
export type ParticipantRow = { id: string; auth_user_id: string | null; password_configured_at: string | null; origin?: string | null };
export type AuthUserInfo = { id: string; email: string | null; kind: string | null };
export type HighSchoolRow = { id: string; name: string };
export type CareerRow = { id: string; name: string; division: string | null };
export type Deps = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  participantByEmail: (email: string) => Promise<ParticipantRow | null>;
  careers: () => Promise<CareerRow[]>;
  highSchools: () => Promise<HighSchoolRow[]>;
  /** null = no existe; un fallo temporal del servicio de Auth se lanza como `TemporaryError`, nunca se confunde con «no existe». */
  getUser: (id: string) => Promise<AuthUserInfo | null>;
  /** Búsqueda por correo (solo en la recuperación de un registro interrumpido): null si no hay cuenta con ese correo. */
  findUserByEmail: (email: string) => Promise<AuthUserInfo | null>;
  /** El participante (de cualquier edición) que ya usa esa cuenta de Auth, si lo hay. */
  participantByAuthUser: (authUserId: string) => Promise<{ id: string } | null>;
  createUser: (email: string, password: string) => Promise<{ id?: string; code?: 'EMAIL_TAKEN' | 'AUTH_ERROR' }>;
  updateUser: (id: string, email: string, password?: string) => Promise<{ ok: boolean; code?: 'EMAIL_TAKEN' | 'AUTH_ERROR' }>;
  deleteUser: (id: string) => Promise<void>;
  /**
   * Prueba de posesión: ¿esta contraseña abre esa cuenta de Auth? Es la ÚNICA forma de reclamar una cuenta que ya existía. No cambia
   * nada en la cuenta. Un límite o una caída se lanza como `TemporaryError`; solo una negativa definitiva devuelve `invalid`.
   */
  verifyPassword: (email: string, password: string) => Promise<'valid' | 'invalid'>;
  log: (event: string, code?: string) => void;
};

/**
 * El servicio (o la base) está limitando o no responde por ahora. No es un error de datos ni de credenciales: la persona debe poder
 * reintentar sin perder nada. `status` 429 = demasiadas solicitudes; 503 = servicio temporalmente no disponible.
 */
export class TemporaryError extends Error {
  readonly status: 429 | 503;
  readonly retryAfter: number;
  constructor(status: 429 | 503, retryAfter?: number) {
    super(status === 429 ? 'RATE_LIMITED' : 'TEMPORARILY_UNAVAILABLE');
    this.name = 'TemporaryError';
    this.status = status;
    // Con variación aleatoria para que cientos de teléfonos no vuelvan a la vez.
    this.retryAfter = retryAfter ?? (status === 429 ? 10 : 5) + Math.floor(Math.random() * 10);
  }
}

/** Clasifica la respuesta de un servicio de apoyo (Auth, PostgREST). `null` = no es temporal: se trata como error normal. */
export function upstreamTemporary(info: { status?: number | null; code?: string | null; name?: string | null; message?: string | null }): TemporaryError | null {
  const status = info.status ?? undefined;
  if (status === 429 || info.code === 'over_request_rate_limit') return new TemporaryError(429);
  if (status === 0 || status === 408 || (status !== undefined && status >= 500) || info.name === 'AuthRetryableFetchError') return new TemporaryError(503);
  if (status === undefined && /fetch failed|network|timed? ?out|econn|socket|temporar/i.test(info.message ?? '')) return new TemporaryError(503);
  return null;
}

const asTemporary = (error: unknown): TemporaryError | null => {
  if (error instanceof TemporaryError) return error;
  if (error && typeof error === 'object') return upstreamTemporary(error as { status?: number; code?: string; name?: string; message?: string });
  return null;
};

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Retry-After',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Content-Type': 'application/json',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SYNTHETIC = /^p\.[0-9a-f-]{36}@participantes\.diaov\.invalid$/i;
const KNOWN_ERRORS = ['INVALID_EMAIL', 'INVALID_NAME', 'INVALID_PHONE', 'PHONE_REQUIRED', 'HIGH_SCHOOL_REQUIRED', 'INVALID_GRADE',
  'INVALID_PERIOD', 'INVALID_CAREER', 'INVALID_HIGH_SCHOOL', 'CONSENT_REQUIRED', 'EMAIL_EXISTS', 'NO_ACTIVE_EDITION', 'NOT_FOUND',
  'ACCOUNT_RECOVERY_REQUIRED'];

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= PASSWORD_MIN && new TextEncoder().encode(value).length <= PASSWORD_MAX;
}

function normalizeEmail(value: unknown): string | null {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email && email.length <= 254 && EMAIL.test(email) ? email : null;
}

const temporary = (error: TemporaryError) =>
  new Response(JSON.stringify({ error: error.message, retry_after: error.retryAfter }), { status: error.status, headers: { ...headers, 'Retry-After': String(error.retryAfter) } });

const statusFor = (code: string) => code === 'EMAIL_EXISTS' || code === 'ACCESS_ALREADY_CONFIGURED' || code === 'ACCOUNT_RECOVERY_REQUIRED' ? 409
  : code === 'NO_ACTIVE_EDITION' ? 503 : code === 'SERVER_ERROR' ? 500 : code === 'NOT_FOUND' ? 404 : 400;
const fail = (code: string) => json({ error: code }, statusFor(code));
const rpcErrorCode = (error: { message: string }) => KNOWN_ERRORS.find((code) => error.message.includes(code)) ?? 'SERVER_ERROR';

/** Una identidad solo se reutiliza si es de participante: nunca se cambia la contraseña de Staff por un vínculo erróneo. */
const isParticipantIdentity = (user: AuthUserInfo) => user.kind === 'participant' || SYNTHETIC.test(user.email ?? '');

/** Una cuenta con contraseña de marcador (la que el sistema crea al prerregistrar): nadie la conoce, así que no hay nada que proteger. */
const isPlaceholder = (user: AuthUserInfo) => SYNTHETIC.test(user.email ?? '');

/**
 * Una cuenta de Auth que YA EXISTÍA con este correo (quedó a medias de un intento anterior: se creó pero no llegó a vincularse porque se
 * perdió la respuesta, hubo un 429, etc.). El correo y los metadatos NO prueban que quien llama sea su dueño original, así que:
 *   - nunca se cambia su contraseña (ni se usa `updateUser`);
 *   - solo se vincula si quien llama demuestra conocer su contraseña actual (`verifyPassword`), que es justo lo que ocurre cuando la
 *     misma persona reintenta con lo que escribió la primera vez;
 *   - si no coincide, no se toca nada y se responde `ACCOUNT_RECOVERY_REQUIRED`: la ruta segura es la contraseña del primer intento o
 *     que Staff verifique la identidad en persona y restablezca el acceso.
 * Además, solo se considera una cuenta de participante con este correo que ningún OTRO participante use (nunca Staff).
 */
async function adoptInterruptedIdentity(deps: Deps, participant: ParticipantRow, email: string, password: string): Promise<string> {
  const user = await deps.findUserByEmail(email);
  if (!user || user.kind !== 'participant' || (user.email ?? '').toLowerCase() !== email) {
    deps.log('email_taken_not_adoptable');
    throw new Error('EMAIL_EXISTS');
  }
  const owner = await deps.participantByAuthUser(user.id);
  if (owner && owner.id !== participant.id) {
    deps.log('email_taken_other_participant');
    throw new Error('EMAIL_EXISTS');
  }
  await proveOwnership(deps, email, password);
  await linkIdentity(deps, participant.id, user.id, false);
  return user.id;
}

async function proveOwnership(deps: Deps, accountEmail: string, password: string) {
  if ((await deps.verifyPassword(accountEmail, password)) !== 'valid') {
    deps.log('ownership_not_proven');
    throw new Error('ACCOUNT_RECOVERY_REQUIRED');
  }
}

/**
 * Vincula la identidad. Si el vínculo falla de forma DEFINITIVA y la cuenta se acaba de crear aquí, se retira (como antes). Si el
 * resultado es incierto (límite, servicio caído, tiempo agotado) NO se borra nada: el vínculo pudo haberse guardado y borrar la cuenta
 * dejaría a la persona sin acceso; el reintento la recupera con `adoptInterruptedIdentity`.
 */
async function linkIdentity(deps: Deps, participantId: string, authUserId: string, rollbackOnFailure: boolean) {
  let linked: RpcResult;
  try {
    linked = await deps.rpc('participant_link_auth_internal', { p_participant: participantId, p_auth_user: authUserId });
  } catch (error) {
    if (asTemporary(error)) throw error;
    throw new Error('SERVER_ERROR');
  }
  if (linked.error) {
    if (upstreamTemporary(linked.error as { status?: number; message?: string })) throw new TemporaryError(503);
    if (rollbackOnFailure) await deps.deleteUser(authUserId).catch(() => deps.log('rollback_delete_failed'));
    throw new Error('SERVER_ERROR');
  }
}

/** Crea la identidad con el correo real, o migra la sintética antigua al correo real, y vincula al participante. */
async function establishIdentity(deps: Deps, participant: ParticipantRow, email: string, password: string): Promise<string> {
  let existing: AuthUserInfo | null = null;
  if (participant.auth_user_id) existing = await deps.getUser(participant.auth_user_id);
  if (existing && !isParticipantIdentity(existing)) {
    deps.log('identity_not_participant');
    throw new Error('SERVER_ERROR');
  }
  if (existing) {
    if (isPlaceholder(existing)) {
      // Cuenta de marcador creada al prerregistrar: se migra al correo real y recibe la primera contraseña real.
      const updated = await deps.updateUser(existing.id, email, password);
      if (!updated.ok) throw new Error(updated.code === 'EMAIL_TAKEN' ? 'EMAIL_EXISTS' : 'SERVER_ERROR');
    } else {
      // Una cuenta con correo propio puede tener una contraseña que alguien ya eligió: no se reemplaza; se vincula si la conoce.
      await proveOwnership(deps, existing.email ?? email, password);
      if ((existing.email ?? '').toLowerCase() !== email) {
        const aligned = await deps.updateUser(existing.id, email); // solo el correo que Staff corrigió, jamás la contraseña
        if (!aligned.ok) throw new Error(aligned.code === 'EMAIL_TAKEN' ? 'EMAIL_EXISTS' : 'SERVER_ERROR');
      }
    }
    await linkIdentity(deps, participant.id, existing.id, false);
    return existing.id;
  }
  const created = await deps.createUser(email, password);
  if (created.id) {
    await linkIdentity(deps, participant.id, created.id, true);
    return created.id;
  }
  // El correo ya tiene cuenta: puede ser de otra persona o la que dejó un intento anterior de esta (incluso si se perdió la respuesta).
  if (created.code === 'EMAIL_TAKEN') return adoptInterruptedIdentity(deps, participant, email, password);
  throw new Error('SERVER_ERROR');
}

async function identify(deps: Deps, body: Record<string, unknown>) {
  const email = normalizeEmail(body.email);
  if (!email) return fail('INVALID_EMAIL');
  const state = await deps.rpc('participant_access_state_internal', { p_email: email });
  if (state.error) {
    const temp = upstreamTemporary(state.error as { status?: number; message?: string });
    if (temp) throw temp;
    return fail(rpcErrorCode(state.error));
  }
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
    const temp = asTemporary(error);
    if (temp) throw temp;
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
  let participant: ParticipantRow;
  let fresh = true;
  const created = await deps.rpc('register_self_service_internal', { p: fields });
  if (created.error) {
    const temp = upstreamTemporary(created.error as { status?: number; message?: string });
    if (temp) throw temp;
    const code = rpcErrorCode(created.error);
    if (code !== 'EMAIL_EXISTS') return fail(code);
    // Reintento de un registro que SÍ llegó a crear al participante (se perdió la respuesta o la cuenta quedó a medias): se continúa
    // donde se quedó, con los datos y el consentimiento que ya se guardaron, sin duplicar nada. Solo aplica a un autorregistro que aún
    // no tiene contraseña; un prerregistro o una cuenta ya configurada siguen siendo «correo ya registrado».
    const existing = await deps.participantByEmail(email);
    if (!existing || existing.origin !== 'self_service' || existing.password_configured_at) return fail('EMAIL_EXISTS');
    participant = existing;
    fresh = false;
  } else if (typeof created.data !== 'string') {
    return fail('SERVER_ERROR');
  } else {
    participant = { id: created.data, auth_user_id: null, password_configured_at: null };
  }
  try {
    await establishIdentity(deps, participant, email, body.password);
  } catch (error) {
    // Un límite o una caída temporal NO descarta el registro: queda guardado y el reintento lo completa. Solo un fallo definitivo de un
    // registro recién creado se compensa (sin cuenta no debe quedar un autorregistro a medias); si la limpieza falla, el correo aparecerá
    // como «prerregistro sin contraseña» y la persona podrá terminar de configurarla.
    const temp = asTemporary(error);
    if (temp) throw temp;
    if (fresh) {
      await deps.rpc('discard_self_service_registration_internal', { p_participant: participant.id })
        .catch(() => deps.log('rollback_discard_failed'));
    }
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
  } catch (error) {
    const temp = asTemporary(error);
    if (temp) {
      deps.log('temporary_failure', String(temp.status));
      return temporary(temp);
    }
    deps.log('unexpected_failure');
    return fail('SERVER_ERROR');
  }
}
