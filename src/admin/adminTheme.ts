import { paletteCssVars } from '../theme/themeEngine';
import type { ColorKey } from '../theme/types';

/**
 * Fixed visual system of the back office. It is intentionally independent from the configurable public theme:
 * neutral canvas, light surfaces, Anáhuac orange as identity, blue for information/actions and full semantic
 * colours (success / warning / error) for states, alerts and charts.
 */
export const ADMIN_COLORS: Record<ColorKey, string> = {
  primary: '#FF5900',
  secondary: '#1D6FD8',
  accent: '#0E9384',
  success: '#16A34A',
  warning: '#D97706',
  error: '#DC2626',
  neutral: '#64748B',
  background: '#F4F5F7',
  surface: '#FFFFFF',
  surfaceRaised: '#F8FAFC',
  ink: '#111827',
  inkMuted: '#4B5563',
  line: '#E2E8F0',
};

export const ADMIN_LOGO = '/assets/images/Logo_A.png';
export const ADMIN_PRODUCT_NAME = 'Día OV';

export function adminCssVars(): Record<string, string> {
  return {
    ...paletteCssVars(ADMIN_COLORS, 700),
    '--font-display': "'Montserrat', system-ui, sans-serif",
    '--font-body': "'Inter', system-ui, sans-serif",
    '--radius': '10px',
  };
}
