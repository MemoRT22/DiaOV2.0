import { LogOut, Menu, X } from 'lucide-react';
import { Suspense, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEdition } from '../edition/EditionProvider';
import { BootSpinner } from '../components/BootSpinner';
import RouteErrorBoundary from '../components/RouteErrorBoundary';
import { Button, Spinner } from '../components/ui';
import { ROLE_LABELS } from '../lib/adminApi';
import { hasRole, useAuth } from '../lib/auth';
import AdminLogin from './AdminLogin';
import { ADMIN_LOGO, ADMIN_PRODUCT_NAME } from './adminTheme';
import { COORD_NAV, isNavActive, SORTEO_NAV, STAFF_NAV, type AdminNavItem } from './navigation';

const navClass = (active: boolean) =>
  `admin-nav-link group flex min-h-12 items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70 ${
    active ? 'text-ink' : 'text-ink-muted'
  }`;

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '·';

export default function AdminLayout() {
  const { ready, staff, profile, signOut } = useAuth();
  const { edition, loading } = useEdition();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  if (!ready || loading) return <BootSpinner />;
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
        className={`admin-sidebar fixed inset-y-0 left-0 z-40 flex w-72 flex-col overflow-y-auto border-r border-line p-5 shadow-2xl transition-transform duration-300 lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 lg:shadow-none ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-6 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white p-1.5 shadow-[0_8px_20px_-10px_rgba(28,25,23,0.35)] ring-1 ring-line">
              <img src={ADMIN_LOGO} alt="" className="h-full w-full object-contain" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-[0.95rem] font-extrabold leading-tight text-ink">{edition?.name ?? ADMIN_PRODUCT_NAME}</p>
              <p className="text-xs text-ink-muted">Panel del personal</p>
            </div>
          </div>
          <button className="rounded-full p-1 text-ink-muted hover:text-ink lg:hidden" onClick={close} aria-label="Cerrar menú">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mb-7">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-raised px-3 py-1.5 text-xs font-semibold text-ink">
            <span aria-hidden className={`admin-pulse h-2 w-2 rounded-full ${real ? 'bg-emerald-500 text-emerald-500' : 'bg-amber-500 text-amber-500'}`} />
            <span>{real ? 'Operación real' : 'Preparación'}</span>
          </span>
        </div>

        <p aria-hidden className="mb-2 px-2.5 text-[0.65rem] font-bold uppercase tracking-[0.2em] text-ink-muted/70">Menú</p>
        <nav aria-label={navLabel} className="flex-1 space-y-1.5">
          {items.map((item) => {
            const { to, label, icon: Icon, end } = item;
            const active = isNavActive(item, pathname);
            return (
              <NavLink key={to} to={to} end={end} onClick={close} data-active={active} className={() => navClass(active)}>
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                    active
                      ? 'bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-[0_6px_14px_-6px_rgba(242,92,5,0.75)]'
                      : 'bg-neutral-500/10 text-ink-muted group-hover:bg-neutral-500/15 group-hover:text-ink'
                  }`}
                >
                  <Icon className="h-[1.15rem] w-[1.15rem]" aria-hidden />
                </span>
                {label}
              </NavLink>
            );
          })}
        </nav>

        <div className="mt-6 space-y-1.5 border-t border-line pt-4">
          <NavLink
            to="/coordinacion/cuenta"
            onClick={close}
            data-active={pathname.startsWith('/coordinacion/cuenta')}
            className={({ isActive }) => navClass(isActive)}
            aria-label={`Mi cuenta · ${staff.full_name}`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-neutral-600 to-neutral-900 text-xs font-extrabold text-white shadow-md ring-2 ring-white">
              {initials(staff.full_name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-ink">{staff.full_name}</span>
              <span className="block truncate text-xs font-normal text-ink-muted">{roleLabel}</span>
            </span>
          </NavLink>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink-muted transition-colors hover:bg-neutral-500/10 hover:text-ink"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Cerrar sesión
          </button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-stone-950/40 backdrop-blur-sm lg:hidden" onClick={close} />}

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line/70 bg-surface/80 px-4 backdrop-blur-xl lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-xl p-2 text-ink hover:bg-surface-raised" aria-label="Abrir menú">
            <Menu className="h-5 w-5" />
          </button>
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white p-1 shadow-sm ring-1 ring-line">
              <img src={ADMIN_LOGO} alt="" className="h-full w-full object-contain" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-extrabold leading-tight">{ADMIN_PRODUCT_NAME}</span>
              <span className="block truncate text-[0.7rem] leading-tight text-ink-muted">{roleLabel}</span>
            </span>
          </span>
        </header>
        <main className={`admin-rise mx-auto p-4 sm:p-8 lg:p-10 ${pathname.startsWith('/coordinacion/operacion-en-vivo') ? 'max-w-7xl' : 'max-w-6xl'}`}>
          <RouteErrorBoundary resetKey={pathname} home="/coordinacion">
            <Suspense fallback={<Spinner />}>
              <Outlet />
            </Suspense>
          </RouteErrorBoundary>
        </main>
      </div>
    </div>
  );
}
