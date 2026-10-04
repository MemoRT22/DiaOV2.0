import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { neutralTheme } from './neutralTheme';
import { fillTemplate, normalizeTheme, themeCssVars } from './themeEngine';
import type { TextKey, ThemeConfig, VocabularyKey } from './types';

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
  max_reservations: number;
  travel_buffer_minutes: number;
};

type ThemeContextValue = {
  theme: ThemeConfig;
  edition: Edition | null;
  loading: boolean;
  reloadEdition: () => Promise<void>;
  term: (key: VocabularyKey, plural?: boolean) => string;
  text: (key: TextKey, values?: Record<string, string | number>) => string;
  rankName: (level: number) => string;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const CACHE_KEY = 'diaov.theme.v1';

function readCache(): ThemeConfig | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? normalizeTheme(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function buildHelpers(theme: ThemeConfig) {
  const term = (key: VocabularyKey, plural = false) => (plural ? theme.vocabulary[key].many : theme.vocabulary[key].one);
  const text = (key: TextKey, values: Record<string, string | number> = {}) =>
    fillTemplate(theme.texts[key], { guide: theme.meta.guideName, event: theme.meta.eventName, ...values });
  const rankName = (level: number) => theme.ranks[Math.min(Math.max(level, 1), 5) - 1].name;
  return { term, text, rankName };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeConfig>(() => readCache() ?? neutralTheme);
  const [edition, setEdition] = useState<Edition | null>(null);
  const [loading, setLoading] = useState(true);

  const reloadEdition = useCallback(async () => {
    try {
      const { data: ed, error } = await supabase.from('editions').select('*').eq('is_active', true).maybeSingle();
      if (error) throw error;
      setEdition(ed as Edition | null);
      if (!ed) return;
      const { data: tv, error: tvError } = await supabase
        .from('theme_versions')
        .select('config')
        .eq('edition_id', ed.id)
        .eq('status', 'published')
        .maybeSingle();
      if (tvError) throw tvError;
      if (tv?.config) {
        const next = normalizeTheme(tv.config);
        setTheme(next);
        localStorage.setItem(CACHE_KEY, JSON.stringify(tv.config));
      }
    } catch (cause) {
      console.error('theme load failed', cause);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reloadEdition();
  }, [reloadEdition]);

  useEffect(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(themeCssVars(theme))) root.style.setProperty(k, v);
    root.dataset.background = theme.style.background;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colors.background);
    document.title = `${theme.meta.eventName} · ${theme.meta.organizer}`;
  }, [theme]);

  const value = useMemo(
    () => ({ theme, edition, loading, reloadEdition, ...buildHelpers(theme) }),
    [theme, edition, loading, reloadEdition],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function ThemeScope({ theme, children, className }: { theme: ThemeConfig; children: ReactNode; className?: string }) {
  const parent = useTheme();
  const value = useMemo(() => ({ ...parent, theme, ...buildHelpers(theme) }), [parent, theme]);
  const style = useMemo(() => themeCssVars(theme) as CSSProperties, [theme]);
  return (
    <ThemeContext.Provider value={value}>
      <div style={style} data-background={theme.style.background} className={className}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
