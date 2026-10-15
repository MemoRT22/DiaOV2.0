import { Activity, House, LogOut, Menu, Settings2, Shapes, TicketCheck, UsersRound, X, type LucideIcon } from 'lucide-react';
import { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEdition } from '../edition/EditionProvider';
import { BootSpinner } from '../components/BootSpinner';
import RouteErrorBoundary from '../components/RouteErrorBoundary';
import { Alert, Button } from '../components/ui';
import { ROLE_LABELS } from '../lib/adminApi';
import { hasRole, useAuth } from '../lib/auth';
import AdminLogin from './AdminLogin';
import { ADMIN_LOGO, ADMIN_PRODUCT_NAME } from './adminTheme';
import { COORD_NAV, isNavActive, SORTEO_NAV, STAFF_NAV, type AdminNavItem } from './navigation';

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '·';

const NAV_ICONS: Record<string, LucideIcon> = {
  '/coordinacion': House,
  '/coordinacion/participantes': UsersRound,
  '/coordinacion/talleres': Shapes,
  '/coordinacion/operacion-en-vivo': Activity,
  '/coordinacion/configuracion': Settings2,
  '/coordinacion/sorteo': TicketCheck,
};

export default function AdminLayout() {
  const { ready, staff, profile, signOut, signOutError } = useAuth();
  const { edition, loading } = useEdition();
  const [open, setOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const closeDrawer = () => {
    workspace.current?.removeAttribute('inert');
    setOpen(false);
    menuTrigger.current?.focus();
  };

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeDrawer(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    workspace.current?.setAttribute('inert', '');
    return () => {
      document.body.style.overflow = previousOverflow;
      workspace.current?.removeAttribute('inert');
    };
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
          {signOutError && <Alert tone="error">{signOutError}</Alert>}
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
      <a href="#admin-main" className="admin-skip-link">Saltar al contenido</a>
      <aside
        id="admin-navigation"
        className={`admin-sidebar fixed inset-y-0 left-0 z-40 flex w-[15.5rem] flex-col overflow-y-auto border-r border-line px-4 py-6 transition-transform duration-200 lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 ${
          open ? 'translate-x-0 visible' : '-translate-x-full invisible lg:visible'
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
          <button className="admin-icon-button lg:hidden" onClick={closeDrawer} aria-label="Cerrar menú">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="admin-nav-heading px-3">Espacio de trabajo</p>
        <nav aria-label={navLabel} className="mt-3 flex-1 space-y-1">
          {items.map((item) => {
            const active = isNavActive(item, pathname);
            const Icon = NAV_ICONS[item.to] ?? House;
            return (
              <NavLink key={item.to} to={item.to} end={item.end} onClick={close} data-active={active}
                aria-current={active ? 'page' : undefined} className="admin-nav-link">
                <Icon className="admin-nav-icon h-[1.15rem] w-[1.15rem] shrink-0" strokeWidth={1.9} aria-hidden />
                <span className="flex-1">{item.label}</span>
                {active && <span className="admin-nav-active-dot" aria-hidden />}
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
          {signOutError && <p role="alert" className="mt-1 text-xs text-error-600">{signOutError}</p>}
        </div>
      </aside>
      {open && <button className="fixed inset-0 z-30 bg-ink/30 lg:hidden" onClick={closeDrawer} aria-label="Cerrar menú" />}

      <div ref={workspace} className="admin-workspace min-w-0 flex-1">
        <header className="admin-topbar sticky top-0 z-20 flex items-center gap-3 border-b border-line px-4 sm:px-8 lg:px-10">
          <button ref={menuTrigger} onClick={() => setOpen(true)} className="admin-icon-button lg:hidden" aria-label="Abrir menú" aria-controls="admin-navigation" aria-expanded={open}>
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.13em] text-ink-muted">{coord ? 'Coordinación / Día OV' : 'Personal / Día OV'}</p>
            <p className="truncate text-sm font-bold text-ink">{currentLabel}</p>
          </div>
        </header>
        <main id="admin-main" tabIndex={-1} className={`admin-content mx-auto p-4 sm:p-7 lg:p-9 ${pathname.startsWith('/coordinacion/operacion-en-vivo') ? 'max-w-[90rem]' : 'max-w-[82rem]'}`}>
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
