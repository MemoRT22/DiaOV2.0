import { rpc } from './adminApi';
import { functionsUrl, supabase, supabaseAnonKey } from './supabase';

export type PasswordReset = { ok: true; generated: true; password: string } | { ok: true; generated: false };

/**
 * Restablecer la contraseña de un participante. La contraseña viaja solo en esta respuesta (cuando se genera en el
 * servidor): el sistema no la guarda ni la audita, y esta capa tampoco la conserva ni la escribe en ningún registro.
 */
async function call(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('NOT_AUTHORIZED');
  let response: Response;
  try {
    response = await fetch(`${functionsUrl}/participant-admin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('NETWORK');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result !== 'object' || result.ok !== true) {
    throw new Error(typeof result?.error === 'string' ? result.error : 'SERVER_ERROR');
  }
  return result as Record<string, unknown>;
}

export async function resetParticipantPassword(participantId: string, password?: string): Promise<PasswordReset> {
  const result = await call({ action: 'reset_password', participant_id: participantId, ...(password ? { password } : {}) });
  if (result.generated === true && typeof result.password === 'string') return { ok: true, generated: true, password: result.password };
  return { ok: true, generated: false };
}

/** What goes away with a participant (server-side counts shown before confirming the deletion). */
export type ParticipantDeletePreview = {
  id: string; full_name: string; email: string; is_demo: boolean;
  reservations: number; attendances: number; stamps: number;
  initial_interests: number; post_event_interests: number; email_aliases: number; import_conflicts: number;
  raffle_records: number; raffle_confirmed: number;
  has_account: boolean;
  /** False when the linked account is not a participant identity (e.g. Staff): it is unlinked, never deleted. */
  account_will_be_deleted: boolean;
};

export const fetchParticipantDeletePreview = (participantId: string) =>
  rpc<ParticipantDeletePreview>('participant_delete_preview', { p_id: participantId });

export type ParticipantDeleted = { account: 'none' | 'deleted' | 'kept_not_participant' };

/** Permanently deletes a participant with everything of theirs, including their sign-in account (Coordinación only). */
export async function deleteParticipant(participantId: string): Promise<ParticipantDeleted> {
  const result = await call({ action: 'delete', participant_id: participantId });
  const account = result.account;
  return { account: account === 'deleted' || account === 'kept_not_participant' ? account : 'none' };
}

export type NewParticipant = {
  email: string; full_name: string; phone?: string; high_school_id?: string;
  high_school_grade?: string; entry_period?: string; initial_career_id?: string;
};

/** Manual sign-up by Coordinación. No consent is recorded: the participant accepts the privacy notice on first access. */
export const createParticipant = (values: NewParticipant) => rpc<string>('admin_create_participant', { p: values });
