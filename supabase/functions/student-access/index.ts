import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { handleRequest, type Deps } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const authOptions = { auth: { persistSession: false, autoRefreshToken: false } };
// service_role solo existe aquí, en el servidor. El navegador nunca la recibe.
const admin = url && serviceKey ? createClient(url, serviceKey, authOptions) : null;

const need = () => {
  if (!admin) throw new Error('CONFIG');
  return admin;
};
const emailTaken = (error: { code?: string; message: string }) =>
  error.code === 'email_exists' || /already (been )?registered|already exists/i.test(error.message);

const deps: Deps = {
  rpc: async (name, args) => {
    const { data, error } = await need().rpc(name, args);
    return { data, error: error ? { code: error.code, message: error.message } : null };
  },
  participantByEmail: async (email) => {
    const { data: edition, error: editionError } = await need().from('editions').select('id').eq('is_active', true).maybeSingle();
    if (editionError) throw editionError;
    if (!edition) return null;
    const { data, error } = await need().from('participants').select('id, auth_user_id, password_configured_at')
      .eq('edition_id', edition.id).eq('email', email).maybeSingle();
    if (error) throw error;
    return data;
  },
  careers: async () => {
    const { data, error } = await need().from('careers').select('id, name, divisions(name)')
      .eq('is_active', true).eq('is_demo', false).order('name');
    if (error) throw error;
    return (data ?? []).map((row: { id: string; name: string; divisions: { name: string } | { name: string }[] | null }) => ({
      id: row.id, name: row.name,
      division: (Array.isArray(row.divisions) ? row.divisions[0]?.name : row.divisions?.name) ?? null,
    }));
  },
  highSchools: async () => {
    const { data, error } = await need().from('high_schools').select('id, name').eq('is_active', true).order('name');
    if (error) throw error;
    return data ?? [];
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
      email, ...(password ? { password } : {}), email_confirm: true, app_metadata: { kind: 'participant' },
    });
    if (!error) return { ok: true };
    return { ok: false, code: emailTaken(error) ? 'EMAIL_TAKEN' : 'AUTH_ERROR' };
  },
  deleteUser: async (id) => {
    await need().auth.admin.deleteUser(id);
  },
  // Solo códigos de evento: nunca correo, contraseña ni datos personales.
  log: (event, code) => console.error(`[student-access] ${event}`, code ?? ''),
};

Deno.serve((req: Request) => handleRequest(req, deps));
