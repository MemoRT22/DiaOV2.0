import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';

/** Operational data of the active edition. It has nothing to do with the public theme. */
export type Edition = {
  id: string;
  code: string;
  name: string;
  event_date: string;
  start_time: string;
  venue: string;
  mode: 'preparacion' | 'operacion_real';
  real_operation_at: string | null;
  theme_unlock_until: string | null;
  interests_prompt_min_attendances: number;
  interests_prompt_at: string | null;
  interests_close_at: string | null;
  privacy_notice_version: string;
  privacy_notice_summary: string;
  privacy_notice_url: string | null;
  roster_status: 'preparacion' | 'oficial';
  roster_declared_at: string | null;
  reservations_open_at: string | null;
  reservations_close_at: string | null;
  /** System-managed reservation rules: Coordinación only controls when reservations open and close. */
  max_reservations: number;
  travel_buffer_minutes: number;
  checkin_open_before_minutes: number;
  checkin_close_after_minutes: number;
};

type EditionContextValue = {
  edition: Edition | null;
  loading: boolean;
  reloadEdition: () => Promise<void>;
};

const EditionContext = createContext<EditionContextValue | null>(null);

export function EditionProvider({ children }: { children: ReactNode }) {
  const [edition, setEdition] = useState<Edition | null>(null);
  const [loading, setLoading] = useState(true);

  const reloadEdition = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('editions').select('*').eq('is_active', true).maybeSingle();
      if (error) throw error;
      setEdition(data as Edition | null);
    } catch (cause) {
      console.error('edition load failed', cause);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reloadEdition();
  }, [reloadEdition]);

  const value = useMemo(() => ({ edition, loading, reloadEdition }), [edition, loading, reloadEdition]);
  return <EditionContext.Provider value={value}>{children}</EditionContext.Provider>;
}

export function useEdition() {
  const ctx = useContext(EditionContext);
  if (!ctx) throw new Error('useEdition must be used inside EditionProvider');
  return ctx;
}
