// Restablecer la contraseña de un participante (Staff o Coordinación). Se ejecuta solo en el servidor con service_role:
// verifica el rol del llamante, genera o recibe la contraseña, la aplica en Supabase Auth y deja una auditoría mínima
// (quién, a quién, cuándo). La contraseña NO se guarda, NO se audita y NO se registra; solo se devuelve al operador
// cuando fue generada aquí. No envía correos, códigos ni enlaces.
//
// Eliminar un participante (solo Coordinación): primero se retira su identidad de Supabase Auth —únicamente si es una
// identidad de participante; jamás una cuenta de Staff o Coordinación— y después la base elimina al participante con
// todo lo suyo en una transacción. Si algo falla a medias, repetir la operación la termina: nunca queda una cuenta de
// acceso sin participante. Si Auth no puede decir si la cuenta existe, no se elimina nada.
export type AuthResult = { kind: 'ok'; userId: string; coordinator?: boolean } | { kind: 'unauthorized' | 'forbidden' };
export type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
export type ParticipantRow = { id: string; email: string; auth_user_id: string | null };
export type AuthUserInfo = { id: string; email: string | null; kind: string | null };
export type Deps = {
  authorize: (token: string) => Promise<AuthResult>;
  participant: (id: string) => Promise<ParticipantRow | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  /**
   * Resolves `null` ONLY when Auth confirms the identity does not exist. When Auth cannot answer (network, permissions,
   * timeout, any other error) it must THROW: «no answer» is never read as «no account».
   */
  getUser: (id: string) => Promise<AuthUserInfo | null>;
  /** Búsqueda por correo, solo para reclamar la cuenta que dejó a medias un intento de registro del mismo participante. Lanza si Auth no responde. */
  findUserByEmail: (email: string) => Promise<AuthUserInfo | null>;
  /** El participante (de cualquier edición) que ya usa esa cuenta de Auth. */
  participantByAuthUser: (authUserId: string) => Promise<{ id: string } | null>;
  createUser: (email: string, password: string) => Promise<{ id?: string; code?: 'EMAIL_TAKEN' | 'AUTH_ERROR' }>;
  updateUser: (id: string, email: string, password: string) => Promise<{ ok: boolean; code?: 'EMAIL_TAKEN' | 'AUTH_ERROR' }>;
  deleteUser: (id: string) => Promise<void>;
  randomBytes: (length: number) => Uint8Array;
  log: (event: string, code?: string) => void;
};

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const fail = (code: string, status: number) => json({ error: code }, status);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYNTHETIC = /^p\.[0-9a-f-]{36}@participantes\.diaov\.invalid$/i;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;
// Sin caracteres que se confunden al dictarlos (0/O, 1/l/I).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const GENERATED_LENGTH = 10;

const validPassword = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= PASSWORD_MIN && new TextEncoder().encode(value).length <= PASSWORD_MAX;

export function generatePassword(randomBytes: (length: number) => Uint8Array): string {
  // Muestreo por rechazo: sin sesgo hacia los primeros caracteres del alfabeto.
  const limit = 256 - (256 % ALPHABET.length);
  let out = '';
  while (out.length < GENERATED_LENGTH) {
    for (const byte of randomBytes(GENERATED_LENGTH * 2)) {
      if (byte < limit && out.length < GENERATED_LENGTH) out += ALPHABET[byte % ALPHABET.length];
    }
  }
  return out;
}

/** What Auth answered when asked for an identity. Only a confirmed «not found» counts as a missing account. */
export type AuthLookup = 'found' | 'missing' | 'inconclusive';
export function classifyAuthLookup(user: unknown, error: { status?: number; code?: string } | null | undefined): AuthLookup {
  if (error) return error.status === 404 || error.code === 'user_not_found' ? 'missing' : 'inconclusive';
  return user ? 'found' : 'inconclusive';
}

const isParticipantIdentity = (user: AuthUserInfo) => user.kind === 'participant' || SYNTHETIC.test(user.email ?? '');

async function applyPassword(deps: Deps, participant: ParticipantRow, password: string): Promise<'ok' | 'EMAIL_EXISTS' | 'SERVER_ERROR'> {
  let existing: AuthUserInfo | null = null;
  if (participant.auth_user_id) {
    try {
      existing = await deps.getUser(participant.auth_user_id);
    } catch {
      // Auth no respondió: no se sabe si la cuenta existe, así que no se crea otra ni se cambia nada.
      deps.log('auth_lookup_failed');
      return 'SERVER_ERROR';
    }
  }
  // Jamás se cambia la contraseña de una cuenta que no sea de participante (p. ej. Staff vinculada por error).
  if (existing && !isParticipantIdentity(existing)) {
    deps.log('identity_not_participant');
    return 'SERVER_ERROR';
  }
  if (existing) {
    const updated = await deps.updateUser(existing.id, participant.email, password);
    if (!updated.ok) return updated.code === 'EMAIL_TAKEN' ? 'EMAIL_EXISTS' : 'SERVER_ERROR';
    const linked = await deps.rpc('participant_link_auth_internal', { p_participant: participant.id, p_auth_user: existing.id });
    return linked.error ? 'SERVER_ERROR' : 'ok';
  }
  // Sin cuenta todavía: restablecer también sirve para configurarla.
  const created = await deps.createUser(participant.email, password);
  if (!created.id) return created.code === 'EMAIL_TAKEN' ? claimInterruptedAccount(deps, participant, password) : 'SERVER_ERROR';
  const linked = await deps.rpc('participant_link_auth_internal', { p_participant: participant.id, p_auth_user: created.id });
  if (linked.error) {
    await deps.deleteUser(created.id).catch(() => deps.log('rollback_delete_failed'));
    return 'SERVER_ERROR';
  }
  return 'ok';
}

/**
 * El correo ya tiene cuenta en Auth. Aquí quien actúa es personal autenticado y auditado que verificó la identidad de la persona (es la
 * ruta segura cuando el alumno no recuerda la contraseña de su primer intento), así que puede reclamar la cuenta que dejó a medias su
 * propio registro: solo si es de participante, tiene ese correo y NINGÚN otro participante la usa. Staff, Coordinación y cuentas de
 * otro alumno jamás se tocan.
 */
async function claimInterruptedAccount(deps: Deps, participant: ParticipantRow, password: string): Promise<'ok' | 'EMAIL_EXISTS' | 'SERVER_ERROR'> {
  let user: AuthUserInfo | null;
  let owner: { id: string } | null;
  try {
    user = await deps.findUserByEmail(participant.email);
    owner = user ? await deps.participantByAuthUser(user.id) : null;
  } catch {
    deps.log('auth_lookup_failed');
    return 'SERVER_ERROR';
  }
  if (!user || user.kind !== 'participant' || (user.email ?? '').toLowerCase() !== participant.email.toLowerCase() || (owner && owner.id !== participant.id)) {
    return 'EMAIL_EXISTS';
  }
  const updated = await deps.updateUser(user.id, participant.email, password);
  if (!updated.ok) return updated.code === 'EMAIL_TAKEN' ? 'EMAIL_EXISTS' : 'SERVER_ERROR';
  // La cuenta ya existía: si el vínculo falla NO se borra; repetir la operación la termina.
  const linked = await deps.rpc('participant_link_auth_internal', { p_participant: participant.id, p_auth_user: user.id });
  return linked.error ? 'SERVER_ERROR' : 'ok';
}

type DeletePlan = { participant_id?: string; auth_user_id?: string | null; linked_non_participant_account?: boolean };

const rpcStatus = (message: string): [string, number] =>
  message.includes('NOT_FOUND') ? ['NOT_FOUND', 404] : message.includes('NOT_AUTHORIZED') ? ['NOT_AUTHORIZED', 403] : ['SERVER_ERROR', 500];

async function deleteParticipant(deps: Deps, actor: string, participantId: string): Promise<Response> {
  const plan = await deps.rpc('participant_delete_plan_internal', { p_actor: actor, p_participant: participantId });
  if (plan.error) return fail(...rpcStatus(plan.error.message));
  const { auth_user_id: authUserId, linked_non_participant_account: foreignAccount } = (plan.data ?? {}) as DeletePlan;

  let account: 'none' | 'deleted' | 'kept_not_participant' = foreignAccount ? 'kept_not_participant' : 'none';
  if (typeof authUserId === 'string' && UUID.test(authUserId)) {
    let identity: AuthUserInfo | null;
    try {
      identity = await deps.getUser(authUserId);
    } catch {
      // Auth no pudo responder (red, permisos, tiempo de espera…). No se sabe si la cuenta existe: no se elimina
      // nada, ni la cuenta ni el participante, y la operación puede repetirse.
      deps.log('auth_lookup_failed');
      return fail('AUTH_UNAVAILABLE', 502);
    }
    // `null` aquí significa que Auth CONFIRMÓ que la identidad ya no existe (p. ej. una eliminación anterior que se
    // quedó a medias): no hay cuenta que retirar y el participante puede eliminarse.
    if (identity && !isParticipantIdentity(identity)) {
      // La base ya lo descarta; segunda barrera con lo que dice Auth. La cuenta se conserva y solo se desvincula.
      deps.log('identity_not_participant');
      account = 'kept_not_participant';
    } else if (identity) {
      try {
        await deps.deleteUser(identity.id);
      } catch {
        // Nada se eliminó todavía: el participante sigue completo y la operación puede repetirse.
        deps.log('auth_delete_failed');
        return fail('AUTH_DELETE_FAILED', 502);
      }
      account = 'deleted';
    }
  }

  const removed = await deps.rpc('participant_delete_internal', { p_actor: actor, p_participant: participantId });
  if (removed.error) {
    deps.log('participant_delete_failed', removed.error.code);
    return fail(...rpcStatus(removed.error.message));
  }
  return json({ ok: true, account, removed: (removed.data as { removed?: unknown } | null)?.removed ?? {} });
}

export async function handleRequest(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return fail('NOT_AUTHORIZED', 401);
  try {
    const caller = await deps.authorize(token);
    if (caller.kind !== 'ok') return fail('NOT_AUTHORIZED', caller.kind === 'forbidden' ? 403 : 401);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || (body.action !== 'reset_password' && body.action !== 'delete')) return fail('INVALID_ACTION', 400);
    if (typeof body.participant_id !== 'string' || !UUID.test(body.participant_id)) return fail('INVALID_INPUT', 400);
    if (body.action === 'delete') {
      // Staff puede restablecer contraseñas, pero eliminar es exclusivo de Coordinación.
      if (!caller.coordinator) return fail('NOT_AUTHORIZED', 403);
      return await deleteParticipant(deps, caller.userId, body.participant_id);
    }
    const manual = body.password !== undefined && body.password !== null && body.password !== '';
    if (manual && !validPassword(body.password)) return fail('INVALID_PASSWORD', 400);

    const participant = await deps.participant(body.participant_id);
    if (!participant) return fail('NOT_FOUND', 404);

    // La auditoría va primero y falla cerrado: no se cambia ninguna contraseña sin dejar rastro de quién lo hizo.
    const audit = await deps.rpc('participant_password_audit_internal', { p_actor: caller.userId, p_participant: participant.id });
    if (audit.error) {
      deps.log('audit_failed');
      return fail('SERVER_ERROR', 500);
    }
    const password = manual ? (body.password as string) : generatePassword(deps.randomBytes);
    const outcome = await applyPassword(deps, participant, password);
    if (outcome === 'EMAIL_EXISTS') return fail('EMAIL_EXISTS', 409);
    if (outcome !== 'ok') return fail('SERVER_ERROR', 500);
    return json(manual ? { ok: true, generated: false } : { ok: true, generated: true, password });
  } catch {
    deps.log('unexpected_failure');
    return fail('SERVER_ERROR', 500);
  }
}
