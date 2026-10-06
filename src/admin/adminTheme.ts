import { paletteCssVars } from '../theme/themeEngine';
import type { ColorKey } from '../theme/types';

/**
 * Fixed visual system of the back office. It is intentionally independent from the configurable public theme:
 * neutral canvas, light surfaces, Anáhuac orange as identity, blue for information/actions and full semantic
 * colours (success / warning / error) for states, alerts and charts.
 */
export const ADMIN_COLORS: Record<ColorKey, string> = {
  primary: '#F25C05',
  secondary: '#5B6B86',
  accent: '#4D7C68',
  success: '#16A34A',
  warning: '#D97706',
  error: '#DC2626',
  neutral: '#78716C',
  background: '#F6F5F2',
  surface: '#FFFFFF',
  surfaceRaised: '#FAF9F7',
  ink: '#1C1917',
  inkMuted: '#5C564F',
  line: '#E7E4DE',
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
