import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessError, classifyAuthError } from './accessErrors';
import { retryTransient, RetryAborted } from './retry';
import { supabase } from './supabase';

export type ParticipantProfile = {
  participant_id: string;
  display_name: string;
  high_school: string | null;
  platform_consent_at: string | null;
  platform_consent_version: string | null;
};

export type StaffRole = 'coordinacion' | 'staff' | 'sorteo';
export type StaffMember = { user_id: string; full_name: string; roles: StaffRole[] };

export function hasRole(staff: StaffMember | null, ...roles: StaffRole[]) {
  return !!staff && roles.some((r) => staff.roles.includes(r));
}

/** `signal`: si la persona abandona la pantalla, los reintentos en segundo plano se cancelan. */
export type SignInOptions = { signal?: AbortSignal };

type AuthContextValue = {
  session: Session | null;
  ready: boolean;
  profile: ParticipantProfile | null;
  staff: StaffMember | null;
  refreshIdentity: () => Promise<void>;
  signInParticipant: (email: string, password: string, options?: SignInOptions) => Promise<void>;
  signInStaff: (email: string, password: string, options?: SignInOptions) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ParticipantProfile | null>(null);
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [ready, setReady] = useState(false);
  // The account whose identity is loaded. Supabase repeats SIGNED_IN for the SAME account when a tab regains focus or
  // another tab of the app loads; that is not a new sign-in and must not tear the whole back office down.
  const loadedUser = useRef<string | null>(null);

  const loadIdentity = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setStaff(null);
      setReady(true);
      return;
    }
    try {
      const [p, st] = await Promise.all([
        supabase
          .from('participant_profiles')
          .select('participant_id, display_name, high_school, platform_consent_at, platform_consent_version')
          .eq('auth_user_id', s.user.id)
          .maybeSingle(),
        supabase
          .from('staff_members')
          .select('user_id, full_name, is_active, staff_roles(role)')
          .eq('user_id', s.user.id)
          .maybeSingle(),
      ]);
      if (p.error) throw p.error;
      if (st.error) throw st.error;
      setProfile(p.data as ParticipantProfile | null);
      const roles = ((st.data?.staff_roles as { role: StaffRole }[] | null) ?? []).map((r) => r.role);
      setStaff(
        st.data && st.data.is_active && roles.length ? { user_id: st.data.user_id, full_name: st.data.full_name, roles } : null,
      );
    } catch (cause) {
      console.error('identity load failed', cause);
      setProfile(null);
      setStaff(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_IN' && s && loadedUser.current === s.user.id) return;
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        loadedUser.current = s?.user.id ?? null;
        setReady(false);
        (async () => {
          await loadIdentity(s);
        })();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadIdentity]);

  const refreshIdentity = useCallback(() => loadIdentity(session), [loadIdentity, session]);

  /**
   * Iniciar sesión no cambia datos, así que ante un límite (429), una caída pasajera, falta de red o un tiempo agotado se reintenta
   * sola un par de veces (espera progresiva con variación aleatoria). Solo una respuesta definitiva de «credenciales inválidas» se
   * informa como contraseña incorrecta: un 429 nunca se hace pasar por eso. Un fallo no cierra una sesión que ya existiera.
   */
  const passwordSignIn = useCallback(async (email: string, password: string, signal?: AbortSignal) => {
    let data: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>['data'];
    try {
      data = await retryTransient(async () => {
        const { data: result, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
        if (error) throw classifyAuthError(error as { status?: number; code?: string; name?: string; message?: string }) ?? error;
        return result;
      }, { signal });
    } catch (cause) {
      if (cause instanceof RetryAborted) throw new Error('ABORTED');
      return { user: null, failure: cause } as const;
    }
    // La petición ya en vuelo no se puede cancelar: si la persona abandonó la pantalla mientras tanto, la sesión que acaba de crearse
    // se cierra (solo esta, `local`) para que una operación abandonada no termine dejando una sesión establecida.
    if (signal?.aborted) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      throw new Error('ABORTED');
    }
    return data;
  }, []);

  const signInParticipant = useCallback(async (email: string, password: string, options: SignInOptions = {}) => {
    const outcome = await passwordSignIn(email, password, options.signal);
    if ('failure' in outcome) {
      if (outcome.failure instanceof AccessError) throw outcome.failure;
      throw new Error('INVALID_CREDENTIALS');
    }
    if (!outcome.user) throw new Error('INVALID_CREDENTIALS');
    // Esta pantalla es solo para participantes: una cuenta de Staff no entra por aquí.
    if (outcome.user.app_metadata?.kind !== 'participant') {
      await supabase.auth.signOut();
      throw new Error('INVALID_CREDENTIALS');
    }
  }, [passwordSignIn]);

  const signInStaff = useCallback(async (email: string, password: string, options: SignInOptions = {}) => {
    const outcome = await passwordSignIn(email, password, options.signal);
    if ('failure' in outcome) {
      if (outcome.failure instanceof AccessError) throw outcome.failure;
      throw new Error('INVALID_STAFF_CREDENTIALS');
    }
  }, [passwordSignIn]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({ session, ready, profile, staff, refreshIdentity, signInParticipant, signInStaff, signOut }),
    [session, ready, profile, staff, refreshIdentity, signInParticipant, signInStaff, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
