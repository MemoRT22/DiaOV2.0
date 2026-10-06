import {
  CalendarClock, ClipboardList, GraduationCap, History, LayoutDashboard, MonitorDot, Palette, Power,
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

export const WORKSHOP_TABS: AreaTab[] = [
  {
    to: '/coordinacion/talleres', label: 'Propuestas',
    isActive: (p) => within(p, '/coordinacion/talleres') && !within(p, '/coordinacion/talleres/programa'),
  },
  { to: '/coordinacion/talleres/programa', label: 'Programa', isActive: (p) => within(p, '/coordinacion/talleres/programa') },
];

export type SettingsSection = { to: string; label: string; description: string; icon: LucideIcon; group: string };

export const SETTINGS_BASE = '/coordinacion/configuracion';

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { to: `${SETTINGS_BASE}/personal`, label: 'Personal', icon: UsersRound, group: 'Equipo',
    description: 'Cuentas y roles de Coordinación, staff y sorteo.' },
  { to: `${SETTINGS_BASE}/experiencia-publica`, label: 'Experiencia pública', icon: Palette, group: 'Experiencia del alumno',
    description: 'Temática y branding que ven los aspirantes. No cambia la apariencia de este panel.' },
  { to: `${SETTINGS_BASE}/reservaciones`, label: 'Reservaciones', icon: CalendarClock, group: 'Experiencia del alumno',
    description: 'Cuándo abren y cierran las reservaciones.' },
  { to: `${SETTINGS_BASE}/preparacion`, label: 'Preparación y puesta en marcha', icon: Power, group: 'Evento',
    description: 'Reinicia el ambiente de ensayo y activa la operación real.' },
  { to: `${SETTINGS_BASE}/catalogo`, label: 'Carreras y divisiones', icon: GraduationCap, group: 'Evento',
    description: 'Catálogo académico oficial. Cambia pocas veces.' },
  { to: `${SETTINGS_BASE}/auditoria`, label: 'Auditoría', icon: History, group: 'Avanzado',
    description: 'Consulta las acciones registradas por el sistema.' },
];

export const SETTINGS_TABS: AreaTab[] = SETTINGS_SECTIONS.map(({ to, label }) => ({
  to, label, isActive: (p) => within(p, to),
}));

