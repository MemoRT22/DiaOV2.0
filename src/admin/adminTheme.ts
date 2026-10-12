import { paletteCssVars } from '../theme/themeEngine';
import type { ColorKey } from '../theme/types';

/**
 * Fixed visual system of the back office. It is intentionally independent from the configurable public theme:
 * neutral canvas, light surfaces, Anáhuac orange as identity, blue for information/actions and full semantic
 * colours (success / warning / error) for states, alerts and charts.
 */
export const ADMIN_COLORS: Record<ColorKey, string> = {
  primary: '#BF4818',
  secondary: '#24536B',
  accent: '#23766B',
  success: '#15803D',
  warning: '#A65C09',
  error: '#B42318',
  neutral: '#64748B',
  background: '#F4F6FA',
  surface: '#FFFFFF',
  surfaceRaised: '#EEF2F7',
  ink: '#172238',
  inkMuted: '#526174',
  line: '#DCE3EC',
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
