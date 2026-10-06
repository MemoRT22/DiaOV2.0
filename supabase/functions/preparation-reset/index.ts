import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { handleRequest, type Deps } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const admin = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

const deps: Deps = {
  authorize: async (token) => {
    if (!admin) throw new Error('CONFIG');
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return { kind: 'unauthorized' };
    const { data: staff, error: staffError } = await admin.from('staff_members')
      .select('is_active, staff_roles(role)').eq('user_id', data.user.id).maybeSingle();
    if (staffError) throw staffError;
    if (!staff?.is_active || !((staff.staff_roles ?? []) as { role: string }[]).some((r) => r.role === 'coordinacion')) {
      return { kind: 'forbidden' };
    }
    const { data: edition, error: editionError } = await admin.from('editions')
      .select('id, mode').eq('is_active', true).maybeSingle();
    if (editionError) throw editionError;
    if (!edition) throw new Error('NO_ACTIVE_EDITION');
    return { kind: 'ok', userId: data.user.id, editionId: edition.id, mode: edition.mode };
  },
  rpc: async (name, args) => {
    if (!admin) throw new Error('CONFIG');
    const { data, error } = await admin.rpc(name, args);
    return { data, error: error ? { code: error.code, message: error.message } : null };
  },
  pending: async (editionId) => {
    if (!admin) throw new Error('CONFIG');
    const { data, error } = await admin.from('preparation_auth_cleanup').select('auth_user_id')
      .eq('edition_id', editionId).in('status', ['pending', 'failed']).order('updated_at').limit(50);
    if (error) throw error;
    return data ?? [];
  },
  deleteUser: async (id) => {
    if (!admin) throw new Error('CONFIG');
    const { error } = await admin.auth.admin.deleteUser(id);
    return { ok: !error || error.status === 404, code: error?.code ?? (error ? 'AUTH_ERROR' : undefined) };
  },
  log: (event, code) => console.error(`[preparation-reset] ${event}`, code ?? ''),
};

Deno.serve((req: Request) => handleRequest(req, deps));
