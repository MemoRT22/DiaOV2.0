import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { handleRequest, type Deps } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
const authOptions = { auth: { persistSession: false, autoRefreshToken: false } };
// service_role solo existe aquí, en el servidor. El navegador nunca la recibe.
const admin = url && serviceKey ? createClient(url, serviceKey, authOptions) : null;
const anon = url && anonKey ? createClient(url, anonKey, authOptions) : null;

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
  legacy: {
    sha256: async (text) => {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    },
    isLocked: async (email) => {
      const { data, error } = await need().rpc('access_lock_state', { p_email: email });
      if (error) throw error;
      return Boolean(data?.locked);
    },
    activeEditionId: async () => {
      const { data, error } = await need().from('editions').select('id').eq('is_active', true).maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
    participant: async (editionId, email) => {
      const { data, error } = await need().from('participants')
        .select('id, birth_date, auth_user_id, password_configured_at').eq('edition_id', editionId).eq('email', email).maybeSingle();
      if (error) throw error;
      return data;
    },
    recordAttempt: async (emailHash, succeeded) => {
      await need().from('access_attempts').insert({ email_hash: emailHash, succeeded });
    },
    ensureIdentity: async (authEmail) => {
      const { error } = await need().auth.admin.createUser({ email: authEmail, email_confirm: true, app_metadata: { kind: 'participant' } });
      if (error && !/already/i.test(error.message)) throw error;
    },
    magicLink: async (authEmail) => {
      const { data, error } = await need().auth.admin.generateLink({ type: 'magiclink', email: authEmail });
      if (error || !data?.properties?.hashed_token || !data.user) throw error ?? new Error('link generation failed');
      return { hashedToken: data.properties.hashed_token, userId: data.user.id };
    },
    linkParticipant: async (participantId, userId) => {
      const { error } = await need().from('participants').update({ auth_user_id: userId }).eq('id', participantId);
      if (error) throw error;
    },
    verify: async (hashedToken) => {
      if (!anon) throw new Error('CONFIG');
      const { data, error } = await anon.auth.verifyOtp({ token_hash: hashedToken, type: 'email' });
      if (error || !data.session) throw error ?? new Error('no session');
      return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
    },
  },
  // Solo códigos de evento: nunca correo, contraseña ni datos personales.
  log: (event, code) => console.error(`[student-access] ${event}`, code ?? ''),
};

Deno.serve((req: Request) => handleRequest(req, deps));
