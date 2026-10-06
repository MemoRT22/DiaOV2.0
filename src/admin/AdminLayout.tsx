import { LogOut, Menu, UserRound, X } from 'lucide-react';
import { Suspense, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEdition } from '../edition/EditionProvider';
import { Badge, Button, Spinner } from '../components/ui';
import { ROLE_LABELS } from '../lib/adminApi';
import { hasRole, useAuth } from '../lib/auth';
import AdminLogin from './AdminLogin';
import { ADMIN_LOGO, ADMIN_PRODUCT_NAME } from './adminTheme';
import { COORD_NAV, isNavActive, SORTEO_NAV, STAFF_NAV, type AdminNavItem } from './navigation';

const navClass = (active: boolean) =>
  `flex min-h-11 items-center gap-3 rounded-theme px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-500 ${
    active ? 'bg-primary-500/10 text-fg-brand' : 'text-ink-muted hover:bg-surface-raised hover:text-ink'
  }`;

export default function AdminLayout() {
  const { ready, staff, profile, signOut } = useAuth();
  const { edition, loading } = useEdition();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  if (!ready || loading) return <Spinner />;
  if (!staff || profile) return <AdminLogin />;

  const coord = hasRole(staff, 'coordinacion');
  const isStaff = hasRole(staff, 'staff');
  const isSorteo = hasRole(staff, 'sorteo');
  if (!coord && !isStaff && !isSorteo) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="card max-w-md space-y-4 p-8 text-center">
          <h1 className="text-xl font-extrabold">Sin acceso</h1>
          <Button variant="secondary" onClick={signOut}>Cerrar sesión</Button>
        </div>
      </div>
    );
  }

  const real = edition?.mode === 'operacion_real';
  const roleLabel = staff.roles.map((r) => ROLE_LABELS[r]).join(' · ');
  const items: AdminNavItem[] = coord ? COORD_NAV : isStaff ? STAFF_NAV : SORTEO_NAV;
  const navLabel = coord ? 'Navegación de Coordinación' : isStaff ? 'Navegación de staff' : 'Navegación de sorteo';
  const close = () => setOpen(false);

  return (
    <div className="min-h-dvh lg:flex">
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col overflow-y-auto border-r border-line bg-surface p-4 transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <img src={ADMIN_LOGO} alt="" className="h-8 w-8 object-contain" />
            <div>
              <p className="font-display text-sm font-extrabold">{edition?.name ?? ADMIN_PRODUCT_NAME}</p>
              <p className="text-xs text-ink-muted">Panel del personal</p>
            </div>
          </div>
          <button className="rounded-full p-1 text-ink-muted lg:hidden" onClick={close} aria-label="Cerrar menú">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mb-5">
          <Badge tone={real ? 'success' : 'warning'}>{real ? 'Operación real' : 'Preparación'}</Badge>
        </div>

        <nav aria-label={navLabel} className="flex-1 space-y-1">
          {items.map((item) => {
            const { to, label, icon: Icon, end } = item;
            return (
              <NavLink key={to} to={to} end={end} onClick={close} className={() => navClass(isNavActive(item, pathname))}>
                <Icon className="h-5 w-5" aria-hidden />
                {label}
              </NavLink>
            );
          })}
        </nav>

        <div className="mt-6 space-y-1 border-t border-line pt-4">
          <NavLink to="/coordinacion/cuenta" onClick={close} className={({ isActive }) => navClass(isActive)} aria-label={`Mi cuenta · ${staff.full_name}`}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-500/15 text-ink-muted">
              <UserRound className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-ink">{staff.full_name}</span>
              <span className="block truncate text-xs font-normal text-ink-muted">{roleLabel}</span>
            </span>
          </NavLink>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-theme px-3 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-raised hover:text-ink"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Cerrar sesión
          </button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={close} />}

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface-sunken/90 px-4 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-full p-2 text-ink" aria-label="Abrir menú">
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold">{roleLabel}</span>
        </header>
        <main className={`mx-auto p-4 sm:p-8 ${pathname.startsWith('/coordinacion/operacion-en-vivo') ? 'max-w-7xl' : 'max-w-5xl'}`}>
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
