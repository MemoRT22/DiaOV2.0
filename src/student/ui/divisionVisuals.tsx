import { Award, Briefcase, Flag, HeartPulse, Palette, Plane, Rocket, Scale, Cpu, type LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Division } from '../../lib/catalog';
import { hexToRgb } from '../../theme/themeEngine';
import type { ThemeConfig } from '../../theme/types';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** A recognisable symbol per division (by name), so two divisions never look alike. */
export function divisionIcon(name: string | undefined): LucideIcon {
  if (!name) return Rocket;
  const n = norm(name);
  if (/salud|medic|nutri/.test(n)) return HeartPulse;
  if (/ingenier|tecnolog|sistemas/.test(n)) return Cpu;
  if (/creativ|diseno|arte|comunic/.test(n)) return Palette;
  if (/negocio|empresa|financ/.test(n)) return Briefcase;
  if (/jurid|social|derecho|humanid/.test(n)) return Scale;
  if (/lider|deporte|vida universitaria/.test(n)) return Flag;
  if (/turism|hoteler|gastron/.test(n)) return Plane;
  return Award;
}

/** Division colour from the published theme (by code), falling back to the theme's secondary colour. */
export function divisionColor(theme: ThemeConfig, division: Pick<Division, 'code'> | null | undefined): string {
  return (division && theme.divisions[division.code]?.color) || theme.colors.secondary;
}

/** `--tint: r g b` so CSS can use the colour at any opacity (`rgb(var(--tint) / 0.2)`) without color-mix(). */
export const tintVars = (hex: string) => ({ '--tint': hexToRgb(hex).join(' ') }) as CSSProperties;

/** Icon inside a softly glowing orb tinted with the division colour. Purely decorative. */
export function DivisionOrb({
  name,
  color,
  size = 'md',
  className = '',
}: {
  name: string | undefined;
  color: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const Icon = divisionIcon(name);
  const box = size === 'lg' ? 'h-14 w-14 rounded-2xl' : size === 'sm' ? 'h-9 w-9 rounded-xl' : 'h-11 w-11 rounded-2xl';
  const icon = size === 'lg' ? 'h-7 w-7' : size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
  return (
    <span
      aria-hidden
      className={`division-orb relative flex shrink-0 items-center justify-center ${box} ${className}`}
      style={tintVars(color)}
    >
      <Icon className={icon} />
    </span>
  );
}
