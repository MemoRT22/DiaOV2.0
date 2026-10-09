import { LogOut, Menu, X } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEdition } from '../edition/EditionProvider';
import { BootSpinner } from '../components/BootSpinner';
import RouteErrorBoundary from '../components/RouteErrorBoundary';
import { Button } from '../components/ui';
import { ROLE_LABELS } from '../lib/adminApi';
import { hasRole, useAuth } from '../lib/auth';
import AdminLogin from './AdminLogin';
import { ADMIN_LOGO, ADMIN_PRODUCT_NAME } from './adminTheme';
import { COORD_NAV, isNavActive, SORTEO_NAV, STAFF_NAV, type AdminNavItem } from './navigation';

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '·';

export default function AdminLayout() {
  const { ready, staff, profile, signOut } = useAuth();
  const { edition, loading } = useEdition();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  if (!ready || loading) return <BootSpinner restartTo="/coordinacion" />;
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

  const roleLabel = staff.roles.map((r) => ROLE_LABELS[r]).join(' · ');
  const items: AdminNavItem[] = coord ? COORD_NAV : isStaff ? STAFF_NAV : SORTEO_NAV;
  const navLabel = coord ? 'Navegación de Coordinación' : isStaff ? 'Navegación de staff' : 'Navegación de sorteo';
  const current = items.find((item) => isNavActive(item, pathname));
  const currentLabel = pathname.startsWith('/coordinacion/cuenta') ? 'Mi cuenta' : current?.label ?? 'Panel';
  const close = () => setOpen(false);

  return (
    <div className="admin-shell min-h-dvh lg:flex">
      <aside
        className={`admin-sidebar fixed inset-y-0 left-0 z-40 flex w-[15.5rem] flex-col overflow-y-auto border-r border-line px-4 py-6 transition-transform duration-200 lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-9 flex items-start justify-between gap-2 px-2">
          <div className="flex min-w-0 items-center gap-3">
            <span className="admin-brand-mark flex h-10 w-10 shrink-0 items-center justify-center rounded-lg p-1.5">
              <img src={ADMIN_LOGO} alt="" className="h-full w-full object-contain" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-tight text-ink">{ADMIN_PRODUCT_NAME}</p>
              <p className="mt-0.5 text-xs text-ink-muted">Administración</p>
            </div>
          </div>
          <button className="admin-icon-button lg:hidden" onClick={close} aria-label="Cerrar menú">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="admin-nav-heading px-3">Espacio de trabajo</p>
        <nav aria-label={navLabel} className="mt-3 flex-1 space-y-1">
          {items.map((item) => {
            const active = isNavActive(item, pathname);
            return (
              <NavLink key={item.to} to={item.to} end={item.end} onClick={close} data-active={active}
                aria-current={active ? 'page' : undefined} className="admin-nav-link">
                <span className="admin-nav-marker" aria-hidden />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="admin-sidebar-footer mt-6 border-t border-line pt-5">
          <p className="admin-nav-heading px-3">Edición actual</p>
          <p className="mt-2 truncate px-3 text-sm font-medium text-ink" title={edition?.name ?? ADMIN_PRODUCT_NAME}>
            {edition?.name ?? ADMIN_PRODUCT_NAME}
          </p>
          <NavLink to="/coordinacion/cuenta" onClick={close} data-active={pathname.startsWith('/coordinacion/cuenta')}
            className="admin-account-link mt-5 flex items-center gap-3" aria-label={`Mi cuenta · ${staff.full_name}`}>
            <span className="admin-avatar flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold" aria-hidden>
              {initials(staff.full_name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">{staff.full_name}</span>
              <span className="block truncate text-xs text-ink-muted">{roleLabel}</span>
            </span>
          </NavLink>
          <button onClick={signOut} className="admin-signout mt-2 flex w-full items-center gap-2 text-sm">
            <LogOut className="h-4 w-4" aria-hidden />
            Cerrar sesión
          </button>
        </div>
      </aside>
      {open && <button className="fixed inset-0 z-30 bg-ink/30 lg:hidden" onClick={close} aria-label="Cerrar menú" />}

      <div className="admin-workspace min-w-0 flex-1">
        <header className="admin-topbar sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line px-4 sm:px-8 lg:px-10">
          <button onClick={() => setOpen(true)} className="admin-icon-button lg:hidden" aria-label="Abrir menú">
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.13em] text-ink-muted">{coord ? 'Coordinación' : 'Personal'}</p>
            <p className="truncate text-sm font-semibold text-ink">{currentLabel}</p>
          </div>
          <span className="ml-auto hidden text-xs text-ink-muted sm:block">Panel del personal</span>
        </header>
        <main className={`admin-content mx-auto p-4 sm:p-7 lg:p-9 ${pathname.startsWith('/coordinacion/operacion-en-vivo') ? 'max-w-[90rem]' : 'max-w-[82rem]'}`}>
          <RouteErrorBoundary resetKey={pathname} home="/coordinacion">
            <Suspense fallback={<BootSpinner restartTo="/coordinacion" />}>
              <Outlet />
            </Suspense>
          </RouteErrorBoundary>
        </main>
      </div>
    </div>
  );
}
