import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { handleRequest, type Deps } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
// service_role solo existe aquí, en el servidor. El navegador nunca la recibe.
const admin = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

const need = () => {
  if (!admin) throw new Error('CONFIG');
  return admin;
};
const emailTaken = (error: { code?: string; message: string }) =>
  error.code === 'email_exists' || /already (been )?registered|already exists/i.test(error.message);

const deps: Deps = {
  authorize: async (token) => {
    const { data, error } = await need().auth.getUser(token);
    if (error || !data.user) return { kind: 'unauthorized' };
    const { data: staff, error: staffError } = await need().from('staff_members')
      .select('is_active, staff_roles(role)').eq('user_id', data.user.id).maybeSingle();
    if (staffError) throw staffError;
    const roles = ((staff?.staff_roles ?? []) as { role: string }[]).map((r) => r.role);
    if (!staff?.is_active || !roles.some((role) => role === 'coordinacion' || role === 'staff')) return { kind: 'forbidden' };
    return { kind: 'ok', userId: data.user.id };
  },
  participant: async (id) => {
    const { data: edition, error: editionError } = await need().from('editions').select('id').eq('is_active', true).maybeSingle();
    if (editionError) throw editionError;
    if (!edition) return null;
    const { data, error } = await need().from('participants').select('id, email, auth_user_id')
      .eq('id', id).eq('edition_id', edition.id).maybeSingle();
    if (error) throw error;
    return data;
  },
  rpc: async (name, args) => {
    const { data, error } = await need().rpc(name, args);
    return { data, error: error ? { code: error.code, message: error.message } : null };
  },
  getUser: async (id) => {
    const { data, error } = await need().auth.admin.getUserById(id);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null, kind: (data.user.app_metadata?.kind as string | undefined) ?? null };
  },
  createUser: async (email, password) => {
    const { data, error } = await need().auth.admin.createUser({
      email, password, email_confirm: true, app_metadata: { kind: 'participant' },
    });
    if (error || !data.user) return { code: error && emailTaken(error) ? 'EMAIL_TAKEN' : 'AUTH_ERROR' };
    return { id: data.user.id };
  },
  updateUser: async (id, email, password) => {
    const { error } = await need().auth.admin.updateUserById(id, {
      email, password, email_confirm: true, app_metadata: { kind: 'participant' },
    });
    if (!error) return { ok: true };
    return { ok: false, code: emailTaken(error) ? 'EMAIL_TAKEN' : 'AUTH_ERROR' };
  },
  deleteUser: async (id) => {
    await need().auth.admin.deleteUser(id);
  },
  randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  // Solo códigos de evento: nunca contraseñas ni datos personales.
  log: (event, code) => console.error(`[participant-admin] ${event}`, code ?? ''),
};

Deno.serve((req: Request) => handleRequest(req, deps));
