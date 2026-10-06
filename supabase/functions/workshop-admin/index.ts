import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { handleRequest, type Deps } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const admin = url && serviceKey ? createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
}) : null;

const deps: Deps = {
  authorize: async (token) => {
    if (!admin) throw new Error('CONFIG');
    const { data: caller, error: userError } = await admin.auth.getUser(token);
    if (userError || !caller.user) return { kind: 'unauthorized' };
    const { data: staff, error: staffError } = await admin.from('staff_members')
      .select('is_active, staff_roles(role)').eq('user_id', caller.user.id).maybeSingle();
    if (staffError) throw staffError;
    const roles = (staff?.staff_roles ?? []) as { role: string }[];
    if (!staff?.is_active || !roles.some((r) => r.role === 'coordinacion')) return { kind: 'forbidden' };
    return { kind: 'ok', userId: caller.user.id };
  },
  rpc: async (name, args) => {
    if (!admin) throw new Error('CONFIG');
    const { data, error } = await admin.rpc(name, args);
    return { data, error: error ? { code: error.code, message: error.message } : null };
  },
  log: (event, code) => console.error(`[workshop-admin] ${event}`, code ?? ''),
};

Deno.serve((req: Request) => handleRequest(req, deps));
