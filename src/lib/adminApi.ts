import { functionsUrl, supabase, supabaseAnonKey } from './supabase';

export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data as T;
}

export async function staffAccounts<T>(body: Record<string, unknown>): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('NOT_AUTHORIZED');
  let res: Response;
  try {
    res = await fetch(`${functionsUrl}/staff-accounts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('NETWORK');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || typeof json !== 'object') {
    throw new Error(typeof json?.error === 'string' ? json.error : 'SERVER_ERROR');
  }
  return json as T;
}

export const FIELD_LABELS: Record<string, string> = {
  email: 'Correo',
  full_name: 'Nombre completo',
  birth_date: 'Fecha de nacimiento',
  phone: 'Teléfono',
  high_school: 'Preparatoria',
  initial_career_id: 'Carrera de interés inicial',
};

export const ORIGIN_LABELS: Record<string, string> = { forms: 'Forms', manual: 'Alta manual', demo: 'Prueba' };

export const ROLE_LABELS: Record<string, string> = { coordinacion: 'Coordinación', staff: 'Staff', sorteo: 'Sorteo' };
