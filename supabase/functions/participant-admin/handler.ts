// Restablecer la contraseña de un participante (Staff o Coordinación). Se ejecuta solo en el servidor con service_role:
// verifica el rol del llamante, genera o recibe la contraseña, la aplica en Supabase Auth y deja una auditoría mínima
// (quién, a quién, cuándo). La contraseña NO se guarda, NO se audita y NO se registra; solo se devuelve al operador
// cuando fue generada aquí. No envía correos, códigos ni enlaces.
export type AuthResult = { kind: 'ok'; userId: string } | { kind: 'unauthorized' | 'forbidden' };
export type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
export type ParticipantRow = { id: string; email: string; auth_user_id: string | null };
export type AuthUserInfo = { id: string; email: string | null; kind: string | null };
export type Deps = {
  authorize: (token: string) => Promise<AuthResult>;
  participant: (id: string) => Promise<ParticipantRow | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  getUser: (id: string) => Promise<AuthUserInfo | null>;
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

const isParticipantIdentity = (user: AuthUserInfo) => user.kind === 'participant' || SYNTHETIC.test(user.email ?? '');

async function applyPassword(deps: Deps, participant: ParticipantRow, password: string): Promise<'ok' | 'EMAIL_EXISTS' | 'SERVER_ERROR'> {
  const existing = participant.auth_user_id ? await deps.getUser(participant.auth_user_id) : null;
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
  if (!created.id) return created.code === 'EMAIL_TAKEN' ? 'EMAIL_EXISTS' : 'SERVER_ERROR';
  const linked = await deps.rpc('participant_link_auth_internal', { p_participant: participant.id, p_auth_user: created.id });
  if (linked.error) {
    await deps.deleteUser(created.id).catch(() => deps.log('rollback_delete_failed'));
    return 'SERVER_ERROR';
  }
  return 'ok';
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
    if (!body || typeof body !== 'object' || body.action !== 'reset_password') return fail('INVALID_ACTION', 400);
    if (typeof body.participant_id !== 'string' || !UUID.test(body.participant_id)) return fail('INVALID_INPUT', 400);
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
