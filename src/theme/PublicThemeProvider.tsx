import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type CSSProperties, type ReactNode,
} from 'react';
import { Outlet } from 'react-router-dom';
import { useEdition } from '../edition/EditionProvider';
import { supabase } from '../lib/supabase';
import { neutralTheme } from './neutralTheme';
import { paintAdminSurface, paintPublicTheme, readCachedTheme, THEME_CACHE_KEY } from './surface';
import { fillTemplate, normalizeTheme, themeCssVars } from './themeEngine';
import type { TextKey, ThemeConfig, VocabularyKey } from './types';

/**
 * The configurable Día OV theme belongs to the public experience (student portal and public forms).
 * Providing it never touches the document: only `PublicSurface` paints it, and the admin never mounts that.
 */
type PublicThemeContextValue = {
  theme: ThemeConfig;
  loading: boolean;
  reloadTheme: () => Promise<void>;
  term: (key: VocabularyKey, plural?: boolean) => string;
  text: (key: TextKey, values?: Record<string, string | number>) => string;
  rankName: (level: number) => string;
};

const PublicThemeContext = createContext<PublicThemeContextValue | null>(null);

function buildHelpers(theme: ThemeConfig) {
  const term = (key: VocabularyKey, plural = false) => (plural ? theme.vocabulary[key].many : theme.vocabulary[key].one);
  const text = (key: TextKey, values: Record<string, string | number> = {}) =>
    fillTemplate(theme.texts[key], { guide: theme.meta.guideName, event: theme.meta.eventName, ...values });
  const rankName = (level: number) => theme.ranks[Math.min(Math.max(level, 1), 5) - 1].name;
  return { term, text, rankName };
}

export function PublicThemeProvider({ children }: { children: ReactNode }) {
  const { edition, loading: editionLoading } = useEdition();
  const [theme, setTheme] = useState<ThemeConfig>(() => {
    const cached = readCachedTheme();
    return cached ? normalizeTheme(cached) : neutralTheme;
  });
  const [themeLoading, setThemeLoading] = useState(true);
  const editionId = edition?.id ?? null;

  const reloadTheme = useCallback(async () => {
    if (!editionId) return;
    try {
      const { data, error } = await supabase
        .from('theme_versions')
        .select('config')
        .eq('edition_id', editionId)
        .eq('status', 'published')
        .maybeSingle();
      if (error) throw error;
      if (data?.config) {
        setTheme(normalizeTheme(data.config));
        try {
          localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(data.config));
        } catch {
          /* a full or blocked storage only disables the cache */
        }
      }
    } catch (cause) {
      console.error('theme load failed', cause);
    } finally {
      setThemeLoading(false);
    }
  }, [editionId]);

  useEffect(() => {
    if (editionLoading) return;
    if (!editionId) {
      setThemeLoading(false);
      return;
    }
    reloadTheme();
  }, [editionLoading, editionId, reloadTheme]);

  const value = useMemo(
    () => ({ theme, loading: editionLoading || themeLoading, reloadTheme, ...buildHelpers(theme) }),
    [theme, editionLoading, themeLoading, reloadTheme],
  );
  return <PublicThemeContext.Provider value={value}>{children}</PublicThemeContext.Provider>;
}

/** Layout route of the public experience: paints the published theme on the document while it is mounted. */
export function PublicSurface() {
  const { theme } = usePublicTheme();
  useLayoutEffect(() => {
    paintPublicTheme(theme);
  }, [theme]);
  useLayoutEffect(() => paintAdminSurface, []);
  return <Outlet />;
}

/** Scoped rendering of another theme (e.g. the draft preview inside Configuración) without touching the document. */
export function PublicThemeScope({ theme, children, className }: { theme: ThemeConfig; children: ReactNode; className?: string }) {
  const parent = usePublicTheme();
  const value = useMemo(() => ({ ...parent, theme, ...buildHelpers(theme) }), [parent, theme]);
  const style = useMemo(() => themeCssVars(theme) as CSSProperties, [theme]);
  return (
    <PublicThemeContext.Provider value={value}>
      <div style={style} data-background={theme.style.background} className={className}>
        {children}
      </div>
    </PublicThemeContext.Provider>
  );
}

export function usePublicTheme() {
  const ctx = useContext(PublicThemeContext);
  if (!ctx) throw new Error('usePublicTheme must be used inside PublicThemeProvider');
  return ctx;
}
