import { Suspense } from 'react';
import { MapPinned } from 'lucide-react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Backdrop } from '../components/themed';
import { BootSpinner } from '../components/BootSpinner';
import RouteErrorBoundary from '../components/RouteErrorBoundary';
import { useAuth } from '../lib/auth';
import { useEdition } from '../edition/EditionProvider';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import BottomNav from './BottomNav';
import { MapLink } from './campus/mapLinks';
import ExitSurveyInvite from './ExitSurveyInvite';
import { ExitSurveyProvider } from './ExitSurveyProvider';
import { RafflePrizeProvider } from './RafflePrizeProvider';
import WinnerNotice from './WinnerNotice';

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
    <RafflePrizeProvider enabled={consentOk}>
    <ExitSurveyProvider enabled={consentOk}>
      <div className="relative min-h-dvh">
        <Backdrop />
        {/* Slim header: vertical space on a phone is for the event, not for chrome. Sign-out lives in Bitácora.
            The right slot is the campus map: «¿dónde queda?» is the question a student asks most during the event, and the
            map has no tab of its own (Bitácora already has one, so the old initials badge only duplicated it). */}
        <header className="sticky top-0 z-30 border-b border-line/60 bg-surface-sunken/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="mx-auto flex h-12 max-w-2xl items-center justify-between px-4">
            <div className="flex min-w-0 items-center gap-2">
              {theme.assets.logoMark && <img src={theme.assets.logoMark} alt="" className="h-6 w-6 object-contain" />}
              <span className="truncate font-display text-sm font-extrabold uppercase tracking-wider">{theme.meta.eventName}</span>
            </div>
            {consentOk &&
              (location.pathname === '/mapa' ? (
                // Already on the map: the badge only says so (a link to itself would also overwrite «Volver»).
                <span aria-current="page" className="inline-flex h-11 items-center gap-1.5 rounded-full bg-primary-500 px-3.5 text-xs font-extrabold text-on-primary ring-1 ring-primary-500">
                  <MapPinned className="h-4 w-4" aria-hidden />
                  Mapa
                </span>
              ) : (
                // MapLink carries the screen we come from, so «Volver» on the map returns there and not always to Inicio.
                <MapLink
                  to="/mapa"
                  ariaLabel="Mapa del campus"
                  className="inline-flex h-11 items-center gap-1.5 rounded-full bg-primary-500/15 px-3.5 text-xs font-extrabold text-fg-brand ring-1 ring-primary-500/45 transition-colors hover:bg-primary-500/25"
                >
                  <MapPinned className="h-4 w-4" aria-hidden />
                  Mapa
                </MapLink>
              ))}
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
        {consentOk && <WinnerNotice />}
        {consentOk && <ExitSurveyInvite />}
      </div>
    </ExitSurveyProvider>
    </RafflePrizeProvider>
  );
}
