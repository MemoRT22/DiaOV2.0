// Edge Function pública `workshop-intake` (verify_jwt = false): ÚNICA frontera pública para propuestas de talleres.
//   GET  -> catálogo mínimo para construir el formulario.
//   POST -> valida y guarda una propuesta (status siempre 'submitted').
// Las credenciales server-side (SUPABASE_SERVICE_ROLE_KEY) existen solo en este runtime: nunca se devuelven,
// nunca se registran y nunca llegan al navegador. La función solo invoca dos primitivas SQL internas.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { handleRequest, type Deps } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const admin = url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

const deps: Deps = {
  rpc: async (fn, args) => {
    if (!admin) return { data: null, error: { code: 'CONFIG', message: 'server not configured' } };
    const { data, error } = await admin.rpc(fn, args);
    return { data, error: error ? { code: error.code, message: error.message } : null };
  },
  log: (event, info) => console.error(`[workshop-intake] ${event}`, info ?? {}),
  // antiAbuse: aquí se conectará CAPTCHA / verificación humana cuando se decida (ver Deps.antiAbuse).
};

Deno.serve((req: Request) => handleRequest(req, deps));
