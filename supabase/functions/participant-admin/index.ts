import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { classifyAuthLookup, handleRequest, type Deps } from './handler.ts';
import { operationalFetch, temporaryOf, unwrap } from '../_shared/operations.ts';

const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
// service_role solo existe aquí, en el servidor. El navegador nunca la recibe.
const admin = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: operationalFetch } }) : null;

const need = () => {
  if (!admin) throw new Error('CONFIG');
  return admin;
};
const emailTaken = (error: { code?: string; message: string }) =>
  error.code === 'email_exists' || /already (been )?registered|already exists/i.test(error.message);

const deps: Deps = {
  authorize: async (token) => {
    const { data, error } = await need().auth.getUser(token);
    if (error && temporaryOf(error)) throw temporaryOf(error);
    if (error || !data.user) return { kind: 'unauthorized' };
    const staff = unwrap(await need().from('staff_members')
      .select('is_active, staff_roles(role)').eq('user_id', data.user.id).maybeSingle());
    const roles = ((staff?.staff_roles ?? []) as { role: string }[]).map((r) => r.role);
    if (!staff?.is_active || !roles.some((role) => role === 'coordinacion' || role === 'staff')) return { kind: 'forbidden' };
    return { kind: 'ok', userId: data.user.id, coordinator: roles.includes('coordinacion') };
  },
  participant: async (id) => {
    const edition = unwrap(await need().from('editions').select('id').eq('is_active', true).maybeSingle());
    if (!edition) return null;
    return unwrap(await need().from('participants').select('id, email, auth_user_id')
      .eq('id', id).eq('edition_id', edition.id).maybeSingle());
  },
  rpc: async (name, args) => {
    const result = await need().rpc(name, args);
    const temporary = result.error ? temporaryOf({ ...result.error, status: result.status }) : null;
    if (temporary) throw temporary;
    const { data, error } = result;
    return { data, error: error ? { code: error.code, message: error.message } : null };
  },
  getUser: async (id) => {
    const { data, error } = await need().auth.admin.getUserById(id);
    if (error && temporaryOf(error)) throw temporaryOf(error);
    // «No existe» solo cuando Auth lo confirma (404). Cualquier otro fallo es «no se sabe» y se propaga: quien
    // llama no debe tratarlo como una cuenta inexistente.
    const outcome = classifyAuthLookup(data?.user, error ? { status: error.status, code: error.code } : null);
    if (outcome === 'missing') return null;
    if (outcome !== 'found' || !data.user) throw error ?? new Error('AUTH_LOOKUP_FAILED');
    return { id: data.user.id, email: data.user.email ?? null, kind: (data.user.app_metadata?.kind as string | undefined) ?? null };
  },
  // Solo para reclamar la cuenta que dejó a medias el registro del propio participante (lo hace personal autenticado y auditado).
  findUserByEmail: async (email) => {
    for (let page = 1; page <= 5; page += 1) {
      const { data, error } = await need().auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      const match = data.users.find((user) => (user.email ?? '').toLowerCase() === email.toLowerCase());
      if (match) return { id: match.id, email: match.email ?? null, kind: (match.app_metadata?.kind as string | undefined) ?? null };
      if (data.users.length < 1000) return null;
    }
    return null;
  },
  participantByAuthUser: async (authUserId) => {
    return unwrap(await need().from('participants').select('id').eq('auth_user_id', authUserId).limit(1).maybeSingle());
  },
  createUser: async (email, password) => {
    const { data, error } = await need().auth.admin.createUser({
      email, password, email_confirm: true, app_metadata: { kind: 'participant' },
    });
    if (error && temporaryOf(error)) throw temporaryOf(error);
    if (error || !data.user) return { code: error && emailTaken(error) ? 'EMAIL_TAKEN' : 'AUTH_ERROR' };
    return { id: data.user.id };
  },
  updateUser: async (id, email, password) => {
    const { error } = await need().auth.admin.updateUserById(id, {
      email, password, email_confirm: true, app_metadata: { kind: 'participant' },
    });
    if (!error) return { ok: true };
    if (temporaryOf(error)) throw temporaryOf(error);
    return { ok: false, code: emailTaken(error) ? 'EMAIL_TAKEN' : 'AUTH_ERROR' };
  },
  deleteUser: async (id) => {
    const { error } = await need().auth.admin.deleteUser(id);
    if (error) throw temporaryOf(error) ?? error;
  },
  randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  // Solo códigos de evento: nunca contraseñas ni datos personales.
  log: (event, code) => console.error(`[participant-admin] ${event}`, code ?? ''),
};

Deno.serve((req: Request) => handleRequest(req, deps));
