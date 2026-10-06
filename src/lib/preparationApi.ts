import { functionsUrl, supabase, supabaseAnonKey } from './supabase';

export type PreparationCounts = {
  participants: number; proposals: number; activities: number; sessions: number;
  reservations: number; attendances: number; interests: number; imports: number;
  raffle_results: number; temporary_catalog: number; temporary_staff: number; auth_identities: number;
};
export type PreparationPreview = {
  edition_id: string; mode: 'preparacion' | 'operacion_real'; counts: PreparationCounts;
  last_reset_at: string | null; auth_cleanup_pending: number;
  theme_ready: boolean; temporary_records_remaining: number;
};
export type AuthCleanup = { deleted: number; failed: number; pending: number | null };

async function call<T>(action: string, fields: Record<string, unknown> = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('NOT_AUTHORIZED');
  let response: Response;
  try {
    response = await fetch(`${functionsUrl}/preparation-reset`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...fields }),
    });
  } catch { throw new Error('NETWORK'); }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result !== 'object') {
    throw new Error(typeof result?.error === 'string' ? result.error : 'SERVER_ERROR');
  }
  return result as T;
}

export const preparationApi = {
  preview: () => call<PreparationPreview>('preview'),
  reset: (phrase: string) => call<{ reset: { reset_at: string; counts: PreparationCounts }; auth_cleanup: AuthCleanup }>('reset', { phrase }),
  retryAuthCleanup: () => call<{ auth_cleanup: AuthCleanup }>('retry_auth_cleanup'),
};
