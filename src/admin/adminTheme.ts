import { paletteCssVars } from '../theme/themeEngine';
import type { ColorKey } from '../theme/types';

/**
 * Fixed visual system of the back office. It is intentionally independent from the configurable public theme:
 * neutral canvas, light surfaces, Anáhuac orange as identity, blue for information/actions and full semantic
 * colours (success / warning / error) for states, alerts and charts.
 */
export const ADMIN_COLORS: Record<ColorKey, string> = {
  primary: '#B94720',
  secondary: '#24536B',
  accent: '#23766B',
  success: '#15803D',
  warning: '#A65C09',
  error: '#B42318',
  neutral: '#687177',
  background: '#F5F5F3',
  surface: '#FFFFFF',
  surfaceRaised: '#F8F8F6',
  ink: '#252A2E',
  inkMuted: '#687177',
  line: '#E2E4E2',
};

export const ADMIN_LOGO = '/assets/images/Logo_A.png';
export const ADMIN_PRODUCT_NAME = 'Día OV';

export function adminCssVars(): Record<string, string> {
  return {
    ...paletteCssVars(ADMIN_COLORS, 700),
    '--font-display': "'Inter', system-ui, sans-serif",
    '--font-body': "'Inter', system-ui, sans-serif",
    '--radius': '10px',
  };
}
