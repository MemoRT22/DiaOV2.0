import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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

type AuthContextValue = {
  session: Session | null;
  ready: boolean;
  profile: ParticipantProfile | null;
  staff: StaffMember | null;
  refreshIdentity: () => Promise<void>;
  signInParticipant: (email: string, password: string) => Promise<void>;
  signInStaff: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ParticipantProfile | null>(null);
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [ready, setReady] = useState(false);

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
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        setReady(false);
        (async () => {
          await loadIdentity(s);
        })();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadIdentity]);

  const refreshIdentity = useCallback(() => loadIdentity(session), [loadIdentity, session]);

  const signInParticipant = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error || !data.user) throw new Error('INVALID_CREDENTIALS');
    // Esta pantalla es solo para participantes: una cuenta de Staff no entra por aquí.
    if (data.user.app_metadata?.kind !== 'participant') {
      await supabase.auth.signOut();
      throw new Error('INVALID_CREDENTIALS');
    }
  }, []);

  const signInStaff = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw new Error('INVALID_STAFF_CREDENTIALS');
  }, []);

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
