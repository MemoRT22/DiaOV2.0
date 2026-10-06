import { functionsUrl, supabase, supabaseAnonKey } from './supabase';

export type PasswordReset = { ok: true; generated: true; password: string } | { ok: true; generated: false };

/**
 * Restablecer la contraseña de un participante. La contraseña viaja solo en esta respuesta (cuando se genera en el
 * servidor): el sistema no la guarda ni la audita, y esta capa tampoco la conserva ni la escribe en ningún registro.
 */
export async function resetParticipantPassword(participantId: string, password?: string): Promise<PasswordReset> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('NOT_AUTHORIZED');
  let response: Response;
  try {
    response = await fetch(`${functionsUrl}/participant-admin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset_password', participant_id: participantId, ...(password ? { password } : {}) }),
    });
  } catch {
    throw new Error('NETWORK');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result !== 'object' || result.ok !== true) {
    throw new Error(typeof result?.error === 'string' ? result.error : 'SERVER_ERROR');
  }
  if (result.generated === true && typeof result.password === 'string') return { ok: true, generated: true, password: result.password };
  return { ok: true, generated: false };
}
