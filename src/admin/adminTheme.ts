import { paletteCssVars } from '../theme/themeEngine';
import type { ColorKey } from '../theme/types';

/**
 * Fixed visual system of the back office. It is intentionally independent from the configurable public theme:
 * neutral canvas, light surfaces, Anáhuac orange as identity, blue for information/actions and full semantic
 * colours (success / warning / error) for states, alerts and charts.
 */
export const ADMIN_COLORS: Record<ColorKey, string> = {
  primary: '#D95A1A',
  secondary: '#385D73',
  accent: '#4C7563',
  success: '#16A34A',
  warning: '#D97706',
  error: '#DC2626',
  neutral: '#6B7280',
  background: '#F7F8FA',
  surface: '#FFFFFF',
  surfaceRaised: '#F3F5F7',
  ink: '#1F2933',
  inkMuted: '#5B6570',
  line: '#E2E7EB',
};

export const ADMIN_LOGO = '/assets/images/Logo_A.png';
export const ADMIN_PRODUCT_NAME = 'Día OV';

export function adminCssVars(): Record<string, string> {
  return {
    ...paletteCssVars(ADMIN_COLORS, 700),
    '--font-display': "'Inter', system-ui, sans-serif",
    '--font-body': "'Inter', system-ui, sans-serif",
    '--radius': '8px',
  };
}
