import {
  BookOpen,
  ClipboardList,
  CalendarClock,
  FileSpreadsheet,
  GitMerge,
  History,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Medal,
  Menu,
  MonitorDot,
  Palette,
  Power,
  QrCode,
  Ticket,
  Upload,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Suspense, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Badge, Button, Spinner } from '../components/ui';
import { ROLE_LABELS } from '../lib/adminApi';
import { hasRole, useAuth } from '../lib/auth';
import { useTheme } from '../theme/ThemeProvider';
import AdminLogin from './AdminLogin';

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean; coordOnly?: boolean };

const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: 'Atención',
    items: [
      { to: '/coordinacion', label: 'Resumen', icon: LayoutDashboard, end: true, coordOnly: true },
      { to: '/coordinacion/participantes', label: 'Participantes', icon: Users },
      { to: '/coordinacion/acceso', label: 'Ayuda de acceso', icon: LifeBuoy },
      { to: '/coordinacion/checkin', label: 'Check-in', icon: QrCode },
      { to: '/coordinacion/operacion-en-vivo', label: 'Centro de Operación', icon: MonitorDot },
    ],
  },
  {
    title: 'Datos',
    items: [
      { to: '/coordinacion/importar', label: 'Padrón oficial', icon: Upload, coordOnly: true },
      { to: '/coordinacion/conflictos', label: 'Conflictos de importación', icon: GitMerge, coordOnly: true },
      { to: '/coordinacion/catalogo', label: 'Catálogo', icon: BookOpen, coordOnly: true },
      { to: '/coordinacion/talleres', label: 'Propuestas de talleres', icon: ClipboardList, coordOnly: true },
      { to: '/coordinacion/exportacion', label: 'Exportación', icon: FileSpreadsheet, coordOnly: true },
    ],
  },
  {
    title: 'Configuración',
    items: [
      { to: '/coordinacion/personal', label: 'Personal', icon: UsersRound, coordOnly: true },
      { to: '/coordinacion/tematica', label: 'Edición y temática', icon: Palette, coordOnly: true },
      { to: '/coordinacion/rangos', label: 'Reglas de rangos', icon: Medal, coordOnly: true },
      { to: '/coordinacion/reservaciones', label: 'Reservaciones', icon: CalendarClock, coordOnly: true },
      { to: '/coordinacion/sorteo-admin', label: 'Sorteo final', icon: Ticket, coordOnly: true },
      { to: '/coordinacion/operacion', label: 'Operación y datos de prueba', icon: Power, coordOnly: true },
      { to: '/coordinacion/auditoria', label: 'Auditoría', icon: History, coordOnly: true },
      { to: '/coordinacion/cuenta', label: 'Mi cuenta', icon: KeyRound },
    ],
  },
];

const SORTEO_NAV: NavItem[] = [
  { to: '/coordinacion/sorteo', label: 'Sorteo final', icon: Ticket, end: true },
  { to: '/coordinacion/cuenta', label: 'Mi cuenta', icon: KeyRound },
];

export default function AdminLayout() {
  const { ready, staff, profile, signOut } = useAuth();
  const { theme, edition, loading } = useTheme();
  const [open, setOpen] = useState(false);

  if (!ready || loading) return <Spinner />;
  if (!staff || profile) return <AdminLogin />;

  const coord = hasRole(staff, 'coordinacion');
  const isStaff = hasRole(staff, 'staff');
  const isSorteo = hasRole(staff, 'sorteo');
  const real = edition?.mode === 'operacion_real';
  const roleLabel = staff.roles.map((r) => ROLE_LABELS[r]).join(' · ');

  if (isSorteo && !coord && !isStaff) {
    const sections = [{ title: 'Sorteo', items: SORTEO_NAV }];
    return (
      <div className="min-h-dvh lg:flex">
        <aside className={`fixed inset-y-0 left-0 z-40 w-72 overflow-y-auto border-r border-line bg-surface p-4 transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="mb-6 flex items-center gap-2">
            {theme.assets.logoMark && <img src={theme.assets.logoMark} alt="" className="h-8 w-8 object-contain" />}
            <div><p className="font-display text-sm font-extrabold">{edition?.name ?? theme.meta.eventName}</p><p className="text-xs text-ink-muted">{roleLabel}</p></div>
          </div>
          <nav className="space-y-5">
            {sections.map((s) => (
              <div key={s.title} className="space-y-1">
                <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted/70">{s.title}</p>
                {s.items.map(({ to, label, icon: Icon, end }) => (
                  <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)} className={({ isActive }) => `flex items-center gap-3 rounded-theme px-3 py-2.5 text-sm font-semibold transition-colors ${isActive ? 'bg-primary-500/15 text-primary-300' : 'text-ink-muted hover:bg-surface-raised hover:text-ink'}`}>
                    <Icon className="h-4 w-4" aria-hidden />{label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <button onClick={signOut} className="mt-6 flex w-full items-center gap-3 rounded-theme px-3 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-raised hover:text-ink">
            <LogOut className="h-4 w-4" aria-hidden />Cerrar sesión
          </button>
        </aside>
        {open && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />}
        <div className="flex-1">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface-sunken/90 px-4 backdrop-blur lg:hidden">
            <button onClick={() => setOpen(true)} className="rounded-full p-2 text-ink" aria-label="Abrir menú"><Menu className="h-5 w-5" /></button>
            <span className="text-sm font-semibold">{roleLabel}</span>
          </header>
          <main className="mx-auto max-w-5xl p-4 sm:p-8"><Suspense fallback={<Spinner />}><Outlet /></Suspense></main>
        </div>
      </div>
    );
  }

  if (!coord && !isStaff) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="card max-w-md space-y-4 p-8 text-center">
          <h1 className="text-xl font-extrabold">Sin acceso</h1>
          <Button variant="secondary" onClick={signOut}>Cerrar sesión</Button>
        </div>
      </div>
    );
  }

  const sections = NAV.map((s) => ({ ...s, items: s.items.filter((i) => coord || !i.coordOnly) })).filter((s) => s.items.length);

  const nav = (
    <nav className="space-y-5">
      {sections.map((section) => (
        <div key={section.title} className="space-y-1">
          <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted/70">{section.title}</p>
          {section.items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-theme px-3 py-2.5 text-sm font-semibold transition-colors ${
              isActive ? 'bg-primary-500/15 text-primary-300' : 'text-ink-muted hover:bg-surface-raised hover:text-ink'
            }`
          }
        >
          <Icon className="h-4 w-4" aria-hidden />
          {label}
        </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh lg:flex">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 overflow-y-auto border-r border-line bg-surface p-4 transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {theme.assets.logoMark && <img src={theme.assets.logoMark} alt="" className="h-8 w-8 object-contain" />}
            <div>
              <p className="font-display text-sm font-extrabold">{edition?.name ?? theme.meta.eventName}</p>
              <p className="text-xs text-ink-muted">{roleLabel}</p>
            </div>
          </div>
          <button className="rounded-full p-1 text-ink-muted lg:hidden" onClick={() => setOpen(false)} aria-label="Cerrar menú">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mb-6">
          <Badge tone={real ? 'success' : 'warning'}>{real ? 'Operación real' : 'Preparación'}</Badge>
        </div>
        {nav}
        <button
          onClick={signOut}
          className="mt-6 flex w-full items-center gap-3 rounded-theme px-3 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-raised hover:text-ink"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Cerrar sesión
        </button>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex-1">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface-sunken/90 px-4 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-full p-2 text-ink" aria-label="Abrir menú">
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold">{roleLabel}</span>
        </header>
        <main className="mx-auto max-w-5xl p-4 sm:p-8">
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
