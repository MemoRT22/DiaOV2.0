import { paletteCssVars } from '../theme/themeEngine';
import type { ColorKey } from '../theme/types';

/**
 * Fixed visual system of the back office. It is intentionally independent from the configurable public theme:
 * neutral canvas, light surfaces, Anáhuac orange as identity, blue for information/actions and full semantic
 * colours (success / warning / error) for states, alerts and charts.
 */
export const ADMIN_COLORS: Record<ColorKey, string> = {
  primary: '#FF5900',
  secondary: '#2F5FE3',
  accent: '#0D9488',
  success: '#16A34A',
  warning: '#D97706',
  error: '#DC2626',
  neutral: '#64748B',
  background: '#F4F6FB',
  surface: '#FFFFFF',
  surfaceRaised: '#F8FAFD',
  ink: '#0F172A',
  inkMuted: '#52607A',
  line: '#E4E8F0',
};

export const ADMIN_LOGO = '/assets/images/Logo_A.png';
export const ADMIN_PRODUCT_NAME = 'Día OV';

export function adminCssVars(): Record<string, string> {
  return {
    ...paletteCssVars(ADMIN_COLORS, 700),
    '--font-display': "'Plus Jakarta Sans', 'Montserrat', system-ui, sans-serif",
    '--font-body': "'Inter', system-ui, sans-serif",
    '--radius': '10px',
  };
}
