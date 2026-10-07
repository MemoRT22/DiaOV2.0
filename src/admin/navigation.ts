import {
  ClipboardList, GraduationCap, LayoutDashboard, MonitorDot, Palette,
  Settings2, Ticket, Users, UsersRound, type LucideIcon,
} from 'lucide-react';

/**
 * The administrative product is five areas. Everything else is either a section inside one of them or a
 * system rule: no module exists just because an RPC or a table exists.
 */
export type AdminNavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Extra path prefixes that keep the item highlighted (areas that span several routes). */
  match?: string[];
};

export const COORD_NAV: AdminNavItem[] = [
  { to: '/coordinacion', label: 'Inicio', icon: LayoutDashboard, end: true },
  { to: '/coordinacion/participantes', label: 'Participantes', icon: Users },
  { to: '/coordinacion/talleres', label: 'Talleres', icon: ClipboardList },
  {
    to: '/coordinacion/operacion-en-vivo', label: 'Operación', icon: MonitorDot,
    match: ['/coordinacion/checkin', '/coordinacion/sorteo-admin'],
  },
  { to: '/coordinacion/configuracion', label: 'Configuración', icon: Settings2 },
];

export const STAFF_NAV: AdminNavItem[] = [
  { to: '/coordinacion/participantes', label: 'Participantes', icon: Users },
  { to: '/coordinacion/operacion-en-vivo', label: 'Operación', icon: MonitorDot, match: ['/coordinacion/checkin'] },
];

export const SORTEO_NAV: AdminNavItem[] = [
  { to: '/coordinacion/sorteo', label: 'Sorteo final', icon: Ticket, end: true },
];

const within = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

export function isNavActive(item: AdminNavItem, pathname: string) {
  if (item.end) return pathname === item.to;
  return [item.to, ...(item.match ?? [])].some((base) => within(pathname, base));
}

export type AreaTab = { to: string; label: string; coordOnly?: boolean; isActive: (pathname: string) => boolean };

export const OPERATION_TABS: AreaTab[] = [
  { to: '/coordinacion/operacion-en-vivo', label: 'Centro de Operación', isActive: (p) => within(p, '/coordinacion/operacion-en-vivo') },
  { to: '/coordinacion/checkin', label: 'Check-in', isActive: (p) => within(p, '/coordinacion/checkin') },
  { to: '/coordinacion/sorteo-admin', label: 'Sorteo final', coordOnly: true, isActive: (p) => within(p, '/coordinacion/sorteo-admin') },
];

export type SettingsSection = { to: string; label: string; description: string; icon: LucideIcon; group: string };

export const SETTINGS_BASE = '/coordinacion/configuracion';

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { to: `${SETTINGS_BASE}/personal`, label: 'Personal', icon: UsersRound, group: 'Administración',
    description: 'Cuentas y roles del equipo.' },
  { to: `${SETTINGS_BASE}/experiencia-publica`, label: 'Experiencia del alumno', icon: Palette, group: 'Experiencia',
    description: 'Identidad visual y contenido que ven los aspirantes.' },
  { to: `${SETTINGS_BASE}/catalogo`, label: 'Catálogos académicos', icon: GraduationCap, group: 'Datos maestros',
    description: 'Divisiones, carreras y preparatorias.' },
];

export const SETTINGS_TABS: AreaTab[] = SETTINGS_SECTIONS.map(({ to, label }) => ({
  to, label, isActive: (p) => within(p, to),
}));
