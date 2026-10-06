import { adminCssVars, ADMIN_COLORS } from '../admin/adminTheme';
import { neutralTheme } from './neutralTheme';
import { contrastRatio, themeCssVars } from './themeEngine';
import type { ThemeConfig } from './types';

export const THEME_CACHE_KEY = 'diaov.theme.v1';
const BASE_TITLE = 'Día OV · Universidad Anáhuac Cancún';

type SurfaceMeta = { background: string; title: string; dataBackground?: string };

/**
 * The document hosts exactly one visual surface at a time: the public (student) theme or the fixed admin system.
 * Painting one replaces the other's variables, so nothing from the public theme can leak into the back office.
 */
let applied: string[] = [];

function paint(vars: Record<string, string>, meta: SurfaceMeta) {
  const root = document.documentElement;
  for (const key of applied) if (!(key in vars)) root.style.removeProperty(key);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  applied = Object.keys(vars);
  root.style.colorScheme = contrastRatio(meta.background, '#000000') < 4 ? 'dark' : 'light';
  if (meta.dataBackground) root.dataset.background = meta.dataBackground;
  else delete root.dataset.background;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', meta.background);
  document.title = meta.title;
}

export function paintPublicTheme(theme: ThemeConfig) {
  paint(themeCssVars(theme), {
    background: theme.colors.background,
    title: `${theme.meta.eventName} · ${theme.meta.organizer}`,
    dataBackground: theme.style.background,
  });
}

export function paintAdminSurface() {
  paint(adminCssVars(), { background: ADMIN_COLORS.background, title: 'Día OV · Coordinación' });
}

export function readCachedTheme(): unknown {
  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** First paint before React mounts: the right surface for the URL, using the cached public theme when there is one. */
export function bootSurface(pathname: string, normalize: (input: unknown) => ThemeConfig) {
  if (pathname.startsWith('/coordinacion')) {
    paintAdminSurface();
    return;
  }
  const cached = readCachedTheme();
  paintPublicTheme(cached ? normalize(cached) : neutralTheme);
  if (!cached) document.title = BASE_TITLE;
}
