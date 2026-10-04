import { Compass, LogOut, Orbit, ScrollText } from 'lucide-react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Backdrop } from '../components/themed';
import { Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useTheme } from '../theme/ThemeProvider';

export default function StudentLayout() {
  const { ready, profile, signOut } = useAuth();
  const { theme, edition, text, loading } = useTheme();
  const location = useLocation();

  if (!ready || loading) return <Spinner />;
  if (!profile) return <Navigate to="/" replace />;

  const consentOk = !!edition && profile.platform_consent_version === edition.privacy_notice_version;
  const onWelcome = location.pathname === '/bienvenida';
  if (!consentOk && !onWelcome) return <Navigate to="/bienvenida" replace />;
  if (consentOk && onWelcome) return <Navigate to="/bitacora" replace />;

  const tabs = [
    { to: '/bitacora', label: text('navPassport'), icon: ScrollText },
    { to: '/misiones', label: text('navActivities'), icon: Orbit },
    { to: '/destinos', label: text('navInterests'), icon: Compass },
  ];

  return (
    <div className="relative min-h-dvh">
      <Backdrop />
      <header className="sticky top-0 z-30 border-b border-line/60 bg-surface-sunken/80 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            {theme.assets.logoMark && <img src={theme.assets.logoMark} alt="" className="h-7 w-7 object-contain" />}
            <span className="font-display text-sm font-extrabold uppercase tracking-wider">{theme.meta.eventName}</span>
            {theme.meta.editionLabel && <span className="hidden text-xs text-ink-muted sm:inline">· {theme.meta.editionLabel}</span>}
          </div>
          <button
            onClick={signOut}
            className="-mr-2 inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Salir
          </button>
        </div>
      </header>

      <main className={`relative mx-auto max-w-2xl px-4 pt-6 ${consentOk ? 'pb-28' : 'pb-10'}`}>
        <Outlet />
      </main>

      {consentOk && (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line/60 bg-surface-sunken/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
          <div className="mx-auto grid max-w-2xl grid-cols-3">
            {tabs.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 py-3 text-xs font-semibold transition-colors ${
                    isActive ? 'text-primary-400' : 'text-ink-muted hover:text-ink'
                  }`
                }
              >
                <Icon className="h-5 w-5" aria-hidden />
                {label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
