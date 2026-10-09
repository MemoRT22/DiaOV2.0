import { Suspense } from 'react';
import { Navigate, Link, Outlet, useLocation } from 'react-router-dom';
import { Backdrop } from '../components/themed';
import { BootSpinner } from '../components/BootSpinner';
import RouteErrorBoundary from '../components/RouteErrorBoundary';
import { useAuth } from '../lib/auth';
import { useEdition } from '../edition/EditionProvider';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import BottomNav from './BottomNav';

const initials = (name: string | undefined) =>
  (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '·';

export default function StudentLayout() {
  const { ready, profile } = useAuth();
  const { theme, loading } = usePublicTheme();
  const { edition } = useEdition();
  const location = useLocation();

  if (!ready || loading) return <BootSpinner />;
  if (!profile) return <Navigate to="/" replace />;

  const consentOk = !!edition && profile.platform_consent_version === edition.privacy_notice_version;
  const onWelcome = location.pathname === '/bienvenida';
  if (!consentOk && !onWelcome) return <Navigate to="/bienvenida" replace />;
  if (consentOk && onWelcome) return <Navigate to="/bitacora" replace />;

  return (
    <div className="relative min-h-dvh">
      <Backdrop />
      {/* Slim header: vertical space on a phone is for the event, not for chrome. Sign-out lives in Bitácora. */}
      <header className="sticky top-0 z-30 border-b border-line/60 bg-surface-sunken/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-12 max-w-2xl items-center justify-between px-4">
          <div className="flex min-w-0 items-center gap-2">
            {theme.assets.logoMark && <img src={theme.assets.logoMark} alt="" className="h-6 w-6 object-contain" />}
            <span className="truncate font-display text-sm font-extrabold uppercase tracking-wider">{theme.meta.eventName}</span>
          </div>
          {consentOk && (
            <Link
              to="/pasaporte"
              aria-label={`Mi bitácora, ${profile.display_name}`}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-500/20 text-xs font-extrabold text-fg-brand ring-1 ring-primary-500/50"
            >
              {initials(profile.display_name)}
            </Link>
          )}
        </div>
      </header>

      <main className={`relative mx-auto max-w-2xl px-4 pt-5 ${consentOk ? 'pb-[calc(6.5rem+env(safe-area-inset-bottom))]' : 'pb-10'}`}>
        <RouteErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<BootSpinner />}>
            <Outlet />
          </Suspense>
        </RouteErrorBoundary>
      </main>

      {consentOk && <BottomNav />}
    </div>
  );
}
