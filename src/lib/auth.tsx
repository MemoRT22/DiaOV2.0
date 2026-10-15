import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessError, classifyAuthError } from './accessErrors';
import { invalidateBoard } from './boardCache';
import { friendlyError } from './errors';
import { authStorageKey, clearLocalSession } from './localSession';
import { retryTransient, RetryAborted } from './retry';
import { supabase, supabaseUrl } from './supabase';

/** The only way out of the app after a local sign-out: a seam so tests can observe it (`window.location` cannot be redefined in jsdom). */
export const navigation = { restart: () => window.location.assign('/') };

export type ParticipantProfile = {
  participant_id: string;
  display_name: string;
  high_school: string | null;
  platform_consent_at: string | null;
  platform_consent_version: string | null;
};

export type StaffRole = 'coordinacion' | 'staff' | 'sorteo';
export type StaffMember = { user_id: string; full_name: string; roles: StaffRole[] };

const IDENTITY_ATTEMPTS = 3;
const IDENTITY_CACHE_PREFIX = 'diaov-identity:';
type CachedIdentity = { profile: ParticipantProfile | null; staff: StaffMember | null };

/** Display data of the account already verified on this device (never credentials): lets the app open and survive a failing server. */
function readIdentityCache(userId: string): CachedIdentity | null {
  try {
    const raw = window.localStorage.getItem(IDENTITY_CACHE_PREFIX + userId);
    const parsed = raw ? (JSON.parse(raw) as CachedIdentity) : null;
    return parsed && (parsed.profile || parsed.staff) ? parsed : null;
  } catch {
    return null;
  }
}
function writeIdentityCache(userId: string, profile: ParticipantProfile | null, staff: StaffMember | null) {
  try {
    if (profile || staff) window.localStorage.setItem(IDENTITY_CACHE_PREFIX + userId, JSON.stringify({ profile, staff }));
    else window.localStorage.removeItem(IDENTITY_CACHE_PREFIX + userId);
  } catch { /* storage unavailable: just no cache */ }
}
function clearIdentityCache() {
  try {
    for (const key of Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i) ?? '')) {
      if (key.startsWith(IDENTITY_CACHE_PREFIX)) window.localStorage.removeItem(key);
    }
  } catch { /* nothing to clear */ }
}

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
  /** Why the session could not be closed on this device (shown next to the button), or `null`. */
  signOutError?: string | null;
  identityFailed?: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ParticipantProfile | null>(null);
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [ready, setReady] = useState(false);
  /** The account exists (there is a session) but its profile could not be loaded: show a retry, never the login screen. */
  const [identityFailed, setIdentityFailed] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  // The account whose identity is loaded. Supabase repeats SIGNED_IN for the SAME account when a tab regains focus or
  // another tab of the app loads; that is not a new sign-in and must not tear the whole back office down.
  const loadedUser = useRef<string | null>(null);

  const loadIdentity = useCallback(async (s: Session | null) => {
    if (!s) {
      clearIdentityCache();
      setProfile(null);
      setStaff(null);
      setIdentityFailed(false);
      setReady(true);
      return;
    }
    // A saturated or flaky network must NEVER look like «this person has no account»: that redirected students to the login screen
    // and made them type their password again. The identity last seen for THIS user is shown at once and re-verified in the background.
    const cached = readIdentityCache(s.user.id);
    if (cached) {
      setProfile((current) => current ?? cached.profile);
      setStaff((current) => current ?? cached.staff);
      setIdentityFailed(false);
      setReady(true);
    }
    let lastError: unknown = null;
    for (let attempt = 0; attempt < (cached ? 1 : IDENTITY_ATTEMPTS); attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => window.setTimeout(resolve, 600 * 2 ** (attempt - 1) + Math.random() * 400));
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
        const nextProfile = p.data as ParticipantProfile | null;
        const roles = ((st.data?.staff_roles as { role: StaffRole }[] | null) ?? []).map((r) => r.role);
        const nextStaff: StaffMember | null =
          st.data && st.data.is_active && roles.length ? { user_id: st.data.user_id, full_name: st.data.full_name, roles } : null;
        setProfile(nextProfile);
        setStaff(nextStaff);
        writeIdentityCache(s.user.id, nextProfile, nextStaff);
        setIdentityFailed(false);
        setReady(true);
        return;
      } catch (cause) {
        lastError = cause;
      }
    }
    // Could not verify. With an identity already known for this account, keep it (and try again later); without one, say so instead of
    // pretending the account does not exist.
    console.error('identity load failed', (lastError as { name?: string; code?: string } | null)?.name, (lastError as { code?: string } | null)?.code);
    if (!cached) {
      setProfile(null);
      setStaff(null);
      setIdentityFailed(true);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') invalidateBoard(); // never show another account's board
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
    setSignOutError(null);
    // The server logout can fail (no network, saturation, timeout) and then supabase-js keeps the session: the button would do nothing.
    // Leaving must work on THIS device, but only once it is PROVEN that the stored session is gone; otherwise the person is told.
    const result = await supabase.auth.signOut().catch((error: unknown) => ({ error }));
    if (!result?.error) return;
    supabase.auth.stopAutoRefresh?.(); // a refresh must not write the session back between clearing it and restarting
    if (!clearLocalSession(authStorageKey(supabaseUrl))) {
      setSignOutError(friendlyError(new Error('SIGN_OUT_FAILED')));
      return;
    }
    navigation.restart();
  }, []);

  const value = useMemo(
    () => ({ session, ready, profile, staff, refreshIdentity, signInParticipant, signInStaff, signOut, signOutError, identityFailed }),
    [session, ready, profile, staff, refreshIdentity, signInParticipant, signInStaff, signOut, signOutError, identityFailed],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
