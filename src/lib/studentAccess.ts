import { functionsUrl, supabaseAnonKey } from './supabase';

/** Lo único que la pantalla pública llega a saber de un correo: qué paso sigue. Nunca datos personales. */
export type AccessState = 'password_login' | 'password_setup' | 'self_registration';
export type CatalogHighSchool = { id: string; name: string };
export type AccessCatalog = { careers: CatalogCareer[]; high_schools: CatalogHighSchool[] };
export type CatalogCareer = { id: string; name: string; division: string | null };

export type SelfRegistration = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone: string;
  high_school_id: string;
  high_school_grade: string;
  entry_period: string;
  initial_career_id: string;
  consent_accepted: boolean;
};

async function call<T>(body: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${functionsUrl}/student-access`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supabaseAnonKey}`, apikey: supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('NETWORK');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result !== 'object') {
    throw new Error(typeof result?.error === 'string' ? result.error : 'SERVER_ERROR');
  }
  return result as T;
}

export const studentAccess = {
  async identify(email: string): Promise<AccessState> {
    const { state } = await call<{ state: AccessState }>({ action: 'identify', email: email.trim().toLowerCase() });
    if (state !== 'password_login' && state !== 'password_setup' && state !== 'self_registration') throw new Error('SERVER_ERROR');
    return state;
  },
  async catalog(): Promise<AccessCatalog> {
    const result = await call<AccessCatalog>({ action: 'catalog' });
    return { careers: Array.isArray(result.careers) ? result.careers : [], high_schools: Array.isArray(result.high_schools) ? result.high_schools : [] };
  },
  /** Prerregistro sin contraseña: la crea en Supabase Auth. Después el navegador inicia sesión con ella. */
  async setupPassword(email: string, password: string): Promise<void> {
    await call({ action: 'setup_password', email: email.trim().toLowerCase(), password });
  },
  /** Autorregistro: crea participante, perfil, interés inicial, consentimiento y cuenta en una sola operación del servidor. */
  async register(data: SelfRegistration): Promise<void> {
    await call({ action: 'register', ...data, email: data.email.trim().toLowerCase() });
  },
};
