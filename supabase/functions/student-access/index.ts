import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { handleRequest, upstreamTemporary, type Deps } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
const authOptions = { auth: { persistSession: false, autoRefreshToken: false } };
// service_role solo existe aquí, en el servidor. El navegador nunca la recibe.
const admin = url && serviceKey ? createClient(url, serviceKey, authOptions) : null;

const need = () => {
  if (!admin) throw new Error('CONFIG');
  return admin;
};
const emailTaken = (error: { code?: string; message: string }) =>
  error.code === 'email_exists' || /already (been )?registered|already exists/i.test(error.message);

/** Un límite (429) o una caída de un servicio de apoyo se lanza como error temporal: el navegador lo reintenta sin perder nada. */
const throwIfTemporary = (error: { status?: number; code?: string; name?: string; message?: string } | null | undefined) => {
  const temporary = error ? upstreamTemporary(error) : null;
  if (temporary) throw temporary;
};

const deps: Deps = {
  rpc: async (name, args) => {
    const { data, error, status } = await need().rpc(name, args);
    // Un 4xx de la base (validación de negocio) es definitivo; 429/5xx/sin respuesta es temporal.
    if (error) throwIfTemporary({ status, code: error.code, message: error.message });
    return { data, error: error ? { code: error.code, message: error.message } : null };
  },
  participantByEmail: async (email) => {
    const edition = await need().from('editions').select('id').eq('is_active', true).maybeSingle();
    if (edition.error) { throwIfTemporary({ status: edition.status, code: edition.error.code, message: edition.error.message }); throw edition.error; }
    if (!edition.data) return null;
    const found = await need().from('participants').select('id, auth_user_id, password_configured_at, origin')
      .eq('edition_id', edition.data.id).eq('email', email).maybeSingle();
    if (found.error) { throwIfTemporary({ status: found.status, code: found.error.code, message: found.error.message }); throw found.error; }
    return found.data;
  },
  participantByAuthUser: async (authUserId) => {
    const { data, error, status } = await need().from('participants').select('id').eq('auth_user_id', authUserId).limit(1).maybeSingle();
    if (error) { throwIfTemporary({ status, code: error.code, message: error.message }); throw error; }
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
    // «No existe» solo es un 404; un límite o una caída NO se confunde con eso (se crearía una identidad duplicada).
    if (error) {
      throwIfTemporary(error);
      if (error.status === 404 || error.code === 'user_not_found') return null;
      throw error;
    }
    if (!data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null, kind: (data.user.app_metadata?.kind as string | undefined) ?? null };
  },
  // Solo en la recuperación de un registro interrumpido (el correo ya tiene cuenta). Acotado a 5 páginas de 1,000 cuentas.
  findUserByEmail: async (email) => {
    for (let page = 1; page <= 5; page += 1) {
      const { data, error } = await need().auth.admin.listUsers({ page, perPage: 1000 });
      if (error) { throwIfTemporary(error); throw error; }
      const match = data.users.find((user) => (user.email ?? '').toLowerCase() === email);
      if (match) return { id: match.id, email: match.email ?? null, kind: (match.app_metadata?.kind as string | undefined) ?? null };
      if (data.users.length < 1000) return null;
    }
    return null;
  },
  createUser: async (email, password) => {
    const { data, error } = await need().auth.admin.createUser({
      email, password, email_confirm: true, app_metadata: { kind: 'participant' },
    });
    if (error) {
      throwIfTemporary(error); // 429 / 5xx / sin respuesta: la cuenta pudo o no crearse; el reintento la recupera, no se descarta nada
      return { code: emailTaken(error) ? 'EMAIL_TAKEN' : 'AUTH_ERROR' };
    }
    if (!data.user) return { code: 'AUTH_ERROR' };
    return { id: data.user.id };
  },
  updateUser: async (id, email, password) => {
    const { error } = await need().auth.admin.updateUserById(id, {
      email, ...(password ? { password } : {}), email_confirm: true, app_metadata: { kind: 'participant' },
    });
    if (!error) return { ok: true };
    throwIfTemporary(error);
    return { ok: false, code: emailTaken(error) ? 'EMAIL_TAKEN' : 'AUTH_ERROR' };
  },
  deleteUser: async (id) => {
    await need().auth.admin.deleteUser(id);
  },
  // Prueba de posesión de una cuenta que ya existía: un inicio de sesión desechable con la contraseña recibida. No modifica la cuenta
  // y la sesión se cierra enseguida (solo esa sesión; `local`, para no sacar al alumno de sus otros dispositivos).
  verifyPassword: async (email, password) => {
    if (!url || !anonKey) throw new Error('CONFIG');
    const probe = createClient(url, anonKey, authOptions);
    const { error } = await probe.auth.signInWithPassword({ email, password });
    if (error) {
      throwIfTemporary(error);
      if (error.status !== undefined && error.status >= 400 && error.status < 500) return 'invalid';
      throw error;
    }
    await probe.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return 'valid';
  },
  // Solo códigos de evento: nunca correo, contraseña ni datos personales.
  log: (event, code) => console.error(`[student-access] ${event}`, code ?? ''),
};

Deno.serve((req: Request) => handleRequest(req, deps));
