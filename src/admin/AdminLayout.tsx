import { History, KeyRound, LayoutDashboard, LogOut, Medal, Menu, Palette, Power, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Badge, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useTheme } from '../theme/ThemeProvider';
import AdminLogin from './AdminLogin';

const NAV = [
  { to: '/coordinacion', label: 'Resumen', icon: LayoutDashboard, end: true },
  { to: '/coordinacion/operacion', label: 'Operación y datos de prueba', icon: Power },
  { to: '/coordinacion/tematica', label: 'Edición y temática', icon: Palette },
  { to: '/coordinacion/rangos', label: 'Reglas de rangos', icon: Medal },
  { to: '/coordinacion/auditoria', label: 'Auditoría', icon: History },
  { to: '/coordinacion/cuenta', label: 'Mi cuenta', icon: KeyRound },
];

export default function AdminLayout() {
  const { ready, staff, profile, signOut } = useAuth();
  const { theme, edition, loading } = useTheme();
  const [open, setOpen] = useState(false);

  if (!ready || loading) return <Spinner />;
  if (!staff || staff.role !== 'coordinacion' || profile) return <AdminLogin />;

  const real = edition?.mode === 'operacion_real';

  const nav = (
    <nav className="space-y-1">
      {NAV.map(({ to, label, icon: Icon, end }) => (
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
    </nav>
  );

  return (
    <div className="min-h-dvh lg:flex">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 border-r border-line bg-surface p-4 transition-transform lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {theme.assets.logoMark && <img src={theme.assets.logoMark} alt="" className="h-8 w-8 object-contain" />}
            <div>
              <p className="font-display text-sm font-extrabold">{edition?.name ?? theme.meta.eventName}</p>
              <p className="text-xs text-ink-muted">Coordinación</p>
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
          <span className="text-sm font-semibold">Coordinación</span>
        </header>
        <main className="mx-auto max-w-5xl p-4 sm:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
