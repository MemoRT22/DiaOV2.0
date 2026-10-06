import {
  BookOpen, CalendarClock, ClipboardList, FileSpreadsheet, GitMerge, History,
  KeyRound, LayoutDashboard, LifeBuoy, Medal, MonitorDot, Palette, Power,
  QrCode, Ticket, Upload, Users, UsersRound, type LucideIcon,
} from 'lucide-react';

export type AdminNavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  description?: string;
  end?: boolean;
};

export const COORD_PRIMARY: AdminNavItem[] = [
  { to: '/coordinacion', label: 'Inicio', icon: LayoutDashboard, end: true },
  { to: '/coordinacion/participantes', label: 'Participantes', icon: Users },
  { to: '/coordinacion/talleres', label: 'Talleres', icon: ClipboardList },
  { to: '/coordinacion/operacion-en-vivo', label: 'Operación del evento', icon: MonitorDot },
];

export const COORD_MORE: { title: string; description: string; items: AdminNavItem[] }[] = [
  {
    title: 'Participantes y datos',
    description: 'Acceso, padrón e información de aspirantes.',
    items: [
      { to: '/coordinacion/acceso', label: 'Ayuda de acceso', icon: LifeBuoy, description: 'Ayuda a un participante a entrar.' },
      { to: '/coordinacion/importar', label: 'Padrón oficial', icon: Upload, description: 'Carga y valida los registros de Forms.' },
      { to: '/coordinacion/conflictos', label: 'Conflictos de importación', icon: GitMerge, description: 'Decide qué dato conservar.' },
      { to: '/coordinacion/exportacion', label: 'Exportación', icon: FileSpreadsheet, description: 'Descarga los datos del evento.' },
    ],
  },
  {
    title: 'Talleres y evento',
    description: 'Configuración y herramientas para el Día OV.',
    items: [
      { to: '/coordinacion/catalogo', label: 'Catálogo', icon: BookOpen, description: 'Administra talleres, carreras y horarios.' },
      { to: '/coordinacion/checkin', label: 'Check-in', icon: QrCode, description: 'Registra asistencias en las sesiones.' },
      { to: '/coordinacion/reservaciones', label: 'Reservaciones', icon: CalendarClock, description: 'Define límites y horarios de reserva.' },
      { to: '/coordinacion/sorteo-admin', label: 'Sorteo final', icon: Ticket, description: 'Configura premios y realiza el sorteo.' },
    ],
  },
  {
    title: 'Configuración y control',
    description: 'Opciones de administración menos frecuentes.',
    items: [
      { to: '/coordinacion/personal', label: 'Personal', icon: UsersRound, description: 'Gestiona cuentas y roles del equipo.' },
      { to: '/coordinacion/tematica', label: 'Edición y temática', icon: Palette, description: 'Ajusta la presentación de la edición.' },
      { to: '/coordinacion/rangos', label: 'Reglas de rangos', icon: Medal, description: 'Configura el progreso de participantes.' },
      { to: '/coordinacion/operacion', label: 'Preparación y puesta en marcha', icon: Power, description: 'Prepara el ambiente y realiza el paso final a operación real.' },
      { to: '/coordinacion/auditoria', label: 'Auditoría', icon: History, description: 'Consulta acciones registradas.' },
      { to: '/coordinacion/cuenta', label: 'Mi cuenta', icon: KeyRound, description: 'Actualiza tu acceso personal.' },
    ],
  },
];

export const STAFF_NAV: AdminNavItem[] = [
  { to: '/coordinacion/participantes', label: 'Participantes', icon: Users },
  { to: '/coordinacion/acceso', label: 'Ayuda de acceso', icon: LifeBuoy },
  { to: '/coordinacion/checkin', label: 'Check-in', icon: QrCode },
  { to: '/coordinacion/operacion-en-vivo', label: 'Centro de Operación', icon: MonitorDot },
  { to: '/coordinacion/cuenta', label: 'Mi cuenta', icon: KeyRound },
];

export const SORTEO_NAV: AdminNavItem[] = [
  { to: '/coordinacion/sorteo', label: 'Sorteo final', icon: Ticket, end: true },
  { to: '/coordinacion/cuenta', label: 'Mi cuenta', icon: KeyRound },
];

export function isMorePath(pathname: string) {
  return pathname === '/coordinacion/mas' || COORD_MORE.some(({ items }) =>
    items.some(({ to }) => pathname === to || pathname.startsWith(`${to}/`)));
}
